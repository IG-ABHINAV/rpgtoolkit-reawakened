import { deepEqual, equal, match, ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { classifyProcess } from "../proof-process.mjs";

const tool = resolve(dirname(fileURLToPath(import.meta.url)), "../proof.mjs");

test("pidof timeout, transport errors and malformed output are unknown, not absence", () => {
  for (const result of [
    { status: null, stdout: "", stderr: "timed out" },
    { status: 1, stdout: "", stderr: "error: device offline" },
    { status: 0, stdout: "garbage", stderr: "" },
  ]) deepEqual(classifyProcess(result), { state: "unknown", pid: null });
  deepEqual(classifyProcess({ status: 1, stdout: "", stderr: "" }), { state: "absent", pid: null });
  deepEqual(classifyProcess({ status: 0, stdout: "123 456", stderr: "" }), { state: "running", pid: "123" });
});

test("transient adb failure does not restart, genuine absence does, and failure artifacts say failed", () => {
  const dir = mkdtempSync(join(tmpdir(), "mobile-proof-test-"));
  try {
    const adb = join(dir, "adb");
    const calls = join(dir, "calls");
    const clock = join(dir, "clock.mjs");
    writeFileSync(adb, `#!/bin/sh\necho "$*" >> "$CALLS"\ncase "$*" in\n  'shell pidof '*)\n    if [ ! -e "$FIRST" ]; then touch "$FIRST"; echo 'error: device offline' >&2; exit 1; fi\n    exit 1;;\n  *) exit 0;;\nesac\n`);
    chmodSync(adb, 0o755);
    // Accelerate only the spawned proof's clock; no wall-clock sleeps or production test switches.
    writeFileSync(clock, 'let now = 0; Date.now = () => { now += 5000; return now; }; const original = globalThis.setTimeout; globalThis.setTimeout = (fn, _ms, ...args) => original(fn, 1, ...args);\n');
    const result = spawnSync(process.execPath, ["--import", clock, tool], {
      encoding: "utf8", timeout: 15000,
      env: { ...process.env, CI: "false", PATH: `${dir}:${process.env.PATH}`, CALLS: calls, FIRST: join(dir, "first"), MOBILE_PROOF_DIR: join(dir, "output") },
    });
    equal(result.status, 1, result.stderr);
    const commands = readFileSync(calls, "utf8").trim().split("\n");
    const firstPid = commands.findIndex((line) => line.startsWith("shell pidof "));
    const secondPid = commands.findIndex((line, index) => index > firstPid && line.startsWith("shell pidof "));
    const start = commands.findIndex((line) => line.startsWith("shell am start "));
    ok(firstPid >= 0 && secondPid > firstPid && start > secondPid, JSON.stringify(commands));
    const reading = JSON.parse(readFileSync(join(dir, "output", "readings.json"), "utf8"));
    equal(reading.result, "failed");
    equal(reading.attachAttempts[0].processState, "unknown");
    equal(reading.attachAttempts[1].processState, "absent");
    match(reading.error, /could not expose the Android WebView/);
    const evidence = JSON.parse(readFileSync(join(dir, "output", "failure-evidence.json"), "utf8"));
    match(evidence.error, /could not expose the Android WebView/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
