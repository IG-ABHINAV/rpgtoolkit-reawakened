import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  BATTLE_BACKGROUND_MAGIC,
  BinaryReader,
  deriveGameId,
  derivePackageIdentity,
  loadPackage,
  readBoard,
  readDistributionManifest,
  readMainFile,
  writeBattleBackground,
  writeBoard,
  writeDistributionPackage,
  writeMainFile,
} from "@tk-reawakened/core";

const PACKAGE = "fixtures/packages/spinner-race.tpk";
type Span = { readonly start: number; readonly end: number };
type Fixture = { readonly bytes: Uint8Array; readonly descriptor: Record<string, unknown>; readonly oldMusic: Span; readonly replacementBoard: Span };
type DeferredGate = { readonly released: Promise<void>; release(): void };

declare global {
  interface Window {
    __playerClock?: () => number;
    __spinnerRaceOldSession?: { loadState(): { hints: { pending: number } } };
    __spinnerRaceChanges?: boolean[];
  }
}
async function sendKeyDown(page: Page, key: string, code: string): Promise<void> {
  await page.evaluate(({ key, code }) => window.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true })), { key, code });
}

function gate(): DeferredGate {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  return { released, release };
}

/** Rebuild the demo with distinct board-entry actions to quit the old session and stall a new board load. */
function raceFixture(): Fixture {
  const loaded = loadPackage({ kind: "tpk", name: "demo.tpk", bytes: new Uint8Array(readFileSync("fixtures/packages/demo.tpk")) });
  if (!loaded.ok) throw new Error(loaded.error.message);
  const manifest = readDistributionManifest(loaded.value);
  if (!manifest.ok) throw new Error(manifest.error.message);
  const main = manifest.value.main;
  const files = loaded.value.files.filter((file) => file.path !== "manifest.json").map((file) => ({ path: file.path, bytes: file.bytes }));
  const mainAsset = files.find((file) => file.path === main);
  const outAsset = files.find((file) => file.path.toLowerCase() === "boards/out.brd");
  const startAsset = files.find((file) => file.path.toLowerCase() === "boards/start.brd");
  if (mainAsset === undefined || outAsset === undefined || startAsset === undefined) throw new Error("the demo package lacks a fixture asset");
  const parsedMain = readMainFile(new BinaryReader(mainAsset.bytes, main));
  const parsedOut = readBoard(new BinaryReader(outAsset.bytes, outAsset.path));
  const parsedStart = readBoard(new BinaryReader(startAsset.bytes, startAsset.path));
  if (!parsedMain.ok || !parsedOut.ok || !parsedStart.ok) throw new Error("the demo package contains an unreadable runner fixture");
  const startProgram = "spinner-start.prg";
  const updatedMain = writeMainFile({ ...parsedMain.value, startupPrg: "" });
  if (!updatedMain.ok) throw new Error(updatedMain.error.message);
  const updatedOut = writeBoard(parsedOut.value);
  // The unused battle music is a background prefetch, so its read can outlive quit without stalling the game.
  const updatedStart = writeBoard({ ...parsedStart.value, properties: { ...parsedStart.value.properties, enterPrg: startProgram, battleBackground: "spinner.bkg" } });
  const background = writeBattleBackground({
    magic: BATTLE_BACKGROUND_MAGIC, major: 2, minor: 2, image: "", music: "media/vip - town2.mid",
    menuMoveSound: "", menuChooseSound: "", readySound: "", cantDoSound: "", residue: new Uint8Array(),
  });
  if (!updatedOut.ok || !updatedStart.ok || !background.ok) throw new Error("could not encode the runner test assets");
  const startSource = 'choice = waitInput()\nif (choice.kind == "key") { quitGame() } else { send("third.brd", 112, 192, 1) }\nend()\n';
  const tree = [
    ...files.map((file) => file.path === main ? { path: file.path, bytes: updatedMain.value } : file.path === startAsset.path ? { path: file.path, bytes: updatedStart.value } : file.path === outAsset.path ? { path: file.path, bytes: updatedOut.value } : file),
    { path: "Bkrounds/spinner.bkg", bytes: background.value },
    { path: "Boards/third.brd", bytes: updatedOut.value },
    { path: `Prg/${startProgram}`, bytes: new TextEncoder().encode(startSource) },
  ];
  const written = writeDistributionPackage({ files: tree, manifest: { schema: manifest.value.schema, main, index: tree.map((file) => file.path) } });
  if (!written.ok) throw new Error(written.error.message);
  const zipEntries = entrySpans(written.value);
  const oldMusic = zipEntries.get("Media/VIP - Town2.mid");
  const replacementBoard = zipEntries.get("Boards/third.brd");
  if (oldMusic === undefined || replacementBoard === undefined) throw new Error("demo package is missing a race asset");
  return {
    bytes: written.value,
    oldMusic,
    replacementBoard,
    descriptor: {
      schema: 1,
      file: PACKAGE.split("/").at(-1),
      sha256: createHash("sha256").update(written.value).digest("hex"),
      size: written.value.length,
      gameId: deriveGameId(updatedMain.value, derivePackageIdentity(tree)),
      title: "Spinner generation race",
      version: "1",
    },
  };
}

/** Read each entry's local span from the ZIP central directory; offsets are fixture-derived, not hard-coded. */
function entrySpans(bytes: Uint8Array): ReadonlyMap<string, Span> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error("generated package has no ZIP end record");
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const spans = new Map<string, Span>();
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    const compressed = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    const localExtra = view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    spans.set(name, { start: local, end: local + 30 + localExtra + compressed });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return spans;
}

function overlaps(header: string | undefined, span: Span): boolean {
  const range = header === undefined ? null : /^bytes=(\d+)-(\d+)$/.exec(header);
  return range !== null && Number(range[1]) < span.end && Number(range[2]) >= span.start;
}


test("a late old-session load notification cannot hide the replacement session's visible spinner", async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = raceFixture();
  const musicGate = gate();
  const destinationGate = gate();
  let musicHeld = false;
  let destinationHeld = false;
  await page.addInitScript(() => {
    let now = 10_000;
    window.__playerClock = () => now;
    Object.defineProperty(window, "__advanceSpinnerClock", { value: (milliseconds: number) => { now += milliseconds; } });
    Object.defineProperty(window, "__observeSpinnerRace", { value: () => {
      const spinner = document.querySelector<HTMLElement>("#spinner");
      if (spinner === null) throw new Error("runner has no spinner element");
      window.__spinnerRaceChanges = [];
      new MutationObserver((records) => {
        for (const record of records) window.__spinnerRaceChanges?.push(record.oldValue === null);
      }).observe(spinner, { attributes: true, attributeFilter: ["hidden"], attributeOldValue: true });
    } });
  });
  await page.route(`**/${PACKAGE}`, async (route) => {
    const range = route.request().headers()["range"];
    if (!musicHeld && overlaps(range, fixture.oldMusic)) {
      musicHeld = true;
      await musicGate.released;
    } else if (!destinationHeld && overlaps(range, fixture.replacementBoard)) {
      destinationHeld = true;
      await destinationGate.released;
    }
    const match = range === undefined ? null : /^bytes=(\d+)-(\d+)$/.exec(range);
    if (match === null) {
      return route.fulfill({ status: 200, contentType: "application/octet-stream", headers: { "content-length": String(fixture.bytes.length), "accept-ranges": "bytes" }, body: Buffer.from(fixture.bytes) });
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), fixture.bytes.length - 1);
    const slice = fixture.bytes.subarray(start, end + 1);
    return route.fulfill({ status: 206, contentType: "application/octet-stream", headers: { "content-range": `bytes ${start}-${end}/${fixture.bytes.length}`, "content-length": String(slice.length) }, body: Buffer.from(slice) });
  });
  await page.route(`**/${PACKAGE}.json`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.descriptor) }));

  await page.goto(`/packages/runner-web/app/index.html?package=${PACKAGE}&mode=streaming`);
  await page.waitForFunction(() => window.__session !== undefined && window.__live !== undefined && window.__live.tick >= 30, undefined, { timeout: 45_000 });
  await expect.poll(() => musicHeld, { timeout: 15_000, message: "old-session hint must reach the deferred source" }).toBe(true);
  await page.waitForFunction(() => window.__session?.loadState().hints.pending > 0, undefined, { timeout: 15_000 });
  await page.evaluate(() => { window.__spinnerRaceOldSession = window.__session; });
  await sendKeyDown(page, "Enter", "Enter");
  await page.waitForFunction(() => window.__spinnerRaceOldSession !== undefined && window.__session !== undefined && window.__session !== window.__spinnerRaceOldSession && window.__live !== undefined, undefined, { timeout: 30_000 });
  const canvasBox = await page.locator("canvas").boundingBox();
  if (canvasBox === null) throw new Error("replacement canvas has no layout box");
  await page.locator("canvas").dispatchEvent("pointerdown", {
    clientX: canvasBox.x + canvasBox.width / 2,
    clientY: canvasBox.y + canvasBox.height / 2,
    button: 0,
    buttons: 1,
    pointerType: "mouse",
  });
  await expect.poll(() => destinationHeld, { timeout: 15_000, message: "replacement board must reach the deferred source" }).toBe(true);
  await page.waitForFunction(() => window.__session?.loadState().blocking?.key === "boards/third.brd", undefined, { timeout: 30_000 });
  await page.evaluate(() => {
    (window as Window & { __advanceSpinnerClock(milliseconds: number): void }).__advanceSpinnerClock(400);
    (window as Window & { __observeSpinnerRace(): void }).__observeSpinnerRace();
  });
  await expect(page.locator("#spinner")).toBeVisible();
  const activeBlock = await page.evaluate(() => window.__session?.loadState().blocking?.key);
  expect(activeBlock).toBe("boards/third.brd");

  musicGate.release();
  await page.waitForFunction(() => window.__spinnerRaceOldSession?.loadState().hints.pending === 0, undefined, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__spinnerRaceChanges ?? [])).not.toContain(true);
  await expect(page.locator("#spinner")).toBeVisible();

  destinationGate.release();
  await page.waitForFunction(() => window.__session?.boardKey() === "boards/third.brd", undefined, { timeout: 30_000 });
});
