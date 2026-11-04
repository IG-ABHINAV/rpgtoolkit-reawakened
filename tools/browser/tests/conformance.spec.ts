import { expect, test } from "@playwright/test";

/**
 * D-7 on the whole commit-time kit: exact on every discrete decision (colour-key exclusion, the R-15 tint remap,
 * alpha-0 skipping, row order, and the pixel sets of the line, the rectangle outline, the midpoint ellipse, the `.iso`
 * projection and text ink), at most one unit per channel on blend arithmetic.
 *
 * The page reports the worst channel per vector and whether the reference itself reproduced the committed bytes, so a
 * failure here names the vector, the pixel and the channel instead of a boolean.
 */
type VectorReport = {
  readonly id: string;
  readonly actual: string;
  readonly expected: string;
  readonly worst: number;
  readonly at: string;
  readonly kitError: string | null;
};

test("render-webgl2 replays every committed raster vector within the D-7 bound", async ({ page }) => {
  await page.goto("/packages/runner-web/app/vectors.html");
  await page.waitForFunction(() => window.__vectors !== undefined, undefined, { timeout: 60_000 });
  const results = (await page.evaluate(() => window.__vectors)) as readonly VectorReport[];
  // 15 geometry and pipeline vectors (including a mid-tone colour key), one legacy bitmap-font run, one TrueType run.
  expect(results.length).toBe(17);

  const blendArithmetic = (id: string): boolean => id.includes("translucent") || id.includes("additive");
  for (const result of results) {
    expect(result.kitError, `${result.id}: the committed bytes must reproduce through the reference`).toBeNull();
    const worst = worstChannel(bytes(result.actual), bytes(result.expected));
    expect(worst, `${result.id}: worst channel`).toBe(result.worst);
    if (blendArithmetic(result.id)) expect(worst, `${result.id} within one unit per channel (${result.at})`).toBeLessThanOrEqual(1);
    else expect(worst, `${result.id} must be exact (first difference ${result.at})`).toBe(0);
  }
});

function bytes(hex: string): number[] {
  const out: number[] = [];
  for (let index = 0; index < hex.length; index += 2) out.push(Number.parseInt(hex.slice(index, index + 2), 16));
  return out;
}

function worstChannel(actual: number[], expected: number[]): number {
  let worst = 0;
  for (let index = 0; index < expected.length; index += 1) worst = Math.max(worst, Math.abs((actual[index] ?? 0) - (expected[index] ?? 0)));
  return worst;
}
