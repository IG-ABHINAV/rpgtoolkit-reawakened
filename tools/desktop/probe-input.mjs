// Prove one real key press reaches the live engine inside the Electron window (entry 9.16).
//
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
import { electronBinary } from "./electron-binary.mjs";

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

function packagePath() {
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
  const hold = async (name, milliseconds) => {
    const key = KEY[name];
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...key });
    await new Promise((wait) => setTimeout(wait, milliseconds));
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
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

    // Exercise the actual live page, including a ratio above 2.5 where rounding would choose the wrong scale.
    const fits = [];
    for (const [width, height] of [[480, 360], [960, 720], [1900, 1600]]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      const geometry = await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const canvas = document.querySelector("#screen");
        const box = canvas.getBoundingClientRect();
        const area = document.querySelector("#viewport").getBoundingClientRect();
        resolve({ frame: { width: canvas.width, height: canvas.height },
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
          area: { x: area.x, y: area.y, width: area.width, height: area.height } });
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
      fits.push(geometry);
    }
    await page.send("Emulation.clearDeviceMetricsOverride");

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const live = await status();
      if (live.board !== null && live.board !== undefined) break;
      await press("Enter");
      await new Promise((wait) => setTimeout(wait, 600));
    }
    if ((await status()).board === null) throw new Error("the session never entered a board");
    let settled = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const live = await status();
      if (live.player === null || live.player === undefined) throw new Error("the board never showed a player");
      const same = settled !== null && settled.x === live.player.x && settled.y === live.player.y && live.tick > 30;
      settled = { x: live.player.x, y: live.player.y, tick: live.tick };
      if (same) break;
      await new Promise((wait) => setTimeout(wait, 300));
    }
    const before = await status();
    if (before.player === null || before.player === undefined) throw new Error("the board never showed a player");

    // A direction is only meaningful while it is held across input phases. Hold it long enough for several
    // tiles (1200 ms ≈ 72 ticks ≈ 3 tiles at default speed) so the probe proves continuous movement, not a single step.
    let moved = null;
    const attempts = [];
    let probeBefore = before.player;
    for (const name of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
      await hold(name, 1200);
      await new Promise((wait) => setTimeout(wait, 300));
      const after = await status();
      const delta = after.player !== null && after.player !== undefined
        ? { x: after.player.x - probeBefore.x, y: after.player.y - probeBefore.y }
        : { x: 0, y: 0 };
      attempts.push({ key: name, before: probeBefore, after: after.player ?? null, delta });
      const axisDelta = name === "ArrowRight" || name === "ArrowLeft" ? delta.x : delta.y;
      // Continuous movement: at least two 32-pixel tiles on the pressed axis.
      if (Math.abs(axisDelta) >= 64) {
        moved = { key: name, before: probeBefore, after: after.player, delta };
        break;
      }
      probeBefore = after.player ?? probeBefore;
    }

    const report = {
      package: pkg,
      error: moved === null ? "a dispatched key did not move the player continuously (expected >= 64 px on one axis)" : null,
      tick: (await status()).tick,
      opened: { tick: opened.tick, player: opened.player ?? null },
      fits,
      attempts,
      moved,
    };
    console.log(JSON.stringify(report, null, 2));
    if (report.error !== null) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ package: pkg, error: String(error), log: log.join("") }, null, 2));
    process.exitCode = 1;
  } finally {
    page.close();
    child.kill();
  }
}

await main();
