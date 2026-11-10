import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { scheduleEmulatorCleanup } from "../proof-cleanup.mjs";

test("scheduleEmulatorCleanup is a no-op on non-linux platforms", () => {
  let spawned = false;
  const result = scheduleEmulatorCleanup({
    platform: "darwin",
    spawnFn: () => {
      spawned = true;
      return null;
    },
  });
  equal(result, null);
  equal(spawned, false);
});

test("scheduleEmulatorCleanup spawns detached reaper and unrefs on linux", () => {
  let spawnArgs = null;
  let unreferenced = false;
  const mockProcess = {
    unref: () => {
      unreferenced = true;
    },
  };

  const result = scheduleEmulatorCleanup({
    platform: "linux",
    delaySeconds: 10,
    processPatterns: "test_pattern",
    spawnFn: (command, args, options) => {
      spawnArgs = { command, args, options };
      return mockProcess;
    },
  });

  ok(result === mockProcess);
  equal(unreferenced, true);
  ok(spawnArgs !== null);
  equal(spawnArgs.command, "sh");
  deepEqual(spawnArgs.args, ["-c", "sleep 10; pkill -9 -f 'test_pattern' || true"]);
  deepEqual(spawnArgs.options, { detached: true, stdio: "ignore" });
});

test("scheduleEmulatorCleanup catches spawn errors gracefully", () => {
  const result = scheduleEmulatorCleanup({
    platform: "linux",
    spawnFn: () => {
      throw new Error("spawn failed");
    },
  });
  equal(result, null);
});
