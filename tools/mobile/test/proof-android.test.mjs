import { deepEqual, equal, rejects, strictEqual, throws } from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";
import { _android } from "@playwright/test";
import { adbServerOptions, attachPage, selectDevice, UncancelledAttachError } from "../proof-android.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function device(serial) {
  return { serial: () => serial, closes: 0, async close() { this.closes++; } };
}

function view(promise, pid = 123) {
  return Object.assign(new EventEmitter(), { pid: () => pid, page: () => promise });
}

test("selects adb serial and closes all other devices without installing a driver on them", async () => {
  const first = device("other");
  const target = device("emulator-5554");
  let options;
  const selected = await selectDevice({ devices: async (...args) => { options = args; return [first, target]; } }, "emulator-5554", 1000);
  strictEqual(selected, target);
  deepEqual(options, []); // Keep Playwright's automatic driver-install default.
  equal(first.closes, 1);
  equal(target.closes, 0);
});

test("ADB endpoint follows adb socket and host/port precedence without changing driver defaults", async () => {
  deepEqual(adbServerOptions({}), { host: "localhost" });
  deepEqual(adbServerOptions({ ADB_SERVER_PORT: "5038" }), { host: "localhost" }); // adb uses ANDROID_ADB_SERVER_PORT.
  deepEqual(adbServerOptions({ ANDROID_ADB_SERVER_PORT: "5038" }), { host: "localhost", port: 5038 });
  deepEqual(adbServerOptions({ ANDROID_ADB_SERVER_ADDRESS: "example", ANDROID_ADB_SERVER_PORT: "5039" }), { host: "example", port: 5039 });
  deepEqual(adbServerOptions({ ADB_SERVER_SOCKET: "tcp:127.0.0.1:5040", ANDROID_ADB_SERVER_PORT: "5038" }), { host: "127.0.0.1", port: 5040 });
  deepEqual(adbServerOptions({ ADB_SERVER_SOCKET: "tcp:5041" }), { host: "localhost", port: 5041 });
  deepEqual(adbServerOptions({ ADB_SERVER_SOCKET: "tcp:[::1]:5042" }), { host: "::1", port: 5042 });
  for (const value of ["0", "65536", "abc"]) throws(() => adbServerOptions({ ANDROID_ADB_SERVER_PORT: value }), /Invalid ADB server port/u);
  throws(() => adbServerOptions({ ADB_SERVER_SOCKET: "localfilesystem:/tmp/adb.sock" }), /requires a TCP/u);
  const target = device("emulator-5560");
  const wrongServer = device("other");
  const android = { devices: async (options) => options?.port === 5038 ? [target] : [wrongServer] };
  await rejects(selectDevice(android, "emulator-5560", 1000), /matching adb-selected serial/u);
  strictEqual(await selectDevice(android, "emulator-5560", 1000, adbServerOptions({ ANDROID_ADB_SERVER_PORT: "5038" })), target);
});

test("real Playwright enumeration reaches the configured ADB server", async () => {
  const commands = [];
  const server = createServer((socket) => {
    let received = "";
    socket.on("data", (data) => {
      received += data.toString();
      if (received.length < 4) return;
      const length = Number.parseInt(received.slice(0, 4), 16);
      if (received.length < length + 4) return;
      commands.push(received.slice(4, 4 + length));
      socket.end("OKAY0000");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const options = adbServerOptions({ ANDROID_ADB_SERVER_ADDRESS: "127.0.0.1", ANDROID_ADB_SERVER_PORT: String(server.address().port) });
    await rejects(selectDevice(_android, "emulator-5560", 5000, options), /matching adb-selected serial/u);
    deepEqual(commands, ["host:devices"]);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("rejects missing or ambiguous devices and closes every discovered handle", async () => {
  for (const serials of [["other"], ["target", "target"]]) {
    const devices = serials.map(device);
    await rejects(selectDevice({ devices: async () => devices }, "target", 1000), /matching adb-selected serial/);
    deepEqual(devices.map((item) => item.closes), serials.map(() => 1));
  }
});

test("late device enumeration is closed after its deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred();
  const other = device("other");
  const target = device("target");
  const selected = selectDevice({ devices: () => pending.promise }, "target", 10);
  await Promise.resolve();
  t.mock.timers.tick(10);
  await rejects(selected, UncancelledAttachError);
  pending.resolve([other, target]);
  await Promise.resolve();
  await Promise.resolve();
  deepEqual([other.closes, target.closes], [1, 1]);
});

test("attaches the matching package and process to its Playwright page", async () => {
  const page = { isClosed: () => false };
  const webView = view(Promise.resolve(page));
  const calls = [];
  const selected = { webView: async (...args) => { calls.push(args); return webView; } };
  strictEqual(await attachPage(selected, "app.id", "123", 1000), page);
  deepEqual(calls, [[{ pkg: "app.id" }, { timeout: 1000 }]]);
  equal(webView.listenerCount("close"), 0);
});

test("rejects a stale process before opening its page", async () => {
  const webView = view(Promise.resolve(null), 999);
  await rejects(attachPage({ webView: async () => webView }, "app.id", "123", 1000), /PID 999 does not match/);
});

test("a failed attachment can disconnect and reconnect to a fresh WebView", async () => {
  const oldDevice = device("target");
  const newDevice = device("target");
  const page = { isClosed: () => false };
  const oldView = view(Promise.reject(new Error("socket reset")));
  const newView = view(Promise.resolve(page), 456);
  oldDevice.webView = async () => oldView;
  newDevice.webView = async () => newView;
  const devices = [oldDevice, newDevice];
  const android = { devices: async () => [devices.shift()] };
  const first = await selectDevice(android, "target", 1000);
  await rejects(attachPage(first, "app.id", "123", 1000), /socket reset/);
  await first.close();
  const second = await selectDevice(android, "target", 1000);
  strictEqual(await attachPage(second, "app.id", "456", 1000), page);
  await second.close();
  deepEqual([oldDevice.closes, newDevice.closes], [1, 1]);
});

test("a hung page attachment times out and closes any late context", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred();
  const webView = view(pending.promise);
  const attaching = attachPage({ webView: async () => webView }, "app.id", "123", 10);
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(10);
  await rejects(attaching, UncancelledAttachError);
  let closes = 0;
  pending.resolve({ context: () => ({ close: async () => { closes++; } }) });
  await Promise.resolve();
  await Promise.resolve();
  equal(closes, 1);
  equal(webView.listenerCount("close"), 0);
});

test("view closure during attachment is terminal and late pages are closed", async () => {
  const pending = deferred();
  const webView = view(pending.promise);
  const attaching = attachPage({ webView: async () => webView }, "app.id", "123", 1000);
  await Promise.resolve();
  webView.emit("close");
  await rejects(attaching, UncancelledAttachError);
  let closes = 0;
  pending.resolve({ context: () => ({ close: async () => { closes++; } }) });
  await Promise.resolve();
  await Promise.resolve();
  equal(closes, 1);
});
