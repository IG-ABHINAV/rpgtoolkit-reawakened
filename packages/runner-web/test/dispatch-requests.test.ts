import { deepEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import { assetKey } from "@tk-reawakened/core";
import type { InputRecord, RunnerRequest } from "@tk-reawakened/core";
import { dispatchRequests } from "../src/dispatch-requests.ts";

const key = (name: string) => assetKey(name);

function assetRequest(reqId: number, name: string): RunnerRequest {
  return { kind: "asset", reqId, key: key(name) };
}

function prefetchHint(reqId: number, tier: "now" | "next" | "always", name: string): RunnerRequest {
  return { kind: "prefetch", reqId, hints: [{ tier, key: key(name) }] };
}

/** Lets every promise continuation already queued run; the code under test uses no timers. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(cause: unknown): void } {
  let settle!: (value: T) => void;
  let fail!: (cause: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => { settle = resolve; fail = reject; });
  return { promise, resolve: settle, reject: fail };
}

/**
 * A host reply that records the order calls began and ended. Asset replies wait on a gate so the test controls when
 * they resolve; prefetch replies are synchronous. This mirrors the real `hostReply` in `createLiveSession`.
 */
function recordingHost(order: string[], gate: Promise<void>): (request: RunnerRequest, tick: number) => Promise<InputRecord | null> {
  return async (request: RunnerRequest, tick: number): Promise<InputRecord | null> => {
    if (request.kind === "prefetch") {
      order.push(`prefetch:${request.hints.map((h) => h.key).join(",")}`);
      return null;
    }
    if (request.kind === "asset") {
      order.push(`asset-start:${request.key}`);
      await gate;
      order.push(`asset-end:${request.key}`);
      return { tick, event: { kind: "asset", reqId: request.reqId, bytes: null } };
    }
    return null;
  };
}

test("prefetch hints are dispatched before blocking asset requests so the hint starts the origin read", async () => {
  const order: string[] = [];
  const gate = deferred<void>();
  const requests: RunnerRequest[] = [
    assetRequest(1, "music.mid"),
    prefetchHint(2, "now", "music.mid"),
  ];
  const repliesPromise = dispatchRequests(requests, 42, recordingHost(order, gate.promise));
  await flush();
  deepEqual(order, [`prefetch:${key("music.mid")}`, `asset-start:${key("music.mid")}`], "prefetch ran before the asset awaited");
  gate.resolve(undefined);
  const replies = await repliesPromise;
  deepEqual(order, [`prefetch:${key("music.mid")}`, `asset-start:${key("music.mid")}`, `asset-end:${key("music.mid")}`]);
  deepEqual(replies, [{ tick: 42, event: { kind: "asset", reqId: 1, bytes: null } }]);
});

test("replies are collected in report order even when prefetch is dispatched first", async () => {
  const order: string[] = [];
  const gate = deferred<void>();
  const requests: RunnerRequest[] = [
    assetRequest(1, "a.brd"),
    prefetchHint(2, "now", "b.mid"),
    assetRequest(3, "c.brd"),
  ];
  const repliesPromise = dispatchRequests(requests, 7, recordingHost(order, gate.promise));
  gate.resolve(undefined);
  const replies = await repliesPromise;
  deepEqual(replies, [
    { tick: 7, event: { kind: "asset", reqId: 1, bytes: null } },
    { tick: 7, event: { kind: "asset", reqId: 3, bytes: null } },
  ]);
});

test("a prefetch hint does not wait for an earlier asset request to resolve", async () => {
  const order: string[] = [];
  const gate = deferred<void>();
  const requests: RunnerRequest[] = [
    assetRequest(1, "slow.brd"),
    prefetchHint(2, "now", "music.mid"),
  ];
  const repliesPromise = dispatchRequests(requests, 0, recordingHost(order, gate.promise));
  await flush();
  ok(order.includes(`prefetch:${key("music.mid")}`), "prefetch was dispatched while the asset was still pending");
  gate.resolve(undefined);
  await repliesPromise;
});
