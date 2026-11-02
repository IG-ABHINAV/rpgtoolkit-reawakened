import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { applyInputEvent, assetKey, createInputSection } from "@tk-reawakened/core";
import { fetchBundled, fetchBundledFiles, fetchGame, liveTextureProvider, textureProvider, toFiles } from "../src/index.ts";
import { INTERACTIVE_INPUT_BINDINGS } from "../src/input-bindings.ts";

// `runner-web`'s transport helpers and its decode adapter are the shipped code a Node unit test reaches without a
// browser; the drawing itself is entry 4's lane under Playwright.

const realFetch = globalThis.fetch;

/** Answers every request with `body` (or `status`) and records the URLs it was asked for. */
function stubFetch(asked: string[], status = 200, body: unknown = { files: [] }): void {
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    asked.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Response(status === 200 ? JSON.stringify(body) : "nope", { status });
  }) as typeof fetch;
}

/** A 24-bit bottom-up BMP, the smallest real image the shared decoder accepts (docs/spec/formats/images.md#bmp). */
function bmp(left: readonly number[], right: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(14 + 40 + 8);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d], 0);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, 2, true);
  view.setInt32(22, 1, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, 8, true);
  bytes.set([left[2]!, left[1]!, left[0]!, right[2]!, right[1]!, right[0]!], 54);
  return bytes;
}

test("toFiles keys bytes by their path inside the game and keeps the last duplicate", () => {
  const files = toFiles([
    { path: "Main/game.gam", bytes: new Uint8Array([1]) },
    { path: "tiles/first.tst", bytes: new Uint8Array([2]) },
    { path: "tiles/first.tst", bytes: new Uint8Array([3]) },
  ]);
  deepEqual([...files.keys()], ["Main/game.gam", "tiles/first.tst"]);
  deepEqual([...(files.get("tiles/first.tst") ?? [])], [3]);
});

test("fetchGame asks the host for one root and decodes its base64 bytes", async () => {
  const asked: string[] = [];
  stubFetch(asked, 200, { files: [{ path: "Main/a.gam", bytes: "AQID" }] });
  try {
    const files = await fetchGame("http://host", "demo");
    deepEqual(asked, ["http://host/api/game?root=demo"]);
    deepEqual([...(files.get("Main/a.gam") ?? [])], [1, 2, 3]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("fetchBundled joins the plan's folders and percent-encodes them", async () => {
  const asked: string[] = [];
  stubFetch(asked);
  try {
    const files = await fetchBundled("http://host", ["media/fonts", "media/cursors"]);
    deepEqual(asked, ["http://host/api/bundled?folders=media%2Ffonts%2Cmedia%2Fcursors"]);
    equal(files.size, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a non-OK answer throws with the URL and the status, not an empty game", async () => {
  const asked: string[] = [];
  stubFetch(asked, 404);
  let message = "";
  try {
    await fetchGame("http://host", "missing");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  } finally {
    globalThis.fetch = realFetch;
  }
  ok(message.includes("answered 404"), `expected a 404 to throw, got ${JSON.stringify(message)}`);
});

test("textureProvider decodes a game's own image bytes once and caches the pixels", () => {
  const bytes = bmp([255, 0, 0], [0, 0, 255]);
  const files = toFiles([{ path: "tiles/arrow.bmp", bytes }]);
  const provide = textureProvider(files);
  const first = provide(assetKey("Tiles/arrow.bmp"));
  ok(first !== null, "a 2×1 BMP decodes");
  equal(first.w, 2);
  equal(first.h, 1);
  deepEqual([...first.rgba], [255, 0, 0, 255, 0, 0, 255, 255]);
  bytes.fill(0);
  ok(provide(assetKey("Tiles/arrow.bmp")) === first, "the second call is the cached decode, not a re-read");
});

test("an asset the game does not carry, and a kind still deferred, decode to null", () => {
  const provide = textureProvider(toFiles([
    { path: "tiles/anim.tan", bytes: new Uint8Array([1, 2, 3]) },
    { path: "tiles/bit.tbm", bytes: new Uint8Array([1, 2, 3]) },
  ]));
  equal(provide(assetKey("Tiles/missing.bmp")), null);
  equal(provide(assetKey("Tiles/anim.tan")), null);
  equal(provide(assetKey("Tiles/bit.tbm")), null);
});

test("fetchBundledFiles fetches each static path with no /api/ call and percent-encodes each segment", async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push(url);
    return new Response(new Uint8Array([url.length]), { status: 200 });
  }) as typeof fetch;
  try {
    const files = await fetchBundledFiles("http://host", ["media/fonts/a b.ttf", "media/soundfonts/TK-16.sf2"]);
    deepEqual(asked, ["http://host/media/fonts/a%20b.ttf", "http://host/media/soundfonts/TK-16.sf2"]);
    ok(asked.every((url) => !url.includes("/api/")));
    equal(files.get("media/fonts/a b.ttf")?.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("liveTextureProvider does not lock in null before bytes arrive, and prefers pixels the decode worker prepared", () => {
  const arrived = new Map<string, Uint8Array>();
  const prepared = new Map<string, { w: number; h: number; rgba: Uint8Array }>();
  const provide = liveTextureProvider((asset) => arrived.get(asset) ?? null, (asset) => prepared.get(asset) ?? null);
  const arrow = assetKey("Tiles/arrow.bmp");
  equal(provide(arrow), null, "not arrived yet");
  arrived.set(arrow, bmp([0, 255, 0], [0, 0, 0]));
  const decoded = provide(arrow);
  ok(decoded !== null && decoded.rgba[1] === 255, "decodes once the bytes arrive");

  const ready = { w: 1, h: 1, rgba: new Uint8Array([9, 8, 7, 255]) };
  prepared.set(assetKey("Tiles/ready.bmp"), ready);
  equal(provide(assetKey("Tiles/ready.bmp")), ready);
});

test("interactive bindings route the browser Space event into the key queue", () => {
  const input = createInputSection({ bindings: INTERACTIVE_INPUT_BINDINGS });
  applyInputEvent(input, { kind: "key", name: " ", code: "Space", char: " ", down: true });
  deepEqual(input.keys.map((key) => [key.name, key.code, key.action]), [[" ", "Space", " "]]);
});
