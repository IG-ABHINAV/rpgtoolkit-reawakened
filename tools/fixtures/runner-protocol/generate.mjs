// Runner boundary vector kit (docs/spec/engine/runners.md#conformance-lane).
//
//   node tools/fixtures/runner-protocol/generate.mjs          # write vectors.json
//   node tools/fixtures/runner-protocol/generate.mjs --check   # fail if it differs
//
// Every vector is one record plus the verdict a conforming schema must return for
// it. The families are the three record families on the boundary: the draw list
// (AD-3), the input record (AD-14) and the host request (AD-5, AD-17). Audio
// messages are NOT here; they are tools/fixtures/audio-protocol/ under
// packages/synth/schema/audio-protocol-v1.schema.json.
//
// The vectors are the contract a non-TypeScript runner replays: validate every
// vector against the schema, then replay the input and request families against
// your own host to prove the shape, not just the parse.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "../fetch.mjs";
import { refName, schemaErrors, schemaProblems } from "./schema.mjs";
import { typeProblems } from "./types.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, "vectors.json");
const schemaPath = join(here, "../../../packages/runner-harness/schema/runner-protocol-v1.schema.json");

const B64 = Buffer.from([0, 1, 2, 255]).toString("base64");
const rgb = { r: 10, g: 20, b: 30 };
const rect = { x: 0, y: 0, w: 2, h: 2 };
const font = { asset: "media/fonts/tkr.fnt", size: 12, bold: false, italic: false };
const list = (...commands) => ({ tick: 12, width: 640, height: 480, commands });
const input = (event) => ({ tick: 12, event });

const vectors = [
  // --- draw list: one valid record per command of the eight (AD-3) -------------
  { id: "draw-blit-texture", family: "draw", valid: true,
    record: list({ kind: "blit", source: { asset: "tiles/village.tst", tile: 3 }, src: rect, dst: rect, key: rgb, tint: { r: -8, g: 0, b: 8 }, alpha: 255, blend: "normal", iso2d: false }) },
  { id: "draw-blit-surface", family: "draw", valid: true,
    record: list({ kind: "blit", source: { surface: 1, rev: 7 }, src: rect, dst: rect, key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 128, blend: "translucent", iso2d: true }) },
  { id: "draw-fill", family: "draw", valid: true, record: list({ kind: "fill", rgb }) },
  { id: "draw-line", family: "draw", valid: true, record: list({ kind: "line", x1: 0, y1: 0, x2: 10, y2: 4, rgb }) },
  { id: "draw-rect", family: "draw", valid: true, record: list({ kind: "rect", rect, rgb, filled: true }) },
  { id: "draw-ellipse", family: "draw", valid: true, record: list({ kind: "ellipse", rect, rgb, filled: false }) },
  { id: "draw-text", family: "draw", valid: true,
    record: list({ kind: "text", x: 4, y: 8, text: "HP 12", font, rgb, advances: [{ glyph: 5, advance: 6 }, { glyph: 0, advance: 6 }] }) },
  { id: "draw-push-pop-target", family: "draw", valid: true,
    record: list({ kind: "pushTarget", scratch: 2 }, { kind: "fill", rgb }, { kind: "popTarget" }) },
  { id: "draw-empty-frame", family: "draw", valid: true, record: list() },

  // --- input record: one valid record per event of the eleven (AD-14) ----------
  { id: "input-key", family: "input", valid: true, record: input({ kind: "key", name: "ENTER", code: "Enter", char: "\n", down: true }) },
  { id: "input-key-null-char", family: "input", valid: true, record: input({ kind: "key", name: "LEFT", code: "ArrowLeft", char: null, down: false }) },
  { id: "input-pointer", family: "input", valid: true, record: input({ kind: "pointer", x: 320, y: 240, buttons: 1 }) },
  { id: "input-gamepad", family: "input", valid: true,
    record: input({ kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: -1 }, buttons: 4 }) },
  { id: "input-focus", family: "input", valid: true, record: input({ kind: "focus", state: "lost" }) },
  { id: "input-asset-reply", family: "input", valid: true, record: input({ kind: "asset", reqId: 17, bytes: B64 }) },
  { id: "input-asset-missing", family: "input", valid: true, record: input({ kind: "asset", reqId: 18, bytes: null }) },
  { id: "input-blob-loaded", family: "input", valid: true, record: input({ kind: "blob.loaded", reqId: 19, bytes: B64 }) },
  { id: "input-blob-saved", family: "input", valid: true, record: input({ kind: "blob.saved", reqId: 20, ok: false }) },
  { id: "input-blob-listed", family: "input", valid: true, record: input({ kind: "blob.listed", reqId: 21, names: ["slot1.sav"] }) },
  { id: "input-extension-result", family: "input", valid: true,
    record: input({ kind: "extension.result", reqId: 22, result: { ok: true, value: [1, "two", null] } }) },
  { id: "input-audio-ended", family: "input", valid: true, record: input({ kind: "audio.ended", cueId: 9 }) },
  { id: "input-video-ended", family: "input", valid: true, record: input({ kind: "video.ended", reqId: 23 }) },

  // --- request: one valid record per request of the eight (AD-5, AD-17) --------
  { id: "request-asset", family: "request", valid: true, record: { kind: "asset", reqId: 1, key: "boards/village.brd" } },
  { id: "request-load-blob", family: "request", valid: true, record: { kind: "loadBlob", reqId: 2, blob: { area: "saves", path: "slot1.sav" } } },
  { id: "request-save-blob", family: "request", valid: true,
    record: { kind: "saveBlob", reqId: 3, blob: { area: "files", path: "log.txt" }, bytes: B64 } },
  { id: "request-list-blobs", family: "request", valid: true, record: { kind: "listBlobs", reqId: 4, area: "saves" } },
  { id: "request-extension-call", family: "request", valid: true,
    record: { kind: "extension.call", reqId: 5, name: "tkplug0", args: [{ path: "a" }, 2, null] } },
  { id: "request-quit", family: "request", valid: true, record: { kind: "quit", reqId: 6 } },
  { id: "request-open-url", family: "request", valid: true, record: { kind: "openUrl", reqId: 7, url: "https://example.invalid/help" } },
  { id: "request-play-video", family: "request", valid: true,
    record: { kind: "playVideo", reqId: 8, key: "media/intro.webm", presentation: "small" } },
  // A prefetch hint: tiered keys, ordered by tier then key, and no reply (runners.md#prefetch).
  { id: "request-prefetch", family: "request", valid: true,
    record: {
      kind: "prefetch",
      reqId: 9,
      hints: [
        { tier: "now", key: "media/town.mid" },
        { tier: "next", key: "fight.mid" },
        { tier: "always", key: "media/move.wav" },
      ],
    } },
  { id: "refuse-prefetch-bad-tier", family: "request", valid: false, why: "a tier is now, next or always",
    record: { kind: "prefetch", reqId: 10, hints: [{ tier: "later", key: "media/town.mid" }] } },

  // --- refusals: a conforming schema must reject these ------------------------
  { id: "refuse-unknown-command", family: "draw", valid: false, why: "no such draw command",
    record: list({ kind: "sprite", X: 0 }) },
  { id: "refuse-blit-without-tint", family: "draw", valid: false, why: "every key is required; absence is null, never omission",
    record: list({ kind: "blit", source: { asset: "a", tile: null }, src: rect, dst: rect, key: null, alpha: 255, blend: "normal", iso2d: false }) },
  { id: "refuse-alpha-over-255", family: "draw", valid: false, why: "alpha is 0-255",
    record: list({ kind: "blit", source: { asset: "a", tile: null }, src: rect, dst: rect, key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 256, blend: "normal", iso2d: false }) },
  { id: "refuse-unknown-input", family: "input", valid: false, why: "no such input event",
    record: input({ kind: "mouse", x: 1 }) },
  { id: "refuse-key-without-down", family: "input", valid: false, why: "a key event always states its edge",
    record: input({ kind: "key", name: "ENTER", code: "Enter", char: null }) },
  { id: "refuse-unknown-request", family: "request", valid: false, why: "no such request kind (a prefetch hint is 9.8's, not v1)",
    record: { kind: "warm", reqId: 1, key: "a" } },
  { id: "refuse-http-url", family: "request", valid: false, why: "openUrl allows https: only (AD-17)",
    record: { kind: "openUrl", reqId: 9, url: "http://example.invalid/" } },
  { id: "refuse-non-base64-bytes", family: "request", valid: false, why: "a byte leaf is base64 in the JSON projection",
    record: { kind: "saveBlob", reqId: 10, blob: { area: "files", path: "log.txt" }, bytes: "not base64!" } },
];

export function documentOf(vectorList) {
  return JSON.stringify(
    {
      schema: 1,
      protocol: "runner-protocol-v1",
      note: "Records are the JSON projection of the runner boundary: Uint8Array leaves are base64 strings, every key of a kind is present, and an absent value is null (AD-14). Validate against packages/runner-harness/schema/runner-protocol-v1.schema.json; audio messages are the separate audio-protocol kit.",
      counts: {
        draw: vectorList.filter((vector) => vector.family === "draw").length,
        input: vectorList.filter((vector) => vector.family === "input").length,
        request: vectorList.filter((vector) => vector.family === "request").length,
      },
      vectors: vectorList,
    },
    null,
    2,
  ) + "\n";
}

function deref(schema, name) {
  return name === null || schema.$defs[name] === undefined ? undefined : schema.$defs[name];
}

function kindSetFromOneOf(schema, node) {
  const targets = node?.$ref !== undefined ? [deref(schema, refName(node.$ref))] : node?.oneOf ?? [];
  const values = targets.map((alternative) => {
    const target = alternative?.$ref !== undefined ? deref(schema, refName(alternative.$ref)) : alternative;
    return target?.properties?.kind?.const;
  });
  return new Set(values.filter((value) => value !== undefined));
}

function coveredKinds(schema) {
  return {
    draw: kindSetFromOneOf(schema, schema.$defs.drawCommand),
    input: kindSetFromOneOf(schema, schema.$defs.inputEvent),
    request: kindSetFromOneOf(schema, schema.$defs.request),
  };
}

function actualKinds(vectorList) {
  const actual = { draw: new Set(), input: new Set(), request: new Set() };
  for (const vector of vectorList) {
    if (!vector.valid) continue;
    if (vector.family === "draw") {
      for (const command of vector.record.commands) actual.draw.add(command.kind);
    } else if (vector.family === "input") {
      actual.input.add(vector.record.event.kind);
    } else if (vector.family === "request") {
      actual.request.add(vector.record.kind);
    }
  }
  return actual;
}

export function check({ schema: schemaOverride, committed, vectors: vectorsOverride, sources = {} } = {}) {
  const schema = schemaOverride ?? JSON.parse(readFileSync(schemaPath, "utf8"));
  const committedText = committed ?? (existsSync(output) ? readFileSync(output, "utf8") : null);
  const vectorList = vectorsOverride ?? vectors;

  const problems = [];

  // 1. Kit is reproducible.
  const generated = documentOf(vectorList);
  if (committedText !== null && committedText !== generated) {
    problems.push(`${output} differs; run node tools/fixtures/runner-protocol/generate.mjs`);
  }

  // 2. Schema is well formed.
  problems.push(...schemaProblems(schema));

  // 3. Schema accepts every valid vector and refuses every refusal.
  for (const vector of vectorList) {
    const errors = schemaErrors(schema, vector.record);
    if (vector.valid) {
      if (errors.length > 0) problems.push(`vector ${vector.id}: should be valid but ${errors.join("; ")}`);
    } else if (errors.length === 0) {
      problems.push(`vector ${vector.id}: should be refused${vector.why === undefined ? "" : ` (${vector.why})`}`);
    }
  }

  // 4. The kit covers every kind the schema lists.
  const expected = coveredKinds(schema);
  const actual = actualKinds(vectorList);
  for (const family of ["draw", "input", "request"]) {
    for (const kind of expected[family]) {
      if (!actual[family].has(kind)) problems.push(`vector kit covers ${family} kind "${kind}" defined in the schema`);
    }
  }

  // 5. The TypeScript types and the schema agree.
  problems.push(...typeProblems(schema, { sources }));

  return problems;
}

const document = documentOf(vectors);


// Importing this module must have no side effect: `check()` is what the fixtures test
// calls, and a write on import would let it compare a file against itself and always pass.
if (isEntryPoint(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const problems = check();
    if (problems.length > 0) {
      console.error(problems.join("\n"));
      process.exitCode = 1;
    }
  } else {
    writeFileSync(output, document);
  }
}
