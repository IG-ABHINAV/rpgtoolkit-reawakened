import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { quitWhenLastWindowCloses, type PlayerApp } from "../src/lifecycle.ts";

/** A fake Electron `app`: it records the listeners and counts quits. */
function fakeApp() {
  const listeners: Array<() => void> = [];
  let quits = 0;
  const app: PlayerApp = {
    on(_event, listener) {
      listeners.push(listener);
      return app;
    },
    quit() {
      quits += 1;
    },
  };
  return {
    app,
    emit() {
      for (const listener of listeners) listener();
    },
    get quits() {
      return quits;
    },
  };
}

/**
 * Run `body` while `process.platform` reads `platform`.
 *
 * The bug this covers was only visible on macOS, where Electron keeps an application alive after its last window
 * closes, while the unit lane runs on Linux. Faking the platform makes the macOS case a test on every host.
 */
function withPlatform(platform: string, body: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  if (descriptor === undefined) throw new Error("process.platform is not an own property");
  Object.defineProperty(process, "platform", { ...descriptor, value: platform });
  try {
    body();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
}

test("closing the player's last window quits it on macOS", () => {
  withPlatform("darwin", () => {
    const host = fakeApp();
    quitWhenLastWindowCloses(host.app);
    equal(host.quits, 0, "an open window must not quit the player");
    host.emit();
    equal(host.quits, 1);
  });
});

test("the last window closing quits the player on every platform", () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    withPlatform(platform, () => {
      const host = fakeApp();
      quitWhenLastWindowCloses(host.app);
      host.emit();
      equal(host.quits, 1, platform);
    });
  }
});

test("the Electron entry delegates window closing to the shutdown rule", () => {
  const entry = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  ok(entry.includes("quitWhenLastWindowCloses(app)"), "main.ts must install the shutdown rule");
  ok(!entry.includes("window-all-closed"), "the window-all-closed decision belongs to lifecycle.ts");
});
