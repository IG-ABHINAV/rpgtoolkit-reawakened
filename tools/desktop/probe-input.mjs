// Prove one real key press reaches the live engine inside the Electron window (entry 9.16).
//
//   node tools/desktop/probe-input.mjs --host-metrics
//   node tools/desktop/probe-input.mjs --package /path/to/game.tpk
//
// It launches the built desktop player exactly as `desktop:run` does, but with Chromium's remote debugging port open,
// then drives real input through the DevTools protocol (`Input.dispatchKeyEvent`, which delivers trusted key events to
// the focused page — the same path a physical keyboard takes inside the renderer). It reads the live status the page
// publishes on `window.__live` before and after, and reports the positions.
//
// This is the desktop counterpart to the browser movement test: that one proves the page's input path, this one proves
// the same path inside the packaged Electron window.

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeMovement } from "./probe-judge.mjs";
import { electronBinary } from "./electron-binary.mjs";
import { probeDesktopCsp } from "./probe-csp.mjs";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { BinaryReader, deriveGameId, derivePackageIdentity, loadPackage, readDistributionManifest, readMainFile, writeDistributionPackage, writeMainFile } from "@tk-reawakened/core";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const dist = join(root, "packages", "runner-desktop", "dist");

function argument(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? resolve(process.argv[at + 1] ?? "") : fallback;
}

/** A port the OS says is free, so two runs never collide. */
function freePort() {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => done(port));
    });
  });
}

let temporaryPackageDirectory = null;

function hostMetricsPackagePath() {
  const source = loadPackage({ kind: "tpk", name: "demo.tpk", bytes: new Uint8Array(readFileSync(join(root, "fixtures", "packages", "demo.tpk"))) });
  if (!source.ok) throw new Error(source.error.message);
  const manifest = readDistributionManifest(source.value);
  if (!manifest.ok) throw new Error(manifest.error.message);
  const mainPath = manifest.value.main;
  const files = source.value.files.filter((file) => file.path !== "manifest.json").map((file) => ({ path: file.path, bytes: file.bytes }));
  const mainFile = files.find((file) => file.path === mainPath);
  if (mainFile === undefined) throw new Error(`the demo package has no ${mainPath}`);
  const parsed = readMainFile(new BinaryReader(mainFile.bytes, mainPath));
  if (!parsed.ok) throw new Error(parsed.error.message);
  const startupPath = "host-metrics.prg";
  const startup = `on(game, "viewportResized", (event) => {
  leftMargin = marginWidth("left")
  if (leftMargin > 0 && leftMargin == event.detail.marginLeft) {
    send("start.brd", leftMargin, 128, 1)
  }
})
`;
  const rewritten = writeMainFile({ ...parsed.value, startupPrg: startupPath });
  if (!rewritten.ok) throw new Error(rewritten.error.message);
  const tree = files.map((file) => (file.path === mainPath ? { path: file.path, bytes: rewritten.value } : file));
  tree.push({ path: `Prg/${startupPath}`, bytes: new TextEncoder().encode(startup) });
  const bytes = writeDistributionPackage({ files: tree, manifest: { schema: manifest.value.schema, main: mainPath, index: tree.map((file) => file.path) } });
  if (!bytes.ok) throw new Error(bytes.error.message);
  temporaryPackageDirectory = mkdtempSync(join(root, "fixtures", "packages", "host-metrics-"));
  process.once("exit", () => {
    if (temporaryPackageDirectory !== null) rmSync(temporaryPackageDirectory, { recursive: true, force: true });
  });
  const packageFile = join(temporaryPackageDirectory, "host-metrics.tpk");
  writeFileSync(packageFile, bytes.value);
  writeFileSync(`${packageFile}.json`, JSON.stringify({
    schema: 1,
    file: "host-metrics.tpk",
    sha256: createHash("sha256").update(bytes.value).digest("hex"),
    size: bytes.value.length,
    gameId: deriveGameId(rewritten.value, derivePackageIdentity(tree)),
    title: "Host metrics",
    version: "1",
  }));
  return packageFile;
}

function packagePath() {
  if (process.argv.includes("--host-metrics")) return hostMetricsPackagePath();
  const named = argument("--package", null);
  if (named !== null) return named;
  const out = join(root, "fixtures", "packages", "demo.tpk");
  execFileSync(
    process.execPath,
    [join(root, "tools", "make-package", "run.mjs"), join(root, "fixtures", "legacy", "demo"),
      "--closing-plan", join(root, "golden", "closing", "plan.json"), "--game", "demo", "--out", out, "--title", "Demo"],
    { cwd: root, stdio: "inherit" },
  );
  return out;
}

async function targets(port) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const list = await response.json();
        const page = list.find((entry) => typeof entry.url === "string" && entry.url.startsWith("app://"));
        if (page !== undefined && page.webSocketDebuggerUrl !== undefined) return { targetId: page.id, webSocketDebuggerUrl: page.webSocketDebuggerUrl };
      }
    } catch {
      // The port is not listening yet.
    }
    await new Promise((wait) => setTimeout(wait, 100));
  }
  throw new Error("the desktop page never appeared on the debugging port");
}
async function nodeDebuggerTarget(port) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const list = await response.json();
        const main = list.find((entry) => entry.type === "node" && typeof entry.webSocketDebuggerUrl === "string");
        if (main !== undefined) return main.webSocketDebuggerUrl;
      }
    } catch {
      // The main-process inspector has not started yet.
    }
    await new Promise((wait) => setTimeout(wait, 100));
  }
  throw new Error("the Electron main-process inspector did not appear");
}

async function resizeWindowContent(mainDebugger, width, height, area) {
  const expression = `(() => {
    const window = process.mainModule.require("electron").BrowserWindow.getAllWindows()[0];
    if (window === undefined) throw new Error("Electron has no BrowserWindow");
    const [contentWidth, contentHeight] = window.getContentSize();
    window.setContentSize(
      Math.round(contentWidth + ${width} - ${area.width}),
      Math.round(contentHeight + ${height} - ${area.height})
    );
    return window.getContentSize();
  })()`;
  const result = await mainDebugger.send("Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}
async function inspectWindowCapacity(mainDebugger) {
  const result = await mainDebugger.send("Runtime.evaluate", {
    expression: `(() => {
      const { screen } = process.mainModule.require("electron");
      const window = process.mainModule.require("electron").BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error("Electron has no BrowserWindow");
      const bounds = window.getBounds();
      const display = screen.getDisplayMatching(bounds);
      window.setPosition(display.workArea.x, display.workArea.y);
      return {
        bounds: window.getBounds(),
        contentSize: window.getContentSize(),
        workArea: display.workArea,
        workAreaSize: display.workAreaSize,
      };
    })()`,
    returnByValue: true,
  });
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}
async function verifyNonIntegerScaleViaEmulation(mainDebugger, page, evaluate, sleep, nativeTarget) {
  const beforeArea = await evaluate(`(() => {
    const area = document.querySelector("#viewport").getBoundingClientRect();
    return { width: area.width, height: area.height };
  })()`);
  const beforeNativeResize = await evaluate("window.__hostConsumed?.length ?? 0");
  const nativeContentSize = await resizeWindowContent(mainDebugger, nativeTarget[0], nativeTarget[1], beforeArea);
  let nativeObservation = null;
  let lastNativeObservation = null;
  for (let attempt = 0; attempt < 40 && nativeObservation === null; attempt += 1) {
    const observation = await evaluate(`(() => {
      const area = document.querySelector("#viewport").getBoundingClientRect();
      const consumed = window.__hostConsumed?.slice(${beforeNativeResize}) ?? [];
      const display = consumed.filter(input => input.event.kind === "host.display").at(-1)?.event.geometry ?? null;
      return { area: { width: area.width, height: area.height }, display, consumedCount: consumed.length, consumedKinds: consumed.slice(-4).map(input => input.event.kind) };
    })()`);
    lastNativeObservation = observation;
    if (Math.abs(observation.area.width - nativeTarget[0]) < 0.5
      && Math.abs(observation.area.height - nativeTarget[1]) < 0.5
      && observation.display !== null
      && Math.abs(observation.display.content.width - observation.area.width) < 0.01
      && Math.abs(observation.display.content.height - observation.area.height) < 0.01) nativeObservation = observation;
    else await sleep(50);
  }
  if (nativeObservation === null) throw new Error(`desktop resize proof could not re-establish a measured native viewport before emulation: ${JSON.stringify({ nativeContentSize, lastNativeObservation })}`);

  const beforeEmulation = await evaluate("window.__hostConsumed?.length ?? 0");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1011, deviceScaleFactor: 1, mobile: false });
  let emulatedObservation = null;
  try {
    for (let attempt = 0; attempt < 40 && emulatedObservation === null; attempt += 1) {
      const observation = await evaluate(`(() => {
        const area = document.querySelector("#viewport").getBoundingClientRect();
        const display = window.__hostConsumed?.slice(${beforeEmulation}).filter(input => input.event.kind === "host.display").at(-1)?.event.geometry ?? null;
        return { area: { width: area.width, height: area.height }, display };
      })()`);
      const ratio = Math.min(observation.area.width / 640, observation.area.height / 480);
      if (ratio > 1.5 && ratio < 2 && observation.display !== null
        && Math.abs(observation.display.content.width - observation.area.width) < 0.01
        && Math.abs(observation.display.content.height - observation.area.height) < 0.01) emulatedObservation = observation;
      else await sleep(50);
    }
    if (emulatedObservation === null) throw new Error("emulated viewport did not produce a measured 1.5–2.0 scale host.display");
    const geometry = await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
      const area = document.querySelector("#viewport").getBoundingClientRect();
      const canvas = document.querySelector("#screen");
      const view = window.__session.viewSize();
      const display = window.__hostConsumed.slice(${beforeEmulation}).filter(input => input.event.kind === "host.display").at(-1)?.event.geometry ?? null;
      resolve({ area: { width: area.width, height: area.height }, backing: { width: canvas.width, height: canvas.height }, view, display });
    })))`);
    const ratio = Math.min(geometry.area.width / geometry.view.width, geometry.area.height / geometry.view.height);
    const floorScale = Math.floor(ratio);
    const roundedScale = Math.round(ratio);
    const floorWidth = geometry.view.width * floorScale;
    const floorHeight = geometry.view.height * floorScale;
    if (ratio <= 1.5 || ratio >= 2 || floorScale === roundedScale
      || geometry.backing.width !== Math.ceil(geometry.area.width)
      || geometry.backing.height !== Math.ceil(geometry.area.height)
      || geometry.display === null
      || Math.abs(geometry.display.content.width - geometry.area.width) > 0.01
      || Math.abs(geometry.display.content.height - geometry.area.height) > 0.01
      || Math.abs(geometry.display.game.x - (geometry.area.width - floorWidth) / 2) > 0.05
      || Math.abs(geometry.display.game.y - (geometry.area.height - floorHeight) / 2) > 0.05
      || Math.abs(geometry.display.game.width - floorWidth) > 0.05
      || Math.abs(geometry.display.game.height - floorHeight) > 0.05
      || Math.abs(geometry.display.game.width - geometry.view.width * roundedScale) < 0.05
      || Math.abs(geometry.display.game.height - geometry.view.height * roundedScale) < 0.05) {
      throw new Error(`emulated desktop geometry did not prove production floor scaling against round scaling: ${JSON.stringify({ geometry, ratio, floorScale, roundedScale })}`);
    }
    return { kind: "devtools-emulated", ...geometry, ratio, floorScale, roundedScale, nativeArea: nativeObservation.area };
  } finally {
    const beforeRestore = await evaluate("window.__hostConsumed?.length ?? 0");
    await page.send("Emulation.clearDeviceMetricsOverride");
    let restoredObservation = null;
    for (let attempt = 0; attempt < 40 && restoredObservation === null; attempt += 1) {
      const restored = await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const area = document.querySelector("#viewport").getBoundingClientRect();
        const canvas = document.querySelector("#screen");
        const display = window.__hostConsumed?.slice(${beforeRestore}).filter(input => input.event.kind === "host.display").at(-1)?.event.geometry ?? null;
        resolve({ area: { width: area.width, height: area.height }, backing: { width: canvas.width, height: canvas.height }, display });
      })))`);
      if (Math.abs(restored.area.width - nativeObservation.area.width) < 0.5
        && Math.abs(restored.area.height - nativeObservation.area.height) < 0.5
        && restored.display !== null
        && Math.abs(restored.display.content.width - restored.area.width) < 0.01
        && Math.abs(restored.display.content.height - restored.area.height) < 0.01
        && restored.backing.width === Math.ceil(restored.area.width)
        && restored.backing.height === Math.ceil(restored.area.height)) restoredObservation = restored;
      else await sleep(50);
    }
    if (restoredObservation === null) throw new Error("clearing desktop viewport emulation did not produce a fresh matching native host.display and ceil backing");
  }
}

/** A tiny CDP client: request/response over one socket, enough for evaluate and input dispatch. */
function connect(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const waiting = new Map();
  const ready = new Promise((done, fail) => {
    socket.addEventListener("open", () => done());
    socket.addEventListener("error", () => fail(new Error("the debugging socket failed")));
  });
  socket.addEventListener("message", (message) => {
    const payload = JSON.parse(String(message.data));
    const pending = waiting.get(payload.id);
    if (pending === undefined) return;
    waiting.delete(payload.id);
    if (payload.error !== undefined) pending.fail(new Error(payload.error.message));
    else pending.done(payload.result);
  });
  return {
    async send(method, params = {}) {
      await ready;
      const id = nextId;
      nextId += 1;
      const result = new Promise((done, fail) => waiting.set(id, { done, fail }));
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
    close() {
      socket.close();
    },
  };
}

const KEY = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39, text: "", unmodifiedText: "" },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40, text: "", unmodifiedText: "" },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37, text: "", unmodifiedText: "" },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38, text: "", unmodifiedText: "" },
};

async function main() {
  const pkg = packagePath();
  const port = await freePort();
  let inspectorPort = await freePort();
  if (inspectorPort === port) inspectorPort = await freePort();
  const child = spawn(
    electronBinary(),
    [
      `--remote-debugging-port=${port}`,
      `--inspect=127.0.0.1:${inspectorPort}`,
      ...(process.platform === "linux" ? ["--enable-unsafe-swiftshader"] : []),
      dist,
      "--serve", root,
      "--package", pkg,
      "--page", "packages/runner-desktop/app/player.html",
    ],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "0",
        ...(process.platform === "linux" ? { ELECTRON_DISABLE_SANDBOX: "1" } : {}),
      },
    },
  );
  const log = [];
  child.stdout.on("data", (chunk) => log.push(String(chunk)));
  child.stderr.on("data", (chunk) => log.push(String(chunk)));

  let pageTarget;
  let page;
  let mainDebugger;
  try {
    pageTarget = await targets(port);
    page = connect(pageTarget.webSocketDebuggerUrl);
    mainDebugger = connect(await nodeDebuggerTarget(inspectorPort));
  } catch (error) {
    page?.close();
    mainDebugger?.close();
    child.kill();
    throw new Error(`${String(error)}\n${log.join("")}`);
  }
  const evaluate = async (expression) => {
    const result = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.text ?? "evaluation failed");
    return result.result.value;
  };
  const status = () => evaluate("window.__live ?? null");
  const press = async (name) => {
    const key = KEY[name];
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...key });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
  };
  const keyDown = async (name) => page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...KEY[name] });
  const keyUp = async (name) => page.send("Input.dispatchKeyEvent", { type: "keyUp", ...KEY[name] });
  const sleep = (ms) => new Promise((wait) => setTimeout(wait, ms));

  // The engine consumes keyboard state per input phase, so a back-to-back keydown/keyup pair can fall inside one
  // phase and register nothing (that is what the real run showed before #1122). Wait until the player has stood
  // still over several ticks before taking the position to measure against.
  const settled = async () => {
    let previous = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const live = await status();
      const same = previous !== null && previous.x === live.player?.x && previous.y === live.player?.y && live.tick > 30;
      previous = live.player ?? null;
      if (same) return live;
      await sleep(100);
    }
    return null;
  };

  try {
    // Before board entry the session has no board and the player may already exist (E-02 creates it at boot); the
    // board key is the honest signal that the game is actually being played. ENTER clears title/message screens.
    // The page pauses on blur; a headless launch may start unfocused, so take focus the way a click would.
    await evaluate("document.querySelector('#screen')?.focus(); window.dispatchEvent(new Event('focus'));");
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const live = await status();
      if (live !== null && typeof live.tick === "number" && live.tick > 0) break;
      await new Promise((wait) => setTimeout(wait, 100));
    }
    const opened = await status();
    if (opened === null) throw new Error("the live page published no status");
    if (opened.error !== undefined) throw new Error(String(opened.error));

    await evaluate(`(() => {
      const session = window.__session;
      if (session === undefined) throw new Error("desktop player did not publish its live session");
      const engine = session.engine;
      const advance = engine.advance.bind(engine);
      window.__hostConsumed = [];
      engine.advance = (ticks, inputs) => {
        const report = advance(ticks, inputs);
        window.__hostConsumed.push(...report.consumed);
        return report;
      };
    })()`);
    // Resize the real BrowserWindow, not just Chromium's emulated CSS viewport. Use the matched display's work area
    // and the measured window/viewport chrome to choose three distinct content sizes that the display can hold.
    const displayCapacity = await inspectWindowCapacity(mainDebugger);
    const initialArea = await evaluate(`(() => {
      const area = document.querySelector("#viewport").getBoundingClientRect();
      return { width: area.width, height: area.height };
    })()`);
    const maxViewport = {
      width: Math.max(1, displayCapacity.workAreaSize.width - displayCapacity.bounds.width + initialArea.width),
      height: Math.max(1, displayCapacity.workAreaSize.height - displayCapacity.bounds.height + initialArea.height),
    };
    const availableScale = Math.min(maxViewport.width / 960, maxViewport.height / 480);
    const middleScale = Math.min(1, availableScale * 0.75);
    const resizeTargets = [
      [Math.round(640 * middleScale * 0.75), Math.round(480 * middleScale * 0.75)],
      [Math.round(960 * middleScale), Math.round(480 * middleScale)],
      [Math.min(1440, Math.floor(maxViewport.width)), Math.min(900, Math.floor(maxViewport.height))],
    ];
    if (new Set(resizeTargets.map(([width, height]) => `${width}x${height}`)).size !== resizeTargets.length
      || resizeTargets.some(([width, height]) => width > maxViewport.width || height > maxViewport.height)) {
      throw new Error(`desktop work area cannot provide three distinct viewport sizes: ${JSON.stringify({ displayCapacity, maxViewport, resizeTargets })}`);
    }
    const fits = [];
    for (const [targetIndex, [width, height]] of resizeTargets.entries()) {
      const playerBeforeResize = targetIndex === 1 ? await evaluate("window.__live?.player ?? null") : null;
      const beforeArea = await evaluate(`(() => {
        const area = document.querySelector("#viewport").getBoundingClientRect();
        return { width: area.width, height: area.height };
      })()`);
      const consumedBefore = await evaluate("window.__hostConsumed?.length ?? 0");
      const nativeContentSize = await resizeWindowContent(mainDebugger, width, height, beforeArea);

      let resizeObservation = null;
      let lastResizeObservation = null;
      for (let attempt = 0; attempt < 40 && resizeObservation === null; attempt += 1) {
        const observation = await evaluate(`(() => {
          const area = document.querySelector("#viewport").getBoundingClientRect();
          const consumed = window.__hostConsumed?.slice(${consumedBefore}).filter(input => input.event.kind === "host.display").at(-1) ?? null;
          return { area: { width: area.width, height: area.height }, display: consumed?.event.geometry ?? null };
        })()`);
        lastResizeObservation = observation;
        if (Math.abs(observation.area.width - width) < 0.5
          && Math.abs(observation.area.height - height) < 0.5
          && observation.display !== null
          && Math.abs(observation.display.content.width - observation.area.width) < 0.01
          && Math.abs(observation.display.content.height - observation.area.height) < 0.01) resizeObservation = observation;
        else await sleep(50);
      }
      if (resizeObservation === null) {
        throw new Error(`desktop BrowserWindow resize ${width}x${height} did not produce measured content and consumed host.display: ${JSON.stringify({ nativeContentSize, lastResizeObservation })}`);
      }

      const geometry = await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const canvas = document.querySelector("#screen");
        const box = canvas.getBoundingClientRect();
        const area = document.querySelector("#viewport").getBoundingClientRect();
        resolve({ backing: { width: canvas.width, height: canvas.height },
          view: window.__session.viewSize(),
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
          area: { x: area.x, y: area.y, width: area.width, height: area.height },
          hostDisplay: window.__hostConsumed.slice(${consumedBefore}).filter(input => input.event.kind === "host.display").at(-1)?.event.geometry ?? null });
      })))`);
      geometry.nativeContentSize = nativeContentSize;
      const { view, backing, box, area } = geometry;
      const ratio = Math.min(area.width / view.width, area.height / view.height);
      if (targetIndex === 2 && maxViewport.width > 960 && maxViewport.height > 720
        && (ratio <= 1.5 || ratio >= 2)) throw new Error(`probe did not reach its non-integer scale boundary: ${ratio}`);
      const scale = ratio >= 1 ? Math.floor(ratio) : ratio;
      const gameWidth = view.width * scale;
      const gameHeight = view.height * scale;
      const hostDisplay = geometry.hostDisplay;
      if (backing.width !== Math.ceil(area.width) || backing.height !== Math.ceil(area.height)
        || Math.abs(box.x - area.x) > 0.05 || Math.abs(box.y - area.y) > 0.05
        || Math.abs(box.width - area.width) > 0.05 || Math.abs(box.height - area.height) > 0.05) {
        throw new Error(`desktop drawing buffer/canvas does not cover measured content using ceil backing: ${JSON.stringify(geometry)}`);
      }
      if (hostDisplay === null
        || Math.abs(hostDisplay.content.width - area.width) > 0.05
        || Math.abs(hostDisplay.content.height - area.height) > 0.05
        || Math.abs(hostDisplay.game.x - (area.width - gameWidth) / 2) > 0.05
        || Math.abs(hostDisplay.game.y - (area.height - gameHeight) / 2) > 0.05
        || Math.abs(hostDisplay.game.width - gameWidth) > 0.05
        || Math.abs(hostDisplay.game.height - gameHeight) > 0.05) {
        throw new Error(`desktop host.display geometry does not match logical frame fit: ${JSON.stringify(geometry)}`);
      }
      fits.push({ requested: { width, height }, ...geometry, marginLeft: Math.floor(hostDisplay.game.x / scale) });
      if (process.argv.includes("--host-metrics") && targetIndex === 1) {
        const expectedMarginLeft = fits[1].marginLeft;
        if (playerBeforeResize === null || playerBeforeResize.x === expectedMarginLeft) {
          throw new Error(`host-metrics script was already at the target margin before the selected resize: ${JSON.stringify({ playerBeforeResize, expectedMarginLeft })}`);
        }
        let scriptPlayer = null;
        for (let attempt = 0; attempt < 40 && scriptPlayer?.x !== expectedMarginLeft; attempt += 1) {
          scriptPlayer = await evaluate("window.__live?.player ?? null");
          if (scriptPlayer?.x !== expectedMarginLeft) await sleep(50);
        }
        if (scriptPlayer?.x !== expectedMarginLeft || scriptPlayer?.y !== 128) {
          throw new Error(`desktop viewportResized script did not place player at independently measured marginWidth(left) ${expectedMarginLeft}: ${JSON.stringify(scriptPlayer)}`);
        }
        fits[fits.length - 1].scriptPlayer = scriptPlayer;
      }
    }
    if (fits[0].marginLeft === fits[1].marginLeft || fits[1].marginLeft <= 0) {
      throw new Error(`desktop marginWidth did not change across feasible viewport sizes: ${JSON.stringify({ maxViewport, fits: fits.map(({ requested, marginLeft }) => ({ requested, marginLeft })) })}`);
    }
    const emulatedScaleBoundary = await verifyNonIntegerScaleViaEmulation(mainDebugger, page, evaluate, sleep, resizeTargets[1]);
    if (process.argv.includes("--host-metrics")) {
      console.log(JSON.stringify({ package: pkg, displayCapacity, maxViewport, emulatedScaleBoundary, opened: { tick: opened.tick, player: opened.player ?? null }, fits }, null, 2));
      return;
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const live = await status();
      if (live.board !== null && live.board !== undefined) break;
      await press("Enter");
      await new Promise((wait) => setTimeout(wait, 600));
    }
    if ((await status()).board === null) throw new Error("the session never entered a board");
    if ((await settled()) === null) throw new Error("the board never settled to a stable player position");
    const before = await status();
    if (before.player === null || before.player === undefined) throw new Error("the board never showed a player");

    // A direction is only meaningful while a key is pressed (#1122): phase (a) taps once and expects exactly
    // one 32-pixel tile on the tapped axis with no perpendicular drift; phase (b) holds and expects continuous
    // movement (2+ tiles ≈ 64 px) on the same axis with the perpendicular delta near zero, so one big hop or a
    // wrong-axis/diagonal walk cannot impersonate input. Releasing the tap mid-step completes the current tile
    // (core movement contract), which is why a tap held briefly still lands exactly one tile.
    let moved = null;
    const attempts = [];
    let cursor = before.player;
    for (const name of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
      await keyDown(name);
      await sleep(100);
      await keyUp(name);
      const tapped = await settled();
      if (tapped === null || tapped.player === null || tapped.player === undefined) throw new Error("the player vanished or never settled during the tap phase");
      await keyDown(name);
      await sleep(1200);
      await keyUp(name);
      const held = await settled();
      if (held === null || held.player === null || held.player === undefined) throw new Error("the player vanished or never settled during the hold phase");
      const verdict = judgeMovement(name, cursor, tapped.player, held.player);
      attempts.push({
        key: name,
        before: cursor,
        afterTap: tapped.player,
        afterHold: held.player,
        tap: verdict.tap,
        hold: verdict.hold,
        tapOk: verdict.tapOk,
        holdOk: verdict.holdOk,
      });
      if (verdict.tapOk && verdict.holdOk) {
        moved = { key: name, tap: verdict.tap, hold: verdict.hold };
        break;
      }
      cursor = held.player;
    }
    const finalTick = (await status()).tick;

    const csp = await probeDesktopCsp(page, evaluate, root, sleep);
    if (/WebAssembly\.instantiate\(\).*violates.*Content Security Policy/i.test(log.join(""))) {
      throw new Error("desktop renderer logged a WebAssembly CSP violation");
    }

    const report = {
      package: pkg,
      error: moved === null
        ? "no direction proved a one-tile tap (exactly 32 px on the tapped axis, no perpendicular drift) plus a continued hold (>= 64 px on that axis, perpendicular delta < 16 px)"
        : null,
      tick: finalTick,
      opened: { tick: opened.tick, player: opened.player ?? null },
      fits,
      emulatedScaleBoundary,
      attempts,
      moved,
      csp,
    };
    console.log(JSON.stringify(report, null, 2));
    if (report.error !== null) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ package: pkg, error: String(error), log: log.join("") }, null, 2));
    process.exitCode = 1;
  } finally {
    mainDebugger.close();
    page.close();
    child.kill();
    if (temporaryPackageDirectory !== null) {
      rmSync(temporaryPackageDirectory, { recursive: true, force: true });
      temporaryPackageDirectory = null;
    }
  }
}

await main();
