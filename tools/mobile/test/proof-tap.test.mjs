import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  assertPointerEvents,
  dispatchCanvasTap,
  prepareTapTarget,
  waitForPointerEvents,
} from "../proof-tap.mjs";

const mockTarget = {
  coordinateSpace: "CDP CSS viewport pixels, derived from the canvas client rect",
  logical: { x: 160, y: 120 },
  cssViewport: { x: 200, y: 150 },
  canvas: { width: 320, height: 240 },
  rect: { left: 40, top: 30, width: 320, height: 240 },
  devicePixelRatio: 2,
};

test("prepareTapTarget succeeds on first evaluate attempt", async () => {
  const mockPage = {
    evaluate: async () => mockTarget,
  };
  const target = await prepareTapTarget(mockPage, {
    timeoutMs: 5_000,
    delay: async () => {},
  });
  deepEqual(target, mockTarget);
});

test("prepareTapTarget retries when transient errors occur and succeeds", async () => {
  let attempts = 0;
  const delays = [];
  const mockPage = {
    evaluate: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("renderer busy");
      return mockTarget;
    },
  };

  let simulatedTime = 0;
  const now = () => simulatedTime;
  const delay = async (ms) => {
    delays.push(ms);
    simulatedTime += ms;
  };

  const target = await prepareTapTarget(mockPage, {
    timeoutMs: 10_000,
    initialBackoffMs: 200,
    maxBackoffMs: 1_000,
    backoffFactor: 2,
    delay,
    now,
  });

  equal(attempts, 3);
  deepEqual(target, mockTarget);
  deepEqual(delays, [200, 400]);
});

test("prepareTapTarget throws when deadline is exhausted", async () => {
  let attempts = 0;
  const mockPage = {
    evaluate: async () => {
      attempts += 1;
      throw new Error("canvas absent");
    },
  };

  let simulatedTime = 0;
  const now = () => simulatedTime;
  const delay = async (ms) => {
    simulatedTime += ms;
  };

  await rejects(
    async () => prepareTapTarget(mockPage, {
      timeoutMs: 1_000,
      initialBackoffMs: 300,
      delay,
      now,
    }),
    /reading canvas tap target and installing observers timed out after 1000ms; last error: canvas absent/
  );
  ok(attempts >= 2);
});

test("dispatchCanvasTap sends touch events and detaches CDP session", async () => {
  const sent = [];
  let detached = false;
  const mockPage = {
    context: () => ({
      newCDPSession: async () => ({
        send: async (method, params) => {
          sent.push({ method, params });
        },
        detach: async () => {
          detached = true;
        },
      }),
    }),
  };

  await dispatchCanvasTap(mockPage, mockTarget, { holdDelayMs: 0 });
  equal(detached, true);
  equal(sent.length, 2);
  equal(sent[0].method, "Input.dispatchTouchEvent");
  equal(sent[0].params.type, "touchStart");
  equal(sent[0].params.touchPoints[0].x, mockTarget.cssViewport.x);
  equal(sent[0].params.touchPoints[0].y, mockTarget.cssViewport.y);
  equal(sent[1].method, "Input.dispatchTouchEvent");
  equal(sent[1].params.type, "touchEnd");
  deepEqual(sent[1].params.touchPoints, []);
});

test("dispatchCanvasTap retries when transient CDP error occurs and succeeds", async () => {
  let attempts = 0;
  let detachCount = 0;
  const mockPage = {
    context: () => ({
      newCDPSession: async () => ({
        send: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("renderer timed out");
        },
        detach: async () => {
          detachCount += 1;
        },
      }),
    }),
  };

  let simulatedTime = 0;
  const now = () => simulatedTime;
  const delay = async (ms) => {
    simulatedTime += ms;
  };

  await dispatchCanvasTap(mockPage, mockTarget, {
    timeoutMs: 10_000,
    initialBackoffMs: 200,
    holdDelayMs: 0,
    delay,
    now,
  });

  equal(attempts, 3); // attempt 1 failed at start, attempt 2 succeeded for start and end
  equal(detachCount, 2); // detached on failure and detached on success
});

test("dispatchCanvasTap detaches CDP session even if touch dispatch fails and exhausts deadline", async () => {
  let detachCount = 0;
  const mockPage = {
    context: () => ({
      newCDPSession: async () => ({
        send: async () => {
          throw new Error("CDP error");
        },
        detach: async () => {
          detachCount += 1;
        },
      }),
    }),
  };

  let simulatedTime = 0;
  const now = () => simulatedTime;
  const delay = async (ms) => {
    simulatedTime += ms;
  };

  await rejects(
    async () => dispatchCanvasTap(mockPage, mockTarget, {
      timeoutMs: 1_000,
      initialBackoffMs: 200,
      holdDelayMs: 0,
      delay,
      now,
    }),
    /dispatching Android touch events timed out after 1000ms; last error: CDP error/
  );
  ok(detachCount >= 2);
});

test("assertPointerEvents validates correct pointerdown and pointerup events", () => {
  const validEvents = [
    { type: "pointerdown", pointerType: "touch", trusted: true, buttons: 1, logical: { x: 160, y: 120 } },
    { type: "pointerup", pointerType: "touch", trusted: true, buttons: 0, logical: { x: 160, y: 120 } },
  ];
  const { down, up } = assertPointerEvents(validEvents, mockTarget);
  equal(down.type, "pointerdown");
  equal(up.type, "pointerup");
});

test("assertPointerEvents rejects invalid or mismatched events", () => {
  throws(
    () => assertPointerEvents([], mockTarget),
    /pointerdown event was not captured/
  );
  throws(
    () => assertPointerEvents([{ type: "pointerdown", pointerType: "touch", trusted: true, buttons: 1, logical: { x: 160, y: 120 } }], mockTarget),
    /pointerup event was not captured/
  );
  throws(
    () => assertPointerEvents([
      { type: "pointerdown", pointerType: "touch", trusted: false, buttons: 1, logical: { x: 160, y: 120 } },
      { type: "pointerup", pointerType: "touch", trusted: true, buttons: 0, logical: { x: 160, y: 120 } },
    ], mockTarget),
    /touch did not reach intended canvas point/
  );
  throws(
    () => assertPointerEvents([
      { type: "pointerdown", pointerType: "touch", trusted: true, buttons: 1, logical: { x: 160, y: 120 } },
      { type: "pointerup", pointerType: "touch", trusted: true, buttons: 0, logical: { x: 999, y: 999 } },
    ], mockTarget),
    /touch release did not reach intended canvas point/
  );
});

test("waitForPointerEvents polls until both pointerdown and pointerup are observed", async () => {
  let polls = 0;
  const pollDelays = [];
  const mockPage = {
    evaluate: async () => {
      polls += 1;
      if (polls === 1) return [];
      if (polls === 2) return [{ type: "pointerdown", pointerType: "touch", trusted: true, buttons: 1, logical: { x: 160, y: 120 } }];
      return [
        { type: "pointerdown", pointerType: "touch", trusted: true, buttons: 1, logical: { x: 160, y: 120 } },
        { type: "pointerup", pointerType: "touch", trusted: true, buttons: 0, logical: { x: 160, y: 120 } },
      ];
    },
  };

  let simulatedTime = 0;
  const now = () => simulatedTime;
  const delay = async (ms) => {
    pollDelays.push(ms);
    simulatedTime += ms;
  };

  const events = await waitForPointerEvents(mockPage, {
    target: mockTarget,
    timeoutMs: 5_000,
    pollIntervalMs: 100,
    delay,
    now,
  });

  equal(polls, 3);
  equal(events.length, 2);
  deepEqual(pollDelays, [100, 100]);
});

test("waitForPointerEvents throws when polling times out without both events", async () => {
  const mockPage = {
    evaluate: async () => [],
  };

  let simulatedTime = 0;
  const now = () => simulatedTime;
  const delay = async (ms) => {
    simulatedTime += ms;
  };

  await rejects(
    async () => waitForPointerEvents(mockPage, {
      target: mockTarget,
      timeoutMs: 1_000,
      pollIntervalMs: 200,
      delay,
      now,
    }),
    /timed out waiting for canvas pointer events/
  );
});
