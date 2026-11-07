import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { probeScreenshotStages } from "../proof-telemetry.mjs";

test("probeScreenshotStages records successful font and CDP layout metrics", async () => {
  let detached = false;
  const mockPage = {
    locator: (selector) => ({
      count: async () => (selector === "#screen" ? 1 : 0),
    }),
    evaluate: async (fn) => {
      const code = fn.toString();
      if (code.includes("status")) return { status: "loaded", size: 1 };
      if (code.includes("ready")) return "ready";
      throw new Error(`unexpected evaluate: ${code}`);
    },
    context: () => ({
      newCDPSession: async () => ({
        send: async (method) => {
          if (method === "Page.getLayoutMetrics") return { visualViewport: { pageX: 0, pageY: 0 } };
          throw new Error(`unexpected CDP method: ${method}`);
        },
        detach: async () => {
          detached = true;
        },
      }),
    }),
  };

  const probe = await probeScreenshotStages(mockPage, "title", 100);
  equal(probe.name, "title");
  ok(typeof probe.timestamp === "number");
  equal(probe.utilityContext.ready, true);
  equal(probe.fontsStatus.status, "loaded");
  equal(probe.fontsStatus.size, 1);
  equal(probe.fontsReady.result, "ready");
  equal(probe.cdpLayoutMetrics.hasVisualViewport, true);
  equal(detached, true);
});

test("probeScreenshotStages captures font evaluation errors without throwing", async () => {
  let detached = false;
  const mockPage = {
    locator: () => ({
      count: async () => {
        throw new Error("utility failure");
      },
    }),
    evaluate: async () => {
      throw new Error("context destroyed");
    },
    context: () => ({
      newCDPSession: async () => ({
        send: async () => ({ visualViewport: {} }),
        detach: async () => {
          detached = true;
        },
      }),
    }),
  };

  const probe = await probeScreenshotStages(mockPage, "tap", 100);
  equal(probe.name, "tap");
  equal(probe.utilityContext.error, "utility failure");
  equal(probe.fontsStatus.error, "context destroyed");
  equal(probe.fontsReady.error, "context destroyed");
  equal(probe.cdpLayoutMetrics.hasVisualViewport, true);
  equal(detached, true);
});

test("probeScreenshotStages handles CDP failure and ensures session detachment", async () => {
  let detached = false;
  const mockPage = {
    evaluate: async () => ({ status: "loaded", size: 0 }),
    context: () => ({
      newCDPSession: async () => ({
        send: async () => {
          throw new Error("CDP target detached");
        },
        detach: async () => {
          detached = true;
        },
      }),
    }),
  };

  const probe = await probeScreenshotStages(mockPage, "rotation", 100);
  equal(probe.name, "rotation");
  equal(probe.cdpLayoutMetrics.error, "CDP target detached");
  equal(detached, true);
});
