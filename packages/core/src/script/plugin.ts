/**
 * The plugin contract: `PluginDefinition`, the command handler and its result
 * (AD-8; ADR 0004 decisions 2 and 6).
 *
 * ADR 0004 decision 2 dogfoods the engine's own command library as a plugin, so
 * first-party packs, the TK2 compat layer and a game-shipped plugin all use one
 * shape: `PluginDefinition = { id, version, commands, decoders? }`. Decision 6
 * adds the composition — the host resolves manifest ids to definitions and
 * hands an ordered list to `script/registry.ts`, which layers them, later first.
 *
 * The handler is AD-8's functional contract,
 * `(view, args, next) -> { value, out?, effects?, wait? }`:
 *
 * - `view` is read-only: game state plus the injected `rng` and `clock` ports
 *   (decision U2). A command mutates no state, which is what makes a command
 *   replayable and the registry pure.
 * - `value` is the call's result (`null` when there is none). ADR 0004 writes
 *   the contract as `{ out, effects, wait? }`; the call's value is what the VM
 *   pushes for `x = command()`, and the tracer's `done` carried it before this
 *   entry. The plan's edge-case matrix is explicit that the empty result of a
 *   `next` with no layer below has "value `null`" beside no `out`, no `effects`
 *   and no `wait`.
 * - `out` carries by-reference outputs as `[index, Value]` pairs; the VM writes
 *   each back to the caller's variable (AD-8's `Arg.ref`, AD-14's `null`).
 * - `effects` are plain-data records the VM stamps with `{ seq, tick, thread,
 *   name, … }` and stores in the `vm` section's effect log; the section owners
 *   drain them and apply the change (AD-10; decision U1; entry 21).
 * - `wait` parks the calling thread; a blocking command's wait is `global`
 *   (R-32) and freezes every other script thread (AD-9).
 * - `request` with `then` asks the host for something (ADR 0004 decision 7).
 *   The VM parks the calling thread in a `request` wait, records the request
 *   (stamped with a `reqId`) in the effect log, and on the reply runs the named
 *   continuation with the reply prepended (`ok` as `1`/`0`, then the value)
 *   to `then.args`. `timeoutTicks` bounds the wait in ticks (AD-5).
 *
 * docs/adr/0004 (decisions 2 and 6); AD-8, AD-10.
 */

import type {
  InventoryAction,
  ItemActionRequest,
  ItemActionResult,
  MenuAction,
  PartyAction,
  SectionOwnerPort,
} from "../menu/ports.ts";
import type { InventorySection, MenuSection, MenuStateResult, PartySection } from "../menu/model.ts";
import type { PlainData } from "../ports/plain-data.ts";
import type { RngPort } from "../ports/rng.ts";
import type { ClockPort } from "../ports/time.ts";
import type { Value } from "../ports/value.ts";
import type { NativeListener } from "../events/model.ts";
import type { Wait } from "../ports/wait.ts";
import type { GameState, SectionKey } from "../save/state.ts";
import type { ActorService } from "../actors/port.ts";
import type { BattleOwner } from "../battle/port.ts";
import type { SourcePos } from "./ops.ts";
import type { Arg, BuiltinSpec } from "./builtins.ts";
import type { EffectKind } from "./effects.ts";
import type { HostObjectType } from "./host.ts";
import type { ProgramRef } from "./program.ts";
import type { HostRequestKind } from "./manifest.ts";
import type { ActorHooks } from "../actors/rules.ts";
import type { MediaScriptService } from "../audio/script.ts";

import type { AssetDecoder } from "../formats/registry/decoder.ts";

/** Read-only game setup data consumed by battle-start commands. */
export type BattleStartView = {
  readonly enemies: readonly { readonly enemyFile: string; readonly skillLevel: number }[];
  readonly stockBattleAvailable: boolean;
  /** Runtime check for a package-registered `battle()` handler. */
  readonly hasBattleHandler?: () => boolean;
};
/**
 * The read-only view a command runs against (AD-8; decision U2). It holds game
 * state read-only plus the two injected ports a command may draw from: the
 * seeded RNG (a draw advances `GameState.rng`, the one declared exception to
 * "a command mutates nothing") and the clock (G3).
 */
export type CommandView = {
  readonly rng: RngPort;
  readonly clock: ClockPort;
  readonly state?: GameState;
  /** Refresh the composed screen before a script-visible pixel read; host polling never invokes it. */
  readonly refreshScreen?: () => void;
  /** The script-facing media owner (MEDIA-1): `mediaPlay`, track/voice objects and their operations. */
  readonly media?: MediaScriptService;
  /** Read one live object's members without writing them; the media option and method commands use it. */
  readonly objectMembers?: (handle: number) => Readonly<Record<string, Value>> | undefined;
  /**
   * The owner-held actor operations (docs/spec/engine/actors.md#store-and-action-boundary).
   * Every write resolves the actor's behaviour hooks and publishes the resulting
   * transitions; a command never patches the actor section directly.
   */
  readonly actors?: ActorService;
  /** Owner-mediated access to the saved battle section. */
  readonly battle?: BattleOwner;
  /** Main-file enemy pool and package battle handler for start commands. */
  readonly battleStart?: BattleStartView;
  /**
   * The AD-17 `GameId` that scopes host storage, or `null` when the engine has
   * none (a scene engine): save-area commands then fail with
   * `save.no-game-identity` instead of inventing a namespace.
   */
  readonly gameId: string | null;
  /** Manifest options for the layer currently handling this command. */
  readonly options?: PlainData;
  /** True only while package startup is running; exposed read-only to lifecycle-aware built-ins. */
  readonly packageStartup?: boolean;
  /** The id of the thread whose call is running; the VM sets it before every call. */
  readonly thread?: number;
  /**
   * The call site's source position: the `pos` of the `call` instruction the VM is
   * executing. A command that has to name where it was called (the spec runner's
   * `specResult`, a formatter or linter diagnostic) reads it here instead of
   * threading a position through its arguments, which the language has no
   * expression for (TOOL-5).
   */
  readonly pos?: SourcePos;
  /** Main-file game-over program selected by the boot owner. */
  readonly gameOverProgram?: string | null;
  /** Mark the next eligible settled point for one engine recovery capture. */
  readonly requestRecoveryCapture?: () => void;
};

/**
 * One side effect a command reports as plain data (AD-10; decision U1). The
 * owning module applies it; a command never mutates a section itself.
 *
 * `section` names the AD-10 section the command writes; the VM turns it into
 * the recorded `EffectPatch` (`path: []`, `op: "merge"`, `value: null`). A
 * `pure` command reports no section, so its record's patch is `null`. `args`
 * lets a command report the arguments to record; absent means the VM records
 * the call's own argument values. `vm.control` is an internal marker the core
 * pack uses to unwind control flow (FUN-7): it is consumed by the VM and never
 * becomes an `EffectRecord`.
 */
export type CommandEffect = {
  readonly kind: EffectKind | "vm.control";
  readonly section?: SectionKey;
  readonly args?: readonly PlainData[];
};

/**
 * The continuation a `request` resumes with (ADR 0004 decision 7): a named
 * command plus plain-data arguments, never a closure, so it survives a save.
 */
export type CommandContinuation = {
  readonly command: string;
  readonly args: readonly PlainData[];
};

/**
 * A host request a command wants performed (AD-5, AD-17). The VM treats it as
 * plain data: it stamps a `reqId`, records it in the effect log for the host,
 * and parks the calling thread until the reply (or the tick deadline).
 */
export type CommandRequest = {
  readonly kind: string;
  readonly [field: string]: PlainData;
};

/**
 * What a command returns (AD-8). Only `value` is always present; every other
 * field is optional, so a command that returns nothing writes `{ value: null }`.
 */
export type CommandResult = {
  readonly value: Value;
  readonly out?: readonly (readonly [number, Value])[];
  readonly effects?: readonly CommandEffect[];
  readonly wait?: Wait;
  readonly request?: CommandRequest;
  readonly then?: CommandContinuation;
  readonly timeoutTicks?: number;
};

/**
 * The command contract `(view, args, next) -> CommandResult` (AD-8).
 *
 * `next` is the definition the same name has in the layer below: a wrapper may
 * call it and adjust its result, or ignore it and replace the command. Where no
 * lower layer defines the name `next` returns the empty result and warns
 * (decision U4).
 */
export type CommandHandler = (
  view: CommandView,
  args: readonly Arg[],
  next: CommandHandler,
) => CommandResult;

export type PluginDoc = {
  readonly summary: string;
  readonly groups?: readonly { readonly id: string; readonly name: string; readonly summary: string }[];
  readonly requires?: readonly string[];
};

/** Menu facade screen identifiers (E-80, #588). */
export type MenuScreenId = "main" | "items" | "equipment" | "abilities";
export type MenuProviderEvent =
  | { readonly type: "enter" }
  | { readonly type: "input"; readonly key: string }
  | { readonly type: "child.closed"; readonly screen: MenuScreenId }
  | { readonly type: "item.action.completed"; readonly result: ItemActionCompletion };
export type ItemActionCommand = ItemActionRequest;
export type ItemActionCompletion = ItemActionResult;
export type ItemActionProviderResult = {
  readonly kind: "item.action";
  readonly state: PlainData;
  readonly action: ItemActionCommand;
};
/**
 * The menu context a native provider may use. It exposes the same owner sections a script provider
 * sees, but not the VM's item-action preflight/commit operations: a native provider requests an
 * `item.action` transition and the VM runs the composed operation on the calling thread.
 */
export type MenuProviderContext = {
  readonly party: SectionOwnerPort<PartySection, PartyAction>;
  readonly menu: SectionOwnerPort<MenuSection, MenuAction> & {
    updateCurrent(input: { readonly actorId: number | null; readonly selection: number }): MenuStateResult;
  };
  readonly shop: {
    readonly stock: () => readonly string[];
    activate(sources: unknown): MenuStateResult;
    close(): void;
  };
  readonly inventory: SectionOwnerPort<InventorySection, InventoryAction>;
};
export type MenuProviderInput = {
  readonly providerId: string;
  readonly context: MenuProviderContext;
  readonly state: PlainData;
  readonly event: MenuProviderEvent;
};
export type MenuProviderResult =
  | { readonly kind: "wait"; readonly state: PlainData; readonly wait: Wait }
  | { readonly kind: "open"; readonly state: PlainData; readonly screen: MenuScreenId }
  | { readonly kind: "complete" }
  | ItemActionProviderResult;
export type MenuProvider = (input: MenuProviderInput) => MenuProviderResult;

/** Package-scoped actor behaviour registration available during start-up. */
export type BehaviourRegistrar = (name: string, hooks: ActorHooks) => boolean;
/** One plugin: an ordered command and asset pack (ADR 0004 decisions 2 and 6). */
export type PluginDefinition = {
  readonly id: string;
  readonly version: string;
  readonly commands: readonly BuiltinSpec[];
  /** Whole-screen menu transitions keyed by canonical screen token (E-80, #588). */
  readonly menuProviders?: Partial<Readonly<Record<MenuScreenId, MenuProvider>>>;
  /** Ordered package track configuration applied during game boot (MEDIA-4); files remain RPGCode-selected. */
  readonly audioTracks?: readonly { readonly name: string; readonly voiceCount?: number }[];
  /** Optional plain-data package documentation, excluded from VM state. */
  readonly doc?: PluginDoc;
  /** Optional format contributions layered after the core decoder set (AD-31). */
  readonly decoders?: readonly AssetDecoder[];
  /**
   * TypeScript listeners the package declares on the one event bus (EMIT-7, EMIT-21). Each
   * names an emitter key, an event type and one of this definition's commands; the engine
   * adds it to the listener table when the package starts, and the dispatcher runs the
   * command with the event as its argument. A command sends an event by returning the
   * `emit` effect (`emitEffect`), never by calling a listener.
   */
  readonly listeners?: readonly NativeListener[];
  /** Session-only host object declarations hydrated by type name (OOP-12). */
  readonly hostTypes?: readonly HostObjectType[];
  /**
   * Package-scoped actor behaviour registration. The host calls this during
   * `runPackageStartup`, passing a registrar that accepts only this package's
   * declared namespace.
   */
  readonly behaviourStartup?: (registerBehaviour: BehaviourRegistrar) => void;
};

/** A host-resolved package record; core receives definitions and source from the runner (G2). */
export type PackageCatalogueEntry = {
  readonly name: string;
  readonly version: string;
  readonly namespace?: string;
  readonly requests: readonly HostRequestKind[];
  readonly definition: PluginDefinition;
  readonly startup?: ProgramRef;
};

export type ResolvedPackageMetadata = {
  readonly name: string;
  readonly version: string;
  readonly namespace: string;
  readonly requests: readonly HostRequestKind[];
};

/**
 * A host-resolved definition plus its manifest configuration. `namespace` is set
 * for a package entry (PKG-2, PKG-4): the host copies `packageNamespace(entry)`, and
 * `namespace.name(...)` then reaches this definition's own layer of `name`. A native
 * pack has none.
 */
export type ResolvedPlugin = {
  readonly definition: PluginDefinition;
  readonly options?: PlainData;
  readonly namespace?: string;
  readonly package?: ResolvedPackageMetadata;
  readonly startup?: ProgramRef;
};
