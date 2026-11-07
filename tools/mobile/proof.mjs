// Exercise the built Capacitor APK on an Android device or emulator and retain only readings
// observed from its live page. No browser or filesystem mocks are installed here.
//
//   pnpm mobile:proof
//
// The emulator must already be booted. The script installs and launches the debug
// APK, retries WebView attachment for at most three minutes, drives the demo
// through its title sequence, proves a canvas tap changes the player position,
// rotates the device, then relaunches and checks the page's host-blob-presence
// probe. The field records existence, not game-state restoration.

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _android } from "@playwright/test";
import { assertDocumentTitle, assertReport, assertScreenshotManifest } from "./proof-validation.mjs";
import { adbWithTimeout, installApk, runAdbWithTimeout } from "./proof-adb.mjs";
import { classifyProcess } from "./proof-process.mjs";
import { adbServerOptions, attachPage, boundedAttach, closeDevice, selectDevice } from "./proof-android.mjs";
import { launchAndConnect as retryAttach } from "./proof-retry.mjs";
import { probeScreenshotStages } from "./proof-telemetry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const appId = "com.tkreawakened.player";
const activity = `${appId}/.MainActivity`;
const apk = join(root, "packages", "runner-mobile", "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const output = resolve(process.env.MOBILE_PROOF_DIR ?? join(root, "artifacts", "mobile-proof"));
const proof = {
  schema: 1,
  platform: "Android (device details not yet available)",
  apk,
  readings: {},
  screenshots: {},
  saveProbeMeaning: "save.blobPresent means the host blob exists; the page does not restore game state",
  attachAttempts: [],
};
// Attach gets its own bounded deadline (see #1057): exponential backoff covers emulator/boot
// jitter and devtools ECONNRESET, while board-entry assertions below remain strict and unretried.
const ATTACH_TIMEOUT_MS = 180_000;
const ATTACH_BACKOFF_INITIAL_MS = 500;
const ATTACH_BACKOFF_MAX_MS = 8_000;
const ATTACH_LOGCAT_LINES = 20;
const ADB_COMMAND_TIMEOUT_MS = 15_000;
const PROTOCOL_TIMEOUT_MS = 10_000;

function protocolCall(description, operation, timeoutMs = PROTOCOL_TIMEOUT_MS) {
  let timer;
  const command = Promise.resolve().then(operation);
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms: ${description}`)), timeoutMs);
  });
  return Promise.race([command, timeout]).finally(() => clearTimeout(timer));
}

mkdirSync(output, { recursive: true });

function runAdb(...args) {
  return runAdbWithTimeout(ADB_COMMAND_TIMEOUT_MS, ...args);
}

function adb(...args) {
  return adbWithTimeout(ADB_COMMAND_TIMEOUT_MS, ...args);
}

function attachAdb(deadline, ...args) {
  const remaining = Math.max(1, Math.min(ADB_COMMAND_TIMEOUT_MS, deadline - Date.now()));
  return runAdbWithTimeout(remaining, ...args);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function livePage(page, timeoutMs = PROTOCOL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hasReport = await boundedAttach("checking for the mobile page report",
      () => page.evaluate(() => window.__mobile !== undefined),
      Math.min(PROTOCOL_TIMEOUT_MS, Math.max(1, deadline - Date.now())));
    if (hasReport) return page;
    await delay(Math.min(500, Math.max(0, deadline - Date.now())));
  }
  throw new Error("The Android WebView did not publish window.__mobile before its deadline");
}

async function report(page) {
  return protocolCall("reading the mobile page report", () => page.evaluate(() => window.__mobile ?? null));
}

async function waitFor(page, predicate, description, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await report(page).catch(() => null);
    if (predicate(last)) return last;
    if (last?.error) throw new Error(`${description}: page error: ${last.error}`);
    await delay(250);
  }
  throw new Error(`${description} timed out; last page report: ${JSON.stringify(last)}`);
}

async function captureReading(page, label, options) {
  const captured = await protocolCall(`capturing ${label} page reading`, () => page.evaluate(() => ({
    report: window.__mobile ?? null,
    documentTitle: document.title,
  })));
  const pageReport = assertReport(captured.report, label, options);
  assertDocumentTitle(pageReport, captured.documentTitle, label);
  return { report: pageReport, documentTitle: captured.documentTitle };
}
async function captureCanvasContent(page) {
  return protocolCall("reading rendered mobile canvas pixels", () => page.evaluate(() => {
    const canvas = document.querySelector("#screen");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("the mobile screen canvas is absent");
    const gl = canvas.getContext("webgl2");
    if (gl === null) throw new Error("the mobile screen has no WebGL2 context");
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    if (width <= 0 || height <= 0) throw new Error(`the mobile drawing buffer is empty: ${width}x${height}`);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonBlackPixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] === 0 && pixels[index + 1] === 0 && pixels[index + 2] === 0) continue;
      nonBlackPixels += 1;
      const pixel = index / 4;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return {
      width,
      height,
      nonBlackPixels,
      nonBlackRatio: nonBlackPixels / (width * height),
      bounds: nonBlackPixels === 0 ? null : { minX, minY, maxX, maxY },
    };
  }));
}

function assertTitleRendering(reading, canvasContent) {
  const render = reading.report.render;
  if (render === null || typeof render !== "object" ||
    !Number.isSafeInteger(render.drawn) || render.drawn <= 0 ||
    !Number.isSafeInteger(render.deferred) || render.deferred !== 0 ||
    render.deferredByKind === null || typeof render.deferredByKind !== "object" ||
    Array.isArray(render.deferredByKind) ||
    Object.values(render.deferredByKind).some((count) => !Number.isSafeInteger(count) || count !== 0) ||
    !Array.isArray(render.diagnostics) || render.diagnostics.length !== 0) {
    throw new Error(`title frame did not render completely: ${JSON.stringify(render)}`);
  }
  const minimumContentPixels = Math.max(64, Math.ceil(canvasContent.width * canvasContent.height * 0.001));
  if (canvasContent.nonBlackPixels < minimumContentPixels) {
    throw new Error(`title canvas is black or lacks visible content: ${JSON.stringify({ canvasContent, minimumContentPixels })}`);
  }
}


async function screenshot(page, name) {
  const path = join(output, `${name}.png`);
  proof.screenshotTelemetry = proof.screenshotTelemetry ?? {};
  const probe = await probeScreenshotStages(page, name);
  proof.screenshotTelemetry[name] = probe;
  const captureStart = Date.now();
  try {
    await protocolCall(`saving ${name} screenshot`, () =>
      page.screenshot({ path, animations: "disabled", timeout: PROTOCOL_TIMEOUT_MS }),
      PROTOCOL_TIMEOUT_MS + 500);
    probe.capture = { durationMs: Date.now() - captureStart, status: "completed" };
    proof.screenshots[name] = path;
  } catch (err) {
    probe.capture = { durationMs: Date.now() - captureStart, error: err.message };
    throw err;
  }
}


function attachObservation(stage, attempt, startedAt, deadline) {
  const process = attachAdb(deadline, "shell", "pidof", appId);
  const { state: processState, pid } = classifyProcess(process);
  const logcat = attachAdb(deadline, "logcat", "-d", "-t", String(ATTACH_LOGCAT_LINES), "-v", "brief",
    "-s", "chromium:*", "ActivityManager:*", "AndroidRuntime:*");
  return {
    stage,
    attempt,
    elapsedMs: Date.now() - startedAt,
    processState,
    pid,
    pidof: { exitCode: process.status, output: retainedStdout(process.stdout), stderr: process.stderr },
    logcat: { exitCode: logcat.status, output: logcat.stdout, stderr: logcat.stderr },
  };
}

// Keep the raw pidof response diagnosable without dumping unbounded bytes into
// the artifact: strip control characters and cap the retained text (#1080).
function retainedStdout(text) {
  return text.replace(/[^\x20-\x7e\t\n]/g, "¦").slice(0, 400);
}


function launchAndConnect(stage, serial, serverOptions, timeoutMs = ATTACH_TIMEOUT_MS) {
  return retryAttach(stage, serial, timeoutMs, {
    now: Date.now,
    observe: attachObservation,
    start: (deadline) => attachAdb(deadline, "shell", "am", "start", "-n", activity),
    select: (target, remaining) => selectDevice(_android, target, remaining, serverOptions),
    attach: attachPage,
    live: livePage,
    close: closeDevice,
    delay,
    attempts: proof.attachAttempts,
    log: console.log,
    appId,
    protocolTimeoutMs: PROTOCOL_TIMEOUT_MS,
    initialBackoffMs: ATTACH_BACKOFF_INITIAL_MS,
    maxBackoffMs: ATTACH_BACKOFF_MAX_MS,
  });
}

async function enterBoard(page) {
  await waitFor(page, (value) => value !== null && value.tick > 30, "waiting for the title sequence");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const value = await report(page);
    if (value?.board !== null && value?.board !== undefined) break;
    await protocolCall("sending title-entry key", () => page.keyboard.press("Enter"));
    await delay(500);
  }
  return waitFor(page, (value) => value?.board !== null && value?.board !== undefined, "entering the demo board");
}

async function settledPlayer(page) {
  const deadline = Date.now() + 30_000;
  let previous = null;
  let stableTicks = 0;
  while (Date.now() < deadline) {
    const current = await report(page).catch(() => null);
    if (current?.error) throw new Error(`waiting for a settled player: ${current.error}`);
    if (current?.board !== null && current?.board !== undefined && current.player !== null) {
      if (previous !== null && current.tick > previous.tick) {
        if (current.player.x === previous.player.x && current.player.y === previous.player.y) stableTicks += 1;
        else stableTicks = 0;
        if (stableTicks >= 3) return captureReading(page, "settled pre-tap baseline");
      }
      previous = current;
    }
    await delay(250);
  }
  throw new Error(`player did not settle before tap; last report: ${JSON.stringify(previous)}`);
}

async function canvasTap(page, baseline) {
  const target = await protocolCall("reading canvas tap target", () =>
    page.locator("canvas#screen").evaluate((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const logical = { x: Math.floor(canvas.width / 2), y: Math.floor(canvas.height / 2) };
      return {
        coordinateSpace: "CDP CSS viewport pixels, derived from the canvas client rect",
        logical,
        cssViewport: {
          x: rect.left + ((logical.x + 0.5) / canvas.width) * rect.width,
          y: rect.top + ((logical.y + 0.5) / canvas.height) * rect.height,
        },
        canvas: { width: canvas.width, height: canvas.height },
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        devicePixelRatio: window.devicePixelRatio,
      };
    }));

  await protocolCall("installing canvas pointer observers", () => page.evaluate(() => {
    const canvas = document.querySelector("canvas#screen");
    if (canvas === null) throw new Error("mobile canvas is absent");
    window.__mobileProofPointerEvents = [];
    const observe = (event) => {
      const rect = canvas.getBoundingClientRect();
      window.__mobileProofPointerEvents.push({
        type: event.type,
        pointerType: event.pointerType,
        trusted: event.isTrusted,
        buttons: event.buttons,
        logical: {
          x: Math.floor(Math.max(0, Math.min(canvas.width - 1, (event.clientX - rect.left) * canvas.width / rect.width))),
          y: Math.floor(Math.max(0, Math.min(canvas.height - 1, (event.clientY - rect.top) * canvas.height / rect.height))),
        },
      });
    };
    canvas.addEventListener("pointerdown", observe, { once: true });
    canvas.addEventListener("pointerup", observe, { once: true });
  }));

  const cdp = await protocolCall("opening touch input session", () => page.context().newCDPSession(page));
  try {
    const point = { x: target.cssViewport.x, y: target.cssViewport.y, radiusX: 1, radiusY: 1, force: 1, id: 0 };
    await protocolCall("dispatching Android touch start", () =>
      cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] }));
    await protocolCall("dispatching Android touch end", () =>
      cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }));
    const pointerEvents = await protocolCall("reading trusted canvas pointer events", () =>
      page.evaluate(() => window.__mobileProofPointerEvents ?? []));
    const down = pointerEvents.find((event) => event.type === "pointerdown");
    const up = pointerEvents.find((event) => event.type === "pointerup");
    if (down?.trusted !== true || down.pointerType !== "touch" || down.buttons !== 1 ||
      down.logical.x !== target.logical.x || down.logical.y !== target.logical.y) {
      throw new Error(`touch did not reach intended canvas point ${JSON.stringify(target.logical)}: ${JSON.stringify(pointerEvents)}`);
    }
    if (up?.trusted !== true || up.pointerType !== "touch" ||
      up.logical.x !== target.logical.x || up.logical.y !== target.logical.y) {
      throw new Error(`touch release did not reach intended canvas point ${JSON.stringify(target.logical)}: ${JSON.stringify(pointerEvents)}`);
    }

    const beforePlayer = baseline.report.player;
    const changed = await waitFor(page,
      (value) => value?.player !== null && value?.player !== undefined &&
        (value.player.x !== beforePlayer.x || value.player.y !== beforePlayer.y),
      `waiting for player position to change after canvas tap at ${target.logical.x},${target.logical.y}`,
      90_000);
    const reading = await captureReading(page, "canvas tap");
    return {
      reading,
      target,
      pointerEvents,
      playerBefore: beforePlayer,
      playerAfter: changed.player,
    };
  } finally {
    await protocolCall("closing Android touch input session", () => cdp.detach()).catch(() => {});
  }
}

function captureFailureEvidence(error) {
  const logcat = runAdbWithTimeout(5_000, "logcat", "-d", "-v", "threadtime",
    "-s", "chromium:*", "ActivityManager:*", "AndroidRuntime:*");
  const activities = runAdbWithTimeout(5_000, "shell", "dumpsys", "activity", "activities");
  const bootLog = runAdbWithTimeout(5_000, "logcat", "-d", "-b", "all", "-v", "threadtime");
  const apkExists = existsSync(apk);
  const evidence = {
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    apk: { path: apk, exists: apkExists, sizeBytes: apkExists ? statSync(apk).size : null },
    screenshotTelemetry: proof.screenshotTelemetry ?? null,
    androidLogcat: {
      command: "adb logcat -d -v threadtime -s chromium:* ActivityManager:* AndroidRuntime:*",
      exitCode: logcat.status,
      output: logcat.stdout,
      stderr: logcat.stderr,
    },
    activities: {
      command: "adb shell dumpsys activity activities | grep -i tkreawakened",
      exitCode: activities.status,
      matchingLines: activities.stdout.split(/\r?\n/).filter((line) => /tkreawakened/i.test(line)),
      stderr: activities.stderr,
    },
    emulatorBootLogTail: {
      command: "adb logcat -d -b all -v threadtime (last 250 lines)",
      exitCode: bootLog.status,
      output: bootLog.stdout.split(/\r?\n/).slice(-250).join("\n"),
      stderr: bootLog.stderr,
    },
  };
  const path = join(output, "failure-evidence.json");
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
  return path;
}
async function main() {
  const serverOptions = adbServerOptions(process.env);
  adb("wait-for-device");
  const serial = adb("get-serialno");
  if (!serial || serial === "unknown") throw new Error(`adb did not identify a usable Android device: ${serial}`);
  process.env.ANDROID_SERIAL = serial;
  proof.deviceSerial = serial;
  proof.platform = `Android ${adb("shell", "getprop", "ro.build.version.release")} API ${adb("shell", "getprop", "ro.build.version.sdk")} ${adb("shell", "getprop", "ro.product.cpu.abi")}`;
  installApk(apk);
  if (process.env.CI === "true") {
    const cleared = adb("shell", "pm", "clear", appId);
    if (cleared !== "Success") throw new Error(`could not clear Android app data for a fresh CI proof: ${cleared}`);
  }
  const initial = await launchAndConnect("initial launch", serial, serverOptions);
  let device = initial.device;
  let page = initial.page;
  try {
    const titleCandidate = await waitFor(page,
      (value) => value !== null && value.tick > 30 && value.render !== undefined,
      "waiting for the live rendered title report");
    if (titleCandidate.board !== null) throw new Error(`title checkpoint unexpectedly already has a board: ${JSON.stringify(titleCandidate)}`);
    const titleReading = await captureReading(page, "title", { needsBoard: false, needsSave: false });
    const titleCanvas = await captureCanvasContent(page);
    assertTitleRendering(titleReading, titleCanvas);
    titleReading.canvas = titleCanvas;
    if (titleReading.report.save?.blobPresent !== false) {
      throw new Error(`first launch found an existing host blob; the proof requires clean app data: ${JSON.stringify(titleReading.report.save)}`);
    }
    if (titleReading.report.save.written !== true) {
      throw new Error(`first launch did not confirm a host blob write: ${JSON.stringify(titleReading.report.save)}`);
    }
    if (titleReading.report.board !== null) throw new Error(`title screenshot is not on the title screen: ${JSON.stringify(titleReading.report)}`);
    proof.readings.title = titleReading;
    await screenshot(page, "title");

    await enterBoard(page);
    const board = await captureReading(page, "board entry");
    proof.readings.board = board;

    const tapBaseline = await settledPlayer(page);
    const tapped = await canvasTap(page, tapBaseline);
    const playerBefore = tapBaseline.report.player;
    const playerAfter = tapped.reading.report.player;
    if (playerAfter.x === playerBefore.x && playerAfter.y === playerBefore.y) {
      throw new Error(`player position did not change after trusted canvas touch at ${JSON.stringify(tapped.target.logical)}`);
    }
    proof.readings.tap = {
      ...tapped.reading,
      interaction: {
        target: tapped.target,
        pointerEvents: tapped.pointerEvents,
        playerBefore,
        playerAfter,
      },
    };
    await screenshot(page, "tap");

    const beforeRotation = await protocolCall("reading viewport before rotation", () => page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      timeOrigin: performance.timeOrigin,
    })));
    adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
    const requestedRotation = beforeRotation.viewport.width > beforeRotation.viewport.height ? "0" : "1";
    adb("shell", "settings", "put", "system", "user_rotation", requestedRotation);
    const rotationDeadline = Date.now() + 30_000;
    let afterRotation = beforeRotation;
    while (Date.now() < rotationDeadline) {
      await delay(500);
      afterRotation = await protocolCall("reading viewport after rotation", () => page.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        timeOrigin: performance.timeOrigin,
      }))).catch(() => beforeRotation);
      if (afterRotation.viewport.width !== beforeRotation.viewport.width ||
        afterRotation.viewport.height !== beforeRotation.viewport.height) break;
    }
    if (afterRotation.viewport.width === beforeRotation.viewport.width &&
      afterRotation.viewport.height === beforeRotation.viewport.height) {
      throw new Error(`emulator rotation did not change WebView viewport: ${JSON.stringify({ beforeRotation, afterRotation })}`);
    }
    await waitFor(page,
      (value) => value?.board !== null && value?.board !== undefined && value.tick > tapped.reading.report.tick,
      "waiting for a later same-session report after rotation");
    const rotated = await captureReading(page, "rotation");
    if (rotated.report.tick <= tapped.reading.report.tick) {
      throw new Error(`same-session tick did not advance over rotation: ${tapped.reading.report.tick} -> ${rotated.report.tick}`);
    }
    if (afterRotation.timeOrigin !== beforeRotation.timeOrigin) {
      throw new Error(`rotation replaced the live document instead of preserving its session: ${beforeRotation.timeOrigin} -> ${afterRotation.timeOrigin}`);
    }
    proof.readings.rotation = { ...rotated, viewportBefore: beforeRotation, viewportAfter: afterRotation };
    await screenshot(page, "rotation");

    const beforeStop = await captureReading(page, "before force-stop");
    if (beforeStop.report.save?.written !== true) {
      throw new Error(`host blob write was not confirmed before force-stop: ${JSON.stringify(beforeStop.report.save)}`);
    }
    proof.readings.beforeForceStop = beforeStop;

    await closeDevice(device, PROTOCOL_TIMEOUT_MS);
    device = undefined;
    adb("shell", "am", "force-stop", appId);
    await delay(1_000);
    const relaunched = await launchAndConnect("force-stop relaunch", serial, serverOptions);
    device = relaunched.device;
    page = relaunched.page;
    await enterBoard(page);
    const relaunch = await captureReading(page, "relaunch");
    if (relaunch.report.save?.blobPresent !== true) {
      throw new Error(`relaunch did not observe the previously written host blob: ${JSON.stringify(relaunch.report.save)}`);
    }
    await screenshot(page, "relaunch");
    proof.readings.relaunch = relaunch;
  } finally {
    if (device !== undefined) await closeDevice(device, PROTOCOL_TIMEOUT_MS).catch(() => {});
  }
}

try {
  await main();
  assertScreenshotManifest(proof.screenshots, existsSync);
  proof.result = "passed";
} catch (error) {
  proof.result = "failed";
  try {
    proof.failureEvidence = captureFailureEvidence(error);
  } catch (evidenceError) {
    proof.failureEvidenceError = String(evidenceError);
  }
  proof.error = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
} finally {
  const path = join(output, "readings.json");
  writeFileSync(path, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(`Mobile emulator proof ${proof.result}; readings: ${path}`);
  if (proof.error) console.error(proof.error);
  if (process.exitCode !== undefined) {
    const exitCode = process.exitCode;
    const forceExit = setTimeout(() => process.exit(exitCode), 3_000);
    forceExit.unref();
  }
}
