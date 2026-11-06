import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import { chromium } from "@playwright/test";

// This is an integration test, not a fast unit test: it launches a real Chromium
// CDP endpoint and exercises Playwright's socket transport through the proof.
const proof = resolve("tools/mobile/proof.mjs");
const sentinel = "recovered page reached after reset";

async function serverFor(handler) {
  const server = createServer(handler);
  server.listen(9222, "127.0.0.1");
  await once(server, "listening");
  return server;
}

async function executeProof(dir, accelerated = false) {
  const adb = join(dir, "adb");
  await writeFile(adb, "#!/bin/sh\ncase \"$*\" in 'shell pidof '*) echo 123;; esac\nexit 0\n");
  await chmod(adb, 0o755);
  const args = [];
  if (accelerated) {
    const clock = join(dir, "clock.mjs");
    await writeFile(clock, 'let now = Date.now(); Date.now = () => now; const real = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...args) => { const backoff = new Error().stack.includes(\"at delay (\"); return real(() => { if (backoff) now += ms; fn(...args); }, backoff ? 1 : ms); };\n');
    args.push("--import", clock);
  }
  const child = spawn(process.execPath, [...args, proof], {
    env: { ...process.env, CI: "false", PATH: `${dir}:${process.env.PATH}`, MOBILE_PROOF_DIR: join(dir, "output") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 15_000);
  const [code, signal] = await once(child, "exit").finally(() => clearTimeout(watchdog));
  assert.notEqual(signal, "SIGKILL", `mobile proof exceeded its real-time watchdog:\n${output}`);
  const readings = JSON.parse(await readFile(join(dir, "output", "readings.json"), "utf8"));
  return { code, output, readings };
}

test("CDP socket reset is retried and the recovered real page is consumed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mobile-cdp-retry-"));
  let browserProcess;
  let browser;
  let proxy;
  try {
    browserProcess = spawn(chromium.executablePath(), ["--headless", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${join(dir, "profile")}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const endpoint = await new Promise((resolveEndpoint, reject) => {
      browserProcess.once("error", reject);
      browserProcess.once("exit", (code) => reject(new Error(`Chromium exited ${code}: ${stderr}`)));
      browserProcess.stderr.on("data", (chunk) => {
        stderr += chunk;
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) resolveEndpoint(match[1]);
      });
    });
    browser = await chromium.connectOverCDP(endpoint);
    const page = await browser.contexts()[0].newPage();
    await page.goto(`data:text/html,<script>window.__mobile={error:${JSON.stringify(sentinel)}}</script>`);
    const target = new URL(endpoint);
    let calls = 0;
    proxy = await serverFor((req, res) => {
      calls += 1;
      if (calls === 1) { req.socket.destroy(); return; }
      const upstream = request({ hostname: target.hostname, port: target.port, path: req.url, method: req.method }, (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      });
      upstream.on("error", (error) => res.destroy(error));
      req.pipe(upstream);
    });
    const result = await executeProof(dir);
    assert.equal(result.code, 1, result.output); // The sentinel intentionally stops the subsequent title check.
    assert.equal(result.readings.result, "failed");
    assert.match(result.readings.error, new RegExp(sentinel));
    assert.ok(calls >= 2, `expected a reset and another CDP request, got ${calls}`);
    assert.match(result.readings.attachAttempts[0].attachError, /ECONNRESET|socket hang up/i);
    assert.equal(result.readings.attachAttempts[1].connected, true);
  } finally {
    if (proxy) await new Promise((resolveClose) => proxy.close(resolveClose));
    if (browser) await browser.close();
    if (browserProcess && browserProcess.exitCode === null && browserProcess.signalCode === null) {
      const exited = once(browserProcess, "exit");
      browserProcess.kill();
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

for (const mode of ["reset", "http-error"]) {
  test(`persistent CDP ${mode} exhausts the deadline with its actual error`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "mobile-cdp-exhaust-"));
    let calls = 0;
    const server = await serverFor((req, res) => {
      calls += 1;
      if (mode === "reset") req.socket.destroy();
      else { res.writeHead(503, { "content-type": "text/plain" }); res.end("upstream unavailable"); }
    });
    try {
      const result = await executeProof(dir, true);
      assert.equal(result.code, 1, result.output);
      assert.equal(result.readings.result, "failed");
      assert.ok(calls > 1, `expected multiple attempts, got ${calls}`);
      const elapsed = result.readings.attachAttempts.map((attempt) => attempt.elapsedMs);
      assert.equal(elapsed[0], 0);
      assert.deepEqual(elapsed.slice(1, 6).map((value, index) => value - elapsed[index]),
        [500, 1000, 2000, 4000, 8000]);
      assert.ok(elapsed.at(-1) >= 172_000 && elapsed.at(-1) < 180_000,
        `retry stopped before exhausting the deadline: ${JSON.stringify(elapsed)}`);
      assert.match(result.readings.error, /could not expose the Android WebView page within 180000ms after \d+ attach attempts/);
      assert.match(result.readings.error, mode === "reset" ? /ECONNRESET|socket hang up/i : /503/);
      assert.ok(result.readings.attachAttempts.every((attempt) => attempt.connected !== true));
      assert.match(result.readings.attachAttempts.at(-1).attachError, mode === "reset" ? /ECONNRESET|socket hang up/i : /503/);
      const evidence = JSON.parse(await readFile(join(dir, "output", "failure-evidence.json"), "utf8"));
      assert.match(evidence.error, mode === "reset" ? /ECONNRESET|socket hang up/i : /503/);
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
      await rm(dir, { recursive: true, force: true });
    }
  });
}
