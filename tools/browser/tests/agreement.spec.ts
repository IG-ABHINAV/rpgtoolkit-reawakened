import { expect, test } from "@playwright/test";

/**
 * The ledger limb of entry 9.4's agreement bound: every gating row of `golden/ledger.json` replays through
 * `render-webgl2` in headless Chromium and matches its oracle — the independent reference rasteriser replaying the
 * same draw list — exactly. Each row also renders three times with `flush()` between, and every frame must be identical
 * (AD-27, G4 rule 3).
 */
type RowReport = {
  readonly scene: string;
  readonly kind: "scene" | "closing" | "partial" | "vacuous" | "skipped";
  readonly commands: number;
  readonly worst: number;
  readonly at: string;
  readonly drawn: number;
  readonly deferred: number;
  readonly diagnostics: string;
  readonly flushStable: boolean;
  readonly error: string | null;
};

test("every gating ledger row replays through WebGL2 and agrees with its oracle", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/packages/runner-web/app/agreement.html");
  await page.waitForFunction(() => window.__agreement !== undefined, undefined, { timeout: 280_000 });
  await expect.poll(() => page.evaluate(() => window.__scratchFeedback)).toBe(true);
  const rows = (await page.evaluate(() => window.__agreement)) as readonly RowReport[];
  for (const row of rows) console.log("row:", JSON.stringify(row));

  // The ledger has nineteen gating rows today; the page reports one entry per row either way.
  expect(rows.length).toBe(19);
  const replayed = rows.filter((row) => row.kind === "scene" || row.kind === "closing");
  // Every row must be replayed: a vacuous or skipped row is a gap in the lane, not a pass.
  expect(rows.filter((row) => row.kind !== "scene" && row.kind !== "closing").map((row) => `${row.scene}: ${row.kind} ${row.error ?? row.diagnostics}`)).toEqual([]);
  expect(replayed.length).toBe(19);

  for (const row of replayed) {
    expect(row.commands, `${row.scene} has commands`).toBeGreaterThan(0);
    expect(row.deferred, `${row.scene} drew every command (${row.diagnostics})`).toBe(0);
    expect(row.flushStable, `${row.scene} is pixel-identical after a cache flush`).toBe(true);
    expect(row.worst, `${row.scene} agrees with its oracle exactly (first difference ${row.at})`).toBe(0);
  }
});
