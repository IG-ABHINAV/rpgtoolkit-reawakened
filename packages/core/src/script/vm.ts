/**
 * The script step machine (G1; AD-8/AD-9/AD-26; docs/spec/engine/rpgcode-errors-and-threads.md#threads THR-3).
 *
 * Dispatches the full StepOp instruction set, function call frames with
 * overloading by arity, by-reference parameter aliasing, `return &lvalue`,
 * truthiness and operator semantics per SEM-3, control effects for FUN-7
 * unwinding, and source positions on every error.
 *
 * docs/adr/0004; docs/spec/engine/rpgcode-errors-and-threads.md#threads (THR-3) (SEM-3/SEM-4/SEM-5/SEM-6).
 */

import { pow } from "../fmath/index.ts";
import { observe, observePlugins, type ScriptObservers, type CallObservation } from "./observers.ts";
import type { Diagnostic } from "../ports/engine.ts";
import type { Logger } from "../ports/logger.ts";
import type { PlainData } from "../ports/plain-data.ts";
import type { CallableValue, ObjectValue, RefId, Value, VarScope } from "../ports/value.ts";
import type { Wait, WaitPoll, WaitReply, WaitView } from "../ports/wait.ts";
import { createRngPort } from "../rng/xoshiro.ts";
import type { GameState, SectionKey } from "../save/state.ts";
import type { ClockPort } from "../ports/time.ts";
import { createClockPort, MAX_TICK, runTimePhase } from "../time/time.ts";
import { createActorHostType, createActorService, type ActorService } from "../actors/port.ts";
import { createBattleOwner } from "../battle/port.ts";
import { BATTLE_HOST_TYPE, createBattleHostType } from "../battle/host.ts";
import { createActorEventSink } from "../actors/object.ts";
import { createBehaviourRegistry, resolveBehaviour, type BehaviourRegistry } from "../actors/behaviour.ts";
import { createMenuOwnerPorts, type MenuOwnerPorts } from "../menu/ports.ts";
import type { Arg, BuiltinSpec } from "./builtins.ts";
import { createDefaultVirtuals, type VirtualVariablePort } from "./virtuals.ts";
import { MEDIA_HOST_TYPES, objectValue, mediaVoiceRef, type MediaPlayOptions, type MediaScriptService } from "../audio/script.ts";
import { recordDiagnostic, recordEffect, type EffectRecord } from "./effects.ts";
import type { HostObjectContext, HostObjectType } from "./host.ts";
import {
  ASSIGN_READ_ONLY,
  CALLABLE_ARITY,
  CALLABLE_NOT_CALLABLE,
  CALLABLE_UNKNOWN_DEF,
  failureClass,
  HANDLER_NOT_HANDLING,
  HANDLER_TOP_LEVEL,
  HANDLER_UNKNOWN_LABEL,
  INCLUDE_CYCLE,
  KILL_SYSTEM_OWNED,
  locateError,
  ScriptError,
  toDiagnostic,
} from "./errors.ts";
import { NULL_LOGGER } from "./logging.ts";
import { ENGINE_DEFAULT_MANIFEST, foldNamespace, isPlainData } from "./manifest.ts";
import { collectCells, eachLiveRoot, recordOwner } from "./cells.ts";
import {
  addNativeMenuProvider,
  addRegistration,
  createPluginLayers,
  layerIdOf,
  layerRoots,
  registrationIdOf,
  removeHandle,
  removeRegistration,
  topLayerHandle,
  topMenuProvider,
  type LayerRequest,
  type MenuProviderRequest,
  type PluginLayers,
} from "./layers.ts";
import { collectStateGarbage, runEventsPhase } from "../events/dispatch.ts";
import { applyEmitEffect, applyEmitterOp, EVENT_DISPATCH_WAIT, forgetEmitter, isEmitterMethod, isHostMethodDef, queueErrorEvent, queueNativeEvent, registerEmitter } from "../events/emitter.ts";
import { GAME_EMITTER, type EventsSection } from "../events/model.ts";
import { registerNativeListeners } from "../events/native.ts";
import { classInfo, findMember, findMethod } from "./classes.ts";
import { hostMethodDef, parseHostMethodDef } from "./host.ts";
import {
  checkMemberAccess,
  createObject,
  DICTIONARY_CLASS,
  findObject,
  instantiate,
  isDictionary,
  objectRef,
  parseObjectRef,
  readMember,
  removeMember,
  writeMember,
} from "./objects.ts";
import { createProgramCache, type ProgramCache } from "./cache.ts";
import { createPackageFunctionSource, followPackageInclude } from "./package-exports.ts";
import { runModuleCommand } from "./modules.ts";
import { MODULE_COMMANDS } from "./parse.ts";
import type { SourcePos, StepOp } from "./ops.ts";
import type { CommandResult, CommandRequest, CommandView, ResolvedPlugin, MenuProvider, MenuProviderEvent, MenuProviderResult, MenuScreenId } from "./plugin.ts";
import {
  IR_VERSION,
  fileProgramRef,
  restartProgramRef,
  withRedirects,
  type ProgramLoader,
  type FunctionInfo,
  type Program,
  type ProgramRef,
  type StatementRange,
} from "./program.ts";
import {
  assembleCommands,
  bindingOf,
  createCommandLookup,
  resolveCall,
  resolveNamespaced,
  type CallResolution,
  type CommandLookup,
} from "./registry.ts";
import {
  cellRef,
  findBlockingThread,
  findThread,
  globalRef,
  incrementStepCounter,
  killThread,
  localRef,
  refreshBlock,
  startThread,
  virtualRef,
  type Frame,
  type LocalSlot,
  type ObjectRecord,
  type Thread,
  type VmState,
} from "./state.ts";
import { defaultWaitPoll, describeWait } from "./waits.ts";
import {
  compareEqual,
  compareRelational,
  foldAscii,
  indexKey,
  isCallableValue,
  toInt32,
  toNumberValue,
  toStringValue,
  truthy,
} from "./values.ts";

/**
 * The per-thread, per-tick VM-step budget (docs/spec/engine/rpgcode-errors-and-threads.md THR-3, R-33).
 * A fixed number, not a frame-rate formula: 1000 is the tuning point the
 * stress tests exercise, and callers may pass a smaller budget to a phase.
 */
export const STEP_BUDGET = 1000;


/** What one tick left the script threads doing. */
export type ScriptStatus = "running" | "waiting" | "finished";

/**
 * Everything the script phases need that is not state. `logger` is the human
 * debug channel (AD-24); `diagnostics` collects the located host diagnostics
 * of every runtime failure until the engine drains them into a `TickReport`.
 */
export type PackageStartupLifecycle = {
  active: boolean;
  packageName: string | undefined;
};

export type ScriptServices = ScriptObservers & {
  /** Attribution only, built from the same resolved manifest as dispatch. */
  readonly callPlugin?: (name: string, namespace?: string) => string | undefined;
  readonly view: CommandView;
  /** Unrestricted clock used by the deterministic VM scheduler; commands use view.clock. */
  readonly clock: ClockPort;
  /** Private lifecycle capability; native command code receives no startup-mode mutator. */
  readonly isPackageStartup: () => boolean;
  readonly packageStartupForbidden: (operation: string) => ScriptError;
  readonly setPackageStartup: (active: boolean, packageName?: string) => void;
  readonly setCommandThread: (thread: number | undefined) => void;
  /** Set the call site the command view reports as `pos` (TOOL-5). */
  readonly setCommandPos: (pos: SourcePos | undefined) => void;
  /** Listener baseline captured before this service installs its plugin listeners. */
  readonly listenersBeforePackageStartup: readonly GameState["events"]["listeners"][number][];
  readonly commands: CommandLookup;
  readonly programs: ProgramCache;
  /** Where file programs and includes load from; absent when the host serves none (G2). */
  readonly loader?: ProgramLoader;
  readonly virtuals: VirtualVariablePort;
  readonly logger: Logger;
  readonly diagnostics: Diagnostic[];
  /** Actor operations resolve the session behaviour before applying core rules. */
  readonly actors: ActorService;
  /** Session-only actor behaviour registrations; never saved as game state. */
  readonly behaviours: BehaviourRegistry;
  readonly pluginOptions: ReadonlyMap<string, PlainData>;
  /** The packages' session data, rebuilt at boot/reset/restore. */
  readonly hiddenFileWarned: Set<string>;
  /** Session host declarations keyed by the saved object's `hostType` name. */
  readonly hostTypes: ReadonlyMap<string, HostObjectType>;
  /**
   * The command layers `registerPlugin` registered (MOD-4, PKG-5; entry 19.8): session data, never state,
   * rebuilt by package start-up and not saved. A call reaches them through the first entry of the environment table.
   */
  readonly layers: PluginLayers;
  /** Native whole-screen transition handlers, session-only; keys include manifest identity. */
  readonly menuProviders: ReadonlyMap<string, MenuProvider>;
  readonly menuProviderIdentityExists: (id: string) => boolean;
  readonly menuOwners: MenuOwnerPorts;
  /** Synchronous engine cleanup after a thread is removed, before the command resumes. */
  readonly onThreadRemoved?: (threadId: number) => void;
  /** Script-facing request for one engine-owned interruption-recovery candidate. */
  readonly requestRecoveryCapture?: () => void;
  /** Engine-owned synchronous dispatch for recorded command effects. */
  readonly postEffect?: (section: SectionKey, effect: EffectRecord) => void;
  /** Engine-owned synchronous host-request dispatch hook. */
  readonly postRequest?: (request: CommandRequest) => void;
  /** The script-facing media owner (MEDIA-1), when the engine provides one. */
  readonly media?: MediaScriptService;
};

function isMenuProviderResult(value: unknown): value is MenuProviderResult {
  if (!isPlainData(value) || typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.kind === "complete") return true;
  if (!Object.hasOwn(result, "state")) return false;
  if (result.kind === "open") {
    return result.screen === "main" || result.screen === "items" || result.screen === "equipment" || result.screen === "abilities";
  }
  if (result.kind !== "wait" || result.wait === null || typeof result.wait !== "object" || Array.isArray(result.wait)) return false;
  const wait = result.wait as Record<string, unknown>;
  return wait.kind === "menu.screen" && wait.global === true && typeof wait.id === "string" &&
    Array.isArray(wait.payload) && Array.isArray(wait.resumeRefs) && wait.resumeRefs.every((ref) => typeof ref === "string");
}

function handleMenuProviderFailure(
  thread: Thread,
  vm: VmState,
  services: ScriptServices,
  continuation: { readonly [key: string]: PlainData },
  caught: unknown,
): void {
  const baseDepth = Number.isSafeInteger(continuation.menuBaseDepth) ? Number(continuation.menuBaseDepth) : 0;
  const cleanup = services.menuOwners.menu.apply({
    type: "navigation",
    screens: services.menuOwners.menu.read().screens.slice(0, baseDepth),
  });
  if (!cleanup.ok) throw new ScriptError("menu.state-refused", cleanup.error?.message ?? "menu frame cleanup was refused");
  const frameIndex = Number(continuation.frameIndex);
  const opIp = Number(continuation.opIp);
  const depth = Number(continuation.depth);
  const callerFrame = thread.frames[frameIndex];
  if (callerFrame === undefined || !Number.isSafeInteger(opIp) || !Number.isSafeInteger(depth)) {
    throw new ScriptError("restore.menu-provider", "menu provider error continuation cannot be unwound");
  }
  const callerProgram = services.programs.get(callerFrame.program);
  const op = callerProgram.ops[opIp];
  if (op === undefined) throw new ScriptError("restore.menu-provider", "menu provider error instruction is unavailable");
  const pos = {
    file: typeof continuation.file === "string" ? continuation.file : "<menu>",
    line: typeof continuation.line === "number" ? continuation.line : 0,
  };
  const error = caught instanceof ScriptError
    ? new ScriptError(caught.code, caught.message, pos)
    : new ScriptError("menu.provider-error", caught instanceof Error ? caught.message : String(caught), pos);
  thread.frames.length = frameIndex + 1;
  handleFailure(thread, vm, services, callerProgram, callerFrame, op, opIp, depth, error);
}

/** Take every diagnostic collected since the last drain, oldest first. */
export function drainDiagnostics(services: ScriptServices): Diagnostic[] {
  return services.diagnostics.splice(0, services.diagnostics.length);
}

/** The cache key is owned by `programKey`, which includes dialect and module metadata. */
export function createScriptServices(
  state: GameState,
  plugins: readonly ResolvedPlugin[] = [],
  logger: Logger = NULL_LOGGER,
  virtuals?: VirtualVariablePort,
  loaderOrGameId?: ProgramLoader | string,
  explicitGameId?: string | null,
  postEffect?: (section: SectionKey, effect: EffectRecord) => void,
  postRequest?: (request: CommandRequest) => void,
  layers: PluginLayers = createPluginLayers(),
  hostTypes: readonly HostObjectType[] = [],
  packageStartup: boolean | PackageStartupLifecycle = false,
  media?: MediaScriptService,
  observers?: ScriptObservers,
  menuPorts?: MenuOwnerPorts,
  gameOverProgram: string | null = null,
  battleStart?: CommandView["battleStart"],
  onThreadRemoved?: (threadId: number) => void,
  requestRecoveryCapture?: () => void,
  beforeBattleStart?: () => void,
  refreshScreen?: () => void,
): ScriptServices {
  const loader = typeof loaderOrGameId === "string" ? undefined : loaderOrGameId;
  const gameId = typeof loaderOrGameId === "string" ? loaderOrGameId : explicitGameId ?? null;
  const runtimeRng = createRngPort(state.rng);
  const runtimeClock = createClockPort(state.time);
  const lifecycle: PackageStartupLifecycle = typeof packageStartup === "boolean" ? { active: packageStartup, packageName: undefined } : packageStartup;
  const packageStartupActive = lifecycle;
  const packageStartupName = lifecycle;
  const startupForbidden = (operation: string): ScriptError =>
    new ScriptError("package.startup-forbidden", `package "${packageStartupName.packageName ?? "unknown"}" startup cannot ${operation}`);
  let commandThread: number | undefined;
  let commandPos: SourcePos | undefined;
  const listenersBeforePackageStartup = [...state.events.listeners];
  const commandState = new Proxy(state, {
    get(target, property, receiver) {
      if (packageStartupActive.active && (property === "rng" || property === "time")) {
        throw startupForbidden(property === "rng" ? "consume the seeded RNG" : "read the simulation clock");
      }
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (packageStartupActive.active && (property === "rng" || property === "time")) {
        throw startupForbidden(property === "rng" ? "consume the seeded RNG" : "read the simulation clock");
      }
      return Reflect.set(target, property, value, receiver);
    },
    getOwnPropertyDescriptor(target, property) {
      if (packageStartupActive.active && (property === "rng" || property === "time")) {
        throw startupForbidden(property === "rng" ? "consume the seeded RNG" : "read the simulation clock");
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    defineProperty(target, property, descriptor) {
      if (packageStartupActive.active && (property === "rng" || property === "time")) {
        throw startupForbidden(property === "rng" ? "replace the seeded RNG" : "replace the simulation clock");
      }
      return Reflect.defineProperty(target, property, descriptor);
    },
    deleteProperty(target, property) {
      if (packageStartupActive.active && (property === "rng" || property === "time")) {
        throw startupForbidden(property === "rng" ? "delete the seeded RNG" : "delete the simulation clock");
      }
      return Reflect.deleteProperty(target, property);
    },
  });
  const rng = Object.freeze({
    nextUint32: () => {
      if (packageStartupActive.active) throw startupForbidden("consume the seeded RNG");
      return runtimeRng.nextUint32();
    },
  });
  const clock = Object.freeze({
    tick: () => {
      if (packageStartupActive.active) throw startupForbidden("read the simulation clock");
      return runtimeClock.tick();
    },
  });
  const diagnostics: Diagnostic[] = [];
  const behaviours = createBehaviourRegistry(
    plugins.map((plugin) => plugin.namespace ?? plugin.definition.id),
    diagnostics,
  );
  const actors = createActorService(
    state.actors,
    (actor) => resolveBehaviour(behaviours, actor, diagnostics),
    createActorEventSink(state.vm, state.events, state.actors),
  );
  const battle = createBattleOwner({
    readBattle: () => state.battle,
    readActors: () => state.actors,
    commit: (section) => { state.battle = section; },
    readBattleCounter: () => state.engine.nextBattleId,
    commitBattleCounter: (next) => { state.engine = { ...state.engine, nextBattleId: next }; },
    ...(beforeBattleStart === undefined ? {} : { beforeStart: beforeBattleStart }),
  });
  const battleStartView = battleStart === undefined
    ? undefined
    : Object.freeze({
      ...battleStart,
      hasBattleHandler: () => battleStart.stockBattleAvailable || topLayerHandle(layers, "battle") !== undefined,
    });
  const view = Object.freeze({
    rng,
    clock,
    state: commandState,
    actors,
    battle,
    ...(battleStartView === undefined ? {} : { battleStart: battleStartView }),
    ...(refreshScreen === undefined ? {} : { refreshScreen }),
    ...(requestRecoveryCapture === undefined ? {} : { requestRecoveryCapture }),
    ...(media === undefined ? {} : { media }),
    objectMembers: (handle: number) => state.vm.objects.find((record) => record.handle === handle)?.members,
    gameOverProgram,
    gameId,
    get packageStartup() { return packageStartupActive.active; },
    get thread() { return commandThread; },
    get pos() { return commandPos; },
  }) as CommandView;
  const virt = virtuals ?? createDefaultVirtuals(state, actors, media, battle);
  const registry = assembleCommands(observePlugins(plugins, observers?.postHandler), logger);
  for (const problem of registerNativeListeners(state.events, plugins)) {
    logger.warn({
      level: "warn",
      code: problem.reason === "bad-emitter" ? "plugin.listener-bad-emitter" : "plugin.listener-unknown-command",
      message: problem.reason === "bad-emitter"
        ? `plugin "${problem.plugin}" declares a listener on "${problem.listener.emitter}", which is not an emitter key or a pattern of a non-empty prefix followed by one trailing "*"; it was not registered`
        : `plugin "${problem.plugin}" declares a listener for "${problem.listener.type}" on "${problem.listener.emitter}" that names "${problem.listener.command}", which is not one of its commands; it was not registered`,
      data: { plugin: problem.plugin, emitter: problem.listener.emitter, type: problem.listener.type, command: problem.listener.command },
    });
  }
  const pluginOptions = new Map<string, PlainData>();
  const menuProviders = new Map<string, MenuProvider>();
  for (const plugin of plugins) {
    for (const [screen, provider] of Object.entries(plugin.definition.menuProviders ?? {})) {
      if (provider === undefined) continue;
      const id = `${plugin.definition.id}@${plugin.definition.version}:menu:${screen}`;
      menuProviders.set(id, provider);
      addNativeMenuProvider(layers, { id, screen, provider });
    }
  }
  for (const plugin of plugins) {
    if (plugin.options !== undefined) pluginOptions.set(plugin.definition.id, plugin.options);
  }
  // The engine's own packs are the built-in tier (R-35); every other plugin is an extension.
  const builtinPacks = new Set(ENGINE_DEFAULT_MANIFEST.map((entry) => entry.id));
  // The package export index reads compiled programs from the cache created below; it is only asked
  // once a call or a program compile runs, never while this function builds the services.
  const packageFunction = createPackageFunctionSource(layers, (ref) => programs.get(ref));
  const commands = createCommandLookup({
    builtin: (name) =>
      registry.layerPlugins(name).some((id) => builtinPacks.has(id)) ? registry.get(name) : undefined,
    extension: (name) => registry.get(name),
    namespace: { has: (namespace) => registry.hasNamespace(namespace), get: (namespace, name) => registry.getIn(namespace, name) },
    packageFunction,
    owner: (name) => registry.layerPlugins(name).at(-1),
    builtinOwner: (name) => registry.layerPlugins(name).filter((id) => builtinPacks.has(id)).at(-1),
  });
  const hydratedTypes = new Map<string, HostObjectType>();
  hydratedTypes.set("actor", createActorHostType(actors));
  hydratedTypes.set(BATTLE_HOST_TYPE, createBattleHostType());
  if (media !== undefined) for (const type of MEDIA_HOST_TYPES) hydratedTypes.set(type.name, type);
  const menuOwners = menuPorts ?? createMenuOwnerPorts(state);
  for (const plugin of plugins) {
    for (const type of plugin.definition.hostTypes ?? []) hydratedTypes.set(type.name, type);
  }
  for (const type of hostTypes) hydratedTypes.set(type.name, type);
  // Load-time notices (clashes, shadowed built-ins, include cycles) are raised once, when a program
  // compiles: each is a located warn record, and a cycle is also a located host diagnostic (MOD-3).
  const warnedPackageOverrides = new Set<string>();
  const programs: ProgramCache = createProgramCache(
    {
      ...(loader === undefined ? {} : { loader }),
      isBuiltin: (name) => commands.builtin(name) !== undefined,
      packageFunctionOwners: packageFunction.owners,
    },
    (notices) => {
      for (const notice of notices) {
        if (notice.code === INCLUDE_CYCLE) {
          diagnostics.push({
            code: notice.code,
            file: notice.file,
            line: notice.line,
            message: notice.message,
          });
        }
        // A program recompiled for a run-time include meets the same package function again: one warning per binding.
        if (notice.code === "command.overridden" && typeof notice.data === "object" && notice.data !== null && !Array.isArray(notice.data) && notice.data.kind === "package-function") {
          const key = JSON.stringify(notice.data);
          if (warnedPackageOverrides.has(key)) continue;
          warnedPackageOverrides.add(key);
        }
        logger.warn({
          level: "warn",
          code: notice.code,
          message: notice.message,
          data: { file: notice.file, line: notice.line, notice: notice.data },
        });
      }
    },
  );
  return {
    view,
    clock: runtimeClock,
    isPackageStartup: () => packageStartupActive.active,
    packageStartupForbidden: startupForbidden,
    setPackageStartup: (active, packageName) => {
      packageStartupActive.active = active;
      packageStartupActive.packageName = packageName;
    },
    setCommandThread: (thread) => { commandThread = thread; },
    setCommandPos: (pos) => { commandPos = pos; },
    listenersBeforePackageStartup,
    commands,
    programs,
    virtuals: virt,
    logger,
    diagnostics,
    actors,
    behaviours,
    pluginOptions,
    hiddenFileWarned: new Set(),
    hostTypes: hydratedTypes,
    layers,
    menuProviders,
    menuProviderIdentityExists: (id) =>
      menuProviders.has(id) || (layers.menuLayers.get(id) !== undefined && !layers.menuLayers.get(id)!.removed),
    menuOwners,
    ...(loader === undefined ? {} : { loader }),
    ...(postEffect === undefined ? {} : { postEffect }),
    ...(postRequest === undefined ? {} : { postRequest }),
    ...(onThreadRemoved === undefined ? {} : { onThreadRemoved }),
    ...(requestRecoveryCapture === undefined ? {} : { requestRecoveryCapture }),
    ...(media === undefined ? {} : { media }),
    ...observers,
    ...(observers?.postCall === undefined ? {} : {
      callPlugin: (name: string, namespace?: string): string | undefined => {
        if (namespace !== undefined) return plugins.find((plugin) => (plugin.namespace ?? "").toLowerCase() === namespace.toLowerCase())?.definition.id;
        return registry.layerPlugins(name).at(-1);
      },
    }),
  };
}

/**
 * The waits phase (AD-9, AD-26; THR-1, THR-3, R-32). Waiting threads are
 * polled in ascending id, so threads due on the same tick resume in that order
 * and a thread that wakes runs in this tick's threads phase. While a blocking
 * command waits (R-32) only that command's wait is polled; the cooperative
 * waits of the other threads are polled once it resolves, in the same phase.
 * `poll` is AD-9's one resolver; it defaults to the VM-owned kinds.
 */
export function runWaitsPhase(
  vm: VmState,
  view: WaitView,
  poll: WaitPoll = defaultWaitPoll,
  claim?: (seq: number) => void,
  services?: ScriptServices,
  onResolved?: (wait: Wait) => void,
): void {
  const waiting = vm.threads.filter((thread) => thread.status === "waiting" && thread.wait !== null);
  waiting.sort((left, right) => left.id - right.id);
  const blocker = findBlockingThread(vm);
  if (blocker !== null) {
    resolveWait(vm, view, poll, blocker, claim, services, onResolved);
    if (blocker.status === "waiting") {
      refreshBlock(vm, view.tick);
      return;
    }
  }
  for (const thread of waiting) {
    if (thread !== blocker) resolveWait(vm, view, poll, thread, claim, services, onResolved);
  }
  refreshBlock(vm, view.tick);
}

/** Poll one thread's wait; on a result, make the thread ready and hand it the wake value. */
function resolveWait(vm: VmState, view: WaitView, poll: WaitPoll, thread: Thread, claim?: (seq: number) => void, services?: ScriptServices, onResolved?: (wait: Wait) => void): void {
  const wait = thread.wait;
  if (wait === null) return;
  const menuContinuation = wait.kind === "menu.screen" ? wait.payload[0] : null;
  if (menuContinuation !== null && typeof menuContinuation === "object" && !Array.isArray(menuContinuation) &&
      menuContinuation.parkSeq === null) {
    menuContinuation.parkSeq = view.input?.nextSeq ?? 0;
  }
  const result = poll(view, wait);
  if (result === null) return;
  if (result.claim !== undefined) claim?.(result.claim);
  thread.status = "ready";
  thread.wait = null;
  const frame = thread.frames[thread.frames.length - 1];
  if (frame === undefined) {
    thread.status = "finished";
    return;
  }
  onResolved?.(wait);
  if (wait.kind === "menu.screen" && wait.payload[0] !== null && typeof wait.payload[0] === "object" &&
      !Array.isArray(wait.payload[0]) && typeof wait.payload[0].providerId === "string") {
    const saved = wait.payload[0];
    if (services === undefined || saved === null || typeof saved !== "object" || Array.isArray(saved) ||
        typeof saved.providerId !== "string" || typeof saved.screen !== "string") {
      throw new ScriptError("restore.menu-provider", "menu provider continuation is malformed");
    }
    const registered = [...services.layers.menuLayers.values()].find((layer) => layer.id === saved.providerId && !layer.removed);
    if (registered?.kind === "rpgcode") {
      const caller = thread.frames[thread.frames.length - 1]!;
      const program = services.programs.get(caller.program);
      const before = thread.frames.length;
      const context = createObject(vm, null);
      writeMember(context, "screen", saved.screen);
      writeMember(context, "state", null);
      writeMember(context, "event", "enter");
      try {
        const savedFile = typeof saved.file === "string" ? saved.file : "<menu>";
        const savedLine = typeof saved.line === "number" ? saved.line : 0;
        const childPos = program.ops[Math.max(0, caller.ip - 1)]?.pos ?? { file: savedFile, line: savedLine };
        performCallable(thread, vm, services, program, caller, thread.frames.length - 1, registered.provider, [
          { value: { kind: "object", handle: context.handle, className: DICTIONARY_CLASS }, ref: null },
        ], childPos);
      } catch (error) {
        handleMenuProviderFailure(thread, vm, services, saved, error);
        return;
      }
      const childFrame = thread.frames[before];
      if (childFrame !== undefined) {
        childFrame.menuScreen = saved.screen;
        childFrame.menuContinuation = saved as PlainData;
      }
      return;
    }
    const provider = services.menuProviders.get(saved.providerId);
    if (provider === undefined) throw new ScriptError("restore.menu-provider", `menu provider "${saved.providerId}" is not registered`);
    const event: MenuProviderEvent = saved.phase === "enter"
      ? { type: "enter" }
      : saved.phase === "child.closed"
        ? { type: "child.closed", screen: String(saved.childScreen) as MenuScreenId }
        : { type: "input", key: String(result.value) };
    try {
      const transition = provider({
        providerId: saved.providerId,
        context: services.menuOwners,
        state: saved.state as PlainData,
        event,
      });
      if (!isMenuProviderResult(transition)) throw new ScriptError("menu.provider-result", "menu provider returned an invalid or non-plain transition");
      const parents = Array.isArray(saved.parents)
        ? saved.parents as unknown as Array<{ providerId: string; screen: string; state: PlainData }>
        : [];
      if (transition.kind === "wait") {
        if (transition.wait.kind !== "menu.screen" || !transition.wait.global) {
          throw new ScriptError("menu.provider-wait", "menu providers must return a global menu.screen wait");
        }
        thread.wait = {
          ...transition.wait,
          payload: [{ ...saved, state: transition.state, phase: "input", childScreen: null, parkSeq: view.input?.nextSeq ?? null }, ...transition.wait.payload],
        };
        thread.status = "waiting";
        return;
      }
      if (transition.kind === "open") {
        const child = topMenuProvider(services.layers, transition.screen);
        if (child === undefined) throw new ScriptError("menu.provider-missing", `no menu provider is registered for "${transition.screen}"`);
        const pushed = services.menuOwners.menu.apply({
          type: "navigation",
          screens: [...services.menuOwners.menu.read().screens, { screen: transition.screen, actorId: services.menuOwners.party.read().selected, selection: 0 }],
        });
        if (!pushed.ok) throw new ScriptError("menu.state-refused", pushed.error?.message ?? "menu frame was refused");
        const childState = {
          ...saved,
          providerId: child.id,
          screen: transition.screen,
          state: null,
          phase: "enter",
          childScreen: null,
          parkSeq: null,
          parents: [...parents, { providerId: saved.providerId, screen: saved.screen, state: transition.state }],
        };
        thread.wait = { kind: "menu.screen", global: true, id: child.id, payload: [childState], resumeRefs: [] };
        thread.status = "waiting";
        return;
      }
      const popped = services.menuOwners.menu.apply({
        type: "navigation",
        screens: services.menuOwners.menu.read().screens.slice(0, -1),
      });
      if (!popped.ok) throw new ScriptError("menu.state-refused", popped.error?.message ?? "menu frame close was refused");
      if (parents.length > 0) {
        const parent = parents[parents.length - 1]!;
        if (!services.menuProviders.has(parent.providerId)) {
          throw new ScriptError("menu.provider-missing", `parent menu provider "${parent.providerId}" is not registered`);
        }
        thread.wait = {
          kind: "menu.screen",
          global: true,
          id: parent.providerId,
          payload: [{
            ...saved,
            providerId: parent.providerId,
            screen: parent.screen,
            state: parent.state,
            phase: "child.closed",
            childScreen: saved.screen,
            parkSeq: null,
            parents: parents.slice(0, -1),
          }],
          resumeRefs: [],
        };
        thread.status = "waiting";
        return;
      }
      frame.operands.push({ value: null, ref: null });
      return;
    } catch (caught) {
      handleMenuProviderFailure(thread, vm, services, saved, caught);
      return;
    }
  }
  if (wait.kind === "request" || wait.kind === "blob") {
    if (!result.ok) {
      recordDiagnostic(vm, view.tick, thread.id, "request.failed", wait.file, wait.line, toStringValue(result.value));
    }
    if (wait.then !== null) {
      thread.pending = {
        command: wait.then.command,
        args: [result.ok ? 1 : 0, result.value, ...wait.then.args],
        file: wait.file,
        line: wait.line,
      };
      return;
    }
    frame.operands.push({ value: result.ok ? result.value : 0, ref: null });
    return;
  }
  if ("resumeRefs" in wait && wait.resumeRefs !== undefined) {
    const topIndex = thread.frames.length - 1;
    for (const ref of wait.resumeRefs) writeRef(vm, thread, topIndex, ref as RefId, result.value, services);
  }
  if (wait.kind === "sleep" && !wait.resumesCall) return;
  frame.operands.push({ value: result.value, ref: null });
}


/**
 * Deliver a request's reply, or a recorded one on replay (AD-5). The reply is
 * stored in the request's wait; the next waits phase resolves it. Throws
 * `request.unknown` when no thread waits on `reqId` and `request.duplicate-reply`
 * when a reply is already stored.
 */
export function replyToRequest(vm: VmState, reqId: number, reply: WaitReply): void {
  for (const thread of vm.threads) {
    const wait = thread.wait;
    if (thread.status !== "waiting" || wait === null || (wait.kind !== "request" && wait.kind !== "blob")) continue;
    if (wait.reqId !== reqId) continue;
    if (wait.reply !== null) {
      throw new ScriptError("request.duplicate-reply", `request ${reqId} already has a reply`);
    }
    wait.reply = { ok: reply.ok, value: reply.value };
    return;
  }
  throw new ScriptError("request.unknown", `no thread waits on request ${reqId}`);
}

/**
 * The threads phase (AD-26; THR-3, R-32). Ready threads take their turn in
 * ascending id, each for at most `budget` VM steps; a thread that reaches the
 * budget keeps its state and continues next tick. Nothing runs while a
 * blocking command waits (R-32), and a thread that enters one stops the rest
 * of the phase. Threads started or woken during the phase take their first
 * turn next tick.
 */
export function runThreadsPhase(vm: VmState, services: ScriptServices, budget: number): void {
  if (!Number.isInteger(budget) || budget < 1) {
    throw new ScriptError("vm.bad-budget", `the step budget must be a positive whole number, got ${budget}`);
  }
  const ready = vm.threads.filter((thread) => thread.status === "ready");
  ready.sort((left, right) => left.id - right.id);
  for (const thread of ready) {
    if (findBlockingThread(vm) !== null) break;
    if (thread.status !== "ready") continue;
    stepThread(thread, vm, services, budget);
    refreshBlock(vm, services.clock.tick());
  }
  refreshBlock(vm, services.clock.tick());
}

/**
 * The end-of-tick pass (R-34; FUN-8, entry 18.6): the last step of every tick,
 * after the `time` phase, run by `advanceScriptTick` and by the engine's `time`
 * phase alike. It frees the closure cells no script can reach, then runs the
 * object pass, so a cell that only a dead cell named no longer keeps an object alive.
 */
export function collectGarbage(vm: VmState, roots: readonly unknown[] = []): void {
  collectCells(vm, roots);
  collectObjects(vm, roots);
}

/**
 * The end-of-tick object pass (R-34; OOP-5, entry 19.5): an object nothing names
 * is freed. The roots are the places a running script reaches an object from
 * (`eachLiveRoot`: the globals, every frame's locals, operands, return value and
 * `this`, a wait's stored reply, and the object an operand or a by-reference slot
 * holds a reference into) and the value of every closure cell still left, which is
 * why `collectCells` runs first in the same tick (entry 18.6). A callable names
 * its receiver, so a reached object's members reach their receivers too.
 *
 * An object named by a member of any remaining object is kept, a root or not
 * (two objects that name each other are never freed), and the count is taken
 * again until nothing more is freed, so an object only a freed object named goes
 * in the same pass: dropping a dictionary frees the dictionaries nested in it. A
 * kept object keeps the receiver of every callable it holds, so the table never
 * holds a callable whose receiver was freed and a save taken after the pass
 * always loads (`restore.callable-receiver`).
 */
function collectObjects(vm: VmState, roots: readonly unknown[]): void {
  if (vm.objects.length === 0) return;
  const reached = new Set<number>();
  const pending: number[] = [];
  const reach = (handle: number | null): void => {
    if (handle === null || reached.has(handle)) return;
    reached.add(handle);
    pending.push(handle);
  };
  const reachValue = (value: unknown): void => {
    reach(objectHandleOf(value));
    reach(receiverHandleOf(value));
  };
  eachLiveRoot(
    vm,
    (_path, value) => reachValue(value),
    (_path, ref) => reach(typeof ref === "string" ? (parseObjectRef(ref)?.handle ?? null) : null),
  );
  for (const value of Object.values(vm.cells ?? {})) reachValue(value);
  for (const root of roots) reachValue(root);
  for (const thread of vm.threads) {
    for (const frame of thread.frames) reach(frame.objectHandle ?? null);
  }
  const byHandle = new Map(vm.objects.map((record) => [record.handle, record]));
  for (let handle = pending.pop(); handle !== undefined; handle = pending.pop()) {
    for (const value of Object.values(byHandle.get(handle)?.members ?? {})) reachValue(value);
  }
  for (let alive = vm.objects; ; ) {
    const named = new Set<number>();
    for (const record of alive) {
      for (const value of Object.values(record.members)) {
        const handle = objectHandleOf(value);
        if (handle !== null) named.add(handle);
      }
    }
    const kept = new Set<number>();
    for (const record of alive) {
      if (reached.has(record.handle) || named.has(record.handle)) kept.add(record.handle);
    }
    const table = new Map(alive.map((record) => [record.handle, record]));
    const holders = [...kept];
    for (let handle = holders.pop(); handle !== undefined; handle = holders.pop()) {
      for (const value of Object.values(table.get(handle)?.members ?? {})) {
        const receiver = receiverHandleOf(value);
        if (receiver === null || !table.has(receiver) || kept.has(receiver)) continue;
        kept.add(receiver);
        holders.push(receiver);
      }
    }
    const next = alive.filter((record) => kept.has(record.handle));
    if (next.length === alive.length) return;
    vm.objects = next;
    alive = next;
  }
}

/** The handle an object value names, or `null` when `value` is not one. */
function objectHandleOf(value: unknown): number | null {
  if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "object") return null;
  return "handle" in value && typeof value.handle === "number" ? value.handle : null;
}

/** The handle a callable's receiver names (OOP-11), or `null` for any other value and for a callable with none. */
function receiverHandleOf(value: unknown): number | null {
  if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "callable") return null;
  if (!("receiver" in value) || typeof value.receiver !== "string") return null;
  const handle = Number(value.receiver);
  return Number.isSafeInteger(handle) ? handle : null;
}

export function advanceScriptTick(
  state: GameState,
  services: ScriptServices,
  budget: number = STEP_BUDGET,
  poll: WaitPoll = defaultWaitPoll,
): ScriptStatus {
  const claims = state.engine.claims;
  if (claims !== undefined) claims.length = 0;
  const activeClaims = claims ?? [];
  runWaitsPhase(
    state.vm,
    { tick: state.time.tick, events: state.events, input: state.input, ui: state.ui, claims: activeClaims },
    poll,
    (seq) => { if (!activeClaims.includes(seq)) activeClaims.push(seq); },
    services,
    (wait) => {
      if (wait.kind === "input.key" && wait.dialogue !== undefined) {
        queueNativeEvent(state.vm, state.events, "game", "dialogue.completed", wait.dialogue);
      }
    },
  );
  if (claims === undefined && activeClaims.length > 0) state.engine.claims = activeClaims;
  runThreadsPhase(state.vm, services, budget);
  runEventsPhase(state, services, budget);
  assertNoDeadlock(state.vm, services);
  runTimePhase(state.time);
  collectStateGarbage(state, layerRoots(services.layers));
  return scriptStatus(state);
}

function scriptStatus(state: GameState): ScriptStatus {
  const { vm, events } = state;
  let running = events.queue.length > 0 || events.dispatch !== null;
  let waiting = false;
  for (const thread of vm.threads) {
    if (thread.status === "ready") running = true;
    else if (thread.status === "waiting") waiting = true;
  }
  if (running) return "running";
  if (waiting) return "waiting";
  return "finished";
}

/** `file:line` of the call a thread is parked at, or the program's name when it has none. */
export function threadLocation(thread: Thread, services: ScriptServices): SourcePos | null {
  const frame = thread.frames[thread.frames.length - 1];
  if (frame === undefined) return null;
  const program = services.programs.get(frame.program);
  return program.ops[frame.ip - 1]?.pos ?? program.ops[frame.ip]?.pos ?? null;
}

/**
 * Fail headless when nothing can ever run again: no thread is ready and every
 * live thread is parked in an indefinite sleep, which only another running
 * thread's `threadWake` could end (THR-1). The error names every stuck thread
 * with its wait and location. Any other wait (`input.key`, a request, timed
 * sleeps) can still be resolved from outside, so it is not a deadlock.
 */
function assertNoDeadlock(vm: VmState, services: ScriptServices): void {
  const stuck: Thread[] = [];
  for (const thread of vm.threads) {
    if (thread.status === "finished") continue;
    const wait = thread.wait;
    if (thread.status !== "waiting" || wait === null || wait.kind !== "sleep" || wait.until !== null) return;
    stuck.push(thread);
  }
  if (stuck.length === 0) return;
  stuck.sort((left, right) => left.id - right.id);
  const parts = stuck.map((thread) => {
    const pos = threadLocation(thread, services);
    const where = pos === null ? "" : ` at ${pos.file}:${pos.line}`;
    return `thread ${thread.id} waits on ${thread.wait === null ? "nothing" : describeWait(thread.wait)}${where}`;
  });
  throw new ScriptError(
    "vm.deadlock",
    `deadlock at tick ${services.clock.tick()}: ${parts.join("; ")}`,
    threadLocation(stuck[0]!, services),
  );
}

function refName(ref: RefId): string {
  const sep = ref.indexOf(":");
  return sep >= 0 ? ref.slice(sep + 1) : ref;
}
function isObjectValue(value: Value | undefined): value is ObjectValue {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "object";
}

/**
 * The variable `name` as a read of it from the running frame would find it,
 * without creating it: a local of the running frame, else the global, else the
 * game emitter when `name` is `game` (EMIT-19), else `undefined`. Only `game` is
 * asked of the virtual variables here: their other names mean no object, and a read
 * of a board-backed one fails without a board.
 */
function peekVariable(
  vm: VmState,
  thread: Thread,
  frameIndex: number,
  name: string,
  virtuals?: VirtualVariablePort,
  services?: ScriptServices,
): Value | undefined {
  const frame = thread.frames[frameIndex]!;
  if (Object.hasOwn(frame.locals, name)) return readRef(vm, thread, frameIndex, frame.locals[name]!.ref, services);
  const virtual = virtuals?.read(name);
  if (virtual !== undefined) return virtual;
  if (Object.hasOwn(vm.globals, name)) return vm.globals[name];
  return undefined;
}

/**
 * The dictionary a `base[key]` indexes, or `undefined` when the base is not
 * one. A plain variable base arrives as its name (the `name` op), so the name
 * is looked up without creating it; any other base arrives as the value.
 */
function dictionaryOfBase(vm: VmState, thread: Thread, frameIndex: number, base: Arg, virtuals?: VirtualVariablePort): ObjectRecord | undefined {
  const value =
    base.ref === null && typeof base.value === "string" ? peekVariable(vm, thread, frameIndex, base.value, virtuals) : base.value;
  if (!isObjectValue(value)) return undefined;
  const record = findObject(vm, value.handle);
  return record !== undefined && (isDictionary(record) || record.hostType !== undefined) ? record : undefined;
}

/** Copy a callable with the target as receiver unless it already has one (OOP-11). */
function bindMemberValue(value: Value, handle: number): Value {
  if (!isCallableValue(value) || value.receiver !== null) return value;
  return {
    type: "callable",
    def: value.def,
    captures: value.captures,
    receiver: String(handle),
    ...(value.owner === undefined ? {} : { owner: value.owner }),
  };
}

/**
 * The class a method frame finds its symbols through (OOP-10, "Two class
 * identities"): the class of the object it runs on, read from the record, not the
 * class of the running method. `frame.objectClass` stays the access context; it
 * answers here only when the object was freed under the frame.
 */
function frameObjectClass(vm: VmState, frame: Frame): string | undefined {
  if (frame.objectHandle === undefined) return undefined;
  return findObject(vm, frame.objectHandle)?.className ?? frame.objectClass;
}

/**
 * Whether the bare name `name` inside a method is a field of the object it runs on
 * (OOP-6): a field the object's own class declares, unless `shadowed`, which the
 * compiler sets on the op when the name is a parameter of the running function,
 * because a parameter comes before a field.
 */
function isImplicitField(vm: VmState, program: Program, frame: Frame, name: string, shadowed: boolean): boolean {
  if (shadowed || frame.objectHandle === undefined) return false;
  const ownClass = frameObjectClass(vm, frame);
  return ownClass !== undefined && findMember(program, ownClass, name) !== undefined;
}

/**
 * The bare name `name` as a `load` finds it, without creating it (OOP-6): a
 * parameter or a local of the frame, a field of the object the running method is
 * on, else a global. The qualifier of `eng.get()` is found this way, so it is the
 * `eng` that `eng->get()` reads.
 */
function peekName(
  vm: VmState,
  thread: Thread,
  frameIndex: number,
  program: Program,
  name: string,
  shadowed: boolean,
  virtuals?: VirtualVariablePort,
  services?: ScriptServices,
): Value | undefined {
  const frame = thread.frames[frameIndex]!;
  if (frame.objectHandle !== undefined && isImplicitField(vm, program, frame, name, shadowed)) {
    const record = findObject(vm, frame.objectHandle);
    return record === undefined ? undefined : readMember(record, name);
  }
  return peekVariable(vm, thread, frameIndex, name, virtuals, services);
}

/** The live object `value` names; `what` is the message when `value` is no object at all (OOP-3). */
function liveObject(vm: VmState, value: Value | undefined, pos: SourcePos, what: string): ObjectRecord {
  if (!isObjectValue(value)) throw new ScriptError("object.invalid", what, pos);
  const record = findObject(vm, value.handle);
  if (record === undefined) throw new ScriptError("object.invalid", `unknown object handle ${value.handle}`, pos);
  return record;
}

/** The events section a host-provided emitter method works on (EMIT-14). */
/**
 * Register a host object under the emitter key its type names, on first emitter
 * access only (MEDIA-2, EMIT-20): the media event domain stays lazy.
 */
function registerHostEmitter(vm: VmState, services: ScriptServices, emitter: Value | undefined): void {
  if (typeof emitter !== "object" || emitter === null || !("kind" in emitter) || emitter.kind !== "object") return;
  const record = findObject(vm, emitter.handle);
  if (record === undefined || record.hostType === undefined) return;
  const key = services.hostTypes.get(record.hostType)?.emitterKey?.(record) ?? null;
  if (key === null) return;
  const events = eventsOf(services);
  if (events.emitters?.[key] === record.handle) return;
  registerEmitter(vm, events, key, record);
}

function eventsOf(services: ScriptServices): EventsSection {
  const state = services.view.state;
  if (state === undefined) throw new ScriptError("emit.no-state", "the events section is not reachable");
  return state.events;
}

/** Free an object by `release` or after its destructor, and drop its listeners with it (EMIT-14). */
function releaseObject(vm: VmState, services: ScriptServices, handle: number): void {
  vm.objects = vm.objects.filter((item) => item.handle !== handle);
  const state = services.view.state;
  if (state !== undefined) forgetEmitter(state.events, handle);
}

/**
 * Whether reading `name` of `record` finds a host-provided method (OOP-12): an emitter method
 * of every object, or a method in the object's session-hydrated host type.
 */
function isHostMethod(program: Program, record: ObjectRecord, name: string, services: ScriptServices): boolean {
  if (Object.hasOwn(record.members, name)) return false;
  if (isEmitterMethod(name)) return isDictionary(record) || findMember(program, record.className, name) === undefined;
  const type = record.hostType === undefined ? undefined : services.hostTypes.get(record.hostType);
  return type?.methods?.[name] !== undefined && isDictionary(record);
}

function hostContext(services: ScriptServices, record: ObjectRecord): HostObjectContext | null {
  const state = services.view.state;
  return state === undefined ? null : {
    state,
    events: state.events,
    vm: state.vm,
    record,
    ...(services.media === undefined ? {} : { media: services.media }),
    ...(services.view.battle === undefined ? {} : { battle: services.view.battle }),
  };
}

function hostMemberName(name: string): string {
  return name.startsWith("[") && name.endsWith("]") ? name.slice(1, -1) : name;
}

function readObjectValue(services: ScriptServices, record: ObjectRecord, name: string): Value {
  if (Object.hasOwn(record.members, name)) return readMember(record, name);
  const type = record.hostType === undefined ? undefined : services.hostTypes.get(record.hostType);
  const context = hostContext(services, record);
  const hydrated = type?.read !== undefined && context !== null ? type.read(context, hostMemberName(name)) : undefined;
  return hydrated === undefined ? readMember(record, name) : hydrated;
}

function writeObjectValue(services: ScriptServices, record: ObjectRecord, name: string, value: Value): void {
  const type = record.hostType === undefined ? undefined : services.hostTypes.get(record.hostType);
  const memberName = hostMemberName(name);
  const normalizedName = memberName.toLowerCase();
  if (type?.readOnlyMembers?.some((field) => field.toLowerCase() === normalizedName)) {
    throw new ScriptError(ASSIGN_READ_ONLY, `host member "${name}" is read-only`);
  }
  if (!Object.hasOwn(record.members, name)) {
    const context = hostContext(services, record);
    const result = type?.write !== undefined && context !== null ? type.write(context, memberName, value) : "not-host";
    if (result === "written") return;
    if (result === "read-only") throw new ScriptError(ASSIGN_READ_ONLY, `host member "${name}" is read-only`);
  }
  writeMember(record, name, value);
}

/** Park `thread` on the cancelable event `handle` (EMIT-16), straight after the call queued it. */
function parkOnEvent(thread: Thread, handle: number): void {
  thread.wait = { kind: EVENT_DISPATCH_WAIT, global: false, id: "emitCancelable", payload: [handle], resumeRefs: [] };
  thread.status = "waiting";
}

/**
 * Run `emitter.on(...)`, `once`, `off`, `emit` or `emitCancelable` (EMIT-2, EMIT-14,
 * EMIT-16): all but the last are done at once and return `0`; a cancelable emit parks
 * the thread, and the wake pushes the event as the value of the call.
 */
function callEmitterMethod(
  thread: Thread,
  vm: VmState,
  services: ScriptServices,
  frame: Frame,
  record: ObjectRecord,
  name: string,
  args: Arg[],
): CallOutcome {
  const emitter: Value = { kind: "object", handle: record.handle, className: record.className };
  registerHostEmitter(vm, services, emitter);
  const parked = applyEmitterOp(vm, eventsOf(services), name, emitter, args.map((arg) => arg.value), thread.id);
  frame.ip += 1;
  if (parked !== null) {
    parkOnEvent(thread, parked);
    return "yield";
  }
  frame.operands.push({ value: 0, ref: null });
  return "continue";
}

/**
 * Call member `name` of `record` (OOP-10, "Calls through a name"; OOP-11): the one
 * path behind `obj->name(args)`, `obj.name(args)` and `a.b.name(args)`. An object
 * with a class runs the method of that name and parameter count that its class or
 * an ancestor defines, `release()` being the built-in of OOP-5, and otherwise a
 * callable stored in a member of that name; a dictionary calls its callable member.
 * The callee's `this` is the object, and a stored callable keeps the receiver it has.
 */
function invokeMember(
  thread: Thread,
  vm: VmState,
  services: ScriptServices,
  program: Program,
  frame: Frame,
  frameIndex: number,
  record: ObjectRecord,
  name: string,
  args: Arg[],
  pos: SourcePos,
): CallOutcome {
  if (!isDictionary(record)) {
    if (name === "release") {
      const info = classInfo(program, record.className);
      frame.ip += 1;
      if (info?.destructor !== null && info?.destructor !== undefined) {
        thread.frames.push({
          program: frame.program, ip: info.destructor.entry, locals: bindMethodLocals(info.destructor, args), operands: [],
          errorHandler: null, autoLocal: frame.autoLocal, objectHandle: record.handle,
          objectClass: record.className, releaseHandle: record.handle,
        });
      } else {
        releaseObject(vm, services, record.handle);
        frame.operands.push({ value: 0, ref: null });
      }
      return "continue";
    }
    const method = findMethod(program, record.className, name, args.length);
    if (method !== undefined && method.entry >= 0) {
      if (method.access === "private" && frame.objectClass !== method.className) {
        throw new ScriptError("object.inaccessible-member", `method ${name} is private`, pos);
      }
      frame.ip += 1;
      thread.frames.push({
        program: frame.program, ip: method.entry, locals: bindMethodLocals(method, args), operands: [],
        errorHandler: null, autoLocal: frame.autoLocal, objectHandle: record.handle,
        objectClass: method.className ?? record.className,
      });
      return "continue";
    }
    if (findMember(program, record.className, name) === undefined) {
      if (isEmitterMethod(name)) return callEmitterMethod(thread, vm, services, frame, record, name, args);
      if (isHostMethod(program, record, name, services)) {
        const value: CallableValue = { type: "callable", def: hostMethodDef(record.hostType!, name), captures: [], receiver: String(record.handle) };
        return performCallable(thread, vm, services, program, frame, frameIndex, value, args, pos);
      }
      if (record.hostType !== undefined && !Object.hasOwn(record.members, name) && !services.hostTypes.has(record.hostType)) {
        throw new ScriptError("object.invalid", `host type "${record.hostType}" is not installed`, pos);
      }
      throw new ScriptError("object.invalid", `method ${name} not found`, pos);
    }
    checkMemberAccess(program, record, name, frame.objectClass, pos);
  } else if (isEmitterMethod(name) && !Object.hasOwn(record.members, name)) {
    return callEmitterMethod(thread, vm, services, frame, record, name, args);
  } else if (isHostMethod(program, record, name, services)) {
    const value: CallableValue = { type: "callable", def: hostMethodDef(record.hostType!, name), captures: [], receiver: String(record.handle) };
    return performCallable(thread, vm, services, program, frame, frameIndex, value, args, pos);
  } else if (record.hostType !== undefined && !Object.hasOwn(record.members, name) && !services.hostTypes.has(record.hostType)) {
    throw new ScriptError("object.invalid", `host type "${record.hostType}" is not installed`, pos);
  }
  const member = bindMemberValue(readObjectValue(services, record, name), record.handle);
  if (!isCallableValue(member)) {
    const kind = isDictionary(record) ? "dictionary member" : "member";
    throw new ScriptError(CALLABLE_NOT_CALLABLE, `${kind} "${name}" is not callable`, pos);
  }
  return performCallable(thread, vm, services, program, frame, frameIndex, member, args, pos);
}

function setOwnValue(record: { [name: string]: Value }, name: string, value: Value): void {
  Object.defineProperty(record, name, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function setOwnSlot(record: { [name: string]: LocalSlot }, name: string, slot: LocalSlot): void {
  Object.defineProperty(record, name, {
    value: slot,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function lookupLabel(program: Program, ip: number, name: string): number | undefined {
  for (const fnList of Object.values(program.functions)) {
    for (const fn of fnList) {
      if (ip >= fn.entry && ip < fn.end) {
        return fn.labels[name];
      }
    }
  }
  return program.labels[name];
}

/** The function or method whose op range holds `ip`, or `undefined` for top-level code. */
function enclosingFunction(program: Program, ip: number): FunctionInfo | undefined {
  for (const fnList of Object.values(program.functions)) {
    for (const fn of fnList) {
      if (ip >= fn.entry && ip < fn.end) return fn;
    }
  }
  for (const cls of Object.values(program.classes)) {
    for (const fnList of Object.values(cls.methods)) {
      for (const fn of fnList) {
        if (ip >= fn.entry && ip < fn.end) return fn;
      }
    }
  }
  return undefined;
}

/**
 * Resolve a handler label inside the function holding `ip` only (ERR-1: a
 * handler can never jump into another function).
 */
function handlerLabel(program: Program, ip: number, name: string): number | undefined {
  const fn = enclosingFunction(program, ip);
  return fn !== undefined && Object.hasOwn(fn.labels, name) ? fn.labels[name] : undefined;
}

/** The op index just after the innermost statement holding `ip` (ERR-1 `resumeNext`). */
function statementEnd(program: Program, ip: number): number {
  let best: StatementRange | undefined;
  for (const range of program.statements) {
    if (ip < range.start || ip >= range.end) continue;
    if (best === undefined || range.end - range.start < best.end - best.start) best = range;
  }
  return best === undefined ? ip + 1 : best.end;
}

/** How many operands an op consumes and how many values it leaves (net of ops that duplicate). */
function stackEffect(op: StepOp): { readonly pops: number; readonly pushes: number } {
  switch (op.op) {
    case "push":
    case "name":
    case "load":
    case "declRef":
    case "load_fn":
    case "newObject":
    case "dup":
      return { pops: 0, pushes: 1 };
    case "storeRef":
    case "index":
    case "compound":
    case "binop":
      return { pops: 2, pushes: 1 };
    case "member":
    case "get_member_bound":
    case "unop":
      return { pops: 1, pushes: 1 };
    case "select":
      return { pops: 3, pushes: 1 };
    case "methodCall":
      return { pops: op.argc + 1, pushes: 1 };
    case "call_indirect":
      return { pops: op.argc + 1, pushes: 1 };
    case "construct":
    case "call":
      return { pops: op.argc, pushes: 1 };
    case "pop":
    case "initMember":
    case "jumpIfFalse":
      return { pops: 1, pushes: 0 };
    case "jump":
    case "return":
      return { pops: 0, pushes: 0 };
  }
}

/**
 * Record one catchable runtime failure: always as a located host diagnostic,
 * and as an `error` Logger record unless `debug(false)` has silenced the
 * interpreter's own messages (ERR-2). An `internal` fault is never silenced.
 */
function reportFailure(vm: VmState, services: ScriptServices, error: ScriptError): void {
  services.diagnostics.push(toDiagnostic(error));
  const family = failureClass(error.code);
  if (vm.messagesOff === true && family !== "internal") return;
  services.logger.error({
    level: "error",
    code: error.code,
    message: error.message,
    data: { file: error.pos?.file ?? "", line: error.pos?.line ?? 0, class: family },
  });
}

/**
 * Route one failed operation at its own frame (ERR-1/ERR-2). The failure is
 * located at the op, reported, then either the frame's label handler takes
 * over (operands dropped, resume point remembered) or the thread continues at
 * the next VM step with the failed op contributing the unset value. Never
 * touches another frame, so a caller's handler cannot catch a callee failure.
 */
function handleFailure(
  thread: Thread,
  vm: VmState,
  services: ScriptServices,
  program: Program,
  frame: Frame,
  op: StepOp,
  opIp: number,
  depth: number,
  error: ScriptError,
): void {
  const located = locateError(error, op.pos);
  reportFailure(vm, services, located);
  const handler = frame.errorHandler;
  if (handler !== null && handler.mode === "label") {
    const target = handler.label === null ? undefined : handlerLabel(program, opIp, handler.label);
    if (target !== undefined) {
      emitErrorEvent(thread, vm, services, located, true);
      frame.operands.length = 0;
      handler.active = true;
      handler.resume = statementEnd(program, opIp);
      frame.ip = target;
      return;
    }
    // ERR-1: the handler is cleared only when its label cannot be found; the error is reported.
    frame.errorHandler = null;
  }
  emitErrorEvent(thread, vm, services, located, handler !== null && handler.mode === "resumeNext");
  const effect = stackEffect(op);
  const target = Math.max(0, depth - effect.pops) + effect.pushes;
  if (frame.operands.length > target) frame.operands.length = target;
  while (frame.operands.length < target) frame.operands.push({ value: 0, ref: null });
  frame.ip = opIp + 1;
}

/**
 * Queue the game `error` event for one reported failure (EMIT-9, EMIT-22): the same located
 * diagnostic the host receives, plus whether the failing frame's handler took it. It is
 * queued and never runs a listener here (EMIT-3). A run with no state to hold the `events`
 * section (a bare services object) has no game to emit on.
 */
function emitErrorEvent(thread: Thread, vm: VmState, services: ScriptServices, error: ScriptError, handled: boolean): void {
  const state = services.view.state;
  if (state === undefined) return;
  queueErrorEvent(vm, state.events, thread.id, {
    code: error.code,
    message: error.message,
    file: error.pos?.file ?? "",
    line: error.pos?.line ?? 0,
    handled,
  });
}

/** Install or replace the calling frame's handler, keeping any in-flight resume point (ERR-1). */
function installHandler(
  program: Program,
  frame: Frame,
  frameIndex: number,
  opIp: number,
  pos: SourcePos,
  label: string | null,
): void {
  if (frameIndex === 0) {
    throw new ScriptError(
      HANDLER_TOP_LEVEL,
      "an error handler can be set inside a function only",
      pos,
    );
  }
  if (label !== null && handlerLabel(program, opIp, label) === undefined) {
    throw new ScriptError(
      HANDLER_UNKNOWN_LABEL,
      `handler label \`:${label}\` not found in the current function`,
      pos,
    );
  }
  const previous = frame.errorHandler;
  frame.errorHandler = {
    mode: label === null ? "resumeNext" : "label",
    label,
    active: previous?.active ?? false,
    resume: previous?.resume ?? null,
  };
}

/** `resumeNext()`: continue after the failing statement, consuming the remembered point once (ERR-1). */
function resumeAfterFailure(frame: Frame, frameIndex: number, pos: SourcePos): void {
  const handler = frame.errorHandler;
  if (frameIndex === 0 || handler === null || handler.resume === null) {
    throw new ScriptError(
      HANDLER_NOT_HANDLING,
      "resumeNext() is legal only inside a function while its error handler is handling an error",
      pos,
    );
  }
  frame.operands.length = 0;
  frame.ip = handler.resume;
  handler.resume = null;
  handler.active = false;
}

function readVirtual(services: ScriptServices, name: string): Value | undefined {
  if (services.isPackageStartup() && name.toLowerCase() === "gametime") {
    throw services.packageStartupForbidden("read the simulation clock");
  }
  return services.virtuals.read(name);
}

function readRef(vm: VmState, thread: Thread, frameIndex: number, ref: RefId, services?: ScriptServices): Value {
  const separator = ref.indexOf(":");
  const scope = ref.slice(0, separator);
  const name = ref.slice(separator + 1);
  if (scope === "cell") return vm.cells?.[name] ?? 0;
  if (scope === "virtual") return services === undefined ? 0 : readVirtual(services, name) ?? 0;
  if (scope === "object") {
    const object = parseObjectRef(ref);
    const record = object === null ? undefined : findObject(vm, object.handle);
    return record === undefined || object === null ? 0 : services === undefined ? readMember(record, object.name) : readObjectValue(services, record, object.name);
  }
  if (scope === "global") return vm.globals[name] ?? 0;
  for (let i = frameIndex; i >= 0; i--) {
    const f = thread.frames[i];
    if (f && Object.hasOwn(f.locals, name)) {
      const s = f.locals[name]!;
      if (s.ref === localRef(name)) return s.value ?? 0;
      return readRef(vm, thread, i, s.ref, services);
    }
  }
  return 0;
}

function writeRef(
  vm: VmState,
  thread: Thread,
  frameIndex: number,
  ref: RefId,
  value: Value,
  services?: ScriptServices,
): void {
  const stored = value === null ? 0 : value;
  const separator = ref.indexOf(":");
  const scope = ref.slice(0, separator);
  const name = ref.slice(separator + 1);
  if (scope === "cell") {
    setOwnValue((vm.cells ??= {}), name, stored);
    return;
  }
  if (scope === "virtual") {
    const result = services?.virtuals.write?.(name, stored) ?? "not-virtual";
    if (result === "read-only") throw new ScriptError(ASSIGN_READ_ONLY, `system-owned name "${name}" is read-only`);
    if (result === "written") return;
    setOwnValue(vm.globals, name, stored);
    return;
  }
  if (scope === "object") {
    const object = parseObjectRef(ref);
    const record = object === null ? undefined : findObject(vm, object.handle);
    if (record !== undefined && object !== null) {
      if (services === undefined) writeMember(record, object.name, stored);
      else writeObjectValue(services, record, object.name, stored);
    }
    return;
  }
  if (scope === "global") {
    setOwnValue(vm.globals, name, stored);
    return;
  }
  for (let i = frameIndex; i >= 0; i--) {
    const f = thread.frames[i];
    if (f && Object.hasOwn(f.locals, name)) {
      const s = f.locals[name]!;
      if (s.ref === localRef(name)) {
        s.value = stored;
        return;
      }
      writeRef(vm, thread, i, s.ref, stored, services);
      return;
    }
  }
  const currentFrame = thread.frames[frameIndex];
  if (currentFrame) setOwnSlot(currentFrame.locals, name, { value: stored, ref: localRef(name) });
}

function deleteVariable(vm: VmState, thread: Thread, frameIndex: number, target: string, services?: ScriptServices): void {
  if (services?.virtuals.kill?.(target) === true) return;
  const isWholeArray = !target.includes("[");
  const prefix = `${target}[`;
  for (let i = frameIndex; i >= 0; i--) {
    const f = thread.frames[i];
    if (f) {
      const slot = f.locals[target];
      if (slot !== undefined && slot.ref.startsWith("cell:")) setOwnValue((vm.cells ??= {}), slot.ref.slice(5), 0);
      else delete f.locals[target];
      if (isWholeArray) {
        for (const key of Object.keys(f.locals)) if (key.startsWith(prefix)) delete f.locals[key];
      }
    }
  }
  delete vm.globals[target];
  if (isWholeArray) {
    for (const key of Object.keys(vm.globals)) if (key.startsWith(prefix)) delete vm.globals[key];
  }
}

function programRootContext(
  thread: Thread,
  frameIndex: number,
): { readonly frameIndex: number; readonly slot: LocalSlot } | undefined {
  const detachedRoot = thread.detached.reduce(
    (root, index) => index <= frameIndex ? Math.max(root, index) : root,
    0,
  );
  for (let index = frameIndex; index >= detachedRoot; index--) {
    const frame = thread.frames[index];
    if (frame?.programRoot === undefined) continue;
    const slot = frame.locals.context;
    return slot === undefined ? undefined : { frameIndex: index, slot };
  }
  return undefined;
}

function loadArg(
  vm: VmState,
  thread: Thread,
  frameIndex: number,
  name: string,
  scope?: VarScope,
  services?: ScriptServices,
): Arg {
  if (scope === "global") {
    const virt = services === undefined ? undefined : readVirtual(services, name);
    if (virt !== undefined) return { value: virt, ref: virtualRef(name) };
    if (Object.hasOwn(vm.globals, name)) return { value: vm.globals[name] ?? 0, ref: globalRef(name) };
    setOwnValue(vm.globals, name, 0);
    return { value: 0, ref: globalRef(name) };
  }
  const frame = thread.frames[frameIndex]!;
  if (scope === "local") {
    if (!Object.hasOwn(frame.locals, name)) setOwnSlot(frame.locals, name, { value: 0, ref: localRef(name) });
    const slot = frame.locals[name]!;
    if (slot.ref === localRef(name)) return { value: slot.value ?? 0, ref: slot.ref };
    const val = readRef(vm, thread, frameIndex, slot.ref, services);
    return { value: val, ref: slot.ref };
  }
  if (Object.hasOwn(frame.locals, name)) {
    const slot = frame.locals[name]!;
    if (slot.ref === localRef(name)) return { value: slot.value ?? 0, ref: slot.ref };
    const val = readRef(vm, thread, frameIndex, slot.ref, services);
    return { value: val, ref: slot.ref };
  }
  if (scope === undefined && name === "context") {
    const rootContext = programRootContext(thread, frameIndex);
    if (rootContext !== undefined) {
      const { slot } = rootContext;
      const value = slot.ref === localRef(name)
        ? slot.value ?? 0
        : readRef(vm, thread, rootContext.frameIndex, slot.ref, services);
      return { value, ref: slot.ref };
    }
  }

  const virtVal = services === undefined ? undefined : readVirtual(services, name);
  if (virtVal !== undefined) return { value: virtVal, ref: virtualRef(name) };
  if (Object.hasOwn(vm.globals, name)) return { value: vm.globals[name] ?? 0, ref: globalRef(name) };
  if (frame.autoLocal) {
    setOwnSlot(frame.locals, name, { value: 0, ref: localRef(name) });
    return { value: 0, ref: localRef(name) };
  }
  setOwnValue(vm.globals, name, 0);
  return { value: 0, ref: globalRef(name) };
}

/**
 * The callable the running scope holds under `name`, or `undefined` when the
 * name holds anything else or nothing — entry 1 of the environment table
 * (FUN-8; entries 18.4 and 18.5). The scope is the variable a read of `name`
 * reaches: a local of the running frame (a parameter, a declared local or a
 * captured name), else the global. A local that holds a non-callable hides a
 * callable global of the same name, as it hides it for a read, and the caller's
 * locals are never consulted. A lookup that finds no variable is not a call
 * and, unlike a read of an unset variable, never defines a global, so an
 * unmatched call keeps the legacy `unknown.command` failure.
 */
function heldCallable(
  vm: VmState,
  thread: Thread,
  frameIndex: number,
  name: string,
  services?: ScriptServices,
): CallableValue | undefined {
  const frame = thread.frames[frameIndex]!;
  if (Object.hasOwn(frame.locals, name)) {
    const value = readRef(vm, thread, frameIndex, frame.locals[name]!.ref, services);
    return isCallableValue(value) ? value : undefined;
  }
  const global = Object.hasOwn(vm.globals, name) ? vm.globals[name] : undefined;
  return isCallableValue(global) ? global : undefined;
}

/** The call name of the VM-owned `bindingOf` command (FUN-8; entry 18.5), as the lexer folds it. */
const BINDING_OF = "bindingof";

/**
 * `bindingOf(name)` (FUN-8; entry 18.5): the callable a call of `name` would run
 * from the running scope right now. The name is a string and is folded like any
 * name (LEX-10); a script function counts when any compiled program defines
 * one. It changes no variable and does not wait, so it is not a command of the
 * registry: it needs the running frame and the compiled programs, which a
 * command never sees.
 */
function bindingOfCall(
  vm: VmState,
  thread: Thread,
  frameIndex: number,
  services: ScriptServices,
  program: Program,
  args: readonly Arg[],
  pos: SourcePos,
): CallableValue {
  if (args.length !== 1) {
    throw new ScriptError("arity.mismatch", `"bindingOf" takes 1 argument(s), got ${args.length}`, pos);
  }
  const given = args[0]!.value;
  if (typeof given !== "string") {
    throw new ScriptError("builtin.bad-arg", `"bindingOf" takes the name as a string`, pos);
  }
  const name = foldAscii(given);
  const handle = bindingOf(
    name,
    services.commands,
    heldCallable(vm, thread, frameIndex, name, services) ?? topLayerHandle(services.layers, name),
    (candidate) => findDefinition(vm, services, program, candidate)?.infos.some((info) => info.entry >= 0) ?? false,
  );
  if (handle === undefined) {
    throw new ScriptError("unknown.command", `no built-in or function named "${name}"`, pos);
  }
  // A handle that names a script function is resolved by name from whichever
  // compiled program defines it, and compiled programs are not saved: record
  // that program so a restore can compile it (entry 18.6). A command has none.
  const owner = findDefinition(vm, services, program, handle.def);
  if (owner !== undefined) {
    recordOwner(vm, handle.def, owner.program.ref);
    return owner.program.ref.owner === undefined
      ? handle
      : { ...handle, owner: owner.program.ref.owner };
  }
  return handle;
}

function takeArgs(frame: Frame, argc: number, pos: SourcePos): Arg[] {
  const args: Arg[] = [];
  for (let index = 0; index < argc; index++) {
    const arg = frame.operands.pop();
    if (arg === undefined) {
      throw new ScriptError("vm.stack-underflow", "call: the operand stack is missing arguments", pos);
    }
    args.push(arg);
  }
  args.reverse();
  return args;
}

function checkArity(
  spec: BuiltinSpec,
  args: readonly Arg[],
  name: string,
  pos: SourcePos,
): void {
  const variadic = spec.params.some((param) => param.variadic);
  const required = spec.params.filter((param) => !param.optional && !param.variadic).length;
  const maximum = variadic ? Infinity : spec.params.length;
  if (args.length < required || args.length > maximum) {
    const expected = required === maximum ? `${required}` : `${required} to ${maximum}`;
    throw new ScriptError(
      "arity.mismatch",
      `"${name}" takes ${expected} argument(s), got ${args.length}`,
      pos,
    );
  }
}

function applyOut(
  vm: VmState,
  thread: Thread,
  frameIndex: number,
  spec: BuiltinSpec,
  args: readonly Arg[],
  out: readonly (readonly [number, Value])[],
  name: string,
  pos: SourcePos,
  services?: ScriptServices,
): void {
  for (const [index, value] of out) {
    const param = spec.params[index];
    const arg = args[index];
    if (param === undefined || !param.byRef || arg === undefined || arg.ref === null) {
      throw new ScriptError(
        "builtin.out-not-by-ref",
        `"${name}" returned an output for argument ${index}, which is not a by-reference variable`,
        pos,
      );
    }
    writeRef(vm, thread, frameIndex, arg.ref, value, services);
  }
}

function bindMethodLocals(
  method: { readonly params: readonly { readonly name: string; readonly byRef: boolean }[] },
  args: readonly Arg[],
): { [name: string]: LocalSlot } {
  const locals: { [name: string]: LocalSlot } = {};
  for (let index = 0; index < method.params.length; index += 1) {
    const parameter = method.params[index]!;
    const arg = args[index];
    if (parameter.byRef && arg?.ref !== null && arg !== undefined) {
      setOwnSlot(locals, parameter.name, { value: arg.value, ref: arg.ref });
    } else {
      setOwnSlot(locals, parameter.name, { value: arg?.value ?? 0, ref: localRef(parameter.name) });
    }
  }
  return locals;
}
/** Whether the thread keeps running after a call or must stop its turn here. */
type CallOutcome = "continue" | "yield";

/** The recorded form of a call's arguments: values only, with `-0` normalised (AD-14). */
function argValues(args: readonly Arg[]): PlainData[] {
  return args.map((arg) => (typeof arg.value === "number" && arg.value === 0 ? 0 : arg.value));
}

/** A fresh host-request wait; file/blob requests use AD-9's dedicated `blob` kind. */
function requestWait(
  reqId: number,
  deadline: number | null,
  then: CommandResult["then"],
  pos: SourcePos,
  requestKind?: string,
): Wait {
  const kind = requestKind === "loadBlob" || requestKind === "saveBlob" ? "blob" : "request";
  return {
    kind,
    global: true,
    reqId,
    deadline,
    reply: null,
    then: then === undefined ? null : { command: then.command, args: [...then.args] },
    file: pos.file,
    line: pos.line,
  };
}
function videoWait(reqId: number, key: string, presentation: "full" | "small", id: string): Wait {
  return { kind: "video", global: false, id, payload: [{ reqId, key, presentation }], resumeRefs: [] };
}


/** The thread `id` names, for an operation that needs it to be running code (`threadSleep`, `tellThread`). */
function liveTarget(vm: VmState, id: number, what: string, pos: SourcePos): Thread {
  const target = findThread(vm, id);
  if (target === undefined) {
    throw new ScriptError("thread.unknown", `${what}: no thread ${id} is registered`, pos);
  }
  if (target.status === "finished") {
    throw new ScriptError("thread.finished", `${what}: thread ${id} has finished`, pos);
  }
  return target;
}

/**
 * The compiled definition `def` names: the running program first, then the script functions the
 * packages export, last enabled package first (a name only; entry 19.21), then every
 * other compiled program in cache order (FUN-8; entry 18.4), then the program
 * `vm.defOwners` records for it (entry 18.6). A def is unique to the unit that
 * was lowered (`main.prg#lambda_1`), so the first program that defines it owns
 * it, and a handle made in one program is callable from another — a lambda
 * stored in a global and called by a `run()` program, for example. The recorded
 * owner is what finds a program no frame is running after a restore, when the
 * cache holds only what the frames compiled; a program whose source changed
 * since the save is not an owner any more and the def is unknown. `infos` holds
 * one entry per parameter count, as `Program.functions` does.
 */
function findDefinition(
  vm: VmState,
  services: ScriptServices,
  program: Program,
  def: string,
  argc?: number,
): { readonly program: Program; readonly infos: readonly FunctionInfo[] } | undefined {
  const local = program.functions[def];
  if (local !== undefined) return { program, infos: local };
  // A name a call can spell reaches the packages' exports before any other compiled program, in
  // manifest order, so a handle `bindingOf` made binds as the call does (entry 19.21). A lambda's
  // definition (`file#lambda_n`) is not a name and keeps its compile-order lookup.
  if (!def.includes("#")) {
    const source = services.commands.packageFunction;
    const exported = (argc === undefined ? undefined : source.find(def, argc)) ?? source.findAny(def);
    if (exported !== undefined) return { program: exported.program, infos: exported.infos };
  }
  let owner = services.programs.find(def);
  const recorded = vm.defOwners !== undefined && Object.hasOwn(vm.defOwners, def) ? vm.defOwners[def] : undefined;
  if (owner === undefined && recorded !== undefined) {
    try {
      owner = services.programs.get(recorded);
    } catch (error) {
      if (!sourceChanged(error)) throw error;
    }
  }
  const infos = owner === undefined ? undefined : owner.functions[def];
  return owner === undefined || infos === undefined ? undefined : { program: owner, infos };
}

/**
 * `registerPlugin(definition)` validates the required `name` and `commands` dictionary,
 * plus optional `menuProviders`. Both facets are checked before either is installed.
 * Command layers stay in the one environment table; menu providers are separate
 * whole-screen layers sharing the same registration handle and deterministic order.
 */
function registerPluginCall(
  vm: VmState,
  services: ScriptServices,
  program: Program,
  args: readonly Arg[],
  pos: SourcePos,
): Value {
  const definition = liveObject(vm, args[0]?.value, pos, `"registerPlugin" takes a dictionary with a name and a commands dictionary`);
  const label = readMember(definition, "name");
  if (typeof label !== "string") {
    throw new ScriptError("builtin.bad-arg", `"registerPlugin" takes the plugin's name as a string`, pos);
  }
  const commandsValue = readMember(definition, "commands");
  const commands = liveObject(vm, commandsValue, pos, `"registerPlugin" takes a commands dictionary`);
  const requests: LayerRequest[] = [];
  const menuRequests: MenuProviderRequest[] = [];
  for (const key of commands.keys) {
    const interceptor = readMember(commands, key);
    if (!isCallableValue(interceptor)) {
      throw new ScriptError(CALLABLE_NOT_CALLABLE, `registerPlugin: the command "${key}" is not a callable`, pos);
    }
    const command = foldAscii(key);
    let engine: CallableValue | undefined;
    if (topLayerHandle(services.layers, command) === undefined) {
      engine = bindingOf(
        command,
        services.commands,
        undefined,
        (candidate) => findDefinition(vm, services, program, candidate)?.infos.some((info) => info.entry >= 0) ?? false,
      );
      if (engine === undefined) {
        throw new ScriptError("unknown.command", `no built-in or function named "${command}"`, pos);
      }
      // A handle naming a script function is found again after a restore through its recorded owner (entry 18.6).
      const owner = findDefinition(vm, services, program, engine.def);
      if (owner !== undefined) recordOwner(vm, engine.def, owner.program.ref);
    }
    requests.push({ command, interceptor, engine });
  }
  const menuProvidersKey = definition.keys.find((key) => foldAscii(key) === "menuproviders");
  if (menuProvidersKey !== undefined) {
    const rawMenuProviders = readMember(definition, menuProvidersKey);
    const providers = liveObject(vm, rawMenuProviders, pos, `"registerPlugin" takes a menuProviders dictionary`);
    const validScreens = new Set(["main", "items", "equipment", "abilities"]);
    for (const screen of providers.keys) {
      if (!validScreens.has(screen)) {
        throw new ScriptError("builtin.bad-arg", `registerPlugin: unknown menu screen "${screen}"`, pos);
      }
      const provider = readMember(providers, screen);
      if (!isCallableValue(provider)) {
        throw new ScriptError(CALLABLE_NOT_CALLABLE, `registerPlugin: the menu provider "${screen}" is not callable`, pos);
      }
      menuRequests.push({ screen, provider });
    }
  }
  const registration = addRegistration(services.layers, label, requests, menuRequests);
  const result = createObject(vm, null);
  writeMember(result, "name", label);
  writeMember(result, "remove", removeHandle(registration.id));
  return { kind: "object", handle: result.handle, className: DICTIONARY_CLASS };
}

/**
 * Run the layer `id` (entry 19.8): the interceptor takes the call's arguments and then `next`, the
 * layer below, and runs on the calling thread like any indirect call, so a wait inside it parks the
 * thread inside its frame. A removed layer hands the call to the layer below unchanged.
 */
function performLayer(
  thread: Thread,
  vm: VmState,
  services: ScriptServices,
  program: Program,
  frame: Frame,
  frameIndex: number,
  id: string,
  args: Arg[],
  pos: SourcePos,
): CallOutcome {
  const layer = services.layers.layers.get(id);
  if (layer === undefined) {
    throw new ScriptError(
      CALLABLE_UNKNOWN_DEF,
      `the plugin layer "${id}" is not registered: package layers are rebuilt by package start-up and are not saved (PKG-5)`,
      pos,
    );
  }
  if (layer.removed) {
    return performCallable(thread, vm, services, program, frame, frameIndex, layer.below, args, pos);
  }
  const found = findDefinition(vm, services, program, layer.interceptor.def);
  if (found !== undefined) {
    const takes = found.infos.filter((info) => info.entry >= 0).map((info) => info.params.length);
    if (!takes.includes(args.length + 1)) {
      throw new ScriptError(
        CALLABLE_ARITY,
        `a layer of "${layer.command}" takes ${takes.map((count) => Math.max(count - 1, 0)).join(" or ")} argument(s) before next, got ${args.length}`,
        pos,
      );
    }
  }
  return performCallable(
    thread, vm, services, program, frame, frameIndex, layer.interceptor,
    [...args, { value: layer.below, ref: null }], pos,
  );
}

/** Run the `remove` callable of registration `id` (entry 19.8): `1` when it removed a layer, `0` when none was left. */
function performRemove(
  services: ScriptServices,
  frame: Frame,
  id: string,
  args: readonly Arg[],
  pos: SourcePos,
): CallOutcome {
  if (args.length !== 0) {
    throw new ScriptError(CALLABLE_ARITY, `"remove" takes 0 argument(s), got ${args.length}`, pos);
  }
  const removed = removeRegistration(services.layers, id);
  if (removed === null) {
    throw new ScriptError(
      CALLABLE_UNKNOWN_DEF,
      `the plugin registration "${id}" is not registered: package layers are rebuilt by package start-up and are not saved (PKG-5)`,
      pos,
    );
  }
  frame.ip += 1;
  frame.operands.push({ value: removed, ref: null });
  return "continue";
}

/**
 * Dispatch one indirect call (FUN-8; ADR 0004 decision 8; entries 18.4 and
 * 18.5). A handle runs the binding it names through the environment table's
 * lower entries only — an engine command first (R-35), then a compiled
 * definition, then a command a plugin claims — and never asks the running scope
 * for a symbol, so a handle `bindingOf` made keeps running the binding it named
 * after the name has been reassigned, and a wrapper that calls it cannot
 * recurse into itself. A script function or lambda definition pushes a new
 * frame exactly as a direct call pushes one, bound to the program that defines
 * it; a command name runs that command, so a handle can hold either kind. A
 * lambda frame binds its captured names to the cells named in `value.captures`
 * first, then its parameters as usual: a capture is never a parameter, because
 * lowering leaves parameters out of the capture list.
 *
 * The same thread and the same frame stack carry the call, so a wait inside the
 * callee parks the caller, `end()` unwinds it, returns come back to the caller's
 * operand stack, and each instruction spends one step of the same budget: an
 * indirect call is a direct call with the definition chosen at run time.
 */
function performCallable(
  thread: Thread,
  vm: VmState,
  services: ScriptServices,
  program: Program,
  frame: Frame,
  frameIndex: number,
  value: CallableValue,
  args: Arg[],
  pos: SourcePos,
): CallOutcome {
  const hydrated = parseHostMethodDef(value.def);
  if (hydrated !== null) {
    const holder = value.receiver === null ? undefined : findObject(vm, Number(value.receiver));
    if (holder === undefined || holder.hostType !== hydrated.typeName) {
      throw new ScriptError("object.invalid", "hydrated host method receiver is not live", pos);
    }
    const type = services.hostTypes.get(hydrated.typeName);
    const commandName = type?.methods?.[hydrated.methodName];
    if (type === undefined || commandName === undefined) {
      throw new ScriptError("object.invalid", `host type "${hydrated.typeName}" is not installed`, pos);
    }
    const command = services.commands.builtin(commandName) ?? services.commands.extension(commandName);
    if (command === undefined) throw new ScriptError("unknown.command", `host method command "${commandName}" is not registered`, pos);
    const given: Arg[] = [{ value: { kind: "object", handle: holder.handle, className: holder.className }, ref: null }, ...args];
    return dispatchResolved(thread, vm, services, program, frame, frameIndex, value.def, { kind: "command", command }, given, pos, true);
  }
  const layerId = layerIdOf(value.def);
  if (layerId !== null) return performLayer(thread, vm, services, program, frame, frameIndex, layerId, args, pos);
  const registrationId = registrationIdOf(value.def);
  if (registrationId !== null) return performRemove(services, frame, registrationId, args, pos);
  const builtin = services.commands.builtin(value.def);
  if (builtin !== undefined) {
    // A host-provided method read off an object carries it as the receiver; the command takes it first (EMIT-2).
    const holder = value.receiver !== null && isHostMethodDef(value.def) ? findObject(vm, Number(value.receiver)) : undefined;
    const given: Arg[] =
      holder === undefined
        ? args
        : [{ value: { kind: "object", handle: holder.handle, className: holder.className }, ref: null }, ...args];
    return dispatchResolved(
      thread, vm, services, program, frame, frameIndex, value.def,
      { kind: "command", command: builtin }, given, pos, true,
    );
  }
  const found = findDefinition(vm, services, program, value.def, args.length);
  if (found === undefined) {
    const extension = services.commands.extension(value.def);
    if (extension === undefined) {
      throw new ScriptError(
        CALLABLE_UNKNOWN_DEF,
        `the callable's definition "${value.def}" is in no compiled program`,
        pos,
      );
    }
    return dispatchResolved(
      thread, vm, services, program, frame, frameIndex, value.def,
      { kind: "command", command: extension }, args, pos, true,
    );
  }

  const info = found.infos.find((entry) => entry.entry >= 0 && entry.params.length === args.length);
  if (info === undefined) {
    const takes = found.infos.filter((entry) => entry.entry >= 0).map((entry) => entry.params.length);
    throw new ScriptError(CALLABLE_ARITY, `"${value.def}" takes ${takes.join(" or ")} argument(s), got ${args.length}`, pos);
  }
  let receiverHandle: number | undefined;
  let receiverClass: string | undefined;
  if (value.receiver !== null) {
    const handle = Number(value.receiver);
    const receiver = Number.isSafeInteger(handle) ? findObject(vm, handle) : undefined;
    if (receiver === undefined) throw new ScriptError("object.invalid", "callable receiver is not a live object", pos);
    receiverHandle = handle;
    receiverClass = receiver.className;
  }

  const locals = bindMethodLocals(info, args);
  const names = info.captures ?? [];
  if (names.length !== value.captures.length) {
    throw new ScriptError(
      CALLABLE_UNKNOWN_DEF,
      `the callable's definition "${value.def}" captures ${names.length} name(s), but the handle names ${value.captures.length}`,
      pos,
    );
  }
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    if (Object.hasOwn(locals, name)) continue;
    const cell = value.captures[index]!;
    if (cell === "") continue;
    setOwnSlot(locals, name, { value: vm.cells?.[cell] ?? 0, ref: cellRef(cell) });
  }

  frame.ip += 1;
  const definitionRef =
    value.owner === undefined || found.program.ref.owner === value.owner
      ? found.program.ref
      : { ...found.program.ref, owner: value.owner };
  const receiverContext =
    receiverHandle === undefined ? {} : { objectHandle: receiverHandle, objectClass: receiverClass ?? "" };
  thread.frames.push({
    program: definitionRef,
    ip: info.entry,
    locals,
    operands: [],
    errorHandler: null,
    autoLocal: frame.autoLocal,
    ...receiverContext,
  });
  return "continue";
}

/**
 * PKG-4: a package namespace is chosen ahead of a `namespace.prg` file the program also
 * holds, and the first call it serves says so once per namespace and file.
 */
function warnNamespaceHidesFile(services: ScriptServices, program: Program, namespace: string): void {
  const folded = foldNamespace(namespace);
  const path = `${namespace}.prg`;
  if (!Object.hasOwn(program.fileKeys, path)) return;
  const key = `${folded}\u0000${path}`;
  if (services.hiddenFileWarned.has(key)) return;
  services.hiddenFileWarned.add(key);
  services.logger.warn({
    level: "warn",
    code: "namespace.hides-file",
    message: `the package namespace "${folded}" is chosen over the file "${path}" for \`${namespace}.name(...)\` calls`,
    data: { namespace: folded, file: path },
  });
}

/**
 * Run a request continuation's command (a call site that was already passed, so
 * the instruction pointer does not advance). The command resolves through the
 * engine's own bindings only — the environment table without the running
 * scope's symbol — because the continuation belongs to the command that asked
 * for it: a script that has reassigned the name does not intercept it.
 */
function performContinuation(
  thread: Thread,
  vm: VmState,
  services: ScriptServices,
  program: Program,
  frame: Frame,
  frameIndex: number,
  name: string,
  args: Arg[],
  pos: SourcePos,
): CallOutcome {
  const resolved = resolveCall(name, args.length, program, services.commands);
  if (resolved === undefined || resolved.kind === "callable") {
    throw new ScriptError("unknown.command", `no built-in or function named "${name}"`, pos);
  }
  return dispatchResolved(thread, vm, services, program, frame, frameIndex, name, resolved, args, pos, false);
}

/** Report the actual AD-8 result at its VM call site, never in the registry. */
function postResolution(
  services: ScriptServices,
  thread: number,
  name: string,
  argc: number,
  resolved: CallResolution,
  pos: SourcePos,
  via: CallObservation["via"],
  namespace?: string,
): void {
  if (services.postCall === undefined) return;
  const kind = resolved.kind === "callable" ? "callable"
    : resolved.kind === "function" ? "script"
      : namespace === undefined && services.commands.builtin(name) !== undefined ? "builtin" : "extension";
  const plugin = kind === "extension" ? services.callPlugin?.(name, namespace) : undefined;
  observe(services.postCall, {
    kind, name: namespace === undefined ? name : `${namespace}.${name}`, argc, via, pos,
    ...(plugin === undefined ? {} : { plugin }),
  }, thread);
}

type ThreadPair = { readonly source: string | null; readonly target: string | null };
type ProgramContextPlan = {
  readonly pair: ThreadPair;
  readonly context: ObjectValue | null;
  readonly members: Readonly<Record<string, Value>>;
};

function foldedEntityHandle(value: string): string {
  return value.replaceAll("\\", "/").trim().toLowerCase();
}

function hasLiveEntityHandle(state: GameState | undefined, handle: string): boolean {
  if (state === undefined) return false;
  const wanted = foldedEntityHandle(handle);
  if (state.sprites.players.some((sprite) =>
    foldedEntityHandle(sprite.id) === wanted || foldedEntityHandle(sprite.source) === wanted
  )) return true;
  if (state.sprites.items.some((sprite) =>
    foldedEntityHandle(sprite.id) === wanted || foldedEntityHandle(sprite.source) === wanted
  )) return true;
  return state.actors.actors.some((actor) =>
    foldedEntityHandle(String(actor.id)) === wanted ||
    foldedEntityHandle(actor.name) === wanted ||
    foldedEntityHandle(actor.source) === wanted
  );
}

function suppliedEntityHandle(
  value: Value,
  command: "executeProgram" | "replaceProgram",
  slot: "source" | "target",
  callerPair: ThreadPair,
  state: GameState | undefined,
  pos: SourcePos,
): string | null {
  if (value === null || value === 0) return null;
  if (typeof value !== "string") {
    throw new ScriptError("builtin.bad-arg", `${command}: ${slot} must be a live entity handle, "source", "target", null or 0`, pos);
  }
  const special = foldedEntityHandle(value);
  const handle = special === "source" ? callerPair.source : special === "target" ? callerPair.target : value;
  if (handle === null) return null;
  if (!hasLiveEntityHandle(state, handle)) {
    throw new ScriptError("builtin.bad-arg", `${command}: ${slot} handle "${value}" does not name a live entity`, pos);
  }
  return handle;
}

function prepareProgramContext(
  vm: VmState,
  services: ScriptServices,
  command: "executeProgram" | "replaceProgram",
  mode: unknown,
  contextValue: unknown,
  sourceValue: unknown,
  targetValue: unknown,
  callerPair: ThreadPair,
  pos: SourcePos,
): ProgramContextPlan {
  let context: ObjectValue | null = null;
  let members: Readonly<Record<string, Value>> = {};
  let source: Value | undefined;
  let target: Value | undefined;
  if (mode === "object") {
    if (!isObjectValue(contextValue as Value)) {
      throw new ScriptError("builtin.bad-arg", "program context must be a dictionary", pos);
    }
    const record = findObject(vm, (contextValue as ObjectValue).handle);
    if (record === undefined || !isDictionary(record)) {
      throw new ScriptError("builtin.bad-arg", "program context must be a live dictionary", pos);
    }
    context = contextValue as ObjectValue;
    if (Object.hasOwn(record.members, "source")) source = record.members.source!;
    if (Object.hasOwn(record.members, "target")) target = record.members.target!;
  } else if (mode === "positional") {
    if (sourceValue === undefined || targetValue === undefined) {
      throw new ScriptError("builtin.bad-arg", `${command}: positional source and target are required`, pos);
    }
    source = sourceValue as Value;
    target = targetValue as Value;
    members = { source, target };
  } else if (mode !== "default") {
    throw new ScriptError("builtin.bad-arg", "invalid program context form", pos);
  }
  const pair = {
    source: source === undefined ? callerPair.source : suppliedEntityHandle(source, command, "source", callerPair, services.view.state, pos),
    target: target === undefined ? callerPair.target : suppliedEntityHandle(target, command, "target", callerPair, services.view.state, pos),
  };
  return { pair, context, members };
}

function materializeProgramContext(vm: VmState, plan: ProgramContextPlan): ObjectValue {
  if (plan.context !== null) return plan.context;
  const record = createObject(vm, null);
  for (const [name, value] of Object.entries(plan.members)) writeMember(record, name, value);
  return { kind: "object", handle: record.handle, className: DICTIONARY_CLASS };
}

function finishProgramRoot(thread: Thread, rootIndex: number): boolean {
  const root = thread.frames[rootIndex];
  if (root?.programRoot === undefined) return false;
  const restore = root.programRoot.restore;
  if (restore !== null) {
    thread.frames.length = rootIndex;
    thread.detached = thread.detached.filter((index) => index < rootIndex);
    thread.source = restore.source;
    thread.target = restore.target;
    thread.status = "ready";
    return false;
  }
  thread.frames = [];
  thread.status = "finished";
  thread.wait = null;
  thread.detached = [];
  thread.collect = null;
  return true;
}

/**
 * Dispatch one resolved call. `advance` is false for a request continuation;
 * `observed` is true when the source call site already reported its resolution.
 */
function dispatchResolved(
  thread: Thread,
  vm: VmState,
  services: ScriptServices,
  program: Program,
  frame: Frame,
  frameIndex: number,
  name: string,
  resolved: Exclude<CallResolution, { readonly kind: "callable" }>,
  args: Arg[],
  pos: SourcePos,
  advance: boolean,
  observed = false,
): CallOutcome {
  if (!observed) postResolution(services, thread.id, name, args.length, resolved, pos, advance ? "handle" : "continuation");
  if (resolved.kind === "function") {
    if (advance) frame.ip += 1;
    const target = resolved.target;
    const locals: { [name: string]: LocalSlot } = {};
    for (let i = 0; i < target.params.length; i++) {
      const param = target.params[i]!;
      const arg = args[i];
      if (param.byRef && arg && arg.ref !== null) {
        setOwnSlot(locals, param.name, { value: arg.value, ref: arg.ref });
      } else {
        const v = arg ? (arg.value === null ? 0 : arg.value) : 0;
        setOwnSlot(locals, param.name, { value: v, ref: localRef(param.name) });
      }
    }
    thread.frames.push({
      program: target.program,
      ip: target.entry,
      locals,
      operands: [],
      errorHandler: null,
      autoLocal: frame.autoLocal,
    });
    return "continue";
  }

  checkArity(resolved.command.spec, args, name, pos);
  let result: CommandResult;
  try {
    result = resolved.command.spec.call(services.view, args, resolved.command.next);
  } catch (error) {
    // A command cannot know where it was called from: locate its error here.
    if (error instanceof ScriptError && error.pos === null) {
      throw new ScriptError(error.code, error.message, pos);
    }
    throw error;
  }
  if (advance) frame.ip += 1;

  const tick = services.clock.tick();
  let controlApplied = false;
  let parked = false;
  let produced: Value | undefined;
  for (const effect of result.effects ?? []) {
    if (effect.kind === "vm.control") {
      const action = effect.args?.[0];
      if (action === "menu.open") {
        const screen = effect.args?.[1];
        if (typeof screen !== "string" || !["main", "items", "equipment", "abilities"].includes(screen)) {
          throw new ScriptError("builtin.bad-arg", "menu.open: invalid screen", pos);
        }
        const menuBaseDepth = services.menuOwners.menu.read().screens.length;
        const registered = topMenuProvider(services.layers, screen);
        if (registered?.kind === "rpgcode") {
          const opened = services.menuOwners.menu.apply({
            type: "navigation",
            screens: [...services.menuOwners.menu.read().screens, { screen, actorId: services.menuOwners.party.read().selected, selection: 0 }],
          });
          if (!opened.ok) throw new ScriptError("menu.state-refused", opened.error?.message ?? "menu frame was refused", pos);
          const context = createObject(vm, null);
          writeMember(context, "screen", screen);
          writeMember(context, "state", null);
          writeMember(context, "event", "enter");
          const before = thread.frames.length;
          try {
            performCallable(
              thread, vm, services, program, frame, frameIndex, registered.provider,
              [{ value: { kind: "object", handle: context.handle, className: DICTIONARY_CLASS }, ref: null }],
              pos,
            );
          } catch (error) {
            services.menuOwners.menu.apply({ type: "navigation", screens: services.menuOwners.menu.read().screens.slice(0, menuBaseDepth) });
            throw error instanceof ScriptError
              ? new ScriptError(error.code, error.message, pos)
              : new ScriptError("menu.provider-error", error instanceof Error ? error.message : String(error), pos);
          }
          const providerFrame = thread.frames[before];
          if (providerFrame !== undefined) {
            providerFrame.menuScreen = screen;
            providerFrame.menuContinuation = {
              providerId: registered.id,
              screen,
              state: null,
              phase: "enter",
              childScreen: null,
              parkSeq: null,
              parents: [],
              frameIndex,
              opIp: frame.ip - 1,
              depth: frame.operands.length + args.length,
              menuBaseDepth,
              file: pos.file,
              line: pos.line,
            };
          }
          continue;
        }
        if (registered?.kind !== "native") throw new ScriptError("menu.provider-missing", `no menu provider is registered for "${screen}"`, pos);
        const providerId = registered.id;
        const provider = registered.provider;
        const opened = services.menuOwners.menu.apply({
          type: "navigation",
          screens: [...services.menuOwners.menu.read().screens, { screen, actorId: services.menuOwners.party.read().selected, selection: 0 }],
        });
        if (!opened.ok) throw new ScriptError("menu.state-refused", opened.error?.message ?? "menu frame was refused", pos);
        const continuation = {
          providerId,
          screen,
          state: null,
          phase: "enter",
          childScreen: null,
          parkSeq: services.view.state?.input.nextSeq ?? 0,
          parents: [],
          frameIndex,
          opIp: frame.ip - 1,
          depth: frame.operands.length + args.length,
          menuBaseDepth,
          file: pos.file,
          line: pos.line,
        };
        let transition: MenuProviderResult;
        try {
          transition = provider({ providerId, context: services.menuOwners, state: null, event: { type: "enter" } });
          if (!isMenuProviderResult(transition)) throw new ScriptError("menu.provider-result", "menu provider returned an invalid or non-plain transition", pos);
        } catch (error) {
          services.menuOwners.menu.apply({ type: "navigation", screens: services.menuOwners.menu.read().screens.slice(0, menuBaseDepth) });
          throw error instanceof ScriptError
            ? new ScriptError(error.code, error.message, pos)
            : new ScriptError("menu.provider-error", error instanceof Error ? error.message : String(error), pos);
        }
        if (transition.kind === "wait") {
          if (transition.wait.kind !== "menu.screen" || !transition.wait.global) {
            services.menuOwners.menu.apply({ type: "navigation", screens: services.menuOwners.menu.read().screens.slice(0, -1) });
            throw new ScriptError("menu.provider-wait", "menu providers must return a global menu.screen wait", pos);
          }
          thread.wait = {
            ...transition.wait,
            payload: [{ ...continuation, state: transition.state, phase: "input" }, ...transition.wait.payload],
          };
          thread.status = "waiting";
          parked = true;
        } else if (transition.kind === "open") {
          const child = topMenuProvider(services.layers, transition.screen);
          if (child === undefined) {
            services.menuOwners.menu.apply({ type: "navigation", screens: services.menuOwners.menu.read().screens.slice(0, -1) });
            throw new ScriptError("menu.provider-missing", `no menu provider is registered for "${transition.screen}"`, pos);
          }
          const childFrame = services.menuOwners.menu.apply({
            type: "navigation",
            screens: [...services.menuOwners.menu.read().screens, { screen: transition.screen, actorId: services.menuOwners.party.read().selected, selection: 0 }],
          });
          if (!childFrame.ok) {
            services.menuOwners.menu.apply({ type: "navigation", screens: services.menuOwners.menu.read().screens.slice(0, menuBaseDepth) });
            throw new ScriptError("menu.state-refused", childFrame.error?.message ?? "menu frame was refused", pos);
          }
          thread.wait = {
            kind: "menu.screen",
            global: true,
            id: child.id,
            payload: [{
              ...continuation,
              providerId: child.id,
              screen: transition.screen,
              state: null,
              phase: "enter",
              childScreen: null,
              parkSeq: null,
              parents: [{ providerId, screen, state: transition.state }],
            }],
            resumeRefs: [],
          };
          thread.status = "waiting";
          parked = true;
        } else {
          const closed = services.menuOwners.menu.apply({ type: "navigation", screens: services.menuOwners.menu.read().screens.slice(0, -1) });
          if (!closed.ok) {
            services.menuOwners.menu.apply({ type: "navigation", screens: services.menuOwners.menu.read().screens.slice(0, menuBaseDepth) });
            throw new ScriptError("menu.state-refused", closed.error?.message ?? "menu frame close was refused", pos);
          }
        }
      }
      if (action === "end") {
        let rootIndex = -1;
        for (let index = thread.frames.length - 1; index >= 0; index--) {
          if (thread.frames[index]?.programRoot !== undefined) {
            rootIndex = index;
            break;
          }
        }
        if (rootIndex >= 0) {
          if (finishProgramRoot(thread, rootIndex)) return "yield";
          controlApplied = true;
        } else {
          thread.frames = [];
          thread.status = "finished";
          thread.wait = null;
          thread.detached = [];
          thread.collect = null;
          return "yield";
        }
      }
      if (action === "executeProgramRef") {
        const raw = effect.args?.[1];
        if (
          typeof raw !== "object" || raw === null || Array.isArray(raw) ||
          raw.kind !== "inline" || typeof raw.text !== "string" || typeof raw.ir !== "string"
        ) throw new ScriptError("builtin.bad-arg", "executeProgramRef: expected an inline program reference", pos);
        const callerPair = { source: thread.source, target: thread.target };
        const plan = prepareProgramContext(vm, services, "executeProgram", "positional", undefined, null, null, callerPair, pos);
        const newRef = withRedirects(raw as unknown as ProgramRef, vm.redirects);
        services.programs.get(newRef);
        const context = materializeProgramContext(vm, plan);
        const rootFrame: Frame = {
          program: newRef,
          ip: 0,
          locals: {},
          operands: [],
          errorHandler: null,
          autoLocal: false,
          programRoot: { restore: callerPair },
        };
        setOwnSlot(rootFrame.locals, "context", { value: context, ref: localRef("context") });
        thread.source = plan.pair.source;
        thread.target = plan.pair.target;
        frame.operands.push({ value: 0, ref: null });
        thread.frames.push(rootFrame);
        controlApplied = true;
      }
      if (action === "executeProgram" || action === "replaceProgram") {
        const file = effect.args?.[1];
        if (typeof file !== "string") {
          throw new ScriptError("builtin.bad-arg", `${action}: program name must be a string`, pos);
        }
        if (file !== "") {
          const callerPair = { source: thread.source, target: thread.target };
          const mode = effect.args?.[2];
          const contextValue = mode === "object" ? effect.args?.[3] : undefined;
          const sourceValue = mode === "positional" ? effect.args?.[3] : undefined;
          const targetValue = mode === "positional" ? effect.args?.[4] : undefined;
          const plan = prepareProgramContext(
            vm,
            services,
            action,
            mode,
            contextValue,
            sourceValue,
            targetValue,
            callerPair,
            pos,
          );
          if (services.loader === undefined) {
            throw new ScriptError("program.missing", `no program "${file}" is in the asset index`, pos);
          }
          const newRef = fileProgramRef(services.loader, file, vm.redirects);
          services.programs.get(newRef);
          const context = materializeProgramContext(vm, plan);
          const rootFrame: Frame = {
            program: newRef,
            ip: 0,
            locals: {},
            operands: [],
            errorHandler: null,
            autoLocal: false,
            programRoot: {
              restore: action === "executeProgram" ? callerPair : null,
            },
          };
          setOwnSlot(rootFrame.locals, "context", { value: context, ref: localRef("context") });
          if (action === "executeProgram") {
            thread.source = plan.pair.source;
            thread.target = plan.pair.target;
            frame.operands.push({ value: 0, ref: null });
            thread.frames.push(rootFrame);
          } else {
            thread.source = plan.pair.source;
            thread.target = plan.pair.target;
            thread.frames = [rootFrame];
            thread.status = "ready";
            thread.wait = null;
            thread.detached = [];
            thread.collect = null;
            return "yield";
          }
          controlApplied = true;
        }
      }
      if (action === "jump") {
        const labelName = effect.args?.[1] as string;
        const targetIp = lookupLabel(program, frame.ip, labelName);
        if (targetIp === undefined) {
          throw new ScriptError(
            "vm.unknown-label",
            `label \`:${labelName}\` not found in current function scope`,
            pos,
          );
        }
        frame.ip = targetIp;
        controlApplied = true;
      }
      if (action === "setErrorHandler") {
        installHandler(program, frame, frameIndex, frame.ip, pos, effect.args?.[1] as string);
      }
      if (action === "setResumeNextHandler") {
        installHandler(program, frame, frameIndex, frame.ip, pos, null);
      }
      if (action === "resumeNext") {
        resumeAfterFailure(frame, frameIndex, pos);
        controlApplied = true;
      }
      if (action === "debug") {
        if (effect.args?.[1] === true) delete vm.messagesOff;
        else vm.messagesOff = true;
      }
      if (action === "debugger") {
        services.logger.info({
          level: "info",
          code: "script.debugger",
          message: String(effect.args?.[1] ?? ""),
          data: { file: pos.file, line: pos.line, thread: thread.id },
        });
      }
      if (action === "emitter") {
        registerHostEmitter(vm, services, effect.args?.[2] as Value | undefined);
        const event = applyEmitterOp(
          vm,
          eventsOf(services),
          effect.args?.[1] as string,
          effect.args?.[2] as Value,
          (effect.args?.slice(3) ?? []) as Value[],
          thread.id,
        );
        if (event !== null) {
          parkOnEvent(thread, event);
          parked = true;
        }
      }
      if (action === "mediaplay") {
        if (services.media === undefined) throw new ScriptError("unknown.command", "mediaPlay: the media owner is not installed", pos);
        const file = effect.args?.[1];
        const options = effect.args?.[2] as MediaPlayOptions | undefined;
        const returnVoice = effect.args?.[3] !== false;
        if (typeof file !== "string" || options === undefined) throw new ScriptError("builtin.bad-arg", "mediaPlay: malformed start", pos);
        const started = services.media.play(file, options);
        const outcome = started.outcome;
        produced = returnVoice && (outcome.kind === "pending" || outcome.kind === "started" || (outcome.kind === "same-file" && outcome.action === "carry-on"))
          ? objectValue(started.record)
          : null;
        if (outcome.kind === "before-play") {
          thread.wait = services.media.beforePlayWait(started, returnVoice, options.wait);
          thread.status = "waiting";
          parked = true;
          produced = null;
        } else if (options.wait) {
          let wait: Wait | null = null;
          if (outcome.kind === "pending") wait = services.media.pendingWait(started);
          else if (outcome.kind === "started" || (outcome.kind === "same-file" && outcome.action === "carry-on")) {
            const ref = mediaVoiceRef(started.record);
            wait = ref === null ? null : services.media.voiceWait(ref);
          }
          if (wait !== null) {
            if (wait.kind === "audio.track") wait.payload[1] = produced;
            thread.wait = wait;
            thread.status = "waiting";
            parked = true;
          }
        }
      }
      if (action === "mediaTrackObject") {
        const name = effect.args?.[1];
        if (typeof name !== "string" || services.media === undefined) throw new ScriptError("builtin.bad-arg", "media.track: malformed track", pos);
        const record = services.media.trackObject(name);
        produced = record === null ? null : objectValue(record);
      }
      if (action === "registerPlugin") {
        produced = registerPluginCall(vm, services, program, args, pos);
      }
      if (action === "autoLocal") {
        frame.autoLocal = Boolean(effect.args?.[1]);
      }
      if (action === "kill") {
        const targets = (effect.args?.slice(1) ?? []) as Array<string | { readonly ref: string }>;
        for (const target of targets) {
          if (typeof target === "string") {
            deleteVariable(vm, thread, frameIndex, target, services);
            continue;
          }
          const member = parseObjectRef(target.ref as RefId);
          const record = member === null ? undefined : findObject(vm, member.handle);
          if (member !== null && record !== undefined) {
            const type = record.hostType === undefined ? undefined : services.hostTypes.get(record.hostType);
            const context = hostContext(services, record);
            const result = type?.remove !== undefined && context !== null ? type.remove(context, member.name) : "not-host";
            if (result === "system-owned") throw new ScriptError(KILL_SYSTEM_OWNED, `host member "${member.name}" is system-owned`);
            if (result !== "removed") removeMember(record, member.name);
          }
        }
      }
      if (action === "split") {
        const baseRef = effect.args?.[1] as RefId;
        const baseName = refName(baseRef);
        const isGlobal = baseRef.startsWith("global:");
        const parts = (effect.args?.slice(2) ?? []) as Value[];
        for (let i = 0; i < parts.length; i++) {
          const elemName = `${baseName}[${i}]`;
          const elemRef = isGlobal ? globalRef(elemName) : localRef(elemName);
          writeRef(vm, thread, frameIndex, elemRef, parts[i]!, services);
        }
      }
      if (action === "local") {
        const varName = effect.args?.[1] as string;
        if (!Object.hasOwn(frame.locals, varName)) {
          setOwnSlot(frame.locals, varName, { value: 0, ref: localRef(varName) });
        }
      }
      if (action === "global") {
        const varName = effect.args?.[1] as string;
        if (!Object.hasOwn(vm.globals, varName)) {
          setOwnValue(vm.globals, varName, 0);
        }
      }
      if (action === "file") {
        const fileAction = effect.args?.[1] as string;
        const fileId = effect.args?.[2] as string;
        if (fileAction === "open") {
          const fileData = effect.args?.[6] as string;
          const file = {
            id: fileId,
            mode: effect.args?.[3] as "input" | "output" | "append" | "binary",
            path: effect.args?.[4] as string,
            area: effect.args?.[5] as "saves" | "files",
            data: fileData,
            position: effect.args?.[3] === "append" ? fileData.length / 2 : 0,
            loaded: true,
          };
          const existing = vm.files.findIndex((item) => item.id === fileId);
          if (existing >= 0) vm.files.splice(existing, 1, file);
          else vm.files.push(file);
        }
        if (fileAction === "close") {
          const index = vm.files.findIndex((item) => item.id === fileId);
          if (index >= 0) vm.files.splice(index, 1);
        }
        if (fileAction === "position") {
          const file = vm.files.find((item) => item.id === fileId);
          if (file !== undefined) file.position = effect.args?.[3] as number;
        }
        if (fileAction === "data") {
          const file = vm.files.find((item) => item.id === fileId);
          if (file !== undefined) {
            file.data = effect.args?.[3] as string;
            file.position = effect.args?.[4] as number;
          }
        }
      }
      if (action === "thread") {
        startThread(vm, {
          ref: { kind: "inline", text: effect.args?.[1] as string, ir: IR_VERSION },
          kind: effect.args?.[2] === true ? "persistent" : "board",
          owner: "script",
        });
      }
      if (action === "threadKill") {
        const id = effect.args?.[1] as number;
        if (!killThread(vm, id)) {
          throw new ScriptError("thread.unknown", `killThread: no thread ${id} is registered`, pos);
        }
        services.onThreadRemoved?.(id);
        if (id === thread.id) return "yield";
      }
      if (action === "threadSleep") {
        const target = liveTarget(vm, effect.args?.[1] as number, "threadSleep", pos);
        const current = target.wait;
        if (
          target.status === "waiting" &&
          (current === null || current.kind !== "sleep" || current.global)
        ) {
          throw new ScriptError(
            "thread.busy",
            `threadSleep: thread ${target.id} is waiting on something other than a sleep`,
            pos,
          );
        }
        const resumesCall =
          target === thread || (current !== null && current.kind === "sleep" && current.resumesCall);
        target.wait = {
          kind: "sleep",
          global: false,
          until: (effect.args?.[2] ?? null) as number | null,
          resumesCall,
        };
        target.status = "waiting";
        if (target === thread) parked = true;
      }
      if (action === "threadWake") {
        const id = effect.args?.[1] as number;
        const target = findThread(vm, id);
        if (target === undefined) {
          throw new ScriptError("thread.unknown", `threadWake: no thread ${id} is registered`, pos);
        }
        const slept = target.wait;
        if (target.status === "waiting" && slept !== null && slept.kind === "sleep" && !slept.global) {
          target.status = "ready";
          target.wait = null;
          if (slept.resumesCall) {
            const top = target.frames[target.frames.length - 1];
            if (top === undefined) target.status = "finished";
            else top.operands.push({ value: null, ref: null });
          }
        }
      }
      if (action === "threadTell") {
        const target = liveTarget(vm, effect.args?.[1] as number, "tellThread", pos);
        target.queue.push({ text: effect.args?.[2] as string, file: pos.file, line: pos.line });
      }
      if (action === "move") {
        const sprite = effect.args?.[1] as string;
        const ticks = effect.args?.[2] as number;
        if (!Number.isInteger(ticks) || ticks < 1 || tick + ticks > MAX_TICK) {
          throw new ScriptError("builtin.bad-arg", `"${name}": a move takes a positive whole number of ticks`, pos);
        }
        if (thread.collect !== null) {
          thread.collect.push({ sprite, until: tick + ticks });
        } else {
          thread.wait = {
            kind: "movement",
            global: thread.kind === "blocking",
            moves: [{ sprite, until: tick + ticks }],
          };
          thread.status = "waiting";
          parked = true;
        }
      }
      if (action === "multiRun") {
        const moves = thread.collect;
        if (moves === null) {
          thread.collect = [];
        } else {
          thread.collect = null;
          if (moves.length > 0) {
            thread.wait = { kind: "movement", global: thread.kind === "blocking", moves };
            thread.status = "waiting";
            parked = true;
          }
        }
      }
    } else {
      if (effect.kind === "emit") applyEmitEffect(vm, eventsOf(services), effect.args ?? []);
      const section = effect.section;
      const out: { [index: string]: PlainData } = {};
      for (const [index, value] of result.out ?? []) {
        out[String(index)] = typeof value === "number" && value === 0 ? 0 : value;
      }
      const recorded = recordEffect(vm, {
        tick,
        thread: thread.id,
        name,
        kind: effect.kind,
        args: effect.args !== undefined ? [...effect.args] : argValues(args),
        out,
        result: result.value,
        patch: section === undefined ? null : { section, path: [], op: "merge", value: null },
        wait: null,
        request: null,
      });
      if (section !== undefined) services.postEffect?.(section, recorded);
    }
  }

  if (controlApplied) return "continue";
  if (parked) return "yield";

  if (result.wait !== undefined) {
    const waitEffect = result.wait.kind === "movement"
      ? { ...result.wait, moves: result.wait.moves.map((move) => ({ ...move })) }
      : { ...result.wait };
    recordEffect(vm, {
      tick,
      thread: thread.id,
      name,
      kind: "wait",
      args: argValues(args),
      out: {},
      result: result.value,
      patch: null,
      wait: waitEffect,
      request: null,
    });
  }

  if (result.request !== undefined) {
    if (services.isPackageStartup()) {
      const packageName = frame.program.owner ?? "unknown";
      throw new ScriptError("package.startup-forbidden", `package "${packageName}" startup cannot issue host request "${result.request.kind}"`, pos);
    }
    const timeout = result.timeoutTicks;
    let deadline: number | null = null;
    if (timeout !== undefined) {
      if (!Number.isInteger(timeout) || timeout < 1 || tick + timeout > MAX_TICK) {
        throw new ScriptError(
          "builtin.bad-arg",
          `"${name}": a request timeout is a positive whole number of ticks`,
          pos,
        );
      }
      deadline = tick + timeout;
    }
    vm.requestSeq += 1;
    const reqId = vm.requestSeq;
    const request: CommandRequest = { ...result.request, reqId };
    const wait = request.kind === "playVideo" && typeof request.key === "string" && (request.presentation === "full" || request.presentation === "small")
      ? videoWait(reqId, request.key, request.presentation, name)
      : requestWait(reqId, deadline, result.then, pos, request.kind);
    recordEffect(vm, {
      tick,
      thread: thread.id,
      name,
      kind: "request",
      args: argValues(args),
      out: {},
      result: null,
      patch: null,
      wait: { ...wait },
      request,
    });
    services.postRequest?.(request);
    thread.wait = wait;
    thread.status = "waiting";
    return "yield";
  }

  if (result.wait !== undefined) {
    const wait = result.wait.kind === "input.key" && result.wait.parkSeq === undefined &&
      services.view.state?.input.keys.length
      ? { ...result.wait, parkSeq: services.view.state.input.nextSeq }
      : result.wait;
    thread.wait = wait;
    thread.status = "waiting";
    return "yield";
  }

  applyOut(vm, thread, frameIndex, resolved.command.spec, args, result.out ?? [], name, pos, services);
  frame.operands.push({ value: produced !== undefined ? produced : result.value, ref: null });
  return "continue";
}

/** A continuation argument is a script value; booleans become `1`/`0` and anything structured is refused. */
function continuationArg(value: PlainData, pos: SourcePos): Arg {
  if (typeof value === "number" || typeof value === "string" || value === null) {
    return { value, ref: null };
  }
  if (typeof value === "boolean") return { value: value ? 1 : 0, ref: null };
  throw new ScriptError("request.bad-reply", "a request continuation argument must be a number, a string or null", pos);
}

function sourceChanged(error: unknown): boolean {
  return error instanceof ScriptError && error.code === "restore.source-changed";
}

function restartThreadFromSource(thread: Thread, vm: VmState, services: ScriptServices): void {
  const stale = thread.frames[0]?.program;
  if (stale === undefined) throw new ScriptError("restore.shape", `thread ${thread.id} has no program frame`);
  const ref = restartProgramRef(stale, services.loader, vm.redirects);
  services.programs.get(ref);
  thread.frames = [
    {
      program: ref,
      ip: 0,
      locals: {},
      operands: [],
      errorHandler: null,
      autoLocal: false,
    },
  ];
  thread.status = "ready";
  thread.wait = null;
  thread.pending = null;
  thread.detached = [];
  thread.collect = null;
}

function ensureCurrentProgram(thread: Thread, vm: VmState, services: ScriptServices): void {
  const frame = thread.frames[thread.frames.length - 1];
  if (frame === undefined) return;
  // Only a changed source restarts a thread here. An older instruction version was
  // already restarted from source by restoreGameState (owner ruling 2026-10-30).
  try {
    services.programs.get(frame.program);
  } catch (error) {
    if (!sourceChanged(error)) throw error;
    restartThreadFromSource(thread, vm, services);
  }
}

/**
 * Run one thread for at most `budget` VM steps and return the steps it ran
 * (THR-3). The thread keeps its whole state between calls, so a thread
 * preempted at the budget resumes at the same instruction next tick, and a
 * test can single-step with a budget of 1. A pending request continuation runs
 * first; then code queued by `tellThread` runs, one item at a time, each on a
 * frame of its own on top of the thread's frames (THR-2).
 */
export function stepThread(
  thread: Thread,
  vm: VmState,
  services: ScriptServices,
  budget: number,
): number {
  let steps = 0;
  const finish = (): number => {
    refreshBlock(vm, services.clock.tick());
    return steps;
  };
  services.setCommandThread(thread.id);
  while (thread.status === "ready" && steps < budget) {
    const frameBeforeRestore = thread.frames[thread.frames.length - 1];
    if (frameBeforeRestore !== undefined) {
      ensureCurrentProgram(thread, vm, services);
      if (thread.frames[thread.frames.length - 1] !== frameBeforeRestore) continue;
    }
    if (thread.pending !== null) {
      const pending = thread.pending;
      thread.pending = null;
      const pendingIndex = thread.frames.length - 1;
      const top = thread.frames[pendingIndex];
      if (top === undefined) {
        thread.status = "finished";
        return finish();
      }
      steps += 1;
      incrementStepCounter(vm, top.program.owner);
      const pos: SourcePos = { file: pending.file, line: pending.line };
      const program = services.programs.get(top.program);
      // The requesting call has already consumed its arguments and advanced
      // the IP. A failed reply belongs to that same call and frame (ERR-1/2),
      // not to the host: restore its missing result or enter its error handler.
      const callIp = top.ip - 1;
      const call = program.ops[callIp];
      const depth = top.operands.length + (call === undefined ? 0 : stackEffect(call).pops);
      try {
        const args = pending.args.map((value) => continuationArg(value, pos));
        const outcome = performContinuation(
          thread, vm, services, program, top, pendingIndex, pending.command, args, pos,
        );
        if (outcome === "yield") return finish();
      } catch (caught) {
        if (top.menuContinuation !== undefined) {
          handleMenuProviderFailure(
            thread, vm, services, top.menuContinuation as { readonly [key: string]: PlainData }, caught,
          );
        } else {
          if (!(caught instanceof ScriptError) || failureClass(caught.code) === null || call === undefined) throw caught;
          handleFailure(thread, vm, services, program, top, call, callIp, depth, caught);
        }
      }
      continue;
    }
    const queued = thread.queue[0];
    if (queued !== undefined && thread.detached.length === 0) {
      thread.queue.shift();
      thread.frames.push({
        program: withRedirects(
          { kind: "inline", text: queued.text, ir: IR_VERSION },
          vm.redirects,
        ),
        ip: 0,
        locals: {},
        operands: [],
        errorHandler: null,
        autoLocal: false,
      });
      thread.detached.push(thread.frames.length - 1);
      continue;
    }
    const frameIndex = thread.frames.length - 1;
    const frame = thread.frames[frameIndex];
    if (frame === undefined) {
      thread.status = "finished";
      return finish();
    }
    const program = services.programs.get(frame.program);
    const op = program.ops[frame.ip];
    if (op === undefined) {
      if (frame.programRoot !== undefined) {
        if (finishProgramRoot(thread, frameIndex)) return finish();
        continue;
      }
      thread.status = "finished";
      return finish();
    }
    steps += 1;
    incrementStepCounter(vm, frame.program.owner);
    if (services.postStep !== undefined) observe(services.postStep, op, thread.id);
    const opIp = frame.ip;
    const depth = frame.operands.length;

    try {


    switch (op.op) {
      case "push":
        frame.operands.push({ value: op.value, ref: null });
        frame.ip += 1;
        break;

      case "name":
        frame.operands.push({ value: op.name, ref: null });
        frame.ip += 1;
        break;

      case "load": {
        const objectHandle =
          op.scope === undefined && isImplicitField(vm, program, frame, op.name, op.param === true)
            ? frame.objectHandle
            : undefined;
        if (objectHandle !== undefined) {
          const ref = objectRef(objectHandle, op.name);
          frame.operands.push({ value: readRef(vm, thread, frameIndex, ref, services), ref });
        } else if (op.name === "this" && frame.objectHandle !== undefined && frame.objectClass !== undefined) {
          // The object's own class, not the class of the running method (OOP-10, two class identities).
          frame.operands.push({
            value: {
              kind: "object",
              handle: frame.objectHandle,
              className: findObject(vm, frame.objectHandle)?.className ?? frame.objectClass,
            },
            ref: null,
          });
        } else if (op.name === "this") {
          frame.operands.push({ value: null, ref: null });
        } else {
          frame.operands.push(loadArg(vm, thread, frameIndex, op.name, op.scope, services));
        }
        frame.ip += 1;
        break;
      }

      case "member":
      case "get_member_bound": {
        const receiver = frame.operands.pop();
        const record = liveObject(vm, receiver?.value, op.pos, "member access requires a live object");
        const hostMethod = isHostMethod(program, record, op.name, services);
        if (op.op === "get_member_bound" && hostMethod) {
          const def = isEmitterMethod(op.name) ? op.name : hostMethodDef(record.hostType!, op.name);
          frame.operands.push({
            value: { type: "callable", def, captures: [], receiver: String(record.handle) },
            ref: objectRef(record.handle, op.name),
          });
          frame.ip += 1;
          break;
        }
        checkMemberAccess(program, record, op.name, frame.objectClass, op.pos);
        const value = readObjectValue(services, record, op.name);
        frame.operands.push({ value: bindMemberValue(value, record.handle), ref: objectRef(record.handle, op.name) });
        frame.ip += 1;
        break;
      }

      case "newObject": {
        const record = createObject(vm, null);
        frame.operands.push({
          value: { kind: "object", handle: record.handle, className: DICTIONARY_CLASS },
          ref: null,
        });
        frame.ip += 1;
        break;
      }

      case "initMember": {
        const valueArg = frame.operands.pop();
        const objectArg = frame.operands[frame.operands.length - 1];
        const target = isObjectValue(objectArg?.value) ? findObject(vm, objectArg.value.handle) : undefined;
        if (valueArg === undefined || target === undefined) {
          throw new ScriptError("vm.stack-underflow", "initMember: no dictionary below the value", op.pos);
        }
        writeMember(target, op.key, valueArg.value === null ? 0 : valueArg.value);
        frame.ip += 1;
        break;
      }

      case "declRef":
        if (op.scope === "local") {
          if (!Object.hasOwn(frame.locals, op.name)) {
            setOwnSlot(frame.locals, op.name, { value: 0, ref: localRef(op.name) });
          }
          const slot = frame.locals[op.name]!;
          // A slot redirected to a cell (a captured local, FUN-8) or aliasing another variable holds a stale copy: read through it.
          const current = slot.ref === localRef(op.name) ? slot.value ?? 0 : readRef(vm, thread, frameIndex, slot.ref, services);
          frame.operands.push({ value: current, ref: slot.ref });
        } else {
          if (!Object.hasOwn(vm.globals, op.name)) {
            setOwnValue(vm.globals, op.name, 0);
          }
          frame.operands.push({ value: vm.globals[op.name] ?? 0, ref: globalRef(op.name) });
        }
        frame.ip += 1;
        break;

      case "storeRef": {
        const valueArg = frame.operands.pop();
        const refArg = frame.operands.pop();
        if (!valueArg || !refArg) {
          throw new ScriptError("vm.stack-underflow", "storeRef: operand stack underflow", op.pos);
        }
        if (refArg.ref === null) {
          throw new ScriptError("vm.bad-lvalue", "cannot assign to a non-reference value", op.pos);
        }
        const stored = valueArg.value === null ? 0 : valueArg.value;
        const refValue = refArg.value;
        if (isObjectValue(refValue)) {
          const record = vm.objects.find((item) => item.handle === refValue.handle);
          const method = record === undefined ? undefined : findMethod(program, record.className, "operator=", 1);
          if (record !== undefined && method !== undefined && method.entry >= 0) {
            frame.ip += 1;
            thread.frames.push({
              program: frame.program, ip: method.entry, locals: bindMethodLocals(method, [valueArg]), operands: [],
              errorHandler: null, autoLocal: frame.autoLocal, objectHandle: record.handle,
              objectClass: method.className ?? record.className,
            });
            break;
          }
        }
        writeRef(vm, thread, frameIndex, refArg.ref, stored, services);
        frame.operands.push({ value: stored, ref: null });
        frame.ip += 1;
        break;
      }

      case "compound": {
        const valueArg = frame.operands.pop();
        const refArg = frame.operands.pop();
        if (!valueArg || !refArg || refArg.ref === null) {
          throw new ScriptError("vm.stack-underflow", "compound assignment stack underflow", op.pos);
        }
        const current = readRef(vm, thread, frameIndex, refArg.ref, services);
        if (isObjectValue(current)) {
          const record = vm.objects.find((item) => item.handle === current.handle);
          const method = record === undefined ? undefined : findMethod(program, record.className, `operator${op.operator}`, 1);
          if (record !== undefined && method !== undefined && method.entry >= 0) {
            frame.ip += 1;
            thread.frames.push({
              program: frame.program, ip: method.entry, locals: bindMethodLocals(method, [valueArg]), operands: [],
              errorHandler: null, autoLocal: frame.autoLocal, objectHandle: record.handle,
              objectClass: method.className ?? record.className,
            });
            break;
          }
          throw new ScriptError("object.invalid", `${op.operator} not found`, op.pos);
        }
        const rhs = valueArg.value;
        const result = op.operator === "+=" ? Number(current) + Number(rhs)
          : op.operator === "-=" ? Number(current) - Number(rhs)
          : op.operator === "*=" ? Number(current) * Number(rhs)
          : op.operator === "/=" ? Number(current) / Number(rhs)
          : op.operator === "%=" ? Number(current) % Number(rhs)
          : Number(rhs);
        writeRef(vm, thread, frameIndex, refArg.ref, result, services);
        frame.operands.push({ value: result, ref: null });
        frame.ip += 1;
        break;
      }

      case "index": {
        const keyArg = frame.operands.pop();
        const baseArg = frame.operands.pop();
        if (!keyArg || !baseArg) {
          throw new ScriptError("vm.stack-underflow", "index: operand stack underflow", op.pos);
        }
        const keyValue =
          keyArg.ref !== null && typeof keyArg.value === "number"
            ? (keyArg.value | 0)
            : keyArg.value;
        const keyText = indexKey(keyValue);
        const dictionary = dictionaryOfBase(vm, thread, frameIndex, baseArg, services.virtuals);
        if (dictionary !== undefined) {
          // `d["key"]` is the same read and the same write as `d.key` (OOP-10).
          if (typeof keyArg.value !== "string" && typeof keyArg.value !== "number") {
            throw new ScriptError("object.invalid", "a dictionary key must be a string or a number", op.pos);
          }
          const key = indexKey(keyArg.value);
          frame.operands.push({ value: bindMemberValue(readObjectValue(services, dictionary, key), dictionary.handle), ref: objectRef(dictionary.handle, key) });
          frame.ip += 1;
          break;
        }
        const namedValue = baseArg.ref === null && typeof baseArg.value === "string" ? peekVariable(vm, thread, frameIndex, baseArg.value, services.virtuals, services) : baseArg.value;
        if (isObjectValue(namedValue)) {
          const record = findObject(vm, namedValue.handle);
          if (record !== undefined && findMethod(program, record.className, "operator[]", 1) === undefined) {
            const ref = objectRef(record.handle, `[${keyText}]`);
            frame.operands.push({ value: readObjectValue(services, record, `[${keyText}]`), ref });
            frame.ip += 1;
            break;
          }
        }
        if (baseArg.ref !== null) {
          const object = parseObjectRef(baseArg.ref);
          if (object !== null) {
            const ref = objectRef(object.handle, `${object.name}[${keyText}]`);
            frame.operands.push({ value: readRef(vm, thread, frameIndex, ref, services), ref });
            frame.ip += 1;
            break;
          }
        }
        const baseObject = isObjectValue(baseArg.value) ? baseArg.value : null;
        if (baseObject !== null) {
          const record = vm.objects.find((item) => item.handle === baseObject.handle);
          if (record === undefined) throw new ScriptError("object.invalid", `unknown object handle ${baseObject.handle}`, op.pos);
          const method = findMethod(program, record.className, "operator[]", 1);
          if (method !== undefined && method.entry >= 0) {
            frame.ip += 1;
            thread.frames.push({
              program: frame.program, ip: method.entry, locals: bindMethodLocals(method, [keyArg]), operands: [],
              errorHandler: null, autoLocal: frame.autoLocal, objectHandle: record.handle,
              objectClass: method.className ?? record.className,
            });
            break;
          }
          const ref = objectRef(baseObject.handle, `[${keyText}]`);
          frame.operands.push({ value: readObjectValue(services, record, `[${keyText}]`), ref });
          frame.ip += 1;
          break;
        }
        const baseName = baseArg.ref !== null ? refName(baseArg.ref) : toStringValue(baseArg.value);
        if (frame.objectHandle !== undefined && isImplicitField(vm, program, frame, baseName, op.baseParam === true)) {
          const memberRef = objectRef(frame.objectHandle, `${baseName}[${keyText}]`);
          frame.operands.push({ value: readRef(vm, thread, frameIndex, memberRef, services), ref: memberRef });
          frame.ip += 1;
          break;
        }
        const namedObject = typeof baseArg.value === "string" ? vm.globals[baseArg.value] : undefined;
        if (isObjectValue(namedObject)) {
          const record = vm.objects.find((item) => item.handle === namedObject.handle);
          const method = record === undefined ? undefined : findMethod(program, record.className, "operator[]", 1);
          if (record !== undefined && method !== undefined && method.entry >= 0) {
            frame.ip += 1;
            thread.frames.push({
              program: frame.program, ip: method.entry, locals: bindMethodLocals(method, [keyArg]), operands: [],
              errorHandler: null, autoLocal: frame.autoLocal, objectHandle: record.handle,
              objectClass: method.className ?? record.className,
            });
            break;
          }
          if (record !== undefined) {
            const ref = objectRef(record.handle, `[${keyText}]`);
            frame.operands.push({ value: readObjectValue(services, record, `[${keyText}]`), ref });
            frame.ip += 1;
            break;
          }
        }
        let scope: VarScope | null = null;
        if (baseArg.ref !== null) scope = baseArg.ref.startsWith("global:") ? "global" : "local";
        const fullName = `${baseName}[${keyText}]`;
        const elementArg = loadArg(vm, thread, frameIndex, fullName, scope ?? undefined, services);
        frame.operands.push(elementArg);
        frame.ip += 1;
        break;

      }
      case "construct": {
        const args = takeArgs(frame, op.argc, op.pos);
        const info = classInfo(program, op.className);
        if (info === undefined) throw new ScriptError("object.invalid", `unknown class ${op.className}`, op.pos);
        if (info.abstract) throw new ScriptError("object.abstract-class", `class ${op.className} is abstract`, op.pos);
        const record = instantiate(vm, program, frame.program, op.className);
        const value: ObjectValue = { kind: "object", handle: record.handle, className: op.className };
        const constructor = findMethod(program, op.className, op.className, op.argc);
        frame.ip += 1;
        if (constructor !== undefined && constructor.entry >= 0) {
          thread.frames.push({
            program: frame.program, ip: constructor.entry, locals: bindMethodLocals(constructor, args), operands: [],
            errorHandler: null, autoLocal: frame.autoLocal, objectHandle: record.handle,
            objectClass: op.className, returnValue: value,
          });
        } else frame.operands.push({ value, ref: null });
        break;
      }

      case "methodCall": {
        const args = takeArgs(frame, op.argc, op.pos);
        const receiver = frame.operands.pop();
        const record = liveObject(vm, receiver?.value, op.pos, "method receiver is not an object");
        if (invokeMember(thread, vm, services, program, frame, frameIndex, record, op.name, args, op.pos) === "yield") {
          return finish();
        }
        break;
      }
      case "dup": {
        const top = frame.operands[frame.operands.length - 1];
        if (!top) {
          throw new ScriptError("vm.stack-underflow", "dup: operand stack underflow", op.pos);
        }
        frame.operands.push({ value: top.value, ref: top.ref });
        frame.ip += 1;
        break;
      }

      case "pop":
        frame.operands.pop();
        frame.ip += 1;
        break;

      case "unop": {
        const operand = frame.operands.pop();
        if (!operand) {
          throw new ScriptError("vm.stack-underflow", "unop: operand stack underflow", op.pos);
        }
        if (isObjectValue(operand.value)) {
          // The object's own class answers, wherever the value came from (OOP-7, OOP-10).
          const className = findObject(vm, operand.value.handle)?.className ?? DICTIONARY_CLASS;
          const method = findMethod(program, className, `operator${op.operator}`, 0);
          if (method === undefined) throw new ScriptError("object.invalid", `operator${op.operator} not found`, op.pos);
          frame.ip += 1;
          thread.frames.push({
            program: frame.program, ip: method.entry, locals: bindMethodLocals(method, []), operands: [],
            errorHandler: null, autoLocal: frame.autoLocal, objectHandle: operand.value.handle,
            objectClass: method.className ?? className,
          });
          break;
        }
        const v =
          operand.ref !== null && typeof operand.value === "number"
            ? (operand.value | 0)
            : operand.value;
        let resultValue: Value;
        switch (op.operator) {
          case "-":
            resultValue = -toNumberValue(v);
            break;
          case "+":
            resultValue = toNumberValue(v);
            break;
          case "!":
            resultValue = truthy(operand.value) ? 0 : 1;
            break;
          case "~":
            resultValue = ~toInt32(v);
            break;
          default:
            throw new ScriptError("vm.bad-operand", `unsupported unary operator: ${op.operator}`, op.pos);
        }
        frame.operands.push({ value: resultValue, ref: null });
        frame.ip += 1;
        break;
      }

      case "binop": {
        const rightArg = frame.operands.pop();
        const leftArg = frame.operands.pop();
        if (!leftArg || !rightArg) {
          throw new ScriptError("vm.stack-underflow", "binop: operand stack underflow", op.pos);
        }
        if (isObjectValue(leftArg.value)) {
          const className = findObject(vm, leftArg.value.handle)?.className ?? DICTIONARY_CLASS;
          const method = findMethod(program, className, `operator${op.operator}`, 1);
          if (method !== undefined) {
            frame.ip += 1;
            thread.frames.push({
              program: frame.program, ip: method.entry, locals: bindMethodLocals(method, [rightArg]), operands: [],
              errorHandler: null, autoLocal: frame.autoLocal, objectHandle: leftArg.value.handle,
              objectClass: method.className ?? className,
            });
            break;
          }
          if (op.operator === "==" || op.operator === "~=" || op.operator === "!=") {
            const same = leftArg.value.handle === (isObjectValue(rightArg.value) ? rightArg.value.handle : -1);
            frame.operands.push({ value: op.operator === "==" ? (same ? 1 : 0) : (same ? 0 : 1), ref: null });
            frame.ip += 1;
            break;
          }
          throw new ScriptError("object.invalid", `operator${op.operator} not found`, op.pos);
        }
        const lVal =
          leftArg.ref !== null && typeof leftArg.value === "number"
            ? (leftArg.value | 0)
            : leftArg.value;
        const rVal =
          rightArg.ref !== null && typeof rightArg.value === "number"
            ? (rightArg.value | 0)
            : rightArg.value;
        let resultValue: Value;

        switch (op.operator) {
          case "+":
            if (typeof leftArg.value === "string" || typeof rightArg.value === "string") {
              resultValue = toStringValue(leftArg.value) + toStringValue(rightArg.value);
            } else {
              resultValue = toNumberValue(lVal) + toNumberValue(rVal);
            }
            break;
          case "-":
            resultValue = toNumberValue(lVal) - toNumberValue(rVal);
            break;
          case "*":
            resultValue = toNumberValue(lVal) * toNumberValue(rVal);
            break;
          case "/":
            resultValue = toNumberValue(lVal) / toNumberValue(rVal);
            break;
          case "%": {
            const divisor = toInt32(rVal);
            if (divisor === 0) {
              throw new ScriptError("vm.modulo-by-zero", "modulo by zero", op.pos);
            }
            const rem = toInt32(lVal) % divisor;
            resultValue = Object.is(rem, -0) ? 0 : rem;
            break;
          }
          case "^":
            resultValue = pow(toNumberValue(lVal), toNumberValue(rVal));
            break;
          case "<<":
            resultValue = toInt32(lVal) << (toInt32(rVal) & 31);
            break;
          case ">>":
            resultValue = toInt32(lVal) >> (toInt32(rVal) & 31);
            break;
          case "<":
          case "<=":
          case ">":
          case ">=":
            resultValue = compareRelational(op.operator, lVal, rVal);
            break;
          case "==":
            resultValue = compareEqual(leftArg.value, rightArg.value);
            break;
          case "~=":
          case "!=":
            resultValue = compareEqual(leftArg.value, rightArg.value) === 1 ? 0 : 1;
            break;
          case "&":
            resultValue = toInt32(lVal) & toInt32(rVal);
            break;
          case "`":
            resultValue = toInt32(lVal) ^ toInt32(rVal);
            break;
          case "|":
            resultValue = toInt32(lVal) | toInt32(rVal);
            break;
          case "&&":
            resultValue = truthy(leftArg.value) && truthy(rightArg.value) ? 1 : 0;
            break;
          case "||":
            resultValue = truthy(leftArg.value) || truthy(rightArg.value) ? 1 : 0;
            break;
        }

        frame.operands.push({ value: resultValue, ref: null });
        frame.ip += 1;
        break;
      }

      case "select": {
        const elseArg = frame.operands.pop();
        const thenArg = frame.operands.pop();
        const condArg = frame.operands.pop();
        if (!condArg || !thenArg || !elseArg) {
          throw new ScriptError("vm.stack-underflow", "select: operand stack underflow", op.pos);
        }
        const chosen = truthy(condArg.value) ? thenArg : elseArg;
        frame.operands.push({ value: chosen.value, ref: chosen.ref });
        frame.ip += 1;
        break;
      }

      case "jump":
        frame.ip = op.target;
        break;

      case "jumpIfFalse": {
        const cond = frame.operands.pop();
        if (!cond) {
          throw new ScriptError("vm.stack-underflow", "jumpIfFalse: operand stack underflow", op.pos);
        }
        if (!truthy(cond.value)) {
          frame.ip = op.target;
        } else {
          frame.ip += 1;
        }
        break;
      }

      case "load_fn": {
        // Capture resolution (FUN-8; ADR 0004 decision 8; entries 18.4 and 18.5).
        // The definition's captured names were worked out at lowering, and the
        // handle records one cell per name in that order ("" for a name that is not
        // a local of this frame, which every call reads and writes live as a global).
        // A captured local's cell is that local's storage: the first closure to
        // capture the name moves the value into a fresh cell and redirects the
        // frame's slot to it, so the frame and every closure read and write one
        // slot, and a later closure from this frame takes the same cell. A fresh
        // cell per frame keeps two runs of the same code apart. A slot that is
        // already a cell (an enclosing lambda's capture, or a by-reference
        // parameter that aliases a captured variable) is shared as it stands; a
        // slot that aliases some other variable (a by-reference parameter) cannot
        // become a cell, so the closure takes a by-value copy in a cell of its own.
        const names = program.functions[op.def]?.[0]?.captures ?? [];
        const captures: string[] = [];
        for (const name of names) {
          if (!Object.hasOwn(frame.locals, name)) {
            captures.push("");
            continue;
          }
          const slot = frame.locals[name]!;
          if (slot.ref.startsWith("cell:")) {
            captures.push(slot.ref.slice(5));
            continue;
          }
          vm.cellSeq = (vm.cellSeq ?? 0) + 1;
          const id = `cell${vm.cellSeq}`;
          setOwnValue((vm.cells ??= {}), id, readRef(vm, thread, frameIndex, slot.ref, services));
          captures.push(id);
          if (slot.ref === localRef(name)) slot.ref = cellRef(id);
        }
        recordOwner(vm, op.def, frame.program);
        frame.operands.push({
          value: {
            type: "callable",
            def: op.def,
            captures,
            receiver: null,
            ...(frame.program.owner === undefined ? {} : { owner: frame.program.owner }),
          },
          ref: null,
        });
        frame.ip += 1;
        break;
      }

      case "call_indirect": {
        // The callee is below its arguments on the stack (18.3): pop the
        // arguments, then the callable itself.
        const args = takeArgs(frame, op.argc, op.pos);
        const callee = frame.operands.pop();
        if (callee === undefined) {
          throw new ScriptError(
            "vm.stack-underflow",
            "call_indirect: the operand stack is missing the callable",
            op.pos,
          );
        }
        if (!isCallableValue(callee.value)) {
          throw new ScriptError(
            CALLABLE_NOT_CALLABLE,
            "call_indirect: the value below the arguments is not a callable",
            op.pos,
          );
        }
        if (performCallable(thread, vm, services, program, frame, frameIndex, callee.value, args, op.pos) === "yield") {
          return finish();
        }
        break;
      }

      case "call": {
        const args = takeArgs(frame, op.argc, op.pos);
        services.setCommandPos(op.pos);
        if (op.file === undefined && Object.hasOwn(MODULE_COMMANDS, op.name)) {
          runModuleCommand(
            op.name, args, vm, services.loader, services.programs, program, op.pos,
            (from, to) => followPackageInclude(services.layers, from, to),
          );
          frame.ip += 1;
          frame.operands.push({ value: 0, ref: null });
          break;
        }
        if (op.file === undefined && op.name === BINDING_OF) {
          frame.operands.push({ value: bindingOfCall(vm, thread, frameIndex, services, program, args, op.pos), ref: null });
          frame.ip += 1;
          break;
        }
        if (op.file !== undefined) {
          const receiverValue = peekName(vm, thread, frameIndex, program, op.file, op.fileParam === true, services.virtuals, services);
          const record = isObjectValue(receiverValue) ? findObject(vm, receiverValue.handle) : undefined;
          if (record !== undefined) {
            if (invokeMember(thread, vm, services, program, frame, frameIndex, record, op.name, args, op.pos) === "yield") {
              return finish();
            }
            break;
          }
        }
        // A package namespace (PKG-4; entry 19.7) is chosen after a live object and before the
        // file. A parameter qualifier is a local, so it is never a namespace.
        const inPackage =
          op.file !== undefined && op.fileParam !== true
            ? resolveNamespaced(op.file, op.name, op.argc, services.commands)
            : undefined;
        if (inPackage !== undefined) warnNamespaceHidesFile(services, program, op.file!);
        // The environment table (FUN-8; entry 18.5): the running scope's own
        // callable under this name first, then a built-in, a script function and a
        // plugin command. A `file.`-qualified call never asks the scope.
        const held =
          op.file === undefined
            ? (heldCallable(vm, thread, frameIndex, op.name, services) ?? topLayerHandle(services.layers, op.name))
            : undefined;
        const resolved = inPackage ?? resolveCall(op.name, op.argc, program, services.commands, op.file, held);
        if (resolved === undefined) {
          const ownClass = frameObjectClass(vm, frame);
          if (frame.objectHandle !== undefined && ownClass !== undefined) {
            const ownMethod = findMethod(program, ownClass, op.name, op.argc);
            if (ownMethod !== undefined && ownMethod.entry >= 0) {
              frame.ip += 1;
              thread.frames.push({
                program: frame.program, ip: ownMethod.entry, locals: bindMethodLocals(ownMethod, args), operands: [],
                errorHandler: null, autoLocal: frame.autoLocal, objectHandle: frame.objectHandle,
                objectClass: ownMethod.className ?? ownClass,
              });
              break;
            }
          }
          throw new ScriptError("unknown.command", `no built-in or function named "${op.name}"`, op.pos);
        }
        postResolution(services, thread.id, op.name, op.argc, resolved, op.pos, "source", inPackage === undefined ? undefined : op.file);
        const outcome =
          resolved.kind === "callable"
            ? performCallable(thread, vm, services, program, frame, frameIndex, resolved.value, args, op.pos)
            : dispatchResolved(thread, vm, services, program, frame, frameIndex, op.name, resolved, args, op.pos, true, true);
        if (outcome === "yield") return finish();
        break;
      }
      case "return": {
        if (frame.programRoot !== undefined) {
          if (finishProgramRoot(thread, frameIndex)) return finish();
          break;
        }
        const returnArg =
          frame.returnValue !== undefined
            ? { value: frame.returnValue, ref: null }
            : frame.operands.pop() ?? { value: 0, ref: null };
        const releaseHandle = frame.releaseHandle;
        const menuScreen = frame.menuScreen;
        const menuContinuation = frame.menuContinuation;
        const poppedIndex = thread.frames.length - 1;
        thread.frames.pop();
        if (menuScreen !== undefined) {
          services.menuOwners.menu.apply({ type: "navigation", screens: services.menuOwners.menu.read().screens.slice(0, -1) });
        }
        if (menuContinuation !== undefined && menuContinuation !== null && typeof menuContinuation === "object" && !Array.isArray(menuContinuation)) {
          const saved = menuContinuation as Record<string, unknown>;
          const parents = Array.isArray(saved.parents) ? saved.parents as Array<Record<string, unknown>> : [];
          if (parents.length > 0) {
            const parent = parents[parents.length - 1]!;
            if (typeof parent.providerId !== "string" || typeof parent.screen !== "string" || !services.menuProviders.has(parent.providerId)) {
              throw new ScriptError("menu.provider-missing", "native parent menu provider is unavailable after RPGCode child close");
            }
            thread.wait = {
              kind: "menu.screen",
              global: true,
              id: parent.providerId,
              payload: [{
                ...saved,
                providerId: parent.providerId,
                screen: parent.screen,
                state: parent.state as PlainData,
                phase: "child.closed",
                childScreen: menuScreen,
                parkSeq: null,
                parents: parents.slice(0, -1),
              } as unknown as PlainData],
              resumeRefs: [],
            };
            thread.status = "waiting";
            break;
          }
        }
        if (releaseHandle !== undefined) {
          releaseObject(vm, services, releaseHandle);
        }
        if (thread.frames.length === 0) {
          thread.status = "finished";
          return finish();
        }
        if (thread.detached[thread.detached.length - 1] === poppedIndex) {
          // A `tellThread` frame ends: nothing in the target was waiting for its value.
          thread.detached.pop();
          break;
        }
        const callerFrame = thread.frames[thread.frames.length - 1]!;
        callerFrame.operands.push(returnArg);
        break;
      }
    }
    } catch (caught) {
      if (frame.menuContinuation !== undefined) {
        handleMenuProviderFailure(
          thread,
          vm,
          services,
          frame.menuContinuation as { readonly [key: string]: PlainData },
          caught,
        );
      } else {
        // Load-time errors are not catchable; only a runtime failure of this one op is routed here.
        if (!(caught instanceof ScriptError) || failureClass(caught.code) === null) throw caught;
        handleFailure(thread, vm, services, program, frame, op, opIp, depth, caught);
      }
    }
  }
  return finish();
}
