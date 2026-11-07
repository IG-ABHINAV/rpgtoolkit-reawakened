/**
 * Snapshot and restore (AD-10/AD-11; decisions Q4, Q5/Q12).
 *
 * `snapshot(state)` is the canonical form of the whole state tree, so a
 * snapshot, a save, a hash and a restore all share one representation
 * (`canon`, RFC 8785) — Q4. `restoreGameState(json)` parses it, migrates the
 * data sections forward and checks the presence of every section; bounds and the
 * restore-versus-restart policy for an instruction version are entry 11's.
 * Q5/Q12 place the shared snapshot→restore→hash check in `runner-harness`.
 * Compiled programs are not in state (AD-7), so a restored host recompiles
 * lazily through its own program memo.
 *
 * Two identities decide compatibility
 * (docs/spec/formats/save-game.md#save-compatibility-and-instruction-versions-owner-ruling):
 * the per-section versions describe the data shape and migrate forward, while
 * `schema.ir` and every frame's `ProgramRef.ir` describe the meaning of a saved
 * instruction position. A newer `ir` is `restore.ir-mismatch` and refuses the
 * whole save before payload validation; an older `ir` keeps every data section
 * and restarts that thread from its saved program source (root frame at `ip 0`,
 * call stack and locals dropped). A changed source still restarts one thread
 * through the program cache's `restore.source-changed`, which is not a snapshot
 * error. A missing section is `restore.shape`.
 *
 * **VM objects, callables and closure cells (FUN-8/OOP-10; entry 18.6).** Without
 * compiled programs, `restoreGameState` checks each object value, member reference,
 * frame receiver and destructor handle against the saved handle table; values also
 * carry their object's class tag. It checks that every callable is a whole record,
 * that `vm.cells` and `vm.cellSeq` agree, and that every cell a callable or frame
 * names exists (`restore.callable-malformed`, `restore.cell-seq`,
 * `restore.cell-missing`). Whether a callable's definition is still defined needs
 * the compiled programs, so a host runs `verifyRestoredHandles` after rebuilding
 * its services. The new closure fields remain optional when no closure exists.
 *
 * **Migration (AD-7's migration chain).** A save whose `schema.vm` is behind
 * `SCHEMA_VERSIONS.vm` is migrated forward before it is returned: v2 → v3 adds
 * the effect log that ticket 3.21 introduced, v3 → v4 the thread, wait and
 * request fields of ticket 3.9, v4 → v5 advances both ticket 3.8 module
 * metadata and ticket 3.16's sandboxed file-handle table, v5 → v6 renames
 * each program reference's `compiler` to `ir`, and v6 → v7 establishes the
 * composable same-thread item-action continuation shape. The `schema` section
 * v1 → v2 turns its `compiler` into `ir` the same way. A save whose
 * `schema.audio` is 1 carried the empty placeholder; it is replaced by a fresh
 * schema-2 audio section (docs/spec/engine/audio-media.md#audio-state), because
 * a placeholder held no playback to keep. The chain is keyed by the
 * per-section numbers (AD-23).
 *
 * AD-10 (the state tree) and AD-11 (the canonical form); docs/spec/formats/save-game.md#layout-minor-4 (the
 * saved game).
 */

import { canon, reviveNonFinite, tagNonFinite } from "../canon/index.ts";
import { cellIdOfRef, cellNumber, eachRootValue, isRecord, migratePackageInlineLambdaDefs } from "../script/cells.ts";
import { parseObjectRef } from "../script/objects.ts";
import {
  RESTORE_CALLABLE_MALFORMED,
  RESTORE_CALLABLE_RECEIVER,
  RESTORE_CELL_MISSING,
  RESTORE_CELL_SEQ,
  ScriptError,
} from "../script/errors.ts";
import { itemActionRecordIssue, ITEM_ACTION_COMPLETE_COMMAND } from "../script/item-action.ts";
import { IR_VERSION } from "../script/program.ts";
import { SCHEMA_VERSIONS, type GameState } from "./state.ts";
import { asActorsSection, createActorsSection, ACTORS_SCHEMA_VERSION, validateActorProgression, type ActorProgression, type ActorStats } from "../actors/model.ts";
import { asSpritesSection, createSpritesSection, SPRITES_SCHEMA_VERSION } from "../sprites/model.ts";
import { createInputSection, rebuildKeyboardActionClaimIndex } from "../input/input.ts";
import { createTriggersSection, TRIGGERS_SCHEMA_VERSION } from "../triggers/model.ts";
import { INPUT_SCHEMA_VERSION } from "./sections/input.ts";
import { createUiSection, UI_SCHEMA_VERSION } from "./sections/ui.ts";
import { AUDIO_SCHEMA_VERSION, createAudioSection } from "../audio/model.ts";
import { createEventsSection } from "../events/model.ts";
import { EVENT_DISPATCH_WAIT } from "../events/emitter.ts";
import type { Diagnostic } from "../ports/engine.ts";
import type { HostDisplayGeometry, HostFeatures } from "../ports/host.ts";
import { BATTLE_SCHEMA_VERSION, createBattleSection, validateBattleSection } from "../battle/model.ts";
import { migrateMenuSections } from "../menu/migrate.ts";
import { surfaceByteLength } from "../raster/surfaces.ts";
import { createDisplaySection, HOST_FEATURES_SCHEMA_VERSION, DISPLAY_SCHEMA_VERSION, normalizeDisplayGeometry, normalizeHostFeatures } from "./sections/host.ts";
/** Upgrade the old empty battle placeholder to the fighter-reference section. */
function migrateBattle(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.battle;
  if (typeof version !== "number") shapeError("the snapshot's `schema` has no numeric `battle` version");
  if (version > BATTLE_SCHEMA_VERSION) shapeError(`the snapshot's battle schema version ${String(version)} is newer than supported version ${BATTLE_SCHEMA_VERSION}`);
  if (version < BATTLE_SCHEMA_VERSION) {
    if (version !== 1) shapeError(`the snapshot's battle schema version ${String(version)} has no migration`);
    record.battle = createBattleSection();
    schema.battle = BATTLE_SCHEMA_VERSION;
  }
}

/** The canonical form of a whole game state (AD-10/AD-11). */
export function snapshot(state: GameState): string {
  return canon(tagNonFinite(state) as never);
}

/** Rename one saved program reference's legacy `compiler` to `ir` (v5 → v6). */
function renameProgramRef(value: unknown): void {
  if (!isRecord(value)) return;
  if (typeof value.ir === "string") {
    // A partially migrated reference keeps `ir` and drops the legacy field.
    if (typeof value.compiler === "string") delete value.compiler;
    return;
  }
  if (typeof value.compiler !== "string") return;
  value.ir = irOfCompiler(value.compiler);
  delete value.compiler;
}

/** Rename every saved program reference: frame programs, object programs and definition owners. */
function migrateProgramRefs(record: Record<string, unknown>): void {
  const vm = record.vm;
  if (!isRecord(vm)) return;
  if (Array.isArray(vm.threads)) {
    for (const thread of vm.threads) {
      if (!isRecord(thread) || !Array.isArray(thread.frames)) continue;
      for (const frame of thread.frames) if (isRecord(frame)) renameProgramRef(frame.program);
    }
  }
  if (Array.isArray(vm.objects)) {
    for (const object of vm.objects) if (isRecord(object)) renameProgramRef(object.program);
  }
  if (isRecord(vm.defOwners)) {
    for (const ref of Object.values(vm.defOwners)) renameProgramRef(ref);
  }
}

/**
 * Migrate a snapshot's `vm` section to the current schema. Engine effect queues
 * are optional and require no version bump because an empty engine section
 * serialises identically before and after registration.
 */
function migrateVm(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.vm;
  if (typeof version !== "number") {
    throw new ScriptError("restore.shape", "the snapshot's `schema` has no numeric `vm` version");
  }
  if (version > SCHEMA_VERSIONS.vm) shapeError(`the snapshot's vm schema version ${String(version)} is newer than supported version ${SCHEMA_VERSIONS.vm}`);
  if (version < SCHEMA_VERSIONS.vm) migrateProgramRefs(record);
  if (version >= SCHEMA_VERSIONS.vm) return;

  const vm = record.vm;
  if (typeof vm !== "object" || vm === null || Array.isArray(vm)) {
    throw new ScriptError("restore.shape", "the snapshot's `vm` section is not an object");
  }
  const vmRecord = vm as Record<string, unknown>;
  if (version < 3) {
    if (!Array.isArray(vmRecord.effects)) vmRecord.effects = [];
    if (typeof vmRecord.effectSeq !== "number") vmRecord.effectSeq = 0;
  }
  if (version < 4) {
    if (!Array.isArray(vmRecord.threads)) {
      throw new ScriptError("restore.shape", "the snapshot's `vm.threads` is not an array");
    }
    for (const entry of vmRecord.threads as unknown[]) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new ScriptError("restore.shape", "a thread in the snapshot is not an object");
      }
      const thread = entry as Record<string, unknown>;
      thread.queue = [];
      thread.pending = null;
      thread.detached = [];
      thread.collect = null;
      const wait = thread.wait;
      if (typeof wait === "object" && wait !== null && !Array.isArray(wait)) {
        const waitRecord = wait as Record<string, unknown>;
        if (waitRecord.kind === "sleep") {
          waitRecord.global = true;
          waitRecord.resumesCall = true;
        }
      }
    }
    vmRecord.block = null;
    vmRecord.requestSeq = 0;
  }
  if (version < 5) {
    if (!Array.isArray(vmRecord.files)) vmRecord.files = [];
  }
  // v6 → v7 adds an optional per-frame itemActions stack; older frames remain absent until needed.
  schema.vm = SCHEMA_VERSIONS.vm;
}

/** Advance engine effect-dispatch state to the bounded-queue schema. */
function migrateEngine(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.engine;
  if (typeof version !== "number") {
    throw new ScriptError("restore.shape", "the snapshot's `schema` has no numeric `engine` version");
  }
  if (version > SCHEMA_VERSIONS.engine) shapeError(`the snapshot's engine schema version ${String(version)} is newer than supported version ${SCHEMA_VERSIONS.engine}`);
  if (version >= SCHEMA_VERSIONS.engine) return;
  const engine = recordAt(record.engine, "engine");
  if (version < 2) {
    if (engine.pendingEffects !== undefined && (typeof engine.pendingEffects !== "object" || engine.pendingEffects === null || Array.isArray(engine.pendingEffects))) {
      throw new ScriptError("restore.shape", "the snapshot's engine.pendingEffects is not an object");
    }
    if (engine.effectDropped !== undefined && (typeof engine.effectDropped !== "object" || engine.effectDropped === null || Array.isArray(engine.effectDropped))) {
      throw new ScriptError("restore.shape", "the snapshot's engine.effectDropped is not an object");
    }
    if (engine.effectDiagnostics !== undefined && !Array.isArray(engine.effectDiagnostics)) {
      throw new ScriptError("restore.shape", "the snapshot's engine.effectDiagnostics is not an array");
    }
  }
  schema.engine = SCHEMA_VERSIONS.engine;
}

/** Add the host sections to pre-#1349 saves using the documented deterministic defaults. */
function migrateHostSections(record: Record<string, unknown>, schema: Record<string, unknown>, logicalWidth: number, logicalHeight: number): void {
  for (const [name, versionNow] of [["features", HOST_FEATURES_SCHEMA_VERSION], ["display", DISPLAY_SCHEMA_VERSION]] as const) {
    let version = schema[name];
    if (version === undefined) {
      if (Object.hasOwn(record, name)) shapeError(`the snapshot's schema.${name} version is missing`);
      version = 0;
    }
    if (typeof version !== "number" || !Number.isInteger(version) || version < 0) shapeError(`the snapshot's schema.${name} must be a non-negative whole number`);
    if (version > versionNow) shapeError(`the snapshot's ${name} schema version ${String(version)} is newer than supported version ${versionNow}`);
    if (version === versionNow) continue;
    if (version !== 0) shapeError(`the snapshot's ${name} schema version ${String(version)} has no migration`);
    record[name] = name === "features"
      ? normalizeHostFeatures(undefined)
      : createDisplaySection(logicalWidth, logicalHeight);
    schema[name] = versionNow;
  }
}

/** Upgrade old world snapshots while retaining field-by-field absence for the main-file fallback. */
function migrateWorld(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.world;
  if (typeof version !== "number") shapeError("the snapshot's `schema` has no numeric `world` version");
  if (version > SCHEMA_VERSIONS.world) shapeError(`the snapshot's world schema version ${String(version)} is newer than supported version ${SCHEMA_VERSIONS.world}`);
  const world = recordAt(record.world, "world");
  const movement = world.movement === undefined ? {} : recordAt(world.movement, "world.movement");
  world.movement = {
    walking: movement.walking === undefined ? null : movement.walking,
    pushing: movement.pushing === undefined ? null : movement.pushing,
  };
  schema.world = SCHEMA_VERSIONS.world;
}

/** Migrate the old empty sprites placeholder and v2 actors to the movement-aware section. */
function migrateSprites(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.sprites;
  if (typeof version !== "number") shapeError("the snapshot's `schema` has no numeric `sprites` version");
  const current = asSpritesSection(record.sprites);
  const section = current === null ? createSpritesSection() : current;
  const movement = { active: null, waitTicks: 0, pendingExit: null, under: [], lastStepTick: null, lastStepDistance: 0 };
  const normalise = (actor: (typeof section.players)[number]) => ({
    ...actor,
    movement: {
      ...movement,
      ...(actor.movement ?? {}),
      lastStepTick: actor.movement?.lastStepTick ?? null,
      lastStepDistance: actor.movement?.lastStepDistance ?? 0,
    },
  });
  section.players = section.players.map(normalise);
  section.items = section.items.map(normalise);
  if (version < SPRITES_SCHEMA_VERSION) {
    section.version = SPRITES_SCHEMA_VERSION;
    record.sprites = section;
    schema.sprites = SPRITES_SCHEMA_VERSION;
  } else if (current !== null) {
    record.sprites = section;
  }
}

function migrationInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) shapeError(`the snapshot's ${field} must be a safe integer`);
  return value;
}

function migrateActorProgression(actor: Record<string, unknown>, index: number): void {
  const stats = recordAt(actor.stats, `actors.actors[${index}].stats`) as unknown as ActorStats;
  const old = recordAt(actor.progression, `actors.actors[${index}].progression`);
  const fields = ["levelType", "experienceIncrease", "maxLevel", "levelHp", "levelDp", "levelFp", "levelSm", "levelUpType"] as const;
  const policy = Object.fromEntries(fields.map((field) => [field, migrationInteger(old[field], `actors.actors[${index}].progression.${field}`)])) as unknown as ActorProgression;
  let nextRequirement = policy.levelType;
  let remainingExperience = nextRequirement - migrationInteger(stats.experience, `actors.actors[${index}].stats.experience`);
  const level = migrationInteger(stats.level, `actors.actors[${index}].stats.level`);
  for (let priorLevel = 1; priorLevel < level; priorLevel += 1) {
    const product = nextRequirement * policy.experienceIncrease;
    if (!Number.isSafeInteger(product)) shapeError(`the snapshot's actors.actors[${index}] progression threshold is unsafe`);
    nextRequirement = policy.levelUpType === 0
      ? nextRequirement + Math.trunc(product / 100)
      : nextRequirement + policy.experienceIncrease;
    if (!Number.isSafeInteger(nextRequirement)) shapeError(`the snapshot's actors.actors[${index}] progression threshold is unsafe`);
    remainingExperience += nextRequirement;
    if (!Number.isSafeInteger(remainingExperience)) shapeError(`the snapshot's actors.actors[${index}] remaining experience is unsafe`);
  }
  const migrated = {
    ...old,
    ...policy,
    remainingExperience: Math.max(0, remainingExperience),
    nextRequirement,
    // Version 1 did not persist whether a source legacy program was present.
    legacyLevelUp: null,
  };
  try {
    validateActorProgression(stats, migrated);
  } catch {
    shapeError(`the snapshot's actors.actors[${index}] has invalid progression`);
  }
  actor.progression = migrated;
}

/** Migrate actor records while retaining their saved identity and state. */
function migrateActors(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.actors;
  if (version === undefined) {
    record.actors = createActorsSection();
    schema.actors = ACTORS_SCHEMA_VERSION;
    return;
  }
  if (typeof version !== "number") shapeError("the snapshot's `schema` has no numeric `actors` version");
  if (version > ACTORS_SCHEMA_VERSION) shapeError(`the snapshot's actors schema version ${String(version)} is newer than supported version ${ACTORS_SCHEMA_VERSION}`);
  if (version === ACTORS_SCHEMA_VERSION) return;
  if (version !== 1) shapeError(`the snapshot's actors schema version ${String(version)} has no migration`);
  const section = recordAt(record.actors, "actors");
  if (section.version !== 1 || !Array.isArray(section.actors)) shapeError("the snapshot's actors section is not a version-1 actor section");
  for (const [index, value] of section.actors.entries()) {
    if (!isRecord(value)) shapeError(`the snapshot's actors.actors[${index}] is not an object`);
    migrateActorProgression(value, index);
  }
  section.version = ACTORS_SCHEMA_VERSION;
  schema.actors = ACTORS_SCHEMA_VERSION;
  record.actors = section;
}

/** Migrate the old empty trigger placeholder to the activation-state schema. */
function migrateTriggers(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.triggers;
  if (typeof version !== "number") shapeError("the snapshot's `schema` has no numeric `triggers` version");
  if (version >= TRIGGERS_SCHEMA_VERSION) return;
  const current = record.triggers;
  if (typeof current !== "object" || current === null || Array.isArray(current) || Object.keys(current).length === 0) {
    record.triggers = createTriggersSection();
  } else {
    record.triggers = { ...createTriggersSection(), ...(current as Record<string, unknown>), version: TRIGGERS_SCHEMA_VERSION };
  }
  schema.triggers = TRIGGERS_SCHEMA_VERSION;
}

function rebuildInputActionIndexes(input: Record<string, unknown>): void {
  const engineActions = ["up", "down", "left", "right", "confirm", "cancel", "menu"];
  const registry: Record<string, true> = Object.fromEntries(engineActions.map((name) => [name, true]));
  const order: Record<string, number> = Object.fromEntries(engineActions.map((name, index) => [name, index]));
  const controls: Record<string, string[]> = {};
  const padMasks: Record<string, number> = {};
  const registered = Array.isArray(input.registeredActions) ? input.registeredActions : [];
  for (const [index, value] of registered.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const action = value as Record<string, unknown>;
    if (typeof action.name !== "string" || !/^game\.[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/.test(action.name)) continue;
    Object.defineProperty(registry, action.name, { value: true, enumerable: true, configurable: true, writable: true });
    Object.defineProperty(order, action.name, { value: engineActions.length + index, enumerable: true, configurable: true, writable: true });
    if (!Array.isArray(action.controls)) continue;
    for (const control of action.controls) {
      if (typeof control !== "string" || !/^(?:key:[A-Za-z][A-Za-z0-9]*|pad:(?:[0-9]|1[0-6])|pad:axis[01][+-])$/.test(control)) continue;
      if (!Object.hasOwn(controls, control)) Object.defineProperty(controls, control, { value: [], enumerable: true, configurable: true, writable: true });
      controls[control]!.push(action.name);
      if (control.startsWith("pad:")) {
        const bit = control === "pad:axis0-" ? 17 : control === "pad:axis0+" ? 18 : control === "pad:axis1-" ? 19 : control === "pad:axis1+" ? 20 : Number(control.slice(4));
        padMasks[action.name] = (padMasks[action.name] ?? 0) | (1 << bit);
      }
    }
  }
  input.actionRegistry = registry;
  input.actionOrder = order;
  input.controlActions = controls;
  input.actionPadMasks = padMasks;
  const sources = typeof input.keyboardActionSources === "object" && input.keyboardActionSources !== null && !Array.isArray(input.keyboardActionSources)
    ? input.keyboardActionSources as Record<string, Record<string, true>>
    : {};
  const heldKeys = typeof input.held === "object" && input.held !== null && !Array.isArray(input.held)
    ? input.held as Record<string, unknown>
    : {};
  const bindings: Record<string, unknown> = {};
  const bindingRecord = input.bindings;
  if (typeof bindingRecord === "object" && bindingRecord !== null && !Array.isArray(bindingRecord) && "keys" in bindingRecord) {
    const keyMap = bindingRecord.keys;
    if (typeof keyMap === "object" && keyMap !== null && !Array.isArray(keyMap)) Object.assign(bindings, keyMap);
  }
  const defaults: Record<string, string> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "confirm", Space: "confirm", Escape: "cancel" };
  const legacyName = (code: string): string | null => {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^(?:Digit|Numpad)[0-9]$/.test(code)) return code.slice(-1);
    return null;
  };
  const isPhysicalCode = (code: string): boolean =>
    legacyName(code) !== null
    || /^(?:Arrow(?:Up|Down|Left|Right)|Enter|Escape|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock|NumLock|ScrollLock|Pause|ContextMenu|PrintScreen|(?:Shift|Control|Alt|Meta)(?:Left|Right)|F(?:[1-9]|1[0-2])|Numpad(?:Add|Subtract|Multiply|Divide|Decimal|Enter|Equal|Comma|ParenLeft|ParenRight|Backspace)|Intl(?:Backslash|Ro|Yen)|Lang[1-5])$/.test(code);
  const aliases: Record<string, string> = { ENTER: "confirm", RETURN: "confirm", SPACE: "confirm", " ": "confirm", ESC: "cancel", ESCAPE: "cancel", UP: "up", DOWN: "down", LEFT: "left", RIGHT: "right" };
  const resolve = (value: unknown): string | null => typeof value === "string" ? aliases[value.toUpperCase()] ?? value : null;
  if (typeof input.keyboardActions === "object" && input.keyboardActions !== null && !Array.isArray(input.keyboardActions)) {
    for (const [action, held] of Object.entries(input.keyboardActions as Record<string, unknown>)) {
      if (held !== true || !Object.hasOwn(registry, action) || Object.keys(sources[action] ?? {}).length > 0) continue;
      const claims: Record<string, true> = {};
      for (const [code, down] of Object.entries(heldKeys)) {
        // Logical aliases do not prove a physical code. Rebuild only from a separately saved
        // KeyboardEvent.code, so ENTER cannot invent key:Enter beside a held NumpadEnter.
        if (down !== true || !isPhysicalCode(code)) continue;
        const oldName = legacyName(code);
        const resolved = resolve(bindings[code]) ?? defaults[code] ??
          (oldName === null ? null : resolve(bindings[oldName]) ?? aliases[oldName]) ?? null;
        if (resolved === action) Object.defineProperty(claims, `key:${code}`, { value: true, enumerable: true, configurable: true, writable: true });
      }
      if (Object.keys(claims).length === 0) Object.defineProperty(claims, "legacy.keyboard", { value: true, enumerable: true, configurable: true, writable: true });
      Object.defineProperty(sources, action, { value: claims, enumerable: true, configurable: true, writable: true });
    }
  }
  input.keyboardActionSources = sources;
}

/** Migrate the raw input section to the binding-aware schema. */
function migrateInput(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.input;
  if (typeof version !== "number") shapeError("the snapshot's `schema` has no numeric `input` version");
  if (version < 10 && typeof record.input === "object" && record.input !== null && !Array.isArray(record.input)) {
    (record.input as Record<string, unknown>).primaryPointerSuppressedUntilRelease = false;
  }
  const normalizeKeys = (value: unknown): unknown[] => Array.isArray(value)
    ? value.map((entry: unknown) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return entry;
      const key = entry as Record<string, unknown>;
      const actions = Array.isArray(key.resolvedActions) ? key.resolvedActions as string[] : typeof key.action === "string" ? [key.action] : [];
      return { ...key, action: typeof key.action === "string" ? key.action : null, resolvedActions: actions };
    })
    : [];
  if (version >= INPUT_SCHEMA_VERSION) {
    const input = recordAt(record.input, "input");
    if (typeof input.primaryPointerSuppressedUntilRelease !== "boolean") shapeError("the snapshot's primaryPointerSuppressedUntilRelease must be boolean");
    if (!Array.isArray(input.registeredActions)) input.registeredActions = [];
    if (typeof input.actionPadMasks !== "object" || input.actionPadMasks === null || Array.isArray(input.actionPadMasks)) input.actionPadMasks = {};
    if (typeof input.keyboardActionSources !== "object" || input.keyboardActionSources === null || Array.isArray(input.keyboardActionSources)) input.keyboardActionSources = {};
    if (!Array.isArray(input.pendingKeySequences)) input.pendingKeySequences = [];
    input.keys = normalizeKeys(input.keys);
    if (typeof input.nextPointerGestureId !== "number" || !Number.isSafeInteger(input.nextPointerGestureId) || input.nextPointerGestureId < 1) input.nextPointerGestureId = 1;
    if (typeof input.pointerGestureId !== "number" || !Number.isSafeInteger(input.pointerGestureId)) input.pointerGestureId = null;
    if (!Array.isArray(input.pendingClicks)) input.pendingClicks = [];
    else input.pendingClicks = input.pendingClicks.map((value) => typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).x === "number" && typeof (value as Record<string, unknown>).y === "number"
      ? { gestureId: typeof (value as Record<string, unknown>).gestureId === "number" ? (value as Record<string, number>).gestureId! : 0, x: (value as Record<string, number>).x!, y: (value as Record<string, number>).y! }
      : null).filter((value) => value !== null);
    if (!Array.isArray(input.pendingPointerUps)) input.pendingPointerUps = [];
    else input.pendingPointerUps = input.pendingPointerUps.map((value) => typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).x === "number" && typeof (value as Record<string, unknown>).y === "number"
      ? { gestureId: typeof (value as Record<string, unknown>).gestureId === "number" ? (value as Record<string, number>).gestureId! : 0, x: (value as Record<string, number>).x!, y: (value as Record<string, number>).y! }
      : null).filter((value) => value !== null);
    if (input.pointerPlane !== null && (typeof input.pointerPlane !== "object" || Array.isArray(input.pointerPlane))) input.pointerPlane = null;
    if (input.pointerGestureId === null && typeof input.pointer === "object" && input.pointer !== null
      && typeof (input.pointer as Record<string, unknown>).buttons === "number" && (((input.pointer as Record<string, number>).buttons ?? 0) & 1) !== 0) input.pointerGestureId = 0;
    const modalActions = Array.isArray(input.modalActions) ? input.modalActions : [];
    input.modalActions = modalActions;
    for (const value of modalActions) {
      if (typeof value !== "object" || value === null || Array.isArray(value) ||
          !Number.isSafeInteger((value as Record<string, unknown>).seq) ||
          !Number.isSafeInteger((value as Record<string, unknown>).modalId) ||
          ((value as Record<string, unknown>).modalId as number) < 1 ||
          ((value as Record<string, unknown>).action !== "confirm" && (value as Record<string, unknown>).action !== "cancel")) {
        shapeError("the snapshot's input modalActions must contain sequenced confirm/cancel records with positive modal ids");
      }
    }
    rebuildInputActionIndexes(input);
    return;
  }
  if (version === 8 || version === 9) {
    const input = recordAt(record.input, "input");
    input.version = INPUT_SCHEMA_VERSION;
    if (!Array.isArray(input.modalActions)) input.modalActions = [];
    schema.input = INPUT_SCHEMA_VERSION;
    return;
  }
  if (version === 7) {
    const input = recordAt(record.input, "input");
    input.version = INPUT_SCHEMA_VERSION;
    if (!Array.isArray(input.pendingKeySequences)) input.pendingKeySequences = [];
    if (!Array.isArray(input.modalActions)) input.modalActions = [];
    input.keys = normalizeKeys(input.keys);
    rebuildInputActionIndexes(input);
    schema.input = INPUT_SCHEMA_VERSION;
    return;
  }
  const old = record.input;
  if (typeof old !== "object" || old === null || Array.isArray(old)) {
    record.input = createInputSection();
    schema.input = INPUT_SCHEMA_VERSION;
    return;
  }
  const oldRecord = old as Record<string, unknown>;
  if (version >= 2 && version <= 6) {
    const fresh = createInputSection();
    const pointer = typeof oldRecord.pointer === "object" && oldRecord.pointer !== null && !Array.isArray(oldRecord.pointer) ? oldRecord.pointer as Record<string, unknown> : {};
    const legacyPoints = (value: unknown): { gestureId: number; x: number; y: number }[] => Array.isArray(value)
      ? value.flatMap((point) => typeof point === "object" && point !== null && typeof (point as Record<string, unknown>).x === "number" && typeof (point as Record<string, unknown>).y === "number"
        ? [{ gestureId: typeof (point as Record<string, unknown>).gestureId === "number" ? (point as Record<string, number>).gestureId! : 0, x: (point as Record<string, number>).x!, y: (point as Record<string, number>).y! }]
        : [])
      : [];
    const clicks = legacyPoints(oldRecord.pendingClicks);
    const pointerUps = legacyPoints(oldRecord.pendingPointerUps);
    const legacyMask = (mask: number): number => {
      const targets = [12, 13, 14, 15, 0, 1, 9];
      return targets.reduce((result, target, source) => result | ((mask & (1 << source)) !== 0 ? (1 << target) : 0), 0);
    };
    const pads = typeof oldRecord.gamepads === "object" && oldRecord.gamepads !== null && !Array.isArray(oldRecord.gamepads)
      ? Object.fromEntries(Object.entries(oldRecord.gamepads as Record<string, unknown>).map(([device, value]) => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return [device, value];
        const pad = value as Record<string, unknown>;
        return [device, { ...pad, mask: typeof pad.mask === "number" ? version < 6 ? legacyMask(pad.mask) : pad.mask : 0 }];
      }))
      : {};
    const hasPrimaryPointer = (((pointer.buttons as number | undefined) ?? 0) & 1) !== 0;
    const savedGestureId = oldRecord.pointerGestureId;
    const activeGestureId = hasPrimaryPointer
      ? typeof savedGestureId === "number" && Number.isSafeInteger(savedGestureId) && savedGestureId >= 0 ? savedGestureId : 0
      : null;
    const savedNextGestureId = oldRecord.nextPointerGestureId;
    const nextGestureId = typeof savedNextGestureId === "number" && Number.isSafeInteger(savedNextGestureId) && savedNextGestureId >= 1 ? savedNextGestureId : 1;
    const migrated: Record<string, unknown> = {
      ...oldRecord,
      version: INPUT_SCHEMA_VERSION,
      pointer: { ...fresh.pointer, ...pointer },
      pressedButtonSlot: version >= 4 ? oldRecord.pressedButtonSlot ?? null : null,
      registeredActions: version >= 5 && Array.isArray(oldRecord.registeredActions) ? oldRecord.registeredActions : [],
      semanticActionSources: version >= 5 && typeof oldRecord.semanticActionSources === "object" && oldRecord.semanticActionSources !== null ? oldRecord.semanticActionSources : {},
      keyboardActionSources: {},
      pointerMovementSuppressed: version >= 5 && typeof oldRecord.pointerMovementSuppressed === "boolean" ? oldRecord.pointerMovementSuppressed : false,
      pointerPlane: version >= 5 && oldRecord.pointerPlane !== undefined ? oldRecord.pointerPlane : null,
      pendingKeySequences: [],
      modalActions: [],
      gamepads: pads,
      pointerGestureId: activeGestureId,
      pendingClicks: clicks,
      pendingPointerUps: pointerUps,
      nextPointerGestureId: Math.max(nextGestureId, activeGestureId === null ? 1 : activeGestureId + 1, ...clicks.map((item) => item.gestureId + 1), ...pointerUps.map((item) => item.gestureId + 1)),
    };
    migrated.keys = normalizeKeys(migrated.keys);
    record.input = migrated;
    rebuildInputActionIndexes(migrated);
    schema.input = INPUT_SCHEMA_VERSION;
    return;
  }
  const current = createInputSection();
  if (typeof oldRecord.nextSeq === "number") current.nextSeq = oldRecord.nextSeq;
  if (Array.isArray(oldRecord.keys)) current.keys = oldRecord.keys as typeof current.keys;
  if (typeof oldRecord.held === "object" && oldRecord.held !== null && !Array.isArray(oldRecord.held)) current.held = oldRecord.held as typeof current.held;
  if (typeof oldRecord.pointer === "object" && oldRecord.pointer !== null && !Array.isArray(oldRecord.pointer)) current.pointer = oldRecord.pointer as typeof current.pointer;
  if (typeof oldRecord.focused === "boolean") current.focused = oldRecord.focused;
  record.input = current;
  schema.input = INPUT_SCHEMA_VERSION;
}
/** Add deterministic author-surface, explicit custom-touch declaration and input-claim fields. */
function migrateUi(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.ui;
  if (typeof version !== "number") shapeError("the snapshot's `schema` has no numeric `ui` version");
  if (version > UI_SCHEMA_VERSION) shapeError(`the snapshot's ui schema ${version} is newer than supported schema ${UI_SCHEMA_VERSION}`);
  const old = record.ui;
  if (typeof old !== "object" || old === null || Array.isArray(old)) {
    shapeError("the snapshot's `ui` section must be an object");
  }
  if (version < UI_SCHEMA_VERSION) {
    const migrated: Record<string, unknown> = { ...createUiSection(), ...(old as Record<string, unknown>) };
    const time = record.time;
    const savedTick = typeof time === "object" && time !== null && !Array.isArray(time) &&
      Number.isSafeInteger((time as Record<string, unknown>).tick)
      ? (time as Record<string, number>).tick!
      : 0;
    if (version < 5) {
      if (Array.isArray(migrated.actionSurfaces)) {
        migrated.actionSurfaces = migrated.actionSurfaces.map((surface: unknown) => {
          if (typeof surface !== "object" || surface === null || Array.isArray(surface)) return surface;
          const publishedTick = (surface as Record<string, unknown>).publishedTick;
          return {
            ...surface,
            publishedTick: Number.isSafeInteger(publishedTick) ? publishedTick : savedTick,
          };
        });
      }
      if (Array.isArray(migrated.surfaceBuilders)) {
        migrated.surfaceBuilders = migrated.surfaceBuilders.map((builder: unknown) => {
          if (typeof builder !== "object" || builder === null || Array.isArray(builder)) return builder;
          const openedTick = (builder as Record<string, unknown>).openedTick;
          return {
            ...builder,
            openedTick: Number.isSafeInteger(openedTick) ? openedTick : savedTick,
          };
        });
      }
    }
    const modal = migrated.modal;
    const oldModalId = typeof modal === "object" && modal !== null && !Array.isArray(modal)
      ? (modal as Record<string, unknown>).modalId
      : undefined;
    if (typeof modal === "object" && modal !== null && !Array.isArray(modal) &&
        (!Number.isSafeInteger(oldModalId) || (oldModalId as number) < 1)) {
      (modal as Record<string, unknown>).modalId = 1;
    }
    const currentModal = migrated.modal;
    const modalId = typeof currentModal === "object" && currentModal !== null && !Array.isArray(currentModal)
      ? (currentModal as Record<string, unknown>).modalId
      : null;
    const nextModalId = Number.isSafeInteger(migrated.nextModalId) && (migrated.nextModalId as number) >= 1
      ? migrated.nextModalId as number
      : 1;
    migrated.nextModalId = typeof modalId === "number" ? Math.max(nextModalId, modalId + 1) : nextModalId;
    if (!Array.isArray(migrated.authorMarginSurfaces)) migrated.authorMarginSurfaces = [];
    for (const key of ["surfaceActivated", "surfacePointerClaim"] as const) {
      const claim = migrated[key];
      if (claim !== null && typeof claim === "object" && !Array.isArray(claim)) migrated[key] = { ...claim, cancelled: typeof (claim as Record<string, unknown>).cancelled === "boolean" ? (claim as Record<string, unknown>).cancelled : false };
    }
    record.ui = migrated;
  } else {
    const current = old as Record<string, unknown>;
    if (!Array.isArray(current.authorMarginSurfaces)) current.authorMarginSurfaces = [];
  }
  const currentUi = record.ui as Record<string, unknown>;
  for (const key of ["surfaceActivated", "surfacePointerClaim"] as const) {
    const claim = currentUi[key];
    if (claim !== null && (typeof claim !== "object" || Array.isArray(claim) || typeof (claim as Record<string, unknown>).cancelled !== "boolean")) shapeError(`the snapshot's UI ${key} must be null or an object with boolean \`cancelled\``);
  }
  if (!Number.isSafeInteger(currentUi.nextModalId) || (currentUi.nextModalId as number) < 1) {
    shapeError("the snapshot's UI nextModalId must be a positive safe integer");
  }
  const currentModal = currentUi.modal;
  if (currentModal !== null && (typeof currentModal !== "object" || Array.isArray(currentModal) ||
      !Number.isSafeInteger((currentModal as Record<string, unknown>).modalId) ||
      ((currentModal as Record<string, unknown>).modalId as number) < 1 ||
      ((currentModal as Record<string, unknown>).modalId as number) >= (currentUi.nextModalId as number))) {
    shapeError("the snapshot's UI modal must carry an identity below nextModalId");
  }
  if (typeof currentUi.surfaceResultsPending !== "boolean") shapeError("the snapshot's UI surfaceResultsPending must be a boolean");
  schema.ui = UI_SCHEMA_VERSION;
}


/** Migrate the empty audio placeholder (schema 1) to the track-and-voice section (schema 2; docs/spec/engine/audio-media.md#audio-state). */
function migrateAudio(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  const version = schema.audio;
  if (typeof version !== "number") shapeError("the snapshot's `schema` has no numeric `audio` version");
  if (version >= SCHEMA_VERSIONS.audio) return;
  record.audio = createAudioSection();
  schema.audio = SCHEMA_VERSIONS.audio;
}

function shapeError(message: string): never {
  throw new ScriptError("restore.shape", message);
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return shapeError(`the snapshot's ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return shapeError(`the snapshot's ${path} must be an array`);
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string") return shapeError(`the snapshot's ${path} must be a string`);
  return value;
}

function numberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return shapeError(`the snapshot's ${path} must be a finite whole number`);
  }
  return value;
}

function nullableRecord(value: unknown, path: string): Record<string, unknown> | null {
  if (value === null) return null;
  return recordAt(value, path);
}
function validateNativeData(value: unknown, path: string): void {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) shapeError(`the snapshot's ${path} must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) validateNativeData(entry, `${path}[${index}]`);
    return;
  }
  const record = recordAt(value, path);
  for (const [name, entry] of Object.entries(record)) validateNativeData(entry, `${path}.${name}`);
}


function validateProgramRef(value: unknown, path: string): void {
  const ref = recordAt(value, path);
  const kind = stringAt(ref.kind, `${path}.kind`);
  if (kind !== "inline" && kind !== "file") return shapeError(`the snapshot's ${path}.kind is invalid`);
  // The instruction version is shape here; a newer one was refused before payload
  // validation and an older one already restarted its thread (see the file header).
  irNumberAt(ref.ir, `${path}.ir`);
  if (kind === "inline") stringAt(ref.text, `${path}.text`);
  else {
    stringAt(ref.path, `${path}.path`);
    stringAt(ref.sourceHash, `${path}.sourceHash`);
  }
  if (ref.owner !== undefined) {
    if (typeof ref.owner !== "string" || ref.owner === "") shapeError(`the snapshot's ${path}.owner must be a non-empty package name`);
  }
  if (ref.includes !== undefined) {
    for (const [index, item] of arrayAt(ref.includes, `${path}.includes`).entries()) {
      stringAt(item, `${path}.includes[${index}]`);
    }
  }
  if (ref.redirects !== undefined) {
    for (const [index, pair] of arrayAt(ref.redirects, `${path}.redirects`).entries()) {
      const values = arrayAt(pair, `${path}.redirects[${index}]`);
      if (values.length !== 2) return shapeError(`the snapshot's ${path}.redirects[${index}] must have two items`);
      stringAt(values[0], `${path}.redirects[${index}][0]`);
      stringAt(values[1], `${path}.redirects[${index}][1]`);
    }
  }
}

function validateVmShape(vm: Record<string, unknown>): ReadonlyMap<number, string> {
  for (const key of ["threads", "objects", "redirects", "files", "effects"] as const) arrayAt(vm[key], `vm.${key}`);
  recordAt(vm.globals, "vm.globals");
  numberAt(vm.effectSeq, "vm.effectSeq");
  numberAt(vm.requestSeq, "vm.requestSeq");
  nullableRecord(vm.block, "vm.block");
  if (vm.messagesOff !== undefined && vm.messagesOff !== true) shapeError("the snapshot's vm.messagesOff is invalid");
  if (vm.stepCounters !== undefined) {
    const counters = recordAt(vm.stepCounters, "vm.stepCounters");
    for (const [owner, count] of Object.entries(counters)) {
      if (owner === "" || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
        shapeError(`the snapshot's vm.stepCounters.${owner} must be a non-negative whole number`);
      }
    }
  }
  for (const [index, threadValue] of arrayAt(vm.threads, "vm.threads").entries()) {
    const thread = recordAt(threadValue, `vm.threads[${index}]`);
    numberAt(thread.id, `vm.threads[${index}].id`);
    if (!["blocking", "board", "persistent", "item"].includes(stringAt(thread.kind, `vm.threads[${index}].kind`))) {
      shapeError(`the snapshot's vm.threads[${index}].kind is invalid`);
    }
    if (!["script", "world"].includes(stringAt(thread.owner, `vm.threads[${index}].owner`))) {
      shapeError(`the snapshot's vm.threads[${index}].owner is invalid`);
    }
    if (thread.source !== null) stringAt(thread.source, `vm.threads[${index}].source`);
    if (thread.target !== null) stringAt(thread.target, `vm.threads[${index}].target`);
    if (!["ready", "waiting", "finished"].includes(stringAt(thread.status, `vm.threads[${index}].status`))) {
      shapeError(`the snapshot's vm.threads[${index}].status is invalid`);
    }
    nullableRecord(thread.wait, `vm.threads[${index}].wait`);
    arrayAt(thread.queue, `vm.threads[${index}].queue`);
    nullableRecord(thread.pending, `vm.threads[${index}].pending`);
    arrayAt(thread.detached, `vm.threads[${index}].detached`);
    if (thread.collect !== null) arrayAt(thread.collect, `vm.threads[${index}].collect`);
    for (const [frameIndex, frameValue] of arrayAt(thread.frames, `vm.threads[${index}].frames`).entries()) {
      const frame = recordAt(frameValue, `vm.threads[${index}].frames[${frameIndex}]`);
      validateProgramRef(frame.program, `vm.threads[${index}].frames[${frameIndex}].program`);
      numberAt(frame.ip, `vm.threads[${index}].frames[${frameIndex}].ip`);
      recordAt(frame.locals, `vm.threads[${index}].frames[${frameIndex}].locals`);
      arrayAt(frame.operands, `vm.threads[${index}].frames[${frameIndex}].operands`);
      if (frame.errorHandler !== null) recordAt(frame.errorHandler, `vm.threads[${index}].frames[${frameIndex}].errorHandler`);
      if (Object.hasOwn(frame, "itemActions")) {
        const itemActionsPath = `vm.threads[${index}].frames[${frameIndex}].itemActions`;
        const records = arrayAt(frame.itemActions, itemActionsPath);
        if (records.length === 0) shapeError(`the snapshot's ${itemActionsPath} is empty`);
        for (const [actionIndex, actionValue] of records.entries()) {
          const issue = itemActionRecordIssue(actionValue);
          if (issue !== null) shapeError(`the snapshot's ${itemActionsPath}[${actionIndex}] ${issue}`);
        }
      }
      if (typeof frame.autoLocal !== "boolean") shapeError(`the snapshot's vm.threads[${index}].frames[${frameIndex}].autoLocal is invalid`);
      if (frame.programRoot !== undefined) {
        const rootPath = `vm.threads[${index}].frames[${frameIndex}].programRoot`;
        const root = recordAt(frame.programRoot, rootPath);
        if (Object.keys(root).sort().join(",") !== "restore") {
          shapeError(`the snapshot's ${rootPath} must contain only restore`);
        }
        if (root.restore === null) {
          if (frameIndex !== 0) shapeError(`the snapshot's ${rootPath}.restore may be null only on a replacement root`);
        } else {
          const restore = recordAt(root.restore, `${rootPath}.restore`);
          if (Object.keys(restore).sort().join(",") !== "source,target" || frameIndex === 0) {
            shapeError(`the snapshot's ${rootPath}.restore must be a caller pair on a nested program frame`);
          }
          if (restore.source !== null) stringAt(restore.source, `${rootPath}.restore.source`);
          if (restore.target !== null) stringAt(restore.target, `${rootPath}.restore.target`);
        }
      }
    }
    const topFrame = arrayAt(thread.frames, `vm.threads[${index}].frames`).at(-1);
    const topRecords: unknown[] = isRecord(topFrame) && Array.isArray(topFrame.itemActions) ? topFrame.itemActions : [];
    const lastRecord = topRecords.at(-1);
    const completing = isRecord(lastRecord) && lastRecord.phase === "completion";
    const pendingComplete = isRecord(thread.pending) && thread.pending.command === ITEM_ACTION_COMPLETE_COMMAND;
    if (completing !== pendingComplete) {
      shapeError(`the snapshot's vm.threads[${index}] item action completion and its pending dispatch disagree`);
    }
  }
  const objectClasses = validateVmObjects(vm);
  validateVmFrames(vm, objectClasses);
  validateVmHandles(vm, objectClasses);
  return objectClasses;
}

/**
 * The records of the handle table (OOP-10; entries 19.3 and 19.5): every object,
 * a dictionary and a class instance alike, has the one shape. The `handle`s are
 * distinct whole numbers, `keys` names each member exactly once, and `program` is
 * a program reference exactly when the record has a class (`className` is not `""`).
 * A record in the shape saved before entry 19.5 (a class instance with no `keys`)
 * is refused here: no step migrates it.
 */
function validateVmObjects(vm: Record<string, unknown>): ReadonlyMap<number, string> {
  const classes = new Map<number, string>();
  for (const [index, value] of arrayAt(vm.objects, "vm.objects").entries()) {
    const path = `vm.objects[${index}]`;
    const record = recordAt(value, path);
    const handle = numberAt(record.handle, `${path}.handle`);
    if (!Number.isSafeInteger(handle) || handle < 1 || classes.has(handle)) {
      shapeError(`the snapshot's ${path}.handle is not a distinct positive handle`);
    }
    const className = stringAt(record.className, `${path}.className`);
    classes.set(handle, className);
    if (typeof record.hostType !== "undefined" && (typeof record.hostType !== "string" || record.hostType === "")) {
      shapeError(`the snapshot's ${path}.hostType must be a non-empty string when present`);
    }
    if (className === "") {
      if (record.program !== null) shapeError(`the snapshot's ${path}.program must be null on an object with no class`);
    } else {
      validateProgramRef(record.program, `${path}.program`);
    }
    const keys = arrayAt(record.keys, `${path}.keys`);
    const members = recordAt(record.members, `${path}.members`);
    const listed = new Set<string>();
    for (const [at, key] of keys.entries()) listed.add(stringAt(key, `${path}.keys[${at}]`));
    const names = Object.keys(members);
    if (listed.size !== keys.length || names.length !== keys.length || !names.every((name) => listed.has(name))) {
      shapeError(`the snapshot's ${path}.keys does not list its members exactly once each`);
    }
  }
  return classes;
}

/** A typed restore failure whose message names the place in the save (entry 18.6). */
function restoreError(code: string, message: string): never {
  throw new ScriptError(code, `the snapshot's ${message}`);
}

/**
 * Check one script value at `path`: a number, string, null, a whole callable or an
 * object value with a positive safe-integer handle and string class tag. Handles
 * remain meaningful after release and reuse, so the tag is not checked against a
 * current object record. Callable captures must name cells that exist.
 * Malformed callables use `restore.callable-malformed`; missing cells use
 * `restore.cell-missing`; any other invalid value is `restore.shape`.
 */
function checkValue(
  path: string,
  value: unknown,
  cells: Readonly<Record<string, unknown>>,
  objects: ReadonlyMap<number, string>,
): void {
  if (value === null || typeof value === "number" || typeof value === "string") return;
  if (!isRecord(value)) {
    return shapeError(`the snapshot's ${path} is not a script value (a number, a string, null, an object handle or a callable)`);
  }
  if (value.kind === "object") {
    if (
      typeof value.handle !== "number" ||
      !Number.isSafeInteger(value.handle) ||
      value.handle < 1 ||
      typeof value.className !== "string" ||
      Object.keys(value).sort().join(",") !== "className,handle,kind"
    ) {
      shapeError(`the snapshot's ${path} is not a whole object handle`);
    }
    return;
  }
  if (value.type !== "callable") {
    return shapeError(`the snapshot's ${path} is not a script value (a number, a string, null, an object handle or a callable)`);
  }
  const { def, captures, receiver, owner } = value;
  const keyShape = Object.keys(value).sort().join(",");
  if (
    (keyShape !== "captures,def,receiver,type" && keyShape !== "captures,def,owner,receiver,type") ||
    (owner !== undefined && (typeof owner !== "string" || owner === "")) ||
    typeof def !== "string" ||
    def === "" ||
    !Array.isArray(captures) ||
    !captures.every((entry) => typeof entry === "string") ||
    (receiver !== null && typeof receiver !== "string")
  ) {
    restoreError(
      RESTORE_CALLABLE_MALFORMED,
      `${path} is not a whole callable: it must be { type, def, captures, receiver } with an optional owner package name, a def text, a list of cell ids and a receiver that is text or null`,
    );
  }
  if (receiver !== null) {
    const handle = Number(receiver);
    if (!Number.isSafeInteger(handle) || !objects.has(handle)) {
      restoreError(RESTORE_CALLABLE_RECEIVER, `${path}.receiver names no live object handle`);
    }
  }
  for (const [index, id] of (captures as string[]).entries()) {
    if (id !== "" && !Object.hasOwn(cells, id)) {
      restoreError(RESTORE_CELL_MISSING, `${path}.captures[${index}] names cell "${id}", which is not in vm.cells`);
    }
  }
}

function checkReference(
  path: string,
  ref: unknown,
  cells: Readonly<Record<string, unknown>>,
  objects: ReadonlyMap<number, string>,
): void {
  const id = cellIdOfRef(ref);
  if (id !== null && !Object.hasOwn(cells, id)) {
    restoreError(RESTORE_CELL_MISSING, `${path} names cell "${id}", which is not in vm.cells`);
  }
  if (typeof ref !== "string" || !ref.startsWith("object:")) return;
  const parsed = parseObjectRef(ref);
  const separator = ref.indexOf(":", "object:".length);
  const handleText = separator < 0 ? "" : ref.slice("object:".length, separator);
  if (
    parsed === null ||
    !Number.isSafeInteger(parsed.handle) ||
    parsed.handle < 1 ||
    String(parsed.handle) !== handleText ||
    !objects.has(parsed.handle)
  ) {
    shapeError(`the snapshot's ${path} does not name a live object member`);
  }
}

/**
 * A frame may retain a released method receiver; a pending destructor handle
 * must still name its live object.
 */
function validateVmFrames(vm: Record<string, unknown>, objects: ReadonlyMap<number, string>): void {
  for (const [threadIndex, threadValue] of arrayAt(vm.threads, "vm.threads").entries()) {
    const thread = recordAt(threadValue, `vm.threads[${threadIndex}]`);
    for (const [frameIndex, frameValue] of arrayAt(thread.frames, `vm.threads[${threadIndex}].frames`).entries()) {
      const path = `vm.threads[${threadIndex}].frames[${frameIndex}]`;
      const frame = recordAt(frameValue, path);
      const hasHandle = Object.hasOwn(frame, "objectHandle");
      const hasClass = Object.hasOwn(frame, "objectClass");
      if (hasHandle !== hasClass) shapeError(`the snapshot's ${path} must carry objectHandle and objectClass together`);
      if (hasHandle) {
        const handle = numberAt(frame.objectHandle, `${path}.objectHandle`);
        if (!Number.isSafeInteger(handle) || handle < 1) {
          shapeError(`the snapshot's ${path}.objectHandle must be a positive safe integer`);
        }
        stringAt(frame.objectClass, `${path}.objectClass`);
      }
      if (Object.hasOwn(frame, "releaseHandle")) {
        const handle = numberAt(frame.releaseHandle, `${path}.releaseHandle`);
        if (!Number.isSafeInteger(handle) || handle < 1 || !objects.has(handle) || !hasHandle || handle !== frame.objectHandle) {
          shapeError(`the snapshot's ${path}.releaseHandle does not match its live object receiver`);
        }
      }
    }
  }
}
/**
 * The script-reference and closure-cell check (FUN-8/OOP-10; entry 18.6), which
 * needs no compiled program: `vm.cells` and `vm.cellSeq` agree, every script
 * value and callable is whole, and every cell or object handle a member reference
 * or callable receiver names is live. Object values and method frames may retain
 * handles after explicit release. Program-aware callable-definition checks run in
 * `verifyRestoredHandles`.
 */
function validateVmHandles(vm: Record<string, unknown>, objects: ReadonlyMap<number, string>): void {
  const cells = vm.cells;
  const seq = vm.cellSeq;
  if (cells === undefined) {
    if (seq !== undefined) restoreError(RESTORE_CELL_SEQ, "vm.cellSeq is present but vm.cells is not");
  } else {
    if (!isRecord(cells)) return shapeError("the snapshot's vm.cells must be an object");
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) {
      restoreError(RESTORE_CELL_SEQ, "vm.cellSeq must be a whole number of at least 0 beside vm.cells");
    }
    for (const id of Object.keys(cells)) {
      const number = cellNumber(id);
      if (number === null) {
        restoreError(RESTORE_CELL_SEQ, `vm.cells has the id "${id}", which is not a cell id (cell1, cell2, …)`);
      }
      if (number > seq) {
        restoreError(
          RESTORE_CELL_SEQ,
          `vm.cells.${id} is above vm.cellSeq ${seq}, so a later cell would be issued the id of an existing cell`,
        );
      }
    }
  }
  const table: Readonly<Record<string, unknown>> = isRecord(cells) ? cells : {};
  if (vm.defOwners !== undefined) {
    const owners = recordAt(vm.defOwners, "vm.defOwners");
    for (const def of Object.keys(owners)) validateProgramRef(owners[def], `vm.defOwners.${def}`);
  }
  for (const id of Object.keys(table)) checkValue(`vm.cells.${id}`, table[id], table, objects);
  eachRootValue(
    vm,
    (path, value) => checkValue(path, value, table, objects),
    (path, ref) => checkReference(path, ref, table, objects),
  );
}

/** A save made before the `events` section existed loads with the empty section (EMIT-15); nothing else moves. */
function migrateEvents(record: Record<string, unknown>, schema: Record<string, unknown>): void {
  if (record.events !== undefined || schema.events !== undefined) return;
  record.events = createEventsSection();
  schema.events = SCHEMA_VERSIONS.events;
}

/**
 * The `events` section's shape (EMIT-15; entry 19.10): the listener table, the queue
 * and the dispatch cursor are whole, every id is distinct and below `nextListener`,
 * every event handle names a live object, every listener is a whole callable whose
 * cells exist, and the cursor's list, position and thread agree. Whether a listener's
 * definition still exists needs the compiled programs, which is `verifyRestoredHandles`.
 */
function validateEventsShape(value: unknown, vm: Record<string, unknown>, objects: ReadonlyMap<number, string>): void {
  const events = recordAt(value, "events");
  const next = numberAt(events.nextListener, "events.nextListener");
  if (next < 1) shapeError("the snapshot's events.nextListener must be at least 1");
  if (events.audioPasses !== undefined) {
    const passes = recordAt(events.audioPasses, "events.audioPasses");
    for (const [cue, pass] of Object.entries(passes)) {
      if (!Number.isSafeInteger(Number(cue)) || Number(cue) < 1 || String(Number(cue)) !== cue) {
        shapeError(`the snapshot's events.audioPasses.${cue} must name a positive cue id`);
      }
      if (typeof pass !== "number" || !Number.isSafeInteger(pass) || pass < 0) {
        shapeError(`the snapshot's events.audioPasses.${cue} must be a non-negative pass number`);
      }
    }
  }
  const threads = new Set<number>();
  for (const thread of arrayAt(vm.threads, "vm.threads")) threads.add(numberAt(recordAt(thread, "vm.threads[]").id, "vm.threads[].id"));
  const cells = isRecord(vm.cells) ? vm.cells : {};
  const ids = new Set<number>();
  for (const [index, listenerValue] of arrayAt(events.listeners, "events.listeners").entries()) {
    const path = `events.listeners[${index}]`;
    const listener = recordAt(listenerValue, path);
    const id = numberAt(listener.id, `${path}.id`);
    if (id < 1 || id >= next || ids.has(id)) shapeError(`the snapshot's ${path}.id is not a distinct id below events.nextListener`);
    ids.add(id);
    stringAt(listener.emitter, `${path}.emitter`);
    stringAt(listener.type, `${path}.type`);
    if (typeof listener.once !== "boolean") shapeError(`the snapshot's ${path}.once must be a boolean`);
    if (!isRecord(listener.callable) || listener.callable.type !== "callable") {
      shapeError(`the snapshot's ${path}.callable must be a callable`);
    }
    checkValue(`${path}.callable`, listener.callable, cells, objects);
  }
  const liveEvent = (handle: unknown, path: string): void => {
    if (!objects.has(numberAt(handle, path))) shapeError(`the snapshot's ${path} names no live object handle`);
  };
  for (const [index, queuedValue] of arrayAt(events.queue, "events.queue").entries()) {
    const queued = recordAt(queuedValue, `events.queue[${index}]`);
    stringAt(queued.emitter, `events.queue[${index}].emitter`);
    liveEvent(queued.event, `events.queue[${index}].event`);
  }
  if (events.nativeDetails !== undefined) {
    const nativeDetails = recordAt(events.nativeDetails, "events.nativeDetails");
    for (const [rawHandle, detailValue] of Object.entries(nativeDetails)) {
      const path = `events.nativeDetails.${rawHandle}`;
      const handle = Number(rawHandle);
      if (!Number.isSafeInteger(handle) || handle < 1) shapeError(`the snapshot's ${path} must name a positive event handle`);
      liveEvent(handle, path);
      const detail = recordAt(detailValue, path);
      for (const [name, entry] of Object.entries(detail)) validateNativeData(entry, `${path}.${name}`);
    }
  }
  for (const [index, threadValue] of arrayAt(vm.threads, "vm.threads").entries()) {
    const wait = recordAt(threadValue, `vm.threads[${index}]`).wait;
    if (!isRecord(wait) || wait.kind !== EVENT_DISPATCH_WAIT) continue;
    liveEvent(arrayAt(wait.payload, `vm.threads[${index}].wait.payload`)[0], `vm.threads[${index}].wait.payload[0]`);
  }
  if (events.emitters !== undefined) {
    const registered = new Set<number>();
    for (const [key, handle] of Object.entries(recordAt(events.emitters, "events.emitters"))) {
      liveEvent(handle, `events.emitters.${key}`);
      if (registered.has(handle as number)) shapeError(`the snapshot's events.emitters.${key} names a handle another key already names`);
      registered.add(handle as number);
    }
  }
  if (events.retiring !== undefined) {
    const retiring = arrayAt(events.retiring, "events.retiring");
    if (!isRecord(events.emitters)) shapeError("the snapshot's events.retiring requires registered emitters");
    const seen = new Set<string>();
    for (const [index, value] of retiring.entries()) {
      stringAt(value, `events.retiring[${index}]`);
      const key = value as string;
      if (seen.has(key)) shapeError(`the snapshot's events.retiring[${index}] repeats an emitter`);
      seen.add(key);
      if (!Object.hasOwn(events.emitters, key)) shapeError(`the snapshot's events.retiring[${index}] names no registered emitter`);
    }
  }
  if (events.dispatch === null) return;
  const dispatch = recordAt(events.dispatch, "events.dispatch");
  stringAt(dispatch.emitter, "events.dispatch.emitter");
  liveEvent(dispatch.event, "events.dispatch.event");
  const order = arrayAt(dispatch.order, "events.dispatch.order");
  for (const [index, id] of order.entries()) {
    const listed = numberAt(id, `events.dispatch.order[${index}]`);
    if (listed < 1 || listed >= next) shapeError(`the snapshot's events.dispatch.order[${index}] is not an id below events.nextListener`);
  }
  const position = numberAt(dispatch.index, "events.dispatch.index");
  if (position < 0 || position > order.length) shapeError("the snapshot's events.dispatch.index is outside events.dispatch.order");
  if (dispatch.thread !== null) {
    if (!threads.has(numberAt(dispatch.thread, "events.dispatch.thread"))) shapeError("the snapshot's events.dispatch.thread names no thread");
    if (position >= order.length) shapeError("the snapshot's events.dispatch.index must name a listener while a thread runs");
  }
}

function validateSurfacesShape(value: unknown): void {
  const surfaces = recordAt(value, "surfaces");
  if (Object.keys(surfaces).length === 0) return;
  const nextId = numberAt(surfaces.nextId, "surfaces.nextId");
  if (nextId < 1) shapeError("the snapshot's surfaces.nextId must be positive");
  const entries = recordAt(surfaces.entries, "surfaces.entries");
  for (const rawId of Object.keys(entries)) {
    const item = recordAt(entries[rawId], `surfaces.entries.${rawId}`);
    numberAt(item.id, `surfaces.entries.${rawId}.id`);
    numberAt(item.rev, `surfaces.entries.${rawId}.rev`);
    const bitmap = recordAt(item.bitmap, `surfaces.entries.${rawId}.bitmap`);
    if (bitmap.t !== "rgba") shapeError(`the snapshot's surfaces.entries.${rawId}.bitmap.t must be "rgba"`);
    const width = numberAt(bitmap.w, `surfaces.entries.${rawId}.bitmap.w`);
    const height = numberAt(bitmap.h, `surfaces.entries.${rawId}.bitmap.h`);
    if (!Number.isInteger(width) || width < 0 || !Number.isInteger(height) || height < 0) {
      shapeError(`the snapshot's surfaces.entries.${rawId}.bitmap dimensions must be non-negative integers`);
    }
    const byteLength = width * height * 4;
    if (!Number.isSafeInteger(byteLength)) shapeError(`the snapshot's surfaces.entries.${rawId}.bitmap dimensions exceed a safe RGBA byte length`);
    const b64 = stringAt(bitmap.b64, `surfaces.entries.${rawId}.bitmap.b64`);
    if (b64.length !== Math.ceil(byteLength / 3) * 4) {
      shapeError(`the snapshot's surfaces.entries.${rawId}.bitmap.b64 length does not match its dimensions`);
    }
    let decodedLength: number;
    try {
      decodedLength = surfaceByteLength(b64);
    } catch {
      shapeError(`the snapshot's surfaces.entries.${rawId}.bitmap.b64 is not valid base64`);
    }
    if (decodedLength !== byteLength) shapeError(`the snapshot's surfaces.entries.${rawId}.bitmap.b64 does not match its dimensions`);
  }
  const slots = recordAt(surfaces.slots, "surfaces.slots");
  for (const slot of Object.keys(slots)) numberAt(slots[slot], `surfaces.slots.${slot}`);
  const colours = recordAt(surfaces.colours, "surfaces.colours");
  for (const colour of Object.keys(colours)) numberAt(colours[colour], `surfaces.colours.${colour}`);
}

function validateSpritesShape(value: unknown): void {
  const sprites = asSpritesSection(value);
  if (sprites === null || sprites.version !== SPRITES_SCHEMA_VERSION) shapeError("the snapshot's `sprites` section has an invalid schema");
}

function validateActorsShape(value: unknown): void {
  const actors = asActorsSection(value);
  if (actors === null || actors.version !== ACTORS_SCHEMA_VERSION) shapeError("the snapshot's `actors` section has an invalid schema");
}

function validateTriggersShape(value: unknown): void {
  const triggers = recordAt(value, "triggers");
  if (numberAt(triggers.version, "triggers.version") !== TRIGGERS_SCHEMA_VERSION) {
    shapeError("the snapshot's `triggers` section has an invalid schema");
  }
  arrayAt(triggers.suppressed, "triggers.suppressed");
  arrayAt(triggers.deactivated, "triggers.deactivated");
  recordAt(triggers.fired, "triggers.fired");
  recordAt(triggers.repeat, "triggers.repeat");
}

/** One fade descriptor or `null` (docs/spec/engine/audio-media.md#audio-state). */
function validateAudioFade(value: unknown, path: string): void {
  if (value === null) return;
  const fade = recordAt(value, path);
  for (const key of ["fromVolume", "targetVolume", "startTick", "durationTicks"]) numberAt(fade[key], `${path}.${key}`);
}

function validateNullableNumber(value: unknown, path: string): void {
  if (value !== null) numberAt(value, path);
}

/** The `audio` section's shape, schema v2 (docs/spec/engine/audio-media.md#audio-state). */
function validateAudioShape(value: unknown): void {
  const audio = recordAt(value, "audio");
  if (numberAt(audio.schema, "audio.schema") !== AUDIO_SCHEMA_VERSION) shapeError(`the snapshot's audio.schema must be ${AUDIO_SCHEMA_VERSION}`);
  if (numberAt(audio.cueId, "audio.cueId") < 1) shapeError("the snapshot's audio.cueId must be at least 1");
  if (audio.soundFont !== null) stringAt(audio.soundFont, "audio.soundFont");
  for (const [index, trackValue] of arrayAt(audio.tracks, "audio.tracks").entries()) {
    const path = `audio.tracks[${index}]`;
    const track = recordAt(trackValue, path);
    stringAt(track.name, `${path}.name`);
    if (numberAt(track.voiceCount, `${path}.voiceCount`) < 1) shapeError(`the snapshot's ${path}.voiceCount must be at least 1`);
    if (!["stopped", "playing", "paused"].includes(stringAt(track.state, `${path}.state`))) shapeError(`the snapshot's ${path}.state is invalid`);
    numberAt(track.flags, `${path}.flags`);
    numberAt(track.positionTicks, `${path}.positionTicks`);
    if (track.file !== null) stringAt(track.file, `${path}.file`);
    validateNullableNumber(track.lengthTicks, `${path}.lengthTicks`);
    validateAudioFade(track.fade, `${path}.fade`);
    for (const [voiceIndex, voiceValue] of arrayAt(track.voices, `${path}.voices`).entries()) {
      const voicePath = `${path}.voices[${voiceIndex}]`;
      const voice = recordAt(voiceValue, voicePath);
      for (const key of ["index", "cueId", "priority", "volume", "startTick", "positionTicks"]) numberAt(voice[key], `${voicePath}.${key}`);
      if (!["playing", "paused"].includes(stringAt(voice.state, `${voicePath}.state`))) shapeError(`the snapshot's ${voicePath}.state is invalid`);
      stringAt(voice.file, `${voicePath}.file`);
      if (typeof voice.loop !== "boolean") shapeError(`the snapshot's ${voicePath}.loop must be a boolean`);
      for (const key of ["lengthTicks", "endTick", "pausedTick"]) validateNullableNumber(voice[key], `${voicePath}.${key}`);
      validateAudioFade(voice.fade, `${voicePath}.fade`);
    }
  }
  const settings = recordAt(audio.settings, "audio.settings");
  numberAt(settings.masterVolume, "audio.settings.masterVolume");
  for (const [index, entryValue] of arrayAt(settings.trackVolumes, "audio.settings.trackVolumes").entries()) {
    const path = `audio.settings.trackVolumes[${index}]`;
    const entry = recordAt(entryValue, path);
    stringAt(entry.name, `${path}.name`);
    numberAt(entry.volume, `${path}.volume`);
    validateAudioFade(entry.fade, `${path}.fade`);
  }
}
/** Validate engine-owned identifiers when a snapshot carries them. */
function validateEngineShape(value: unknown): void {
  const engine = recordAt(value, "engine");
  for (const key of ["nextBattleId", "pendingEnterThread"] as const) {
    const id = engine[key];
    if (id !== undefined && (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1)) {
      shapeError(`the snapshot's engine.${key} must be a positive whole number`);
    }
  }
}
function validateHostFeaturesShape(value: unknown): void {
  const features = recordAt(value, "features");
  try {
    const normalized = normalizeHostFeatures(features as HostFeatures);
    if (Object.keys(features).length !== 6 || Object.keys(normalized).some((key) => !Object.hasOwn(features, key))) {
      shapeError("the snapshot's features must be a complete normalized record");
    }
  } catch {
    shapeError("the snapshot's features record is invalid");
  }
}

function validateDisplayShape(value: unknown): void {
  const display = recordAt(value, "display");
  if (Object.keys(display).length !== 1) shapeError("the snapshot's display must contain only geometry");
  try {
    normalizeDisplayGeometry(recordAt(display.geometry, "display.geometry") as HostDisplayGeometry);
  } catch {
    shapeError("the snapshot's display.geometry is invalid");
  }
}
function validateShape(record: Record<string, unknown>): void {
  const schema = recordAt(record.schema, "schema");
  for (const key of Object.keys(SCHEMA_VERSIONS)) numberAt(schema[key], `schema.${key}`);
  irNumberAt(schema.ir, "schema.ir");
  for (const key of Object.keys(SCHEMA_VERSIONS)) {
    if (key === "schema" || key === "vm" || key === "rng" || key === "time") continue;
    if (key === "battle") {
      if (record.battle !== null) recordAt(record[key], key);
      continue;
    }
    recordAt(record[key], key);
    if (key === "engine") validateEngineShape(record[key]);
    if (key === "sprites") validateSpritesShape(record[key]);
    if (key === "surfaces") validateSurfacesShape(record[key]);
    if (key === "actors") validateActorsShape(record[key]);
    if (key === "triggers") validateTriggersShape(record[key]);
    if (key === "world") {
      const movement = recordAt(record.world, "world").movement;
      const settings = recordAt(movement, "world.movement");
      for (const field of ["walking", "pushing"] as const) {
        if (settings[field] === null) continue;
        const value = numberAt(settings[field], `world.movement.${field}`);
        if (value !== 0 && value !== 1) shapeError(`the snapshot's world.movement.${field} must be 0, 1 or null`);
      }
    }
    if (key === "audio") validateAudioShape(record[key]);
    if (key === "features") validateHostFeaturesShape(record[key]);
    if (key === "display") validateDisplayShape(record[key]);
  }
  const rng = recordAt(record.rng, "rng");
  for (const key of ["s0", "s1", "s2", "s3"]) numberAt(rng[key], `rng.${key}`);
  numberAt(recordAt(record.time, "time").tick, "time.tick");
  const vm = recordAt(record.vm, "vm");
  const objectClasses = validateVmShape(vm);
  validateEventsShape(record.events, vm, objectClasses);
}

/** Options for a restore beyond the canonical form and diagnostics. */
export type RestoreOptions = {
  /** Refuse an older instruction version instead of restarting the affected threads (recovery). */
  readonly requireCurrentIr?: boolean;
  readonly logicalWidth?: number;
  readonly logicalHeight?: number;
};

/** The whole-number form of an instruction version, or `null` when the text is not one. */
function irNumber(value: unknown): number | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  return Number(value);
}

function irNumberAt(value: unknown, path: string): number {
  const version = irNumber(value);
  if (version === null) return shapeError(`the snapshot's ${path} must be a whole-number string`);
  return version;
}

/**
 * Refuse a save from a newer instruction version. Called on every restore path and
 * by the game-save envelope before its audio projection is read, so a newer save is
 * reported as such whatever else is malformed. A legacy `compiler` field is not
 * checked here: the `schema` migration maps it to `ir` first.
 */
export function refuseNewerIr(value: unknown, path = "schema.ir"): void {
  const version = irNumber(value);
  const current = irNumber(IR_VERSION) ?? 0;
  if (version !== null && version > current) {
    throw new ScriptError("restore.ir-mismatch", `the snapshot's ${path} ${String(value)} is newer than ${IR_VERSION}`);
  }
}

/**
 * The instruction version a legacy `compiler` value maps to: only compiler 2
 * produced the current linear IR. Every other value — compiler 1, or an unknown
 * future compiler — maps to `"0"` ("positions not valid"), which restarts the
 * thread rather than guessing at its saved `ip`.
 */
function irOfCompiler(compiler: string): string {
  return compiler === "2" ? IR_VERSION : "0";
}

/** Migrate the `schema` section: v1 `compiler` becomes v2 `ir` (docs/spec/formats/save-game.md). */
function migrateSchema(schema: Record<string, unknown>): void {
  const version = schema.schema;
  if (typeof version !== "number") shapeError("the snapshot's `schema` has no numeric `schema` version");
  if (version > SCHEMA_VERSIONS.schema) shapeError(`the snapshot's schema version ${String(version)} is newer than supported version ${SCHEMA_VERSIONS.schema}`);
  if (version >= SCHEMA_VERSIONS.schema) return;
  if (version !== 1) shapeError(`the snapshot's schema version ${String(version)} has no migration`);
  schema.ir = irOfCompiler(stringAt(schema.compiler, "schema.compiler"));
  delete schema.compiler;
  schema.schema = SCHEMA_VERSIONS.schema;
}

/**
 * Restart a thread whose saved instruction positions predate the running version.
 * The shape matches `restartThreadFromSource`: one root frame at `ip 0`, no saved
 * locals, operands, wait or pending call, and the current `ir` on the reference so
 * the host compiles the saved source rather than a stale step table.
 */
function restartOutdatedThread(thread: Record<string, unknown>): void {
  const root = Array.isArray(thread.frames) ? thread.frames[0] : undefined;
  if (!isRecord(root) || !isRecord(root.program)) return;
  thread.frames = [{
    program: { ...root.program, ir: IR_VERSION },
    ip: 0,
    locals: {},
    operands: [],
    errorHandler: null,
    autoLocal: false,
  }];
  thread.status = "ready";
  thread.wait = null;
  thread.pending = null;
  thread.detached = [];
  thread.collect = null;
}

type FrameProgram = {
  readonly threadIndex: number;
  readonly path: string;
  readonly ref: Record<string, unknown>;
};

/** Every saved frame's program reference, tolerantly: a malformed thread is a shape error, not this walk's. */
function eachFrameProgram(record: Record<string, unknown>): FrameProgram[] {
  const found: FrameProgram[] = [];
  const vm = record.vm;
  if (!isRecord(vm) || !Array.isArray(vm.threads)) return found;
  vm.threads.forEach((thread, threadIndex) => {
    if (!isRecord(thread) || !Array.isArray(thread.frames)) return;
    thread.frames.forEach((frame, frameIndex) => {
      if (!isRecord(frame) || !isRecord(frame.program)) return;
      found.push({ threadIndex, path: `vm.threads[${threadIndex}].frames[${frameIndex}].program.ir`, ref: frame.program });
    });
  });
  return found;
}

/** Refuse a frame from a newer instruction version before any payload section is migrated or validated. */
export function refuseNewerFrameIr(record: Record<string, unknown>): void {
  const current = irNumber(IR_VERSION) ?? 0;
  for (const frame of eachFrameProgram(record)) {
    const version = irNumber(frame.ref.ir);
    if (version !== null && version > current) {
      throw new ScriptError("restore.ir-mismatch", `the snapshot's ${frame.path} ${String(frame.ref.ir)} is newer than ${IR_VERSION}`);
    }
  }
}

/**
 * Apply the instruction-version rule to every saved thread: an older frame
 * restarts that thread (or, for a recovery candidate, refuses the save). A newer
 * one was already refused before payload validation. Position-free program
 * references — object records and `vm.defOwners` — carry no `ip` and are left for
 * the host to recompile.
 */
function applyIrCompatibility(record: Record<string, unknown>, options: RestoreOptions): void {
  const current = irNumber(IR_VERSION) ?? 0;
  // A recovery candidate is like-for-like: a save-level instruction difference
  // refuses it even when no frame would restart (for example a finished thread).
  const schema = record.schema;
  if (options.requireCurrentIr === true && isRecord(schema) && schema.ir !== IR_VERSION) {
    throw new ScriptError("restore.ir-mismatch", `the snapshot's schema.ir ${String(schema.ir)} differs from ${IR_VERSION}`);
  }
  const outdated = new Set<number>();
  for (const frame of eachFrameProgram(record)) {
    const version = irNumber(frame.ref.ir);
    if (version !== null && version < current) outdated.add(frame.threadIndex);
  }
  const vm = record.vm as Record<string, unknown>;
  for (const index of outdated) {
    const thread = (vm.threads as unknown[])[index];
    if (!isRecord(thread)) continue;
    // A finished thread has no position left to resume; leave it finished.
    if (thread.status === "finished") continue;
    if (options.requireCurrentIr === true) {
      throw new ScriptError("restore.ir-mismatch", `the snapshot's vm.threads[${index}] was saved by an earlier instruction version`);
    }
    restartOutdatedThread(thread);
  }
}
/** Parse and check a snapshot's canonical form (see the file header). */
export function restoreGameState(
  json: string,
  diagnostics: Diagnostic[] = [],
  options: RestoreOptions = {},
): GameState {
  let parsed: unknown;
  try {
    parsed = reviveNonFinite(JSON.parse(json));
  } catch {
    throw new ScriptError("restore.shape", "a snapshot must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ScriptError("restore.shape", "a snapshot must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;

  const schemaValue = record.schema;
  if (!isRecord(schemaValue)) {
    throw new ScriptError("restore.shape", "the snapshot has no `schema` section");
  }
  // The schema migration is the one transform before the newer-version check: a
  // legacy save has `compiler` and no `ir`, and is always older.
  migrateSchema(schemaValue);
  refuseNewerIr(schemaValue.ir);
  refuseNewerFrameIr(record);
  migrateHostSections(record, schemaValue, options.logicalWidth ?? 320, options.logicalHeight ?? 240);
  const schema = schemaValue;
  migrateEvents(record, schema);
  migrateActors(record, schema as Record<string, unknown>);
  validateActorsShape(record.actors);
  migrateBattle(record, schema as Record<string, unknown>);
  migrateMenuSections(record, schema as Record<string, unknown>);
  for (const key of Object.keys(SCHEMA_VERSIONS)) {
    if (!Object.hasOwn(record, key)) {
      throw new ScriptError("restore.shape", `the snapshot is missing the "${key}" section`);
    }
  }
  migrateWorld(record, schema as Record<string, unknown>);

  migrateVm(record, schema as Record<string, unknown>);
  migratePackageInlineLambdaDefs(record.vm, record.events);
  migrateSprites(record, schema as Record<string, unknown>);
  migrateInput(record, schema as Record<string, unknown>);
  rebuildKeyboardActionClaimIndex(record.input as GameState["input"]);
  migrateTriggers(record, schema as Record<string, unknown>);
  migrateUi(record, schema as Record<string, unknown>);
  migrateAudio(record, schema as Record<string, unknown>);
  migrateEngine(record, schema as Record<string, unknown>);
  applyIrCompatibility(record, options);
  // The loaded state now runs the current instruction version: every position is
  // either unchanged or was restarted, and position-free references keep their
  // provenance. A save written from it therefore records the running `ir`.
  schema.ir = IR_VERSION;
  const battleIssues = validateBattleSection(record.battle, record.actors as GameState["actors"]);
  for (const issue of battleIssues) {
    if (issue.recoverable) {
      diagnostics.push({ code: "restore.battle-fighter", file: "battle", line: 0, message: `${issue.path}: ${issue.message}` });
    } else {
      shapeError(`the snapshot's ${issue.path} ${issue.message}`);
    }
  }
  validateShape(record);
  return parsed as GameState;
}
