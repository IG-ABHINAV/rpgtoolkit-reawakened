import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The tracer's evidence (entry 9.3): a sample game boots in a real browser from the same core build the headless runner
 * uses, reports the committed closing-suite hashes at tick 120, and presents the frame through WebGL2.
 *
 * `golden/regression/closing.json` carries both numbers; this lane reads them from the baseline instead of hardcoding them.
 */

function demoBoardBaseline() {
  const baseline = JSON.parse(readFileSync(resolve("golden/regression/closing.json"), "utf8")) as {
    games: Record<string, { frames: ReadonlyArray<{ label: string; tick: number; stateHash: string; drawHash: string; commands: number }> }>;
  };
  const frame = baseline.games.demo.frames.find((f) => f.label === "board" && f.tick === 120);
  if (frame === undefined) throw new Error("demo board frame at tick 120 not found in golden/regression/closing.json");
  return frame;
}

test("demo tracer reports the committed tick-120 hashes and presents its captured frame", async ({ page }) => {
  const started = Date.now();
  await page.goto("/packages/runner-web/app/index.html?game=demo&tracer=1");
  await page.waitForFunction(() => window.__report !== undefined, undefined, { timeout: 45_000 });
  const report = await page.evaluate(() => window.__report as Record<string, unknown>);
  const seconds = (Date.now() - started) / 1000;
  console.log(`demo boot to report: ${seconds.toFixed(2)}s`, JSON.stringify(report));

  const baseline = demoBoardBaseline();
  expect(report["error"]).toBeUndefined();
  expect(report["package"]).toBeNull();
  expect(report["tick"]).toBe(baseline.tick);
  expect(report["stateHash"]).toBe(baseline.stateHash);
  expect(report["drawHash"]).toBe(baseline.drawHash);
  expect(report["commands"]).toBe(baseline.commands);

  const render = report["render"] as { drawn: number; deferred: number; deferredByKind: Record<string, number> };
  expect(render.drawn).toBe(baseline.commands);
  expect(render.deferred).toBe(0);
  expect(render.deferredByKind["text"]).toBeUndefined();
  const sample = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const gl = canvas.getContext("webgl2");
    if (gl === null) return null;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonBlack = 0;
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] !== 0 || pixels[index + 1] !== 0 || pixels[index + 2] !== 0) nonBlack += 1;
    return { width: canvas.width, height: canvas.height, nonBlack };
  });
  expect(sample).not.toBeNull();
  expect(sample?.width).toBe(640);
  expect(sample?.height).toBe(480);
  expect(sample?.nonBlack ?? 0).toBeGreaterThan(1000);
  expect(seconds, "boot cost, for the record").toBeLessThan(30);
});

test("the browser probes VP9+Opus and no WebAssembly on the default player path", async ({ page }) => {
  await page.goto("/packages/runner-web/app/index.html?game=demo");
  const probes = await page.evaluate(() => {
    const video = document.createElement("video");
    return {
      vp9: video.canPlayType('video/webm; codecs="vp9"'),
      opus: video.canPlayType('audio/webm; codecs="opus"'),
      wasm: typeof WebAssembly,
      wasmUsed: (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).some((entry) => entry.name.endsWith(".wasm")),
    };
  });
  expect(probes.vp9).not.toBe("");
  expect(probes.opus).not.toBe("");
  expect(probes.wasmUsed).toBe(false);
});
