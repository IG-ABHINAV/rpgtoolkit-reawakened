// Measure the desktop runner on this machine (entry 9.11). It launches the built Electron shell against the same
// workspace, opens a distribution package **from disk** through the desktop asset source, and reports what the page
// measured: the app:// scheme, no service worker, the tick-120 hashes, WebGL2, the D-7 blend bound, audio of the
// expected length, and the same draw list rendering the same frame as the reference rasteriser.
//
//   node tools/desktop/measure.mjs --package fixtures/packages/demo.tpk --out tools/desktop/measurements/<os>.json
//
// The report is written by the Electron main process (`--report`), so nothing here is inferred from stdout. Running it
// needs a display: macOS and Windows runners have one; Linux needs Xvfb (`xvfb-run -a`).

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { electronBinary } from "./electron-binary.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

function argument(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : fallback;
}

/** The package to open, built from the fetched sample game when the caller names none. */
function packagePath() {
  const named = argument("--package", null);
  if (named !== null) return resolve(named);
  const out = join(root, "fixtures", "packages", "demo.tpk");
  execFileSync(
    process.execPath,
    [join(root, "tools", "make-package", "run.mjs"), join(root, "fixtures", "legacy", "demo"),
      "--closing-plan", join(root, "golden", "closing", "plan.json"), "--game", "demo", "--out", out, "--title", "Demo"],
    { cwd: root, stdio: "inherit" },
  );
  return out;
}

/** Launch the shell, wait for the page's report, and return it. */
export async function measure(options = {}) {
  const pkg = options.package ?? packagePath();
  const reportPath = join(mkdtempSync(join(tmpdir(), "desktop-measure-")), "report.json");
  const binary = options.command?.[0] ?? electronBinary();
  const child = spawn(
    binary,
    options.command?.slice(1) ?? [
      // The app directory is the built one: its `package.json` names `main.js`, and the preload sits beside it.
      join(root, "packages", "runner-desktop", "dist"),
      // Headless Linux CI runners (Xvfb) have no GPU; use Chromium's software WebGL2 path.
      ...(process.platform === "linux" ? ["--enable-unsafe-swiftshader"] : []),
      "--serve", root,
      "--package", pkg,
      "--page", "packages/runner-desktop/app/player-measure.html",
      "--report", reportPath,
      "--quit-after",
    ],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "0",
        // The npm-installed Electron binary is user-owned, so the Linux SUID sandbox helper is not configured.
        // Disable sandboxing for the measurement harness only; interactive play still uses the OS sandbox by default.
        ...(process.platform === "linux" ? { ELECTRON_DISABLE_SANDBOX: "1" } : {}),
      },
    },
  );
  const log = [];
  child.stdout.on("data", (chunk) => log.push(String(chunk)));
  child.stderr.on("data", (chunk) => log.push(String(chunk)));
  const started = Date.now();
  const deadline = started + (options.timeoutMs ?? 120_000);
  let spawnError = null;
  child.on("error", (error) => { spawnError = error; });
  const closed = new Promise((resolveClose) => {
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  let exit = null;
  let report = null;
  while (Date.now() < deadline) {
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8"));
      break;
    } catch {
      let timer;
      exit = await Promise.race([
        closed,
        new Promise((resolveWait) => {
          timer = setTimeout(() => resolveWait(null), Math.min(250, Math.max(0, deadline - Date.now())));
        }),
      ]);
      clearTimeout(timer);
      if (exit !== null) {
        // The report may have been written between the last read and the child's exit.
        try { report = JSON.parse(readFileSync(reportPath, "utf8")); } catch { /* no complete report */ }
        break;
      }
    }
  }
  if (report !== null) {
    child.kill();
    return { report, log: log.join(""), package: pkg };
  }
  const timedOut = exit === null;
  if (timedOut) {
    child.kill();
    exit = await closed;
  }
  const output = log.join("");
  const message = timedOut
    ? `no report within the deadline; log:\n${output}`
    : `Electron child exited before writing a report (${spawnError ? spawnError.message : exit.signal ? `signal ${exit.signal}` : `exit code ${exit.code}`}); log:\n${output}`;
  if (options.out != null) {
    const failure = {
      os: process.platform,
      arch: process.arch,
      measuredAt: new Date().toISOString(),
      package: pkg.replace(`${root}/`, ""),
      error: message,
      exitCode: exit.code,
      signal: exit.signal,
      output,
      elapsedMs: Date.now() - started,
    };
    mkdirSync(dirname(resolve(options.out)), { recursive: true });
    writeFileSync(resolve(options.out), `${JSON.stringify(failure, null, 2)}\n`);
  }
  throw new Error(message);
}

async function main() {
  const out = argument("--out", null);
  const measured = await measure({ out });
  const record = {
    os: process.platform,
    arch: process.arch,
    electron: execFileSync(electronBinary(), ["--version"], {
      encoding: "utf8",
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "0",
        ...(process.platform === "linux" ? { ELECTRON_DISABLE_SANDBOX: "1" } : {}),
      },
    }).trim(),
    measuredAt: new Date().toISOString(),
    // The path is relative to the repository so the record is portable between machines.
    package: measured.package.replace(`${root}/`, ""),
    ...measured.report,
  };
  if (out !== null) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), `${JSON.stringify(record, null, 2)}\n`);
  }
  // Compare against the committed closing baseline so the desktop lane fails if it rendered the wrong frame.
  const baselinePath = resolve(root, "golden", "regression", "closing.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const demoBoard = baseline.games?.demo?.frames?.find((frame) => frame.label === "board" && frame.tick === 120);
  const expected = {
    scheme: "app",
    serviceWorkers: 0,
    tick: demoBoard?.tick ?? 120,
    stateHash: demoBoard?.stateHash ?? null,
    drawHash: demoBoard?.drawHash ?? null,
  };
  const actual = {
    scheme: record.scheme,
    serviceWorkers: record.serviceWorkers,
    tick: record.tick,
    stateHash: record.stateHash,
    drawHash: record.drawHash,
  };
  let assertionError = null;
  for (const key of Object.keys(expected)) {
    if (expected[key] === null) continue;
    if (actual[key] !== expected[key]) {
      if (assertionError === null) assertionError = [];
      assertionError.push(`${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`);
    }
  }
  if (assertionError !== null) {
    const diff = assertionError.join("\n  ");
    console.error(`desktop measurement does not match committed baseline (${baselinePath}):\n  ${diff}`);
    process.exitCode = 1;
  }

  console.log(JSON.stringify(record, null, 2));
  if (record.error !== null) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
