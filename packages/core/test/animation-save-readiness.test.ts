// Real Save/Load continuation, not hand-edited animation state (#1340).
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder, TextEncoder } from "node:util";
import {
  assetKey, createAssetIndex, createEmptyBoard, createEmptyMainFile, createEngine,
  fnv1a64, IR_VERSION, PACKAGE_ROOT, startThread, writeAnimation, writeBoard, writeMainFile,
  SINGLE_TILE_MAGIC, writeSingleTile, writeTileset,
  type AssetKey, type AudioCue, type Engine, type GameState, type InputRecord, type TickReport,
} from "../src/index.ts";
import { encodePng } from "./battle-ui-rig.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
const main = unwrap(writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd" }));
const board = unwrap(writeBoard(createEmptyBoard()));
const red = encodePng(2, 2, new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]));
const blue = encodePng(2, 2, new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]));
const font = new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../media/fonts/tkr-8x8.fnt")));
function animation(sound = ""): Uint8Array {
  return unwrap(writeAnimation({
    magic: "RPGTLKIT ANIM", major: 2, minor: 3, width: 2, height: 2,
    frames: ["red.png", "blue.png"].map((image) => ({ image, transparent: { r: 255, g: 0, b: 255 }, sound })),
    delay: 1 / 60, residue: new Uint8Array(),
  }));
}
const warmPictures = 'createcanvas(2,2,c)\nsetimage("red.png",0,0,2,2,c)\nsetimage("blue.png",0,0,2,2,c)\n';
const sleep = "threadSleep(getThreadId(),120)\nend()\n";
type BlobStore = { bytes: Uint8Array | null };
type Host = {
  readonly engine: Engine;
  readonly files: Map<AssetKey, Uint8Array>;
  readonly requests: { readonly key: string; readonly id: number }[];
  readonly diagnostics: TickReport["diagnostics"][number][];
  readonly cues: AudioCue[];
  readonly store: BlobStore;
  readonly state: GameState;
  readonly loads: number;
  step(): TickReport;
};
function host(store: BlobStore = { bytes: null }, startup = "end()", extras: Readonly<Record<string, Uint8Array>> = {}): Host {
  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), main], [assetKey("boards/start.brd"), board],
    [assetKey("prg/start.prg"), encoder.encode(startup)], [assetKey("misc/spin.anm"), animation()],
    [assetKey("bitmap/red.png"), red], [assetKey("bitmap/blue.png"), blue],
    ...Object.entries(extras).map(([key, bytes]) => [assetKey(key), bytes] as const),
  ]);
  let current: GameState | null = null;
  let loads = 0;
  const engine = createEngine({
    seed: 7, assetIndex: createAssetIndex([...files.keys()]), assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam", gameIdentity: "animation-save-readiness", width: 8, height: 8, maxTicks: 200,
    include: { shading: true, images: true, sprites: true },
    bundled: new Map([[assetKey("media/fonts/tkr-8x8.fnt"), font]]),
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    phaseRegistrations: [{ phase: "events", run: (state) => { current = state; } }],
  });
  const requests: Host["requests"] = [];
  const diagnostics: Host["diagnostics"] = [];
  const cues: AudioCue[] = [];
  let replies: InputRecord[] = [];
  return {
    engine, files, requests, diagnostics, cues, store,
    get state() { if (current === null) throw new Error("no simulation tick has run"); return current; },
    get loads() { return loads; },
    step() {
      const report = engine.advance(1, replies);
      replies = [];
      diagnostics.push(...report.diagnostics);
      cues.push(...report.audioCues);
      for (const request of report.requests) {
        if (request.kind === "asset") {
          requests.push({ key: request.key, id: request.reqId });
          replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: files.get(request.key) ?? null } });
        } else if (request.kind === "saveBlob") {
          store.bytes = new Uint8Array(request.bytes);
          replies.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } });
        } else if (request.kind === "loadBlob") {
          loads += 1;
          replies.push({ tick: report.tickAfter, event: { kind: "blob.loaded", reqId: request.reqId, bytes: store.bytes } });
        }
      }
      return report;
    },
  };
}
function until(game: Host, condition: (report: TickReport) => boolean): void {
  for (let attempt = 0; attempt < 100; attempt += 1) if (condition(game.step())) return;
  throw new Error(`scenario did not finish: ${JSON.stringify({ diagnostics: game.diagnostics, boot: game.state.engine.boot, globals: game.state.vm.globals, threads: game.state.vm.threads.map(({ id, status, wait }) => ({ id, status, wait })) })}`);
}
function run(game: Host, program: string, kind: "board" | "blocking" = "board"): void {
  startThread(game.state.vm, { ref: { kind: "inline", text: program, ir: IR_VERSION }, kind, owner: "script" });
}
function save(program: string, extras: Readonly<Record<string, Uint8Array>> = {}, kind: "board" | "blocking" = "board"): { game: Host; bytes: Uint8Array; saved: GameState } {
  const game = host({ bytes: null }, "end()", extras);
  until(game, (report) => report.ticksRun > 0 && game.state.engine.boot?.stage === "running");
  run(game, program, kind);
  until(game, () => game.store.bytes !== null);
  ok(game.store.bytes !== null);
  const bytes = game.store.bytes;
  return { game, bytes, saved: JSON.parse(decoder.decode(bytes)) as GameState };
}
function atTick(game: Host, tick: number): void {
  until(game, (report) => report.tickAfter >= tick);
  equal(game.state.time.tick, tick, "comparison observes the exact simulation tick");
}
function pixels(game: Host): string {
  const frame = game.engine.surfacePixels(0 as never, game.state.surfaces.entries["0"]!.rev);
  ok(frame);
  return fnv1a64(frame.rgba);
}

for (const sourceWarm of [false, true]) for (const destinationWarm of [false, true]) {
  test(`unloaded Save continues identically with source ${sourceWarm ? "warm" : "cold"} and destination ${destinationWarm ? "warm" : "cold"}`, () => {
    const program = `${sourceWarm ? warmPictures : ""}id=pinnedanimation("spin.anm",0,0,1)\nSave("slot")\nid2=pinnedanimation("spin.anm",4,0,1)\ncontinued=42\n${sleep}`;
    const source = save(program);
    equal(source.saved.fx.animations[0]?.loaded, false, "save captures preparation, not an already loaded animation");
    const restored = host({ bytes: source.bytes }, `${destinationWarm ? warmPictures : ""}load("slot")\nend()`);
    const observed = new Set<string>();
    atTick(source.game, 10);
    atTick(restored, 10);
    for (let tick = 10; tick < 14; tick += 1) {
      equal(restored.state.vm.globals.continued, 42);
      deepEqual(restored.state.fx.animations, source.game.state.fx.animations, "both shared consumers follow uninterrupted playback");
      equal(restored.state.fx.animations.length, 2);
      const rendered = pixels(restored);
      equal(rendered, pixels(source.game));
      observed.add(rendered);
      equal(restored.state.engine.nextRequestId, source.game.state.engine.nextRequestId, "rehydration preserves future logical request IDs");
      if (tick < 13) { atTick(source.game, tick + 1); atTick(restored, tick + 1); }
    }
    equal(observed.size, 2, "both distinct authored frames are actually rendered");
    deepEqual(restored.diagnostics, []);
    deepEqual(source.game.diagnostics, []);
  });
}

for (const warm of [false, true]) for (const replacement of [null, new Uint8Array([0, 1, 2])]) {
  test(`cancellation ignores ${replacement === null ? "missing" : "invalid"} ${warm ? "saved-warm" : "cold"} pictures`, () => {
    const source = save(`${warm ? warmPictures : ""}id=pinnedanimation("spin.anm",0,0,1)\nSave("slot")\nendanimation(id)\ncontinued=42\n${sleep}`);
    const restored = host({ bytes: source.bytes }, 'load("slot")\nend()');
    if (replacement === null) restored.files.delete(assetKey("bitmap/red.png"));
    else restored.files.set(assetKey("bitmap/red.png"), replacement);
    until(restored, (report) => report.ticksRun > 0 && restored.state.vm.globals.continued === 42);
    equal(restored.state.fx.animations.length, 0);
    if (!warm) equal(restored.requests.some((request) => request.key === "bitmap/red.png"), false, "canceled cold frames are never acquired");
    deepEqual(restored.diagnostics, [], "unused content cannot prevent the saved script from resuming");
  });
}

test("a loaded animation preserves its clock while using current installed picture bytes", () => {
  const source = save(`id=pinnedanimation("spin.anm",0,0,1)\nthreadSleep(getThreadId(),0.1)\nSave("slot")\ncontinued=42\n${sleep}`);
  equal(source.saved.fx.animations[0]?.loaded, true);
  const restored = host({ bytes: source.bytes }, 'load("slot")\nend()', { "bitmap/red.png": blue });
  atTick(restored, 12);
  equal(restored.state.fx.animations[0]?.originTick, source.saved.fx.animations[0]?.originTick);
  const current = restored.engine.picturePixels(assetKey("bitmap/red.png"));
  ok(current);
  deepEqual([...current.rgba.subarray(0, 4)], [0, 0, 255, 255]);
  deepEqual(restored.diagnostics, []);
});

test("frame sounds follow the uninterrupted animation phase after a cold restore", () => {
  const sound = new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "audio", "files", "pcm8-mono-8000.wav")));
  const extras = { "misc/spin.anm": animation("step.wav"), "media/step.wav": sound };
  const source = save(`id=pinnedanimation("spin.anm",0,0,1)\nSave("slot")\n${sleep}`, extras);
  const restored = host({ bytes: source.bytes }, "end()", extras);
  until(restored, (report) => report.ticksRun > 0 && restored.state.engine.boot?.stage === "running");
  run(restored, 'load("slot")\nend()');
  atTick(source.game, 10);
  atTick(restored, 10);
  const plays = (game: Host) => game.cues.filter((cue) => cue.kind === "media.play").map((cue) => [cue.tick, cue.asset]);
  deepEqual(plays(restored), plays(source.game));
  equal(plays(restored)[0]?.[1], "media/step.wav", "the restored frames actually emit their authored sound");
  deepEqual(restored.diagnostics, []);
});

test("legacy Load reacquires a visible board image without inheriting destination warmth", () => {
  const empty = createEmptyBoard();
  const imageBoard = unwrap(writeBoard({ ...empty, properties: { ...empty.properties, backgroundImage: "blue.png" } }));
  const source = save(`Save("slot")\ncontinued=42\n${sleep}`, { "boards/start.brd": imageBoard });
  const legacy = JSON.parse(decoder.decode(source.bytes)) as { schema: { engine: number }; engine: Record<string, unknown> };
  legacy.schema.engine = 1;
  delete legacy.engine.cacheKeys;
  const restored = host({ bytes: encoder.encode(JSON.stringify(legacy)) }, 'load("slot")\nend()', { "boards/start.brd": imageBoard });
  atTick(source.game, 10);
  atTick(restored, 10);
  equal(restored.state.vm.globals.continued, 42);
  equal(pixels(restored), pixels(source.game));
  ok(restored.requests.some((request) => request.key === "bitmap/blue.png"));
  deepEqual(restored.diagnostics, []);
});

test("refused malformed Load preserves the live animation, readiness and rendered frame", () => {
  const game = host({ bytes: encoder.encode("{}") });
  until(game, (report) => report.tickAfter >= 2);
  run(game, `id=pinnedanimation("spin.anm",0,0,1)\n${sleep}`);
  atTick(game, 10);
  const origin = game.state.fx.animations[0]!.originTick;
  const keys = [...game.state.engine.cacheKeys!];
  run(game, `load("slot")\nrefused=42\nend()`);
  until(game, (report) => report.ticksRun > 0 && game.state.vm.globals.refused === 42);
  equal(game.state.fx.animations[0]!.originTick, origin);
  deepEqual(game.state.engine.cacheKeys, keys);
  equal(game.diagnostics[0]?.code, "restore.shape");
  ok(game.engine.picturePixels(assetKey("bitmap/red.png")));
});

test("repeated Load restores the saved visibility after an intervening image consumer", () => {
  const source = save(`id=pinnedanimation("spin.anm",0,0,1)\nSave("slot")\ncontinued=42\n${sleep}`);
  const restored = host({ bytes: source.bytes }, 'load("slot")\nend()');
  atTick(restored, 10);
  run(restored, `createcanvas(2,2,c)\nsetimage("blue.png",0,0,2,2,c)\nload("slot")\nend()`);
  until(restored, () => restored.loads === 2);
  atTick(restored, 10);
  atTick(source.game, 10);
  deepEqual(restored.state.fx.animations, source.game.state.fx.animations);
  equal(pixels(restored), pixels(source.game));
  deepEqual(restored.diagnostics, []);
});

test("reset after Load removes the restored animations and permits a new animation", () => {
  const source = save(`id=pinnedanimation("spin.anm",0,0,1)\nSave("slot")\ncontinued=42\n${sleep}`);
  const restored = host({ bytes: source.bytes });
  until(restored, (report) => report.ticksRun > 0 && restored.state.engine.boot?.stage === "running");
  run(restored, 'load("slot")\nend()');
  atTick(restored, 10);
  run(restored, "reset()\nend()");
  until(restored, (report) => report.ticksRun > 0 && (restored.state.fx.animations?.length ?? 0) === 0 && restored.state.engine.boot?.stage === "running");
  run(restored, `newid=pinnedanimation("spin.anm",4,0,1)\nnewrun=42\n${sleep}`);
  until(restored, (report) => report.ticksRun > 0 && restored.state.vm.globals.newrun === 42 && restored.state.fx.animations.some((entry) => entry.loaded));
  equal(restored.state.vm.globals.newrun, 42);
  equal(restored.state.fx.animations[0]?.x, 4);
  deepEqual(restored.diagnostics, []);
});

function tileAnimation(image: string): Uint8Array {
  return unwrap(writeAnimation({
    magic: "RPGTLKIT ANIM", major: 2, minor: 3, width: 2, height: 2,
    frames: [{ image, transparent: { r: 255, g: 0, b: 255 }, sound: "" }],
    delay: 1 / 60, residue: new Uint8Array(),
  }));
}

test("restoring a visible single-tile animation uses the tile decoder", () => {
  const tile = encoder.encode(writeSingleTile({
    magic: SINGLE_TILE_MAGIC, major: 2, minor: 0, detail: 1, compression: 0,
    width: 32, height: 32, pixels: Array<number>(32 * 32).fill(255),
  }));
  const extras = { "misc/spin.anm": tileAnimation("red.gph"), "tiles/red.gph": tile };
  const source = save(`id=pinnedanimation("spin.anm",0,0,1)\nthreadSleep(getThreadId(),0.1)\nSave("slot")\ncontinued=42\n${sleep}`, extras);
  const restored = host({ bytes: source.bytes }, 'load("slot")\nend()', extras);
  atTick(source.game, 12);
  atTick(restored, 12);
  equal(restored.state.vm.globals.continued, 42);
  equal(pixels(restored), pixels(source.game));
  deepEqual(restored.diagnostics, []);
});

test("a saved-warm tileset first consumed after Load is decoded when its new animation starts", () => {
  const tile = unwrap(writeTileset({
    version: 20, detail: { code: 1, size: 32, bytesPerPixel: 3, isometric: false },
    tiles: [{ pixels: Uint8Array.from({ length: 32 * 32 * 3 }, (_, index) => index % 3 === 0 ? 255 : 0) }], residue: new Uint8Array(),
  }));
  const extras = { "misc/spin.anm": tileAnimation("red.tst1"), "tiles/red.tst": tile };
  const source = save(`warm=pinnedanimation("spin.anm",0,0,1)\nthreadSleep(getThreadId(),0.1)\nendanimation(warm)\nSave("slot")\nid=pinnedanimation("spin.anm",0,0,1)\ncontinued=42\n${sleep}`, extras);
  equal(source.saved.fx.animations.length, 0);
  const restored = host({ bytes: source.bytes }, 'load("slot")\nend()', extras);
  atTick(source.game, 12);
  atTick(restored, 12);
  equal(restored.state.vm.globals.continued, 42);
  equal(pixels(restored), pixels(source.game));
  deepEqual(restored.diagnostics, []);
});

test("a later board entry activates a saved-warm background picture", () => {
  const empty = createEmptyBoard();
  const other = unwrap(writeBoard({ ...empty, properties: { ...empty.properties, backgroundImage: "red.png" } }));
  const extras = { "boards/other.brd": other };
  const source = save(`${warmPictures}Save("slot")\nsend("other.brd",1,1,1)\nforceRedraw()\ncontinued=42\n${sleep}`, extras, "blocking");
  const restored = host({ bytes: source.bytes }, 'load("slot")\nend()', extras);
  atTick(source.game, 12);
  atTick(restored, 12);
  equal(restored.state.world.board?.key, "boards/other.brd");
  equal(restored.state.vm.globals.continued, 42);
  equal(pixels(restored), pixels(source.game));
  deepEqual(restored.diagnostics, []);
});

for (const timing of ["visible at Save", "created after Load"] as const) {
test(`a message-window graphic ${timing} uses its saved-warm picture`, () => {
  const extras = { "bitmap/red.png": encodePng(600, 100, Uint8Array.from({ length: 600 * 100 * 4 }, (_, index) => index % 4 === 0 || index % 4 === 3 ? 255 : 0)) };
  const window = 'winGraphic("red.png")\nmwin("")\n';
  const source = save(`${timing === "visible at Save" ? window : warmPictures}Save("slot")\n${timing === "created after Load" ? window : ""}continued=42\n${sleep}`, extras, "blocking");
  const restored = host({ bytes: source.bytes }, "end()", extras);
  until(restored, (report) => report.ticksRun > 0 && restored.state.engine.boot?.stage === "running");
  run(restored, 'load("slot")\nend()');
  atTick(source.game, 10);
  atTick(restored, 10);
  const backgrounds = (game: Host) => game.engine.drawList().commands.filter((command) =>
    command.kind === "blit" && "asset" in command.source && command.source.asset === "bitmap/red.png");
  equal(backgrounds(source.game).length, 1, "the original message actually draws its authored graphic");
  deepEqual(backgrounds(restored), backgrounds(source.game));
  equal(pixels(restored), pixels(source.game));
  deepEqual(source.game.diagnostics, []);
  deepEqual(restored.diagnostics, []);
});
}

for (const action of ["reset", "refused Load"] as const) {
  test(`${action} keeps restored invalid unused pictures unobserved`, () => {
    const source = save(`${warmPictures}Save("slot")\ncontinued=42\n${sleep}`);
    const restored = host({ bytes: source.bytes });
    restored.files.set(assetKey("bitmap/red.png"), new Uint8Array([0, 1, 2]));
    until(restored, (report) => report.ticksRun > 0 && restored.state.engine.boot?.stage === "running");
    run(restored, 'load("slot")\nend()');
    until(restored, (report) => report.ticksRun > 0 && restored.state.vm.globals.continued === 42);
    if (action === "reset") {
      run(restored, "reset()\nend()");
      until(restored, (report) => report.ticksRun > 0 && restored.state.engine.boot?.stage === "running");
    } else {
      const malformed = JSON.parse(decoder.decode(source.bytes)) as GameState;
      const frame = malformed.vm.threads.flatMap((thread) => thread.frames)[0];
      ok(frame);
      frame.program = { kind: "file", path: "prg/removed.prg", sourceHash: "0000000000000000", ir: IR_VERSION };
      restored.store.bytes = encoder.encode(JSON.stringify(malformed));
      run(restored, 'load("slot")\nafterrefusal=42\nend()');
      until(restored, (report) => report.ticksRun > 0 && restored.state.vm.globals.afterrefusal === 42);
    }
    run(restored, `rendernow(1)\nc=cnvrendernow\ncolorrgb(1,2,3)\nfillrect(0,0,1,1,c)\nafter=42\n${sleep}`);
    until(restored, (report) => report.ticksRun > 0 && restored.state.vm.globals.after === 42);
    equal(restored.diagnostics.some((diagnostic) => diagnostic.code === "asset.invalid"), false);
  });
}

test("a current program added after Save remains callable after Load", () => {
  const source = save(`Save("slot")\nrun("worker.prg")\n${sleep}`, { "prg/worker.prg": encoder.encode("end()") });
  const restored = host({ bytes: source.bytes }, 'load("slot")\nend()', {
    "prg/worker.prg": encoder.encode('run("added.prg")\nend()'),
    "prg/added.prg": encoder.encode("added=42\nend()"),
  });
  equal(source.saved.engine.cacheKeys?.includes("prg/added.prg"), false);
  atTick(restored, 10);
  equal(restored.state.vm.globals.added, 42);
  ok(restored.state.engine.cacheKeys?.includes("prg/added.prg"), "actual consumption records acquired source availability");
  deepEqual(restored.diagnostics, []);
});

test("reset after Load boots newly installed sources not present in the save", () => {
  const source = save(`Save("slot")\ncontinued=42\n${sleep}`);
  const restored = host({ bytes: source.bytes }, "end()", { "prg/added.prg": encoder.encode("end()") });
  until(restored, (report) => report.ticksRun > 0 && restored.state.engine.boot?.stage === "running");
  run(restored, 'load("slot")\nend()');
  until(restored, (report) => report.ticksRun > 0 && restored.state.vm.globals.continued === 42);
  equal(restored.state.engine.cacheKeys?.includes("prg/added.prg"), false, "unused new sources stay logically cold");
  run(restored, "reset()\nend()");
  until(restored, (report) => report.ticksRun > 0 && restored.state.engine.boot?.stage === "running");
  ok(restored.state.engine.cacheKeys?.includes("prg/added.prg"), "fresh boot consumes its current source set");
  deepEqual(restored.diagnostics, []);
});

function regionalBoard(): Readonly<Record<string, Uint8Array>> {
  const empty = createEmptyBoard();
  const tileset = (channel: number) => unwrap(writeTileset({
    version: 20, detail: { code: 1, size: 32, bytesPerPixel: 3, isometric: false },
    tiles: [{ pixels: Uint8Array.from({ length: 32 * 32 * 3 }, (_, index) => index % 3 === channel ? 255 : 0) }], residue: new Uint8Array(),
  }));
  return {
    "boards/start.brd": unwrap(writeBoard({
      ...empty, sizeX: 2, sizeY: 1, sizeL: 1, lut: ["", "red.tst1", "blue.tst1"],
      tileMatrix: [1, 2], tileRuns: [{ lutIndex: 1, count: 1, marker: false }, { lutIndex: 2, count: 1, marker: false }],
      layerTitles: ["", ""],
    })),
    "tiles/red.tst": tileset(0), "tiles/blue.tst": tileset(2),
  };
}

test("moving the restored camera activates a previously offscreen saved-warm tileset", () => {
  const extras = regionalBoard();
  const source = save(`Save("slot")\ncontinued=42\n${sleep}`, extras);
  const restored = host({ bytes: source.bytes }, "end()", extras);
  until(restored, (report) => report.ticksRun > 0 && restored.state.engine.boot?.stage === "running");
  run(restored, 'load("slot")\nend()');
  atTick(source.game, 10);
  atTick(restored, 10);
  const before = pixels(source.game);
  equal(pixels(restored), before);
  for (const game of [source.game, restored]) {
    game.state.camera.target = { kind: "point", point: { x: 4, y: 4 } };
    game.step();
    game.step(); // Presentation at alpha 0 uses the previous camera position.
    equal(game.state.camera.x, 0);
  }
  ok(pixels(source.game) !== before, "camera movement really exposes the other tileset");
  equal(pixels(restored), pixels(source.game));
  deepEqual(restored.diagnostics, []);
});

test("legacy Load waits for visible board tiles before reporting the rebuilt frame", () => {
  const extras = regionalBoard();
  const source = save(`Save("slot")\ncontinued=42\n${sleep}`, extras);
  const legacy = JSON.parse(decoder.decode(source.bytes)) as { schema: { engine: number }; engine: Record<string, unknown> };
  legacy.schema.engine = 1;
  delete legacy.engine.cacheKeys;
  const restored = host({ bytes: encoder.encode(JSON.stringify(legacy)) }, 'load("slot")\nend()', extras);
  atTick(source.game, 10);
  atTick(restored, 10);
  equal(pixels(restored), pixels(source.game));
  deepEqual(restored.diagnostics, []);
});
