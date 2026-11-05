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
  if (leftMargin == event.detail.marginLeft && leftMargin == 160) {
    send("start.brd", 128, 128, 1)
  }
})
`;
  const rewritten = writeMainFile({ ...parsed.value, startupPrg: startupPath });
  if (!rewritten.ok) throw new Error(rewritten.error.message);
  const tree = files.map((file) => (file.path === mainPath ? { path: file.path, bytes: rewritten.value } : file));
  tree.push({ path: startupPath, bytes: new TextEncoder().encode(startup) });
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
        if (page !== undefined && page.webSocketDebuggerUrl !== undefined) return page.webSocketDebuggerUrl;
      }
    } catch {
      // The port is not listening yet.
    }
    await new Promise((wait) => setTimeout(wait, 100));
  }
  throw new Error("the desktop page never appeared on the debugging port");
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
  const child = spawn(
    electronBinary(),
    [
      `--remote-debugging-port=${port}`,
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

  const page = connect(await targets(port));
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
    // Exercise the actual live page, including a ratio above 2.5 where rounding would choose the wrong scale.
    const fits = [];
    for (const [width, height] of [[480, 360], [960, 720], [1900, 1600]]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      let display = null;
      for (let attempt = 0; attempt < 40 && display === null; attempt += 1) {
        display = await evaluate(`window.__hostConsumed?.filter(input => input.event.kind === "host.display" && input.event.geometry.content.width === ${width}).at(-1) ?? null`);
        if (display === null) await sleep(50);
      }
      if (display === null) throw new Error(`desktop resize ${width}x${height} did not consume host.display`);
      const geometry = await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const canvas = document.querySelector("#screen");
        const box = canvas.getBoundingClientRect();
        const area = document.querySelector("#viewport").getBoundingClientRect();
        resolve({ frame: { width: canvas.width, height: canvas.height },
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
          area: { x: area.x, y: area.y, width: area.width, height: area.height },
          hostDisplay: window.__hostConsumed.filter(input => input.event.kind === "host.display").at(-1)?.event.geometry ?? null });
      })))`);
      const { frame, box, area } = geometry;
      const ratio = Math.min(area.width / frame.width, area.height / frame.height);
      if (width === 1900 && (ratio <= 2.5 || ratio >= 3)) throw new Error(`probe did not reach its rounding boundary: ${ratio}`);
      const scale = ratio >= 1 ? Math.floor(ratio) : ratio;
      if (Math.abs(box.width - frame.width * scale) > 0.05 || Math.abs(box.height - frame.height * scale) > 0.05
        || Math.abs(box.x - (area.x + (area.width - box.width) / 2)) > 0.05
        || Math.abs(box.y - (area.y + (area.height - box.height) / 2)) > 0.05) {
        throw new Error(`desktop frame is not fitted and centred: ${JSON.stringify(geometry)}`);
      }
      const hostDisplay = geometry.hostDisplay;
      if (hostDisplay === null
        || Math.abs(hostDisplay.content.width - area.width) > 0.05
        || Math.abs(hostDisplay.content.height - area.height) > 0.05
        || Math.abs(hostDisplay.game.x - (box.x - area.x)) > 0.05
        || Math.abs(hostDisplay.game.y - (box.y - area.y)) > 0.05
        || Math.abs(hostDisplay.game.width - box.width) > 0.05
        || Math.abs(hostDisplay.game.height - box.height) > 0.05) {
        throw new Error(`desktop host.display geometry does not match its measured frame: ${JSON.stringify(geometry)}`);
      }
      fits.push({ ...geometry, marginLeft: Math.floor(hostDisplay.game.x / (hostDisplay.game.width / frame.width)) });
      if (process.argv.includes("--host-metrics") && width === 960) {
        let scriptPlayer = null;
        for (let attempt = 0; attempt < 40 && scriptPlayer?.x !== 128; attempt += 1) {
          scriptPlayer = await evaluate("window.__live?.player ?? null");
          if (scriptPlayer?.x !== 128) await sleep(50);
        }
        if (scriptPlayer?.x !== 128 || scriptPlayer?.y !== 128) {
          throw new Error(`desktop viewportResized script listener did not observe marginWidth(left)=160: ${JSON.stringify(scriptPlayer)}`);
        }
        fits[fits.length - 1].scriptPlayer = scriptPlayer;
      }
    }
    if (fits[0].marginLeft === fits[2].marginLeft) throw new Error("desktop marginWidth did not change across viewport sizes");
    await page.send("Emulation.clearDeviceMetricsOverride");

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
    page.close();
    child.kill();
    if (temporaryPackageDirectory !== null) {
      rmSync(temporaryPackageDirectory, { recursive: true, force: true });
      temporaryPackageDirectory = null;
    }
  }
}

await main();
