import { deepEqual, equal, match, ok, rejects } from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { attachPage, closeDevice, selectDevice, UncancelledAttachError } from "../proof-android.mjs";
import { launchAndConnect } from "../proof-retry.mjs";

function rig() {
  let clock = 0;
  const attempts = [];
  const sleeps = [];
  const closed = [];
  const context = {
    now: () => clock,
    observe: (stage, attempt) => ({ stage, attempt, pid: "42", processState: "running", pidof: { exitCode: 0, output: "42", stderr: "" }, logcat: { exitCode: 0, output: `log-${attempt}`, stderr: "" } }),
    start: () => { throw new Error("unexpected restart"); },
    select: async () => ({ id: attempts.length + 1 }),
    attach: async () => ({}), live: async () => {},
    close: async (device) => { closed.push(device.id); },
    delay: async (ms) => { sleeps.push(ms); clock += ms; },
    attempts, log: () => {}, appId: "test.app", protocolTimeoutMs: 10000,
    initialBackoffMs: 500, maxBackoffMs: 8000,
  };
  return { context, attempts, sleeps, closed, advance: (ms) => { clock += ms; } };
}

test("production retry loop closes a transient failure and returns the recovered live page", async () => {
  const { context, attempts, sleeps, closed } = rig();
  const page = { isClosed: () => false };
  let calls = 0;
  const android = { devices: async () => [{
    serial: () => "serial",
    close: async () => { closed.push(++calls); },
    webView: async () => {
      if (calls === 0) throw new Error("connection reset");
      const view = new EventEmitter();
      view.pid = () => 42;
      view.page = async () => page;
      return view;
    },
  }] };
  context.select = (serial, timeout) => selectDevice(android, serial, timeout);
  context.attach = attachPage;
  context.close = closeDevice;
  let livePage;
  context.live = async (value) => { livePage = value; };
  const result = await launchAndConnect("initial", "serial", 180000, context);
  equal(result.page, page); equal(livePage, page);
  deepEqual(closed, [1]); deepEqual(sleeps, [500]);
  equal(attempts.length, 2); match(attempts[0].attachError, /connection reset/u);
  equal(attempts[0].logcat.output, "log-1"); equal(attempts[1].connected, true);
});

test("persistent failures exhaust the shared deadline and retain all diagnostics", async () => {
  const { context, attempts, sleeps, closed } = rig();
  context.attach = async () => { throw new Error("connection refused"); };
  await rejects(launchAndConnect("initial", "serial", 180000, context), /within 180000ms after \d+ attach attempts: Error: connection refused/u);
  equal(sleeps.reduce((a, b) => a + b, 0), 180000);
  deepEqual(sleeps.slice(0, 6), [500, 1000, 2000, 4000, 8000, 8000]);
  ok(attempts.length > 2); equal(closed.length, attempts.length);
  equal(attempts.at(-1).logcat.output, `log-${attempts.length}`);
  match(attempts.at(-1).attachError, /connection refused/u);
});


test("adapter time consumes the shared deadline and reduces subsequent call budgets", async () => {
  const { context, attempts, sleeps, advance } = rig();
  const selectBudgets = [];
  const attachBudgets = [];
  context.select = async (_serial, budget) => { selectBudgets.push(budget); return {}; };
  context.close = async () => {};
  context.attach = async (_device, _app, _pid, budget) => {
    attachBudgets.push(budget);
    advance(attachBudgets.length === 1 ? 7000 : 2500);
    throw new Error("connection refused");
  };
  await rejects(launchAndConnect("initial", "serial", 10000, context), /within 10000ms/u);
  deepEqual(selectBudgets, [10000, 2500]);
  deepEqual(attachBudgets, [10000, 2500]);
  deepEqual(sleeps, [500]);
  equal(attempts.length, 2);
  match(attempts[1].attachError, /connection refused/u);
});
test("uncancelled attachment is terminal and is not retried", async () => {
  const { context, attempts, sleeps, closed } = rig();
  context.attach = async () => { throw new UncancelledAttachError("still pending"); };
  await rejects(launchAndConnect("initial", "serial", 180000, context), /stopped without retrying.*still pending/u);
  equal(attempts.length, 1); deepEqual(sleeps, []); deepEqual(closed, [1]);
});
