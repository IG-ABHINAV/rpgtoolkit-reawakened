// The vm section's migration chain (AD-7, AD-23; tickets 3.21 and 3.9). Each
// bump of `SCHEMA_VERSIONS.vm` needs a save fixture from the previous version
// and a restore test over it. v2 (`fixtures/save/v2-vm.json`, no effect log)
// gains `effects: []` and `effectSeq: 0`; v3 (`fixtures/save/v3-vm.json`, a
// sleeping thread with the old wait shape) gains the thread, wait and request
// fields of ticket 3.9; v4 (`fixtures/save/v4-vm.json`) gains only the section
// version for the module fields of ticket 3.8. All end at the current section version.
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canon,
  createAudioSection,
  createGameState,
  createSurface,
  createSurfacesSection,
  awardExperience,
  queueNativeEvent,
  registerEmitter,
  restoreGameSave,
  snapshotGameSave,
  restoreGameState,
  SCHEMA_VERSIONS,
  snapshot,
  type ScriptError,
} from "../src/index.ts";
import { applyInputEvent, processGamepadEvents } from "../src/input/input.ts";

function errorOf(run: () => unknown): { code: string; message: string } {
  try {
    run();
  } catch (error) {
    const scriptError = error as ScriptError;
    equal(typeof scriptError.code, "string");
    return { code: scriptError.code, message: scriptError.message };
  }
  throw new Error("expected the call to throw");
}

function fixtureText(name: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "save", name), "utf8");
}

test("a v2 save (no effect log) restores cleanly as the current vm schema", () => {
  const restored = restoreGameState(fixtureText("v2-vm.json"));

  equal(SCHEMA_VERSIONS.vm, 7);
  equal(restored.schema.vm, SCHEMA_VERSIONS.vm);
  deepEqual(restored.vm.effects, []);
  equal(restored.vm.effectSeq, 0);
  deepEqual(restored.vm.files, []);
  equal(restored.vm.block, null);
  equal(restored.vm.requestSeq, 0);
  // The migrated state is a valid GameState: it canonicalises and round-trips.
  equal(canon(restoreGameState(snapshot(restored))), canon(restored));
});

test("a v3 save restores with its thread and sleep wait migrated to the v4 shape", () => {
  const restored = restoreGameState(fixtureText("v3-vm.json"));

  equal(restored.schema.vm, SCHEMA_VERSIONS.vm);
  equal(restored.vm.block, null);
  equal(restored.vm.requestSeq, 0);
  const thread = restored.vm.threads[0]!;
  deepEqual(thread.queue, []);
  equal(thread.pending, null);
  deepEqual(thread.detached, []);
  equal(thread.collect, null);
  // The v3 sleep was the blocking `sleep(ticks)` command: global, and it resumes its call.
  deepEqual(thread.wait, { kind: "sleep", until: 5, global: true, resumesCall: true });
  equal(canon(restoreGameState(snapshot(restored))), canon(restored));
});

test("a v4 save (no module fields) restores unchanged apart from the v7 section version", () => {
  const restored = restoreGameState(fixtureText("v4-vm.json"));

  equal(SCHEMA_VERSIONS.vm, 7);
  equal(restored.schema.vm, SCHEMA_VERSIONS.vm);
  const frame = restored.vm.threads[0]!.frames[0]!;
  // The module fields are optional and stay absent: the ref is the v4 ref.
  deepEqual(frame.program, { ir: "1", kind: "inline", text: "sleep(5)\nend()\n" });
  deepEqual(restored.vm.redirects, []);
  deepEqual(restored.vm.threads[0]!.wait, { kind: "sleep", until: 5, global: true, resumesCall: true });
  equal(canon(restoreGameState(snapshot(restored))), canon(restored));
});

test("vm schema 6 saves, out of and mid battle, migrate to vm 7 changing only the schema version", () => {
  for (const [previous, current] of [["vm6-battle-out.json", "engine1-battle-v2-out.json"], ["vm6-battle-mid.json", "engine1-battle-v2-mid.json"]] as const) {
    const saved = JSON.parse(fixtureText(previous)) as { schema: { vm: number } };
    equal(saved.schema.vm, 6, `${previous} is a real vm-6 save`);
    const restored = restoreGameState(fixtureText(previous));
    equal(restored.schema.vm, 7);
    equal(snapshot(restored), snapshot(restoreGameState(fixtureText(current))), `${previous} restores to its vm-7 counterpart`);
    equal(snapshot(restoreGameState(snapshot(restored))), snapshot(restored), "migration is idempotent");
  }
});

test("schema-v1 menu, party and inventory sections migrate without moving saved continuation state", () => {
  const restored = restoreGameState(fixtureText("menu-v1.json"));
  const fresh = createGameState({ seed: 0 });

  equal(restored.schema.menu, SCHEMA_VERSIONS.menu);
  equal(restored.schema.party, SCHEMA_VERSIONS.party);
  equal(restored.schema.inventory, SCHEMA_VERSIONS.inventory);
  deepEqual(restored.menu, fresh.menu);
  deepEqual(restored.party, fresh.party);
  deepEqual(restored.inventory, fresh.inventory);
  equal(restored.vm.globals.count, 2);
  equal(restored.vm.threads[0]!.frames[0]!.ip, 2);
  deepEqual(restored.vm.threads[0]!.wait, { global: true, kind: "sleep", resumesCall: true, until: 5 });
  deepEqual(restored.rng, { s0: 1684164658, s1: 3653269916, s2: 2939563536, s3: 2141751570 });
  equal(restored.time.tick, 3);
  equal(canon(restoreGameState(snapshot(restored))), canon(restored));
});

test("party schema 2 migrates with its steps intact and a zero distance remainder", () => {
  const saved = JSON.parse(fixtureText("party-v2.json")) as { schema: { party: number }; party: { steps: number } };
  equal(saved.schema.party, 2, "party-v2.json is a real party-schema-2 save");
  saved.party.steps = 7;
  const restored = restoreGameState(JSON.stringify(saved));
  equal(restored.schema.party, 3);
  equal(restored.party.steps, 7, "the completed step count is carried over");
  equal(restored.party.stepRemainder, 0, "a version-2 save had no sub-tile remainder accumulated");
  equal(snapshot(restoreGameState(snapshot(restored))), snapshot(restored));
});


test("snapshot restoration rejects malformed or dimension-mismatched surface base64", () => {
  const snapshotText = snapshot(createGameState({ seed: 0 }));
  for (const b64 of ["!!!!!!!!", "AAAAAAAA"]) {
    const malformed = JSON.parse(snapshotText) as Record<string, unknown>;
    malformed.surfaces = {
      nextId: 1,
      entries: { "0": { id: 0, rev: 0, bitmap: { t: "rgba", w: 1, h: 1, b64 } } },
      slots: {},
      colours: {},
    };
    equal(errorOf(() => restoreGameState(JSON.stringify(malformed))).code, "restore.shape");
  }
});

test("producer-created zero-area surfaces with unsafe integer dimensions survive snapshot restore", () => {
  const state = createGameState({ seed: 0 });
  state.surfaces = createSurfacesSection();
  const width = 2 ** 53;
  const id = createSurface(state.surfaces, width, 0);

  const restored = restoreGameState(snapshot(state));
  const surface = restored.surfaces.entries[String(id)]!;
  equal(surface.bitmap.w, width);
  equal(surface.bitmap.h, 0);
  equal(surface.bitmap.b64, "");
});

test("snapshot restoration accepts decoder-compatible noncanonical surface base64", () => {
  const state = createGameState({ seed: 0 });
  state.surfaces = createSurfacesSection();
  const id = createSurface(state.surfaces, 1, 1);
  const surface = state.surfaces.entries[String(id)]!;
  surface.bitmap = { ...surface.bitmap, b64: "AAAAAB==" };

  const restored = restoreGameState(snapshot(state));
  equal(restored.surfaces.entries[String(id)]!.bitmap.b64, "AAAAAB==");
});

test("a schema-v1 actor save preserves state and marks legacy precedence unresolved", () => {
  const restored = restoreGameState(fixtureText("actors-v1.json"));

  equal(SCHEMA_VERSIONS.actors, 2);
  equal(restored.schema.actors, SCHEMA_VERSIONS.actors);
  const actor = restored.actors.actors[0]!;
  equal(actor.stats.level, 2);
  equal(actor.stats.experience, 24);
  equal(actor.progression.nextRequirement, 15);
  equal(actor.progression.remainingExperience, 1);
  equal(actor.progression.legacyLevelUp, null);
  throws(() => awardExperience(restored.actors, actor.id, 1));
  equal(canon(restoreGameState(snapshot(restored))), canon(restored));
});
test("actor migration accepts an exact MAX_SAFE threshold product and rejects overflow", () => {
  const exact = JSON.parse(fixtureText("actors-v1.json")) as {
    actors: { actors: Array<{ progression: Record<string, unknown> }> };
  };
  const exactPolicy = exact.actors.actors[0]!.progression;
  exactPolicy.levelType = 1;
  exactPolicy.experienceIncrease = Number.MAX_SAFE_INTEGER;
  exactPolicy.levelUpType = 0;
  const restored = restoreGameState(JSON.stringify(exact));
  equal(restored.actors.actors[0]!.progression.nextRequirement, 90071992547410);

  const unsafe = JSON.parse(fixtureText("actors-v1.json")) as {
    actors: { actors: Array<{ progression: Record<string, unknown> }> };
  };
  const unsafePolicy = unsafe.actors.actors[0]!.progression;
  unsafePolicy.levelType = 2;
  unsafePolicy.experienceIncrease = Number.MAX_SAFE_INTEGER;
  unsafePolicy.levelUpType = 0;
  equal(errorOf(() => restoreGameState(JSON.stringify(unsafe))).code, "restore.shape");
});
test("restore refuses a future actor schema version", () => {
  const json = JSON.parse(snapshot(createGameState({ seed: 0 }))) as {
    schema: { actors: number };
  };
  json.schema.actors = SCHEMA_VERSIONS.actors + 1;
  equal(errorOf(() => restoreGameState(JSON.stringify(json))).code, "restore.shape");
});

test("migration is idempotent and leaves a current-version save untouched", () => {
  const current = createGameState({ seed: 0 });
  const json = snapshot(current);
  const restored = restoreGameState(json);
  equal(canon(restored), json);
  deepEqual(restored.vm.effects, []);
  equal(restored.vm.effectSeq, 0);
});

test("restore refuses a snapshot whose schema has no numeric vm version", () => {
  const json = JSON.parse(snapshot(createGameState({ seed: 0 }))) as {
    schema: { vm?: unknown };
  };
  json.schema.vm = "two";
  equal(errorOf(() => restoreGameState(JSON.stringify(json))).code, "restore.shape");
});

test("restore refuses a snapshot whose vm section is not an object", () => {
  const json = JSON.parse(snapshot(createGameState({ seed: 0 }))) as {
    schema: { vm: unknown };
    vm: unknown;
  };
  json.schema.vm = 2;
  json.vm = 7;
  equal(errorOf(() => restoreGameState(JSON.stringify(json))).code, "restore.shape");
});

// The audio section (ticket 6.6; docs/spec/engine/audio-media.md#audio-state): schema 1 was the empty placeholder
// every committed save fixture carries; schema 2 is the track-and-voice section.
test("a save from audio schema 1 (the empty placeholder) restores as a fresh schema-2 audio section", () => {
  for (const name of ["v2-vm.json", "v3-vm.json", "v4-vm.json", "compiler-1-snapshot.json"]) {
    const raw = JSON.parse(fixtureText(name)) as { audio: unknown; schema: { audio: number; compiler: string } };
    equal(SCHEMA_VERSIONS.audio, 2);
    equal(raw.schema.audio, 1, `${name} is a schema 1 save`);
    deepEqual(raw.audio, {}, `${name} carries the empty placeholder`);
    const restored = restoreGameState(fixtureText(name));
    equal(restored.schema.audio, SCHEMA_VERSIONS.audio, `${name} applies the schema-1 audio migration`);
    deepEqual(restored.audio, createAudioSection());
    equal(restored.schema.ui, SCHEMA_VERSIONS.ui, `${name} also applies the author UI migration`);
    deepEqual(restored.ui.authorMarginCommands, [], `${name} receives the empty current author-margin list`);
    equal(canon(restoreGameState(snapshot(restored))), canon(restored));
  }
});

/** A snapshot read back as loose JSON so a test can break one field of its audio section. */
type RawAudioSnapshot = {
  audio: {
    schema: number;
    cueId: number;
    tracks: { voices: Record<string, unknown>[]; state: string; voiceCount: number }[];
    settings: { masterVolume: unknown; trackVolumes: unknown[] };
  };
};

test("restore refuses an audio section whose shape is wrong, naming the place", () => {
  const refused = (edit: (json: RawAudioSnapshot) => void, where: string): void => {
    const json = JSON.parse(snapshot(createGameState({ seed: 0 }))) as RawAudioSnapshot;
    edit(json);
    const error = errorOf(() => restoreGameState(JSON.stringify(json)));
    equal(error.code, "restore.shape");
    ok(error.message.includes(where), `${where}: ${error.message}`);
  };
  refused((json) => { json.audio.schema = 1; }, "audio.schema");
  refused((json) => { json.audio.cueId = 0; }, "audio.cueId");
  refused((json) => { json.audio.tracks[0]!.state = "buzzing"; }, "audio.tracks[0].state");
  refused((json) => { json.audio.tracks[1]!.voiceCount = 0; }, "audio.tracks[1].voiceCount");
  refused((json) => { json.audio.tracks[0]!.voices.push({ index: 0, state: "playing", file: "media/a.wav", cueId: 1, priority: 0, volume: 100, startTick: 0, positionTicks: 0, lengthTicks: null, endTick: null, pausedTick: null, fade: null }); }, "audio.tracks[0].voices[0].loop");
  refused((json) => { json.audio.settings.masterVolume = "loud"; }, "audio.settings.masterVolume");
  refused((json) => { json.audio.settings.trackVolumes.push({ name: "music", volume: 5, fade: { fromVolume: 1 } }); }, "audio.settings.trackVolumes[0].fade");
});

// The events section (entry 19.10; EMIT-15): it appeared at schema version 1, so every committed save fixture
// lacks both the section and `schema.events`. Such a save loads with the empty section and nothing else moves.
test("a save from before the events section restores with it empty and no other section moved", () => {
  equal(SCHEMA_VERSIONS.events, 1);
  for (const name of ["v2-vm.json", "v3-vm.json", "v4-vm.json"]) {
    const raw = JSON.parse(fixtureText(name)) as { events?: unknown; schema: { events?: unknown; compiler: string } };
    equal(raw.events, undefined, `${name} predates the section`);
    equal(raw.schema.events, undefined, `${name} predates the section`);
    const restored = restoreGameState(fixtureText(name));
    equal(restored.schema.events, SCHEMA_VERSIONS.events);
    deepEqual(restored.events, { nextListener: 1, listeners: [], queue: [], dispatch: null });
    equal(canon(restoreGameState(snapshot(restored))), canon(restored));
  }
});

test("restore refuses an events section that is not whole", () => {
  const json = JSON.parse(snapshot(createGameState({ seed: 0 }))) as { events: Record<string, unknown> };
  for (const [change, place] of [
    [(events: Record<string, unknown>) => { events.nextListener = 0; }, "events.nextListener"],
    [(events: Record<string, unknown>) => { events.listeners = {}; }, "events.listeners"],
    [(events: Record<string, unknown>) => { events.queue = "none"; }, "events.queue"],
    [(events: Record<string, unknown>) => { events.dispatch = 3; }, "events.dispatch"],
    [(events: Record<string, unknown>) => { events.retiring = "board:old"; }, "events.retiring"],
    [(events: Record<string, unknown>) => { events.retiring = ["board:old"]; }, "events.retiring"],
  ] as const) {
    const copy = JSON.parse(JSON.stringify(json)) as { events: Record<string, unknown> };
    change(copy.events);
    const failure = errorOf(() => restoreGameState(JSON.stringify(copy)));
    equal(failure.code, "restore.shape");
    ok(failure.message.includes(place), `${place}: ${failure.message}`);
  }
});

test("restore refuses malformed native event detail metadata", () => {
  const state = createGameState({ seed: 0 });
  registerEmitter(state.vm, state.events, "game");
  const event = queueNativeEvent(state.vm, state.events, "game", "statusChanged", { expired: false, source: null });
  const json = JSON.parse(snapshot(state)) as { events: { nativeDetails: Record<string, unknown> } };
  json.events.nativeDetails[String(event)] = null;
  const failure = errorOf(() => restoreGameState(JSON.stringify(json)));
  equal(failure.code, "restore.shape");
  ok(failure.message.includes(`events.nativeDetails.${event}`), failure.message);
});

test("game saves persist only playback projection and restore with current audio configuration", () => {
  const state = createGameState({ seed: 7 });
  state.time.tick = 17;
  state.audio.settings.masterVolume = 42;
  state.audio.tracks[0]!.voiceCount = 2;
  const json = snapshotGameSave(state);
  const saved = JSON.parse(json) as { readonly audio: { readonly [key: string]: unknown; readonly tracks: readonly Record<string, unknown>[] } };
  deepEqual(Object.keys(saved.audio).sort(), ["cueId", "tick", "tracks"]);
  ok(!Object.hasOwn(saved.audio.tracks[0]!, "voiceCount"));

  const current = createGameState({ seed: 9 });
  current.audio.settings.masterVolume = 73;
  current.audio.tracks[0]!.voiceCount = 3;
  const restored = restoreGameSave(json, current.audio);
  equal(restored.state.time.tick, 17);
  equal(restored.audio.tick, 17);
  equal(restored.state.audio.settings.masterVolume, 73);
  equal(restored.state.audio.tracks[0]!.voiceCount, 3);
  deepEqual(restored.state.audio.tracks[0]!.voices, []);

  const mismatch = JSON.parse(json) as { audio: { tick: number } };
  mismatch.audio.tick += 1;
  throws(() => restoreGameSave(JSON.stringify(mismatch), current.audio), /audio\.tick must match time\.tick/);
});
test("input migration reconciles legacy held claims and advances past queued pointer gesture ids", () => {
  const original = createGameState({ seed: 9 });
  const raw = JSON.parse(snapshot(original)) as {
    schema: { input: number };
    input: Record<string, unknown>;
  };
  raw.schema.input = 5;
  raw.input.version = 5;
  raw.input.registeredActions = [];
  raw.input.gamepads = { "0": { connected: true, mask: 8 } };
  raw.input.actions = { right: true };
  raw.input.keyboardActions = { right: true };
  raw.input.keyboardActionSources = {};
  raw.input.held = { RIGHT: true, ArrowRight: true };
  raw.input.bindings = { keys: { ArrowRight: "right" } };
  raw.input.pendingClicks = [{ gestureId: 4, x: 8, y: 9 }];
  raw.input.pendingPointerUps = [{ gestureId: 5, x: 10, y: 11 }];
  delete raw.input.actionOrder;
  delete raw.input.pendingKeySequences;
  delete raw.input.nextPointerGestureId;
  delete raw.input.pointerGestureId;
  const restored = restoreGameState(JSON.stringify(raw));
  equal(restored.input.gamepads["0"]?.mask, 1 << 15, "legacy schema 5 logical right becomes W3C physical right");
  deepEqual(restored.input.keyboardActionSources.right, { "key:ArrowRight": true }, "legacy keyboard hold is linked to its physical key without a duplicate raw-name claim");
  equal(restored.input.nextPointerGestureId, 6, "the next gesture follows all queued legacy pointer records");
  applyInputEvent(restored.input, { kind: "pointer", x: 20, y: 21, buttons: 1 });
  equal(restored.input.pendingClicks.at(-1)?.gestureId, 6);
  applyInputEvent(restored.input, { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: false });
  equal(restored.input.actions.right, true, "gamepad still owns right after keyboard release");
  equal(restored.input.keyboardActions.right, false, "the physical key release clears the migrated keyboard claim");
  applyInputEvent(restored.input, { kind: "gamepad", device: 0, connected: false, axes: { x: 0, y: 0 }, buttons: 0 });
  processGamepadEvents(restored.input);
  equal(restored.input.actions.right, false, "disconnect releases migrated physical gamepad state");
});
test("schema 4 letter-name bindings release a restored physical claim across keyboard layouts", () => {
  const original = createGameState({ seed: 9 });
  const raw = JSON.parse(snapshot(original)) as { schema: { input: number }; input: Record<string, unknown> };
  raw.schema.input = 4;
  raw.input.version = 4;
  raw.input.held = { A: true, KeyA: true };
  raw.input.bindings = { keys: { A: "right" } };
  raw.input.keyboardActions = { right: true };
  raw.input.actions = { right: true };
  delete raw.input.registeredActions;
  delete raw.input.keyboardActionSources;
  delete raw.input.semanticActionSources;
  delete raw.input.actionRegistry;
  delete raw.input.actionOrder;
  delete raw.input.controlActions;
  delete raw.input.actionPadMasks;

  const restored = restoreGameState(JSON.stringify(raw));
  deepEqual(restored.input.keyboardActionSources.right, { "key:KeyA": true });
  applyInputEvent(restored.input, { kind: "key", name: "Q", code: "KeyA", char: "q", down: false });
  equal(restored.input.keyboardActions.right, false);
  equal(restored.input.actions.right, false, "the physical code clears its restored claim even when the logical key name changed");
});

test("schema 4 numeric binding restores the saved Numpad key, not a guessed Digit key", () => {
  const original = createGameState({ seed: 9 });
  const raw = JSON.parse(snapshot(original)) as { schema: { input: number }; input: Record<string, unknown> };
  raw.schema.input = 4;
  raw.input.version = 4;
  raw.input.held = { "1": true, Numpad1: true };
  raw.input.bindings = { keys: { "1": "right" } };
  raw.input.keyboardActions = { right: true };
  raw.input.actions = { right: true };
  delete raw.input.registeredActions;
  delete raw.input.keyboardActionSources;
  delete raw.input.semanticActionSources;
  delete raw.input.actionRegistry;
  delete raw.input.actionOrder;
  delete raw.input.controlActions;
  delete raw.input.actionPadMasks;

  const restored = restoreGameState(JSON.stringify(raw));
  deepEqual(restored.input.keyboardActionSources.right, { "key:Numpad1": true });
  applyInputEvent(restored.input, { kind: "key", name: "1", code: "Numpad1", char: "1", down: false });
  equal(restored.input.keyboardActions.right, false);
  equal(restored.input.actions.right, false, "the numpad key-up releases the migrated claim");
});
test("schema 4 NumpadEnter migration does not invent an Enter claim", () => {
  const original = createGameState({ seed: 9 });
  const raw = JSON.parse(snapshot(original)) as { schema: { input: number }; input: Record<string, unknown> };
  raw.schema.input = 4;
  raw.input.version = 4;
  raw.input.held = { ENTER: true, NumpadEnter: true };
  raw.input.bindings = { keys: { NumpadEnter: "confirm" } };
  raw.input.keyboardActions = { confirm: true };
  raw.input.actions = { confirm: true };
  delete raw.input.registeredActions;
  delete raw.input.keyboardActionSources;
  delete raw.input.semanticActionSources;
  delete raw.input.actionRegistry;
  delete raw.input.actionOrder;
  delete raw.input.controlActions;
  delete raw.input.actionPadMasks;

  const restored = restoreGameState(JSON.stringify(raw));
  deepEqual(restored.input.keyboardActionSources.confirm, { "key:NumpadEnter": true });
  applyInputEvent(restored.input, { kind: "key", name: "ENTER", code: "NumpadEnter", char: null, down: false });
  equal(restored.input.keyboardActions.confirm, false);
  equal(restored.input.actions.confirm, false, "the recorded numpad key-up clears its sole claim");
});


test("schema 6 migration preserves W3C pad claims and the active pointer gesture", () => {
  const original = createGameState({ seed: 9 });
  const raw = JSON.parse(snapshot(original)) as { schema: { input: number }; input: Record<string, unknown> };
  raw.schema.input = 6;
  raw.input.version = 6;
  raw.input.registeredActions = [{
    name: "game.pad12",
    label: "Pad 12",
    icon: null,
    group: null,
    controls: ["pad:12"],
    locked: false,
    hidden: false,
  }];
  raw.input.gamepads = { "0": { connected: true, mask: 1 << 12 } };
  raw.input.actions = { "game.pad12": true };
  raw.input.pointer = { ...(raw.input.pointer as Record<string, unknown>), buttons: 1 };
  raw.input.pointerGestureId = 7;
  raw.input.pendingClicks = [{ gestureId: 7, x: 8, y: 9 }];
  delete raw.input.nextPointerGestureId;
  const restored = restoreGameState(JSON.stringify(raw));
  equal(restored.input.gamepads["0"]?.mask, 1 << 12, "schema 6 already uses physical W3C bits");
  equal(restored.input.pointerGestureId, 7);
  equal(restored.input.nextPointerGestureId, 8, "the next gesture does not collide with the restored active gesture");
  applyInputEvent(restored.input, { kind: "pointer", x: 8, y: 9, buttons: 0 });
  equal(restored.input.pendingPointerUps.at(-1)?.gestureId, 7, "release retains the saved gesture id");
  applyInputEvent(restored.input, { kind: "pointer", x: 20, y: 21, buttons: 1 });
  equal(restored.input.pendingClicks.at(-1)?.gestureId, 8, "the next press receives a distinct id");
  restored.input.actions["game.pad12"] = true;
  applyInputEvent(restored.input, { kind: "gamepad", device: 0, connected: false, axes: { x: 0, y: 0 }, buttons: 0 });
  processGamepadEvents(restored.input);
  equal(restored.input.actions["game.pad12"], false, "disconnect releases a migrated physical button-12 action claim");
});

test("game saves from prior audio schema migrate to current schema with empty projection", () => {
  const state = createGameState({ seed: 7 });
  state.time.tick = 10;
  const raw = JSON.parse(snapshotGameSave(state)) as {
    schema: { audio: number };
    audio: Record<string, unknown>;
  };
  raw.schema.audio = 1;
  raw.audio = {};
  const current = createGameState({ seed: 9 });
  const restored = restoreGameSave(JSON.stringify(raw), current.audio);
  equal(restored.state.schema.audio, SCHEMA_VERSIONS.audio);
  equal(restored.audio.tracks.length, 0);
  equal(restored.audio.tick, 10);
  deepEqual(restored.state.audio.tracks, current.audio.tracks);
});

test("schema 7 input migration advances both section and root schema versions with an empty modal queue", () => {
  const original = createGameState({ seed: 9 });
  const raw = JSON.parse(snapshot(original)) as { schema: { input: number }; input: Record<string, unknown> };
  raw.schema.input = 7;
  raw.input.version = 7;
  delete raw.input.modalActions;
  const restored = restoreGameState(JSON.stringify(raw));
  equal(restored.schema.input, SCHEMA_VERSIONS.input);
  equal(restored.input.version, SCHEMA_VERSIONS.input);
  deepEqual(restored.input.modalActions, []);
});

test("schema 7 UI and schema 8 input migration assign modal identity and empty scoped-action queue", () => {
  const original = createGameState({ seed: 9 });
  const raw = JSON.parse(snapshot(original)) as {
    schema: { ui: number; input: number };
    ui: Record<string, unknown>;
    input: Record<string, unknown>;
  };
  raw.schema.ui = 7;
  raw.ui.version = 7;
  raw.ui.modal = {
    kind: "msgbox",
    text: "legacy modal",
    title: "",
    style: 0,
    textColor: { r: 255, g: 255, b: 255 },
    background: { r: 0, g: 0, b: 0 },
    graphic: "",
    selected: 0,
    result: null,
  };
  raw.schema.input = 8;
  raw.input.version = 8;
  delete raw.input.modalActions;

  const restored = restoreGameState(JSON.stringify(raw));
  equal(restored.schema.ui, SCHEMA_VERSIONS.ui);
  equal(restored.ui.modal?.modalId, 1);
  equal(restored.ui.nextModalId, 2);
  equal(restored.schema.input, SCHEMA_VERSIONS.input);
  deepEqual(restored.input.modalActions, []);

  restored.ui.modal = { ...restored.ui.modal!, modalId: 7 };
  restored.ui.nextModalId = 8;
  const roundTripped = restoreGameState(snapshot(restored));
  equal(roundTripped.ui.modal?.modalId, 7, "current saves preserve modal ownership identity");
  equal(roundTripped.ui.nextModalId, 8);
});

test("UI schema 8 migration preserves the pending result marker and author modal claims", () => {
  const state = createGameState({ seed: 9 });
  const raw = JSON.parse(snapshot(state)) as {
    schema: { ui: number };
    ui: Record<string, unknown>;
  };
  raw.schema.ui = 8;
  raw.ui.version = 8;
  raw.ui.surfaceResultsPending = true;
  raw.ui.nextModalId = 6;
  raw.ui.modal = {
    modalId: 5,
    kind: "msgbox",
    text: "restored modal",
    title: "",
    style: 0,
    textColor: { r: 255, g: 255, b: 255 },
    background: { r: 0, g: 0, b: 0 },
    graphic: "",
    selected: 0,
    result: null,
  };
  raw.ui.surfacePointerClaim = {
    owner: 7,
    surfaceId: "title",
    itemId: "play",
    index: 0,
    action: "confirm",
    inputSeq: 41,
    cancelled: true,
  };

  const restored = restoreGameState(JSON.stringify(raw));
  equal(restored.schema.ui, 9);
  equal(restored.ui.surfaceResultsPending, true);
  equal(restored.ui.modal?.modalId, 5);
  equal(restored.ui.nextModalId, 6);
  equal(restored.ui.surfacePointerClaim?.cancelled, true);

  const schema8BeforePendingMarker = JSON.parse(snapshot(state)) as {
    schema: { ui: number };
    ui: Record<string, unknown>;
  };
  schema8BeforePendingMarker.schema.ui = 8;
  schema8BeforePendingMarker.ui.version = 8;
  delete schema8BeforePendingMarker.ui.surfaceResultsPending;
  const migratedOld8 = restoreGameState(JSON.stringify(schema8BeforePendingMarker));
  equal(migratedOld8.schema.ui, 9);
  equal(migratedOld8.ui.surfaceResultsPending, false);
});

test("engine-v1 saves retain continuation while readiness migrates as unknown", () => {
  const previous = fixtureText("engine1-battle-v2-mid.json");
  const raw = JSON.parse(previous) as { schema: { engine: number }; engine: Record<string, unknown>; vm: unknown };
  equal(raw.schema.engine, 1);
  const restored = restoreGameState(previous);
  equal(restored.schema.engine, SCHEMA_VERSIONS.engine);
  equal(restored.engine.cacheKeys, null);
  deepEqual(restored.vm, raw.vm, "migration preserves saved instruction positions, stacks and waits");
  equal(snapshot(restoreGameState(snapshot(restored))), snapshot(restored));
});

test("restore refuses malformed shared readiness before exposing the saved continuation", () => {
  for (const cacheKeys of [
    undefined, {}, "bitmap/red.png", [1], [null], [""],
    ["Bitmap/red.png"], ["bitmap\\red.png"],
    ["bitmap/red.png", "bitmap/red.png"], ["misc/spin.anm", "bitmap/red.png"],
  ]) {
    const state = createGameState({ seed: 5 });
    const raw = JSON.parse(snapshot(state)) as { engine: Record<string, unknown> };
    if (cacheKeys === undefined) delete raw.engine.cacheKeys;
    else raw.engine.cacheKeys = cacheKeys;
    const error = errorOf(() => restoreGameState(JSON.stringify(raw)));
    equal(error.code, "restore.shape");
    ok(error.message.includes("engine.cacheKeys"));
  }
});
