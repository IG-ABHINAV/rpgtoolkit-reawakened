import { deepEqual, equal, match, throws } from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ADB_INSTALL_TIMEOUT_MS, adbFailure, adbWithTimeout, describeAdbFailure, installApk, runAdbWithTimeout } from "../proof-adb.mjs";
import { classifyProcess } from "../proof-process.mjs";

test("adb diagnostics distinguish timeout, spawn failure and signal", () => {
  const timeout = adbFailure({ status: null, code: "ETIMEDOUT", signal: "SIGTERM", stdout: "", stderr: "", message: "spawnSync adb ETIMEDOUT" });
  match(timeout.stderr, /ETIMEDOUT.*signal SIGTERM/u);
  match(adbFailure({ status: null, code: "ETIMEDOUT", signal: "SIGTERM", stderr: "device offline" }).stderr, /device offline.*ETIMEDOUT.*SIGTERM/u);
  match(describeAdbFailure(timeout, 120000), /timed out after 120000ms, signal SIGTERM/u);
  match(describeAdbFailure(adbFailure({ code: "ENOENT", message: "spawnSync adb ENOENT" }), 15000), /code ENOENT.*spawnSync adb ENOENT/u);
  equal(classifyProcess(adbFailure({ status: 1, stdout: "", stderr: "", message: "Command failed" })).state, "absent");
  equal(classifyProcess(timeout).state, "unknown");
  equal(ADB_INSTALL_TIMEOUT_MS, 120000);
  let invocation;
  equal(installApk("slow.apk", (...args) => { invocation = args; return "Success"; }), "Success");
  deepEqual(invocation, [120000, "install", "-r", "slow.apk"]);
});

test("real adb subprocess preserves install success, rejection and absent pidof", () => {
  const directory = mkdtempSync(join(tmpdir(), "mobile-adb-test-"));
  const oldPath = process.env.PATH;
  try {
    const adb = join(directory, "adb");
    writeFileSync(adb, '#!/bin/sh\ncase "$*" in\n  "install -r good.apk") printf "Success\\n";;\n  "install -r bad.apk") echo "INSTALL_FAILED_TEST"; echo "warning" >&2; exit 7;;\n  "shell pidof missing") exit 1;;\n  *) exit 2;;\nesac\n');
    chmodSync(adb, 0o755);
    process.env.PATH = `${directory}:${oldPath}`;
    equal(installApk("good.apk"), "Success");
    throws(() => installApk("bad.apk"), /exit 7.*stderr: warning.*stdout: INSTALL_FAILED_TEST/u);
    equal(classifyProcess(runAdbWithTimeout(15000, "shell", "pidof", "missing")).state, "absent");
    throws(() => adbWithTimeout(15000, "unexpected"), /exit 2/u);
  } finally {
    process.env.PATH = oldPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
