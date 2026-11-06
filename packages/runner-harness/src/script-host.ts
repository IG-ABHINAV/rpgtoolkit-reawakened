/**
 * The VM-backed test host: the tracer's `Engine` over a real script VM
 * (AD-1; decisions Q5/Q6/Q9).
 *
 * This is deliberately **not** `createEngine`: it holds no phase list, no game
 * logic and no world. `advance` runs one whole `advanceScriptTick` per
 * requested tick (clamped by `maxTicks` exactly as the test double is) and
 * reports the state hash; `drawList` is `{ tick, 320×240, commands: [] }`,
 * `surfacePixels`, `picturePixels` and `recoveryCandidate()` are `null`: this script-only host
 * has no world state to capture as a canonical game save. The report's
 * `consumed`/`requests`/`audioCues` are empty; `loading` is false and `paused`
 * is null. `diagnostics` carries the located runtime failures the VM collected
 * during the batch (AD-24), so the golden `runLog` driver accepts it. It stays
 * beside `createEngine` as the script-only host for VM, corpus and restore
 * tests that need no world or renderer; the full-engine golden path uses
 * `createEngine`.
 */

import {
  advanceScriptTick,
  applyPluginManifestPatch,
  parsePluginManifest,
  ENGINE_PLUGIN_TABLE,
  createLogger,
  createScriptServices,
  createGameState,
  drainDiagnostics,
  ENGINE_DEFAULT_MANIFEST,
  fnv1a64,
  hashGameState,
  replyToRequest,
  restoreGameState,
  snapshot,
  IR_VERSION,
  createPluginLayers,
  runPackageStartup,
  startProgram,
  STEP_BUDGET,
  verifyRestoredHandles,
  uiAccessibilityTree,
  type Breakpoint,
  applyInputEvent,
  registerGameAction as registerInputGameAction,
  registeredActionNames as readRegisteredActionNames,
  type Diagnostic,
  type DrawList,
  type Engine,
  type GameState,
  type InputRecord,
  type PluginDefinition,
  type PluginManifestPatch,
  type PluginManifestDiagnostic,
  type PluginManifest,
  type LogSink,
  type ProgramLoader,
  type ProgramRef,
  type ResolvedPlugin,
  type RunnerRequest,
  type ScriptServices,
  type SurfaceId,
  type SurfacePixels,
  type TickReport,
  withOwner,
} from "@tk-reawakened/core";
import { TK2_COMPAT_PLUGIN } from "@tk-reawakened/plugin-tk2-compat";
import type { AssetKey } from "@tk-reawakened/core";
import { resolvePluginManifest } from "./script-plugin-resolver.ts";
type RegisteredAction = Parameters<Engine["registerGameAction"]>[0];
type HostResolution = {
  readonly plugins: readonly ResolvedPlugin[];
  readonly diagnostics: readonly Diagnostic[];
};
export type ScriptHostBlobs = {
  readonly blobs?: Record<string, Uint8Array>;
  readonly assets?: Readonly<Record<string, Uint8Array>>;
};

type RequestEffect = {
  readonly request?: {
    readonly kind?: unknown;
    readonly reqId?: unknown;
    readonly blob?: { readonly area?: unknown; readonly path?: unknown };
    readonly key?: unknown;
    readonly hex?: unknown;
  };
};

function hexBytes(value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length % 2 !== 0 || !/^[0-9a-f]*$/.test(value)) return new Uint8Array(0);
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function bytesHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

function blobKey(area: unknown, path: unknown): string {
  return `${String(area ?? "")}:${String(path ?? "")}`;
}

function toRuntimeDiagnostics(
  diagnostics: readonly PluginManifestDiagnostic[],
): readonly Diagnostic[] {
  return diagnostics.map((item) => ({
    code: item.code,
    file: item.path,
    line: item.index + 1,
    message: item.message,
  }));
}

function resolveHostPlugins(
  manifest: PluginManifest | undefined,
  patch: PluginManifestPatch | undefined,
  definitions: readonly PluginDefinition[] | undefined,
): HostResolution {
  // A null-prototype table keeps inherited `Object.prototype` members out of id lookup (#537).
  const table: Record<string, PluginDefinition> = Object.assign(Object.create(null) as Record<string, PluginDefinition>, ENGINE_PLUGIN_TABLE, { tk2: TK2_COMPAT_PLUGIN });
  if (definitions !== undefined) {
    for (const definition of definitions) {
      if (definition.id !== "core") table[definition.id] = definition;
    }
  }
  const parsed = parsePluginManifest(manifest ?? ENGINE_DEFAULT_MANIFEST);
  if (parsed.manifest === null) {
    return { plugins: [], diagnostics: toRuntimeDiagnostics(parsed.diagnostics) };
  }
  const operations = patch === undefined ? [] : [...patch];
  if (manifest === undefined && definitions !== undefined) {
    for (const definition of definitions) {
      operations.push({ op: "append", entry: { id: definition.id } });
    }
  }
  const patched = applyPluginManifestPatch(parsed.manifest, operations);
  const resolved = resolvePluginManifest(patched.manifest, table);
  return {
    plugins: resolved.plugins,
    diagnostics: toRuntimeDiagnostics([...patched.diagnostics, ...resolved.diagnostics]),
  };
}
/** A package start-up reference with its required canonical catalogue owner. */
export type PackageStartupRef = {
  readonly owner: string;
  readonly ref: ProgramRef;
};
/** How to build a fresh host: the inline program, seed, manifest and plugin layers. */
export type ScriptHostInit = {
  readonly scriptObservers?: import("@tk-reawakened/core").ScriptObservers;
  readonly program: string | ProgramRef;
  readonly seed: number;
  /** Selects the pure TK2 frontend; default is the TK3 frontend. */
  readonly dialect?: "tk2" | "tk3";
  /** Optional game manifest; omitted means the engine default manifest. */
  readonly manifest?: PluginManifest;
  readonly patch?: PluginManifestPatch;
  readonly gameId?: string;
  readonly blobs?: ScriptHostBlobs;
  readonly loader?: ProgramLoader;
  /** Host-side definitions available to the manifest resolver. */
  readonly plugins?: readonly PluginDefinition[];
  /** Where the VM's Logger records go, in order; none means they are dropped. */
  readonly sinks?: readonly LogSink[];
  /** Optional package start-up programs with explicit catalogue ownership (PKG-5; entry 19.8). */
  readonly packageStartups?: readonly PackageStartupRef[];
};

/** How to rebuild a host from a snapshot: the registry is code, not state. */
export type ScriptHostRestore = {
  readonly scriptObservers?: import("@tk-reawakened/core").ScriptObservers;
  readonly manifest?: PluginManifest;
  readonly dialect?: "tk2" | "tk3";
  readonly gameId?: string;
  readonly blobs?: ScriptHostBlobs;
  readonly patch?: PluginManifestPatch;
  readonly loader?: ProgramLoader;
  readonly plugins?: readonly PluginDefinition[];
  /** Where the VM's Logger records go, in order; none means they are dropped. */
  readonly sinks?: readonly LogSink[];
  /**
   * Optional package start-up programs run on a scratch state to rebuild the
   * package layer table. The restored host then reruns package registration
   * against its actual services before it resumes.
   */
  readonly packageStartups?: readonly PackageStartupRef[];
  /** Seed for the scratch state during start-up rebuild (defaults to 0). */
  readonly startupSeed?: number;
};

/** The tracer's test host: the engine API plus state access for tests. */
export type ScriptHost = Engine & {
  snapshot(): string;
  stateHash(): string;
  state(): GameState;
};

function serviceBlobRequests(
  gameState: GameState,
  blobs: ScriptHostBlobs,
  effectIndex: number,
  requests: RunnerRequest[],
): number {
  const effects = gameState.vm.effects as readonly RequestEffect[];
  let next = effectIndex;
  while (next < effects.length) {
    const request = effects[next]?.request;
    next += 1;
    if (request === undefined || request === null || typeof request.reqId !== "number" || typeof request.kind !== "string") continue;
    const reqId = request.reqId;
    if (request.kind === "loadBlob") {
      const blob = { area: String(request.blob?.area ?? "files") as "saves" | "files", path: String(request.blob?.path ?? "") };
      const value = blobs.blobs?.[blobKey(blob.area, blob.path)];
      requests.push({ kind: "loadBlob", reqId, blob });
      replyToRequest(gameState.vm, reqId, { ok: value !== undefined, value: value === undefined ? null : bytesHex(new Uint8Array(value)) });
      continue;
    }
    if (request.kind === "saveBlob") {
      const blob = { area: String(request.blob?.area ?? "files") as "saves" | "files", path: String(request.blob?.path ?? "") };
      const value = hexBytes(request.hex);
      if (blobs.blobs !== undefined) blobs.blobs[blobKey(blob.area, blob.path)] = new Uint8Array(value);
      requests.push({ kind: "saveBlob", reqId, blob, bytes: new Uint8Array(value) });
      replyToRequest(gameState.vm, reqId, { ok: true, value: 1 });
      continue;
    }
    if (request.kind === "asset") {
      const key = String(request.key ?? "");
      const value = blobs.assets?.[key];
      requests.push({ kind: "asset", reqId, key: key as AssetKey });
      replyToRequest(gameState.vm, reqId, { ok: value !== undefined, value: value === undefined ? null : bytesHex(new Uint8Array(value)) });
    }
  }
  return next;
}

function createHost(
  gameState: GameState,
  services: ScriptServices,
  initialDiagnostics: readonly Diagnostic[] = [],
  blobs: ScriptHostBlobs = {},
): ScriptHost {
  let breakpoints: readonly Breakpoint[] = [];
  let pendingDiagnostics = [...initialDiagnostics];
  let effectIndex = gameState.vm.effects.length;
  const requests: RunnerRequest[] = [];
  const reportedUnknownActions = new Set<string>();
  const reportUnknownAction = (action: string): void => {
    if (readRegisteredActionNames(gameState.input).has(action) || reportedUnknownActions.has(action)) return;
    reportedUnknownActions.add(action);
    pendingDiagnostics.push({ code: "input.unknown-action", file: "", line: 0, message: `input names unregistered action "${action}"` });
  };

  return {
    advance(ticks: number, inputs: readonly InputRecord[] = [], maxTicks?: number): TickReport {
      const actualTicks = maxTicks !== undefined && maxTicks < ticks ? maxTicks : ticks;
      const consumed: InputRecord[] = [];
      let inputIndex = 0;
      for (let index = 0; index < actualTicks; index++) {
        while (inputIndex < inputs.length) {
          const record = inputs[inputIndex]!;
          if (record.event.kind === "action") {
            applyInputEvent(gameState.input, record.event, reportUnknownAction);
            consumed.push(record);
            inputIndex++;
            continue;
          }
          if (record.event.kind === "key" && record.event.down) {
            let matched = false;
            for (const thread of gameState.vm.threads) {
              if (thread.wait?.kind === "input.key" && thread.wait.key === null) {
                thread.wait.key = record.event.name;
                consumed.push(record);
                matched = true;
                break;
              }
            }
            if (matched) {
              inputIndex++;
              continue;
            }
          }
          break;
        }
        advanceScriptTick(gameState, services, STEP_BUDGET);
        effectIndex = serviceBlobRequests(gameState, blobs, effectIndex, requests);
      }
      const diagnostics = [...pendingDiagnostics, ...drainDiagnostics(services)];
      pendingDiagnostics = [];
      const emittedRequests = requests.splice(0, requests.length);
      return {
        ticksRun: actualTicks,
        tickAfter: gameState.time.tick,
        consumed,
        audioCues: [],
        requests: emittedRequests,
        diagnostics,
        loading: false,
        paused: null,
        stateHash: hashGameState(gameState),
      };
    },

    registeredActionNames() {
      return [...readRegisteredActionNames(gameState.input)];
    },
    registerGameAction(action: RegisteredAction) {
      return registerInputGameAction(gameState.input, action);
    },
    setPointerMovementSuppressed(suppressed: boolean) {
      gameState.input.pointerMovementSuppressed = suppressed;
    },
    reportUnknownAction,
    customTouchControlsDeclared() {
      return gameState.ui.customTouchControlsDeclared === true;
    },
    hostFeatures() {
      return { ...gameState.features };
    },
    hostDisplayGeometry() {
      const { content, game, safeArea } = gameState.display.geometry;
      return {
        content: { ...content },
        game: { ...game },
        safeArea: { ...safeArea },
      };
    },
    surfaceCacheEpoch() {
      return 0;
    },
    accessibilityTree() {
      return uiAccessibilityTree(gameState.ui);
    },
    runnerControlPointerPreemption(x: number, y: number): number | "author" | null {
      if (gameState.ui.modal != null) return gameState.ui.modal.modalId;
      return (gameState.ui.actionSurfaces ?? []).some((surface) =>
        surface.items.some((item) => item.enabled && x >= item.bounds.x && y >= item.bounds.y &&
          x < item.bounds.x + item.bounds.w && y < item.bounds.y + item.bounds.h)) ? "author" : null;
    },
    drawList(_alpha?: number): DrawList {
      return { tick: gameState.time.tick, width: 320, height: 240, commands: [], marginCommands: [] };
    },

    surfacePixels(_id: SurfaceId, _rev: number): SurfacePixels | null {
      return null;
    },
    picturePixels(): SurfacePixels | null {
      return null;
    },

    recoveryCandidate() {
      return null;
    },
    resumeRecovery() {
      return false;
    },
    recoveryStatus() {
      return "none";
    },

    setBreakpoints(next: readonly Breakpoint[]): void {
      breakpoints = next;
      void breakpoints;
    },

    snapshot(): string {
      return snapshot(gameState);
    },

    stateHash(): string {
      return hashGameState(gameState);
    },

    state(): GameState {
      return gameState;
    },
  };
}

/** Start `program` (inline source) in a manifest-resolved VM. */
function ownedPackageStartups(startups: readonly PackageStartupRef[]): readonly ProgramRef[] {
  return startups.map((startup) => withOwner(startup.ref, startup.owner));
}

export function createScriptHost(init: ScriptHostInit): ScriptHost {
  const gameState = createGameState({ seed: init.seed });
  const manifest =
    init.manifest ??
    (init.dialect === "tk2" ? [...ENGINE_DEFAULT_MANIFEST, { id: "tk2" }] : undefined);
  const resolution = resolveHostPlugins(manifest, init.patch, init.plugins);
  const programRef: ProgramRef = typeof init.program === "string"
    ? {
        kind: "inline",
        text: init.program,
        ir: IR_VERSION,
        dialect: init.dialect ?? "tk3",
      }
    : init.program;
  const gameId =
    init.gameId ??
    (typeof init.program === "string"
      ? fnv1a64(init.program)
      : init.program.kind === "file"
        ? init.program.path
        : fnv1a64(init.program.text));
  const layers = createPluginLayers();
  const packageStartupLifecycle = { active: false, packageName: undefined as string | undefined };
  const listenersBeforeStartup = [...gameState.events.listeners];
  const services = createScriptServices(
    gameState,
    resolution.plugins,
    createLogger(init.sinks ?? []),
    undefined,
    init.loader,
    gameId,
    undefined,
    undefined,
    layers,
    undefined,
    packageStartupLifecycle,
    undefined,
    init.scriptObservers,
  );
  runPackageStartup(
    gameState,
    services,
    ownedPackageStartups(init.packageStartups ?? []),
    resolution.plugins,
    listenersBeforeStartup,
  );
  startProgram(gameState.vm, programRef);
  return createHost(gameState, services, resolution.diagnostics, init.blobs);
}

/** Restore a host from a snapshot, rebinding the same effective manifest. */
export function restoreScriptHost(json: string, init: ScriptHostRestore): ScriptHost {
  const restoreDiagnostics: Diagnostic[] = [];
  const gameState = restoreGameState(json, restoreDiagnostics);
  const isTk2 =
    init.dialect === "tk2" ||
    gameState.vm.threads.some((t) => t.frames.some((f) => f.program.dialect === "tk2"));
  const manifest =
    init.manifest ??
    (isTk2 ? [...ENGINE_DEFAULT_MANIFEST, { id: "tk2" }] : undefined);
  const resolution = resolveHostPlugins(manifest, init.patch, init.plugins);
  const packageStartupLifecycle = { active: false, packageName: undefined as string | undefined };
  const layers = createPluginLayers();
  if (init.packageStartups !== undefined && init.packageStartups.length > 0) {
    const scratch = createGameState({ seed: init.startupSeed ?? 0 });
    const scratchListenersBeforeStartup = [...scratch.events.listeners];
    const scratchServices = createScriptServices(
      scratch,
      resolution.plugins,
      createLogger(init.sinks ?? []),
      undefined,
      init.loader,
      init.gameId ?? "default",
      undefined,
      undefined,
      layers,
      undefined,
      packageStartupLifecycle,
      undefined,
      init.scriptObservers,
    );
    runPackageStartup(
      scratch,
      scratchServices,
      ownedPackageStartups(init.packageStartups),
      resolution.plugins,
      scratchListenersBeforeStartup,
    );
  }
  const listenersBeforeStartup = [...gameState.events.listeners];
  const services = createScriptServices(
    gameState,
    resolution.plugins,
    createLogger(init.sinks ?? []),
    undefined,
    init.loader,
    init.gameId ?? "default",
    undefined,
    undefined,
    layers,
    undefined,
    packageStartupLifecycle,
    undefined,
    init.scriptObservers,
  );
  runPackageStartup(gameState, services, [], resolution.plugins, listenersBeforeStartup);
  // The compiled programs are not in the snapshot: check that every callable in it
  // still resolves against the ones this host rebuilds (FUN-8; entry 18.6).
  verifyRestoredHandles(gameState.vm, services, gameState.events);
  return createHost(gameState, services, [...restoreDiagnostics, ...resolution.diagnostics], init.blobs);
}
