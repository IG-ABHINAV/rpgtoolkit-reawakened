// Host-shipped bundled assets and unrenderable frames on the engine's own screen surface (ticket 4.28).
//
// The closing suite found that the sample games' title screens drew nothing: the default bitmap font and the
// cursor-map hand are bundled under `media/`, the engine had no way to receive them, and the failed replay of the
// frame was dropped without a word.
import { equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assetKey, createAssetIndex, createEmptyBoard, createEngine, PACKAGE_ROOT, writeBoard } from "../src/index.ts";
import type { AssetKey, Diagnostic, Engine } from "../src/index.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const bundledFont = assetKey("media/fonts/tkr-8x8.fnt");
const bundledFiles = new Map<AssetKey, Uint8Array>([[bundledFont, new Uint8Array(readFileSync(join(repoRoot, "media", "fonts", "tkr-8x8.fnt")))]]);

function boardBytes(): Uint8Array {
  const encoded = writeBoard(createEmptyBoard());
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
}

/** A scene-mode engine that has loaded its board and run `program` for a few ticks. */
function runProgram(program: string, bundled?: ReadonlyMap<AssetKey, Uint8Array>, extraKeys: readonly string[] = []): { readonly engine: Engine; readonly diagnostics: Diagnostic[] } {
  const engine = createEngine({
    seed: 5,
    assetIndex: createAssetIndex(["Boards/test.brd", ...extraKeys]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 96,
    height: 32,
    maxTicks: 20,
    program,
    ...(bundled === undefined ? {} : { bundled }),
  });
  const diagnostics: Diagnostic[] = [];
  let report = engine.advance(0, []);
  for (let step = 0; step < 4 && report.loading; step += 1) {
    const replies = report.requests.flatMap((request) => (request.kind === "asset" ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: boardBytes() } }] : []));
    report = engine.advance(0, replies);
  }
  report = engine.advance(3, []);
  diagnostics.push(...report.diagnostics);
  return { engine, diagnostics };
}

/** The screen surface's pixels; its revision depends on how often the frame was refreshed, so scan for the current one. */
function screen(engine: Engine): Uint8Array {
  for (let rev = 0; rev < 64; rev += 1) {
    const surface = engine.surfacePixels(0 as never, rev);
    if (surface !== null) return surface.rgba;
  }
  throw new Error("the screen surface has no readable revision");
}

function paintedPixels(rgba: Uint8Array): number {
  let painted = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) painted += 1;
  return painted;
}

test("a frame that cannot be replayed is reported as render.failed instead of staying silently blank", () => {
  const { engine, diagnostics } = runProgram('text(1, 1, "hi")\nwait()\nend()\n');
  equal(diagnostics.length, 0);
  screen(engine);
  const flushed = engine.advance(0, []);
  const failure = flushed.diagnostics.find((diagnostic) => diagnostic.code === "render.failed");
  equal(failure?.message, "missing bitmap font asset");
});

test("the bundled default bitmap font the host ships draws script text on the screen surface", () => {
  const { engine } = runProgram('text(1, 1, "hi")\nwait()\nend()\n', bundledFiles);
  equal(paintedPixels(screen(engine)) > 0, true);
  equal(engine.advance(0, []).diagnostics.length, 0);
});

test("a font name the game does not ship draws in the default bitmap font", () => {
  const named = runProgram('font("Comic Sans MS")\ntext(1, 1, "hi")\nwait()\nend()\n', bundledFiles);
  const plain = runProgram('text(1, 1, "hi")\nwait()\nend()\n', bundledFiles);
  equal(paintedPixels(screen(named.engine)), paintedPixels(screen(plain.engine)));
  equal(paintedPixels(screen(named.engine)) > 0, true);
  equal(named.engine.advance(0, []).diagnostics.length, 0);
});

test("a family name resolves to the Liberation face the project ships, not an asset it lacks", () => {
  // #848: `font("Arial")` used to store `media/fonts/liberation-sans.ttf`, which no project ships, so the
  // documented substitution silently fell back to the bitmap font.
  const liberation = assetKey("media/fonts/LiberationSans-Regular.ttf");
  const withFont = new Map<AssetKey, Uint8Array>([
    ...bundledFiles,
    [liberation, new Uint8Array(readFileSync(join(repoRoot, "media", "fonts", "LiberationSans-Regular.ttf")))],
  ]);
  const substituted = runProgram('font("Arial")\ntext(1, 1, "hi")\nwait()\nend()\n', withFont, [liberation]);
  const bitmap = runProgram('text(1, 1, "hi")\nwait()\nend()\n', bundledFiles);
  equal(substituted.engine.advance(0, []).diagnostics.length, 0);
  equal(bitmap.engine.advance(0, []).diagnostics.length, 0);
  equal(paintedPixels(screen(substituted.engine)) > 0, true, "the substituted face draws text");
  equal(
    screen(substituted.engine).join(",") === screen(bitmap.engine).join(","),
    false,
    "the Liberation face is used, not the bitmap fallback",
  );
  // A project font whose family is the requested name wins over the substitution.
  const projectFace = assetKey("media/fonts/arial.ttf");
  const withProject = new Map<AssetKey, Uint8Array>([
    ...bundledFiles,
    [projectFace, new Uint8Array(readFileSync(join(repoRoot, "media", "fonts", "LiberationSans-Regular.ttf")))],
  ]);
  const familyMatch = runProgram('font("Arial")\ntext(1, 1, "hi")\nwait()\nend()\n', withProject, [projectFace]);
  equal(familyMatch.engine.advance(0, []).diagnostics.length, 0);
  // The shipped face must be drawn: the bitmap fallback would paint different bytes.
  const unknownFamily = runProgram('font("Comic Sans MS")\ntext(1, 1, "hi")\nwait()\nend()\n', withProject, [projectFace]);
  equal(
    screen(familyMatch.engine).join(",") === screen(unknownFamily.engine).join(","),
    false,
    "a shipped family match draws with that face, not the bitmap fallback",
  );
});

test("a bundled file that does not decode is reported once with its key", () => {
  const broken = new Map<AssetKey, Uint8Array>([[bundledFont, new Uint8Array([1, 2, 3])]]);
  const { engine } = runProgram('text(1, 1, "hi")\nwait()\nend()\n', broken);
  screen(engine);
  const reported = engine.advance(0, []).diagnostics.filter((diagnostic) => diagnostic.code === "asset.invalid" && diagnostic.file === bundledFont);
  equal(reported.length, 1);
  screen(engine);
  equal(engine.advance(0, []).diagnostics.filter((diagnostic) => diagnostic.code === "asset.invalid").length, 0);
});
