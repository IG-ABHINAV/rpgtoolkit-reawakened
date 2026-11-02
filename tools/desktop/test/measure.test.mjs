import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { measure } from "../measure.mjs";

test("a child that exits without a report fails promptly and writes diagnostics", { timeout: 1000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "desktop-measure-test-"));
  const out = join(dir, "nested", "failure.json");
  try {
    await assert.rejects(measure({
      package: "test.tpk",
      out,
      timeoutMs: 5000,
      command: [process.execPath, "-e", "process.stdout.write('out\\n'); process.stderr.write('err\\n'); process.exitCode = 23"],
    }), /exit code 23[\s\S]*(?:out[\s\S]*err|err[\s\S]*out)/);
    const failure = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(failure.exitCode, 23);
    assert.equal(failure.signal, null);
    assert.match(failure.error, /exit code 23/);
    assert.match(failure.output, /out/);
    assert.match(failure.output, /err/);
    assert.equal(typeof failure.elapsedMs, "number");
    assert.ok(failure.elapsedMs >= 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the deadline path retains its error and writes diagnostics", { timeout: 1000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "desktop-measure-test-"));
  const out = join(dir, "failure.json");
  try {
    await assert.rejects(measure({
      package: "test.tpk",
      out,
      timeoutMs: 0,
      command: [process.execPath, "-e", "process.stdin.resume()"],
    }), /^Error: no report within the deadline; log:\n/);
    const failure = JSON.parse(readFileSync(out, "utf8"));
    assert.match(failure.error, /^no report within the deadline; log:\n/);
    assert.equal(typeof failure.elapsedMs, "number");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

if (process.platform !== "win32") {
  test("a child terminated by a signal reports that signal", { timeout: 1000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "desktop-measure-test-"));
    const out = join(dir, "failure.json");
    try {
      await assert.rejects(measure({
        package: "test.tpk",
        out,
        timeoutMs: 5000,
        command: [process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"],
      }), /signal SIGTERM/);
      const failure = JSON.parse(readFileSync(out, "utf8"));
      assert.equal(failure.exitCode, null);
      assert.equal(failure.signal, "SIGTERM");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
