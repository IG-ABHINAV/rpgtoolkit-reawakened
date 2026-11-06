import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BinaryReader, deriveGameId, derivePackageIdentity, loadPackage, readDistributionManifest, readMainFile, writeDistributionPackage, writeMainFile } from "@tk-reawakened/core";
import { expect, test, type Page } from "@playwright/test";


type TouchFixture = { readonly name: string; readonly packageBytes: Uint8Array; readonly descriptor: Record<string, unknown> };
type TraceInput = { readonly event: { readonly kind: string; readonly action?: string; readonly down?: boolean; readonly source?: string; readonly modalId?: number | null; readonly code?: string; readonly buttons?: number } };

function packageWithStartup(name: string, startup: string): TouchFixture {
  const loaded = loadPackage({ kind: "tpk", name: "demo.tpk", bytes: new Uint8Array(readFileSync("fixtures/packages/demo.tpk")) });
  if (!loaded.ok) throw new Error(loaded.error.message);
  const manifest = readDistributionManifest(loaded.value);
  if (!manifest.ok) throw new Error(manifest.error.message);
  const main = manifest.value.main;
  const files = loaded.value.files.filter((file) => file.path !== "manifest.json" && !/\.(?:mid|midi|wav|mp3|ogg|flac|sf2)$/i.test(file.path)).map((file) => ({ path: file.path, bytes: file.bytes }));
  const mainFile = files.find((file) => file.path === main);
  if (mainFile === undefined) throw new Error(`the demo package has no ${main}`);
  const parsed = readMainFile(new BinaryReader(mainFile.bytes, main));
  if (!parsed.ok) throw new Error(parsed.error.message);
  const startupPath = "touch-ownership.prg";
  const rewrittenMain = writeMainFile({ ...parsed.value, startupPrg: startupPath });
  if (!rewrittenMain.ok) throw new Error(rewrittenMain.error.message);
  const tree = files.map((file) => file.path === main ? { path: file.path, bytes: rewrittenMain.value } : file);
  tree.push({ path: `Prg/${startupPath}`, bytes: new TextEncoder().encode(startup) });
  const packageResult = writeDistributionPackage({ files: tree, manifest: { schema: manifest.value.schema, main, index: tree.map((file) => file.path) } });
  if (!packageResult.ok) throw new Error(packageResult.error.message);
  return {
    name,
    packageBytes: packageResult.value,
    descriptor: {
      schema: 1,
      file: name,
      sha256: createHash("sha256").update(packageResult.value).digest("hex"),
      size: packageResult.value.length,
      gameId: deriveGameId(rewrittenMain.value, derivePackageIdentity(tree)),
      title: "Touch ownership test",
      version: "1",
    },
  };
}

function packageWithSilentDemoStartup(name: string): TouchFixture {
  const loaded = loadPackage({ kind: "tpk", name: "demo.tpk", bytes: new Uint8Array(readFileSync("fixtures/packages/demo.tpk")) });
  if (!loaded.ok) throw new Error(loaded.error.message);
  const startup = loaded.value.files.find((file) => file.path.toLowerCase() === "prg/start.prg");
  if (startup === undefined) throw new Error("the demo package has no Prg/start.prg");
  const source = new TextDecoder().decode(startup.bytes);
  const silentSource = source.replace('mediaPlay("vip - title2.mid");', "");
  if (silentSource === source) throw new Error("the demo title music call changed; update the silent input fixture");
  return packageWithStartup(name, silentSource);
}

async function servePackage(page: Page, fixture: TouchFixture): Promise<void> {
  await page.route(`**/fixtures/packages/${fixture.name}`, (route) => {
    const bytes = fixture.packageBytes;
    const range = route.request().headers()["range"];
    const match = range === undefined ? null : /^bytes=(\d+)-(\d+)$/.exec(range);
    if (match === null) return route.fulfill({ status: 200, contentType: "application/octet-stream", headers: { "content-length": String(bytes.length), "accept-ranges": "bytes" }, body: Buffer.from(bytes) });
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), bytes.length - 1);
    const slice = bytes.subarray(start, end + 1);
    return route.fulfill({ status: 206, contentType: "application/octet-stream", headers: { "content-range": `bytes ${start}-${end}/${bytes.length}`, "content-length": String(slice.length) }, body: Buffer.from(slice) });
  });
  await page.route(`**/fixtures/packages/${fixture.name}.json`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.descriptor) }));
}

async function closeLiveSession(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const close = (window as Window & { __session?: { close?: () => Promise<void> } }).__session?.close;
    if (close !== undefined) await close();
  }).catch(() => undefined);
}

async function openSilentDemo(page: Page, name: string): Promise<void> {
  const fixture = packageWithSilentDemoStartup(name);
  await servePackage(page, fixture);
  await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}`);
}

async function installInputTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Engine = { advance: (...args: unknown[]) => unknown };
    type TraceWindow = Window & { __session?: { engine?: Engine }; __touchInputTrace?: { readonly inputs: readonly TraceInput[]; readonly consumed: readonly TraceInput[] }[]; __fallbackPointerId?: number };
    const target = window as TraceWindow;
    const engine = target.__session?.engine;
    if (engine === undefined) throw new Error("live engine is unavailable");
    const original = engine.advance;
    target.__touchInputTrace = [];
    document.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Element && event.target.closest(".fallback-touch-button") !== null) target.__fallbackPointerId = (event as PointerEvent).pointerId;
    }, true);
    engine.advance = (...args) => {
      const report = Reflect.apply(original, engine, args) as { readonly consumed?: readonly TraceInput[] };
      target.__touchInputTrace?.push({ inputs: (args[1] as readonly TraceInput[] | undefined) ?? [], consumed: report.consumed ?? [] });
      return report;
    };
  });
}

async function tracedInputs(page: Page): Promise<readonly TraceInput[]> {
  return page.evaluate(() => (window as Window & { __touchInputTrace?: { readonly inputs: readonly TraceInput[] }[] }).__touchInputTrace?.flatMap((entry) => entry.inputs) ?? []);
}


test("fallback confirm and cancel wait for same-button pointer release", async ({ browser }) => {
  const fixture = packageWithStartup("touch-ownership-input.tpk", 'msgbox("Touch controls")\nend()');
  for (const [name, action] of [["Confirm", "confirm"], ["Cancel", "cancel"]] as const) {
    const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 932 } });
    const page = await context.newPage();
    const button = page.getByRole("button", { name });
    const setup = async (): Promise<{ readonly x: number; readonly y: number }> => {
      await page.getByRole("button", { name: "Confirm" }).waitFor({ state: "visible", timeout: 45_000 });
      await installInputTrace(page);
      const box = await button.boundingBox();
      if (box === null) throw new Error(`${name} fallback button has no bounds`);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const resetTrace = async (): Promise<void> => {
      await page.evaluate(() => {
        const target = window as Window & { __touchInputTrace?: { readonly inputs: readonly TraceInput[]; readonly consumed: readonly TraceInput[] }[]; __fallbackPointerId?: number };
        target.__touchInputTrace = [];
        delete target.__fallbackPointerId;
      });
    };
    try {
      await servePackage(page, fixture);
      await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}`);
      const first = await setup();

      await button.hover();
      await page.mouse.down();
      await page.waitForTimeout(50);
      expect((await tracedInputs(page)).filter((input) => input.event.kind === "action" && input.event.action === action && input.event.source === "runner.fallback")).toHaveLength(0);
      await page.mouse.move(first.x + 80, first.y);
      await page.mouse.move(first.x, first.y);
      await page.mouse.up();
      await page.waitForTimeout(50);
      expect((await tracedInputs(page)).filter((input) => input.event.kind === "action" && input.event.action === action && input.event.source === "runner.fallback")).toHaveLength(0);

      await resetTrace();
      await button.hover();
      await page.mouse.down();
      await page.waitForFunction(() => typeof (window as Window & { __fallbackPointerId?: number }).__fallbackPointerId === "number", undefined, { timeout: 2_000 });
      const pointerId = await page.evaluate(() => (window as Window & { __fallbackPointerId?: number }).__fallbackPointerId ?? -1);
      if (pointerId < 0) throw new Error(`${name} fallback pointer id was not recorded`);
      await button.evaluate((element, id) => {
        element.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: id, pointerType: "mouse", button: 0, buttons: 0 }));
      }, pointerId);
      await page.mouse.up();
      await page.waitForTimeout(50);
      expect((await tracedInputs(page)).filter((input) => input.event.kind === "action" && input.event.action === action && input.event.source === "runner.fallback")).toHaveLength(0);

      await resetTrace();
      await button.click();
      await page.waitForFunction((wanted) => {
        const trace = (window as Window & { __touchInputTrace?: { readonly inputs: readonly TraceInput[] }[] }).__touchInputTrace ?? [];
        return trace.flatMap((entry) => entry.inputs).some((input) => input.event.kind === "action" && input.event.action === wanted && input.event.source === "runner.fallback" && input.event.down === false);
      }, action, { timeout: 10_000 });
      const input = (await tracedInputs(page)).filter((entry) => entry.event.kind === "action" && entry.event.action === action && entry.event.source === "runner.fallback");
      expect(input.filter((entry) => entry.event.down === true)).toHaveLength(1);
      expect(input.filter((entry) => entry.event.down === false)).toHaveLength(1);
    } finally {
      await closeLiveSession(page);
      await context.close();
    }
  }
});

test("fallback DOM yields overlapping author and modal pointers to core", async ({ browser }) => {
  const author = packageWithStartup("author-touch-overlap.tpk", [
    "activated = 0",
    "while (1) {",
    'uiBegin("overlap", "surface", 0, 0, 640, 480)',
    'uiItem("Other", { id: "other", bounds: { x: 10, y: 10, w: 80, h: 40 } })',
    'if (activated == 0) { uiItem("Author target", { id: "overlap", bounds: { x: 480, y: 390, w: 100, h: 90 }, action: "confirm" }) }',
    'if (activated == 1) { uiItem("Author target activated", { id: "overlap", bounds: { x: 480, y: 390, w: 100, h: 90 }, action: "confirm" }) }',
    "uiEnd()",
    "if (uiActivated() >= 0) { activated = 1 }",
    "sleep(1)",
    "}",
  ].join("\n"));
  const modal = packageWithStartup("modal-touch-overlap.tpk", 'msgbox("Modal wins")\nend()');
  for (const fixture of [author, modal]) {
    const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 932 } });
    const page = await context.newPage();
      if (fixture === modal) {
        await page.addInitScript(() => {
          const target = window as Window & { __audioResumeStates?: string[]; __sessionAudioContext?: AudioContext };
          target.__audioResumeStates = [];
          const NativeAudioContext = window.AudioContext;
          const original = NativeAudioContext.prototype.resume;
          NativeAudioContext.prototype.resume = function (...args: Parameters<typeof original>): Promise<void> {
            target.__audioResumeStates?.push(this.state);
            return original.apply(this, args);
          };
          window.AudioContext = class extends NativeAudioContext {
            constructor(options?: AudioContextOptions) {
              super(options);
              target.__sessionAudioContext = this;
            }
          };
        });
      }
    try {
      await servePackage(page, fixture);
      await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}`);
      const confirm = page.getByRole("button", { name: "Confirm" });
      await confirm.waitFor({ state: "visible", timeout: 45_000 });
      if (fixture === modal) {
        await page.waitForFunction(() => (window as Window & { __sessionAudioContext?: AudioContext }).__sessionAudioContext !== undefined, undefined, { timeout: 10_000 });
        const suspended = await page.evaluate(async () => {
          const audio = (window as Window & { __sessionAudioContext?: AudioContext }).__sessionAudioContext;
          if (audio === undefined) return false;
          await audio.suspend();
          return audio.state === "suspended";
        });
        expect(suspended).toBe(true);
      }
      const box = await confirm.boundingBox();
      if (box === null) throw new Error("Confirm fallback button has no bounds");
      await page.waitForFunction(({ screenX, screenY, expected }) => {
        const target = window as Window & { __session?: { readonly engine?: { runnerControlPointerPreemption(x: number, y: number): number | "author" | null }; readonly displayGeometry?: () => { readonly game: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } }; readonly viewSize?: () => { readonly width: number; readonly height: number } } };
        const session = target.__session;
        const geometry = session?.displayGeometry?.();
        const size = session?.viewSize?.();
        if (session?.engine === undefined || geometry === undefined || size === undefined) return false;
        const stage = document.querySelector(".fallback-touch-controls")?.parentElement?.getBoundingClientRect();
        if (stage === undefined) return false;
        const x = Math.floor((screenX - stage.left - geometry.game.x) / (geometry.game.width / size.width));
        const y = Math.floor((screenY - stage.top - geometry.game.y) / (geometry.game.height / size.height));
        const claim = session.engine.runnerControlPointerPreemption(x, y);
        return expected === "author" ? claim === "author" : claim === 1;
      }, { screenX: box.x + box.width / 2, screenY: box.y + box.height / 2, expected: fixture === author ? "author" : "modal" }, { timeout: 45_000 });
      await installInputTrace(page);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      if (fixture === modal) {
        await page.waitForFunction(() => (window as Window & { __sessionAudioContext?: AudioContext }).__sessionAudioContext?.state === "running", undefined, { timeout: 10_000 });
        const resumeStates = await page.evaluate(() => (window as Window & { __audioResumeStates?: string[] }).__audioResumeStates ?? []);
        expect(resumeStates).toContain("suspended");
      }
      await page.waitForFunction(() => {
        const trace = (window as Window & { __touchInputTrace?: { readonly inputs: readonly TraceInput[] }[] }).__touchInputTrace ?? [];
        return trace.flatMap((entry) => entry.inputs).some((input) => input.event.kind === "pointer");
      }, undefined, { timeout: 10_000 });
      const input = await tracedInputs(page);
      expect(input.some((entry) => entry.event.kind === "pointer" && entry.event.buttons === 1)).toBe(true);
      expect(input.some((entry) => entry.event.kind === "pointer" && entry.event.buttons === 0)).toBe(true);
      if (fixture === author) {
        await page.waitForFunction(() => {
          const target = window as Window & {
            __session?: {
              readonly engine?: {
                accessibilityTree(): readonly { readonly children?: readonly { readonly label: string; readonly focused: boolean }[] }[];
              };
            };
          };
          return target.__session?.engine?.accessibilityTree().some((node) => node.children?.some((child) => child.label === "Author target activated")) ?? false;
        }, undefined, { timeout: 10_000 });
        expect(input.filter((entry) => entry.event.kind === "action" && entry.event.source === "runner.fallback")).toHaveLength(0);
      } else {
        await page.waitForFunction((action) => {
          const target = window as Window & {
            __session?: { readonly engine?: { runnerControlPointerPreemption(x: number, y: number): number | "author" | null } };
            __touchInputTrace?: { readonly inputs: readonly TraceInput[] }[];
          };
          return typeof (target.__session?.engine?.runnerControlPointerPreemption(0, 0)) !== "number" &&
            (target.__touchInputTrace ?? []).flatMap((entry) => entry.inputs).some((entry) =>
              entry.event.kind === "action" && entry.event.action === action && entry.event.source === "runner.fallback" && entry.event.down === false);
        }, "confirm", { timeout: 10_000 });
        const modalActions = (await tracedInputs(page)).filter((entry) => entry.event.kind === "action" && entry.event.action === "confirm" && entry.event.source === "runner.fallback");
        expect(modalActions.filter((entry) => entry.event.down === true)).toHaveLength(1);
        expect(modalActions.filter((entry) => entry.event.down === false)).toHaveLength(1);
        expect(modalActions.map((entry) => entry.event.modalId)).toEqual([1, 1]);
      }
    } finally {
      if (fixture === modal) {
        await page.evaluate(async () => {
          const audio = (window as Window & { __sessionAudioContext?: AudioContext }).__sessionAudioContext;
          if (audio !== undefined && audio.state !== "closed") await audio.close();
        });
      }
      await closeLiveSession(page);
      await context.close();
    }
  }
});
test("leaving the host cancels a modal-preempted fallback press", async ({ browser }) => {
  const modal = packageWithStartup("modal-touch-cancel.tpk", 'msgbox("Modal wins")\nend()');
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    await servePackage(page, modal);
    await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${modal.name}`);
    const confirm = page.getByRole("button", { name: "Confirm" });
    await confirm.waitFor({ state: "visible", timeout: 45_000 });
    const button = await confirm.boundingBox();
    const report = await page.locator("#report").boundingBox();
    if (button === null || report === null) throw new Error("modal control or report area has no bounds");
    await installInputTrace(page);
    await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
    await page.mouse.down();
    await page.mouse.move(report.x + report.width / 2, report.y + report.height / 2);
    await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(50);
    expect((await tracedInputs(page)).filter((entry) => entry.event.kind === "action" && entry.event.action === "confirm" && entry.event.source === "runner.fallback")).toHaveLength(0);
    const stillModal = await page.evaluate(({ buttonCenterX, buttonCenterY }) => {
      const target = window as Window & {
        __session?: {
          readonly engine?: { runnerControlPointerPreemption(x: number, y: number): number | "author" | null };
          readonly displayGeometry?: () => { readonly game: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } };
          readonly viewSize?: () => { readonly width: number; readonly height: number };
        };
      };
      const session = target.__session;
      const geometry = session?.displayGeometry?.();
      const size = session?.viewSize?.();
      const stage = document.querySelector(".fallback-touch-controls")?.parentElement?.getBoundingClientRect();
      if (session?.engine === undefined || geometry === undefined || size === undefined || stage === undefined) return false;
      const x = Math.floor((buttonCenterX - stage.left - geometry.game.x) / (geometry.game.width / size.width));
      const y = Math.floor((buttonCenterY - stage.top - geometry.game.y) / (geometry.game.height / size.height));
      return typeof session.engine.runnerControlPointerPreemption(x, y) === "number";
    }, { buttonCenterX: button.x + button.width / 2, buttonCenterY: button.y + button.height / 2 });
    expect(stillModal).toBe(true);
  } finally {
    await closeLiveSession(page);
    await context.close();
  }
});

test("an A-scoped fallback release cannot dismiss modal B when Enter is queued in the same advance", async ({ browser }) => {
  const fixture = packageWithStartup("modal-owner-race.tpk", 'first = msgbox("Modal A")\nsecond = msgbox("Modal B")\nend()');
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    await servePackage(page, fixture);
    await page.goto(`/packages/runner-web/app/index.html?package=fixtures/packages/${fixture.name}`);
    const confirm = page.getByRole("button", { name: "Confirm" });
    await confirm.waitFor({ state: "visible", timeout: 45_000 });
    await page.waitForFunction(() => {
      const session = (window as Window & { __session?: { readonly engine?: { runnerControlPointerPreemption(x: number, y: number): number | "author" | null } } }).__session;
      return session?.engine?.runnerControlPointerPreemption(0, 0) === 1;
    }, undefined, { timeout: 45_000 });
    await installInputTrace(page);
    const box = await confirm.boundingBox();
    if (box === null) throw new Error("Confirm fallback button has no bounds");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForFunction(() => typeof (window as Window & { __fallbackPointerId?: number }).__fallbackPointerId === "number");
    const pointerId = await page.evaluate(() => (window as Window & { __fallbackPointerId?: number }).__fallbackPointerId ?? -1);
    if (pointerId < 0) throw new Error("modal fallback pointer id was not recorded");
    await page.evaluate(({ pointerId, x, y }) => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      const button = document.querySelector<HTMLButtonElement>(".fallback-touch-button[data-action='confirm']");
      if (button === null) throw new Error("Confirm fallback button disappeared");
      button.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "mouse",
        button: 0,
        buttons: 0,
        clientX: x,
        clientY: y,
      }));
    }, { pointerId, x, y });
    await page.waitForTimeout(150);
    const proof = await page.evaluate(() => {
      const target = window as Window & {
        __session?: { readonly engine?: { runnerControlPointerPreemption(x: number, y: number): number | "author" | null } };
        __touchInputTrace?: { readonly inputs: readonly TraceInput[] }[];
      };
      const trace = target.__touchInputTrace ?? [];
      const sameAdvance = trace.some((entry) =>
        entry.inputs.some((input) => input.event.kind === "key" && input.event.code === "Enter" && input.event.down === true) &&
        entry.inputs.some((input) => input.event.kind === "action" && input.event.action === "confirm" && input.event.modalId === 1 && input.event.down === true));
      return { sameAdvance, claim: target.__session?.engine?.runnerControlPointerPreemption(0, 0) ?? null, inputs: trace.map((entry) => entry.inputs.map(({ event }) => event.kind === "key" ? { kind: event.kind, code: event.code, down: event.down } : event.kind === "action" ? { kind: event.kind, action: event.action, down: event.down, modalId: event.modalId } : event.kind === "pointer" ? { kind: event.kind, buttons: event.buttons } : { kind: event.kind })) };
    });
    expect(proof.sameAdvance, JSON.stringify(proof)).toBe(true);
    expect(proof.claim).toBe(2);
    await page.mouse.up();
  } finally {
    await closeLiveSession(page);
    await context.close();
  }
});

test("fallback grid gaps pass through and unrelated focused-button keys reach gameplay", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    await openSilentDemo(page, "touch-grid-gap.tpk");
    const moveRight = page.getByRole("button", { name: "Move right" });
    await moveRight.waitFor({ state: "visible", timeout: 45_000 });
    await installInputTrace(page);
    await page.evaluate(() => {
      const target = window as Window & { __rawPointerDown?: { readonly target: string; readonly buttons: number; readonly x: number; readonly y: number } };
      target.__rawPointerDown = undefined;
      document.getElementById("stage")?.addEventListener("pointerdown", (event) => {
        target.__rawPointerDown = { target: (event.target as Element).tagName, buttons: (event as PointerEvent).buttons, x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY };
      }, true);
    });
    const gap = await page.locator(".fallback-touch-pad").evaluate((pad) => {
      const bounds = pad.getBoundingClientRect();
      const stage = document.getElementById("stage");
      for (let y = Math.ceil(bounds.top) + 2; y < bounds.bottom - 2; y += 3) {
        for (let x = Math.ceil(bounds.left) + 2; x < bounds.right - 2; x += 3) {
          const target = document.elementFromPoint(x, y);
          if (target instanceof Node && stage?.contains(target) === true && !(target instanceof Element && target.closest(".fallback-touch-controls") !== null)) return { x, y };
        }
      }
      throw new Error("fallback touch pad has no hit-testable transparent gap");
    });
    const target = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      const stage = document.getElementById("stage");
      return {
        isButton: element?.matches(".fallback-touch-button") ?? false,
        insideFallback: element instanceof Element && element.closest(".fallback-touch-controls") !== null,
        insideStage: element instanceof Node && stage?.contains(element) === true,
        stageRect: stage?.getBoundingClientRect().toJSON(),
        viewport: { width: innerWidth, height: innerHeight, pointInside: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight },
      };
    }, gap);
    expect(target.isButton).toBe(false);
    expect(target.insideFallback).toBe(false);
    expect(target.insideStage).toBe(true);
    await page.mouse.click(gap.x, gap.y);
    await page.waitForFunction(() => {
      const trace = (window as Window & { __touchInputTrace?: { readonly inputs: readonly TraceInput[] }[] }).__touchInputTrace ?? [];
      return trace.flatMap((entry) => entry.inputs).some((input) => input.event.kind === "pointer");
    }, undefined, { timeout: 10_000 });
    const pointerInputs = (await tracedInputs(page)).filter((input) => input.event.kind === "pointer");
    const rawPointer = await page.evaluate(() => (window as Window & { __rawPointerDown?: unknown }).__rawPointerDown);
    expect(target.viewport.pointInside).toBe(true);
    expect(rawPointer).not.toBeUndefined();
    expect(pointerInputs.length, `gap target: ${JSON.stringify({ target, rawPointer })}`).toBeGreaterThan(0);

    await moveRight.focus();
    await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight");
    await page.keyboard.down("Escape");
    await page.keyboard.up("Escape");
    await page.waitForFunction(() => {
      const trace = (window as Window & { __touchInputTrace?: { readonly inputs: readonly TraceInput[] }[] }).__touchInputTrace ?? [];
      const keys = trace.flatMap((entry) => entry.inputs).filter((entry) => entry.event.kind === "key");
      return ["ArrowRight", "Escape"].every((code) => keys.some((entry) => entry.event.code === code && entry.event.down === true) && keys.some((entry) => entry.event.code === code && entry.event.down === false));
    }, undefined, { timeout: 10_000 });
  } finally {
    await closeLiveSession(page);
    await context.close();
  }
});

test("held Enter on a focused Confirm button emits one action edge", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    await openSilentDemo(page, "touch-held-enter.tpk");
    const confirm = page.getByRole("button", { name: "Confirm" });
    await confirm.waitFor({ state: "visible", timeout: 45_000 });
    await installInputTrace(page);
    await page.evaluate(() => {
      const target = window as Window & { __repeatKeydowns?: number };
      target.__repeatKeydowns = 0;
      document.addEventListener("keydown", (event) => {
        if (event.code === "Enter" && event.repeat) target.__repeatKeydowns = (target.__repeatKeydowns ?? 0) + 1;
      }, true);
    });
    await confirm.focus();
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await page.waitForFunction(() => {
      const trace = (window as Window & { __touchInputTrace?: { readonly inputs: readonly TraceInput[] }[] }).__touchInputTrace ?? [];
      return trace.flatMap((entry) => entry.inputs).some((input) => input.event.kind === "action" && input.event.action === "confirm" && input.event.source === "runner.fallback" && input.event.down === false);
    }, undefined, { timeout: 10_000 });
    const actionEdges = (await tracedInputs(page)).filter((entry) => entry.event.kind === "action" && entry.event.action === "confirm" && entry.event.source === "runner.fallback");
    expect(actionEdges.filter((entry) => entry.event.down === true)).toHaveLength(1);
    expect(actionEdges.filter((entry) => entry.event.down === false)).toHaveLength(1);
    expect(await page.evaluate(() => (window as Window & { __repeatKeydowns?: number }).__repeatKeydowns ?? 0)).toBeGreaterThan(0);
  } finally {
    await closeLiveSession(page);
    await context.close();
  }
});

test("fallback pointer ownership clears after blur before the next gameplay click", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    await openSilentDemo(page, "touch-blur-owner.tpk");
    const right = page.getByRole("button", { name: "Move right" });
    await right.waitFor({ state: "visible", timeout: 45_000 });
    await installInputTrace(page);
    await right.hover();
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const stage = await page.locator("#stage").boundingBox();
    if (stage === null) throw new Error("game stage has no bounds");
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.waitForTimeout(50);
    expect((await tracedInputs(page)).some((entry) => entry.event.kind === "pointer" && entry.event.buttons === 1)).toBe(false);
    await page.mouse.move(-20, -20);
    await page.mouse.up();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const x = stage.x + stage.width / 2;
    const y = stage.y + stage.height / 2;
    const clickTarget = await page.evaluate(({ x: clickX, y: clickY }) => {
      const target = document.elementFromPoint(clickX, clickY);
      return { insideFallback: target instanceof Element && target.closest(".fallback-touch-controls") !== null };
    }, { x, y });
    expect(clickTarget.insideFallback).toBe(false);
    await page.mouse.click(x, y);
    await page.waitForFunction(() => {
      const trace = (window as Window & { __touchInputTrace?: { readonly inputs: readonly TraceInput[] }[] }).__touchInputTrace ?? [];
      return trace.flatMap((entry) => entry.inputs).some((input) => input.event.kind === "pointer" && input.event.buttons === 1);
    }, undefined, { timeout: 10_000 });
    const pointerEvents = (await tracedInputs(page)).filter((entry) => entry.event.kind === "pointer");
    expect(pointerEvents.some((entry) => entry.event.buttons === 1)).toBe(true);
    expect(pointerEvents.some((entry) => entry.event.buttons === 0)).toBe(true);
  } finally {
    await closeLiveSession(page);
    await context.close();
  }
});
test("lost fallback capture keeps a held pointer away from gameplay", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    await openSilentDemo(page, "touch-lost-capture.tpk");
    const right = page.getByRole("button", { name: "Move right" });
    await right.waitFor({ state: "visible", timeout: 45_000 });
    await installInputTrace(page);
    await page.evaluate(() => {
      const target = window as Window & { __fallbackPointerId?: number };
      document.addEventListener("pointerdown", (event) => {
        if ((event.target as Element).closest(".fallback-touch-button") !== null) target.__fallbackPointerId = event.pointerId;
      }, true);
    });
    const button = await right.boundingBox();
    const stage = await page.locator("#stage").boundingBox();
    if (button === null || stage === null) throw new Error("fallback button or game stage has no bounds");
    await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
    await page.mouse.down();
    await page.waitForFunction(() => typeof (window as Window & { __fallbackPointerId?: number }).__fallbackPointerId === "number");
    const pointerId = await page.evaluate(() => (window as Window & { __fallbackPointerId?: number }).__fallbackPointerId ?? -1);
    expect(await right.evaluate((element, id) => element.hasPointerCapture(id), pointerId)).toBe(true);
    await right.evaluate((element, id) => element.releasePointerCapture(id), pointerId);
    await page.waitForFunction(({ id }) => !document.querySelector(".fallback-touch-button")?.hasPointerCapture(id), { id: pointerId });
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.evaluate(() => {
      const { promise, resolve } = Promise.withResolvers<void>();
      requestAnimationFrame(resolve);
      return promise;
    });
    expect((await tracedInputs(page)).some((entry) => entry.event.kind === "pointer" && entry.event.buttons === 1)).toBe(false);
    await page.mouse.up();
    await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.waitForFunction(() => {
      const trace = (window as Window & { __touchInputTrace?: { readonly inputs: readonly TraceInput[] }[] }).__touchInputTrace ?? [];
      return trace.flatMap((entry) => entry.inputs).some((entry) => entry.event.kind === "pointer" && entry.event.buttons === 1);
    }, undefined, { timeout: 10_000 });
  } finally {
    await closeLiveSession(page);
    await context.close();
  }
});

test("blur suppresses a held gameplay pointer until physical release", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  try {
    await openSilentDemo(page, "touch-blur-gameplay.tpk");
    await page.getByRole("button", { name: "Confirm" }).waitFor({ state: "visible", timeout: 45_000 });
    await installInputTrace(page);
    const stage = await page.locator("#stage").boundingBox();
    if (stage === null) throw new Error("game stage has no bounds");
    const x = stage.x + stage.width / 2;
    const y = stage.y + stage.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForFunction(() => {
      const trace = (window as Window & { __touchInputTrace?: { readonly inputs: readonly TraceInput[] }[] }).__touchInputTrace ?? [];
      return trace.flatMap((entry) => entry.inputs).some((entry) => entry.event.kind === "pointer" && entry.event.buttons === 1);
    }, undefined, { timeout: 10_000 });
    const report = await page.locator("#report").boundingBox();
    if (report === null) throw new Error("player report has no bounds");
    await page.mouse.move(report.x + report.width / 2, report.y + report.height / 2);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.mouse.move(x + 8, y + 8);
    await page.waitForTimeout(50);
    const beforeRelease = (await tracedInputs(page)).filter((entry) => entry.event.kind === "pointer" && entry.event.buttons === 1);
    expect(beforeRelease).toHaveLength(1);
    await page.mouse.up();
    await page.mouse.click(x + 16, y + 16);
    await page.waitForFunction(() => {
      const trace = (window as Window & { readonly __touchInputTrace?: { readonly inputs: readonly TraceInput[] }[] }).__touchInputTrace ?? [];
      return trace.flatMap((entry) => entry.inputs).filter((entry) => entry.event.kind === "pointer" && entry.event.buttons === 1).length === 2;
    }, undefined, { timeout: 10_000 });
  } finally {
    await closeLiveSession(page);
    await context.close();
  }
});
