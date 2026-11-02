import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { assetKey, type AssetKey, type PrefetchHint } from "@tk-reawakened/core";
import type { DecodeAhead, PrepareKind } from "../src/decode-types.ts";
import { createSessionAssets, prepareKindFor, stallIsVisible, type AssetOrigin } from "../src/session-assets.ts";
import { createStallOverlay, SPINNER_DELAY_MS } from "../src/stall-overlay.ts";

// The session's tiers: what a blocking request, a prefetch hint and a cue's `ensure` each do to the cache, and what the
// spinner's 300 ms rule says about the blocking state. The clock is injected, so none of it waits on real time.

const key = (name: string): AssetKey => assetKey(name);
const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

type Held = { resolve(value: Uint8Array): void; reject(cause: Error): void };

/** An origin whose reads stay pending until the test settles them, and which records the order reads began in. */
function manualOrigin(names: readonly string[]): { origin: AssetOrigin; started: string[]; settle(name: string, value: Uint8Array): void; fail(name: string, message: string): void } {
  const known = new Set(names.map((name) => key(name)));
  const started: string[] = [];
  const held = new Map<string, Held[]>();
  return {
    started,
    origin: {
      has: (asset) => known.has(asset),
      read(asset) {
        started.push(asset);
        return new Promise<Uint8Array>((resolve, reject) => {
          const list = held.get(asset) ?? [];
          list.push({ resolve, reject });
          held.set(asset, list);
        });
      },
    },
    settle(name, value) {
      for (const entry of held.get(key(name)) ?? []) entry.resolve(value);
      held.delete(key(name));
    },
    fail(name, message) {
      for (const entry of held.get(key(name)) ?? []) entry.reject(new Error(message));
      held.delete(key(name));
    },
  };
}

function fakeClock(start = 1_000): { now: () => number; advance(ms: number): void } {
  let current = start;
  return { now: () => current, advance: (ms) => { current += ms; } };
}

const hints = (...entries: [PrefetchHint["tier"], string][]): PrefetchHint[] => entries.map(([tier, name]) => ({ tier, key: key(name) }));
/** Lets every promise continuation already queued run; the code under test uses no timers. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

test("a key already cached is answered at once with no stall and no origin read", async () => {
  const origin = manualOrigin(["a.brd"]);
  const cache = new Map<AssetKey, Uint8Array>([[key("a.brd"), bytes(1)]]);
  const assets = createSessionAssets({ cache, origin: origin.origin, clock: fakeClock().now });
  deepEqual(await assets.request(key("a.brd")), bytes(1));
  equal(origin.started.length, 0);
  deepEqual(assets.state().stalls, []);
});

test("a request the cache cannot answer is a stall: blocking while it lasts, recorded with its duration and whether a hint named it", async () => {
  const clock = fakeClock();
  const origin = manualOrigin(["a.brd"]);
  const assets = createSessionAssets({ cache: new Map(), origin: origin.origin, clock: clock.now });
  const reading = assets.request(key("a.brd"));
  deepEqual(assets.state().blocking, { key: key("a.brd"), since: 1_000 });
  clock.advance(420);
  origin.settle("a.brd", bytes(9));
  deepEqual(await reading, bytes(9));
  const state = assets.state();
  equal(state.blocking, null);
  deepEqual(state.stalls, [{ key: key("a.brd"), hinted: false, startedAt: 1_000, durationMs: 420 }]);
  deepEqual(assets.peek(key("a.brd")), bytes(9), "the bytes are in the synchronous cache for the renderer and audio");
});

test("a hint that finished before the engine asked leaves no stall; a hint still in flight is a stall flagged hinted", async () => {
  const origin = manualOrigin(["early.mid", "late.mid"]);
  const assets = createSessionAssets({ cache: new Map(), origin: origin.origin, clock: fakeClock().now });
  assets.hint(hints(["now", "early.mid"], ["now", "late.mid"]));
  origin.settle("early.mid", bytes(1));
  await flush();
  deepEqual(await assets.request(key("early.mid")), bytes(1));
  equal(assets.state().stalls.length, 0, "a hinted asset that arrived in time never stalls");
  const late = assets.request(key("late.mid"));
  origin.settle("late.mid", bytes(2));
  await late;
  deepEqual(assets.state().stalls.map((stall) => [stall.key, stall.hinted]), [[key("late.mid"), true]]);
  equal(origin.started.filter((name) => name === key("late.mid")).length, 1, "the request joined the hint's read, it did not start a second one");
});

test("hints run nonblocking in tier order within a concurrency limit, and a blocking request never waits for a slot", async () => {
  const origin = manualOrigin(["now1", "now2", "next1", "always1", "urgent"]);
  const assets = createSessionAssets({ cache: new Map(), origin: origin.origin, clock: fakeClock().now, concurrency: 2 });
  assets.hint(hints(["always", "always1"], ["next", "next1"], ["now", "now1"], ["now", "now2"]));
  deepEqual(origin.started, [key("now1"), key("now2")], "now outranks next outranks always, two at a time");
  const urgent = assets.request(key("urgent"));
  equal(origin.started.includes(key("urgent")), true, "the engine's request starts at once, past the hint limit");
  origin.settle("urgent", bytes(7));
  await urgent;
  origin.settle("now1", bytes(1));
  await flush();
  deepEqual(origin.started.slice(2, 4), [key("urgent"), key("next1")], "a finished hint frees a slot for the next tier");
  origin.settle("now2", bytes(1));
  origin.settle("next1", bytes(1));
  await flush();
  origin.settle("always1", bytes(1));
  await flush();
  const { hints: counts } = assets.state();
  deepEqual(counts, { received: 4, completed: 4, failed: 0, pending: 0 });
});

test("a failed hint is recorded and never thrown; a failed request throws and is recorded; neither is turned into a missing asset", async () => {
  const origin = manualOrigin(["h.wav", "r.brd"]);
  const assets = createSessionAssets({ cache: new Map(), origin: origin.origin, clock: fakeClock().now });
  assets.hint(hints(["now", "h.wav"]));
  origin.fail("h.wav", "offline");
  await flush();
  const request = assets.request(key("r.brd"));
  origin.fail("r.brd", "gone");
  let thrown: unknown;
  try {
    await request;
  } catch (cause) {
    thrown = cause;
  }
  ok(thrown instanceof Error && thrown.message === "gone");
  const state = assets.state();
  equal(state.hints.failed, 1);
  deepEqual(state.failures.map((failure) => [failure.key, failure.during]), [[key("h.wav"), "hint"], [key("r.brd"), "request"]]);
  equal(state.blocking, null, "the blocker is released even though the read failed");
});

test("a key the package does not carry is answered null at once: no stall, no read", async () => {
  const origin = manualOrigin([]);
  const assets = createSessionAssets({ cache: new Map(), origin: origin.origin, clock: fakeClock().now });
  equal(await assets.request(key("nothing.brd")), null);
  equal(origin.started.length, 0);
  equal(assets.state().stalls.length, 0);
});

test("with no origin the cache is the whole package: requests answer from it and hints are counted done", async () => {
  const cache = new Map<AssetKey, Uint8Array>([[key("x.brd"), bytes(3)]]);
  const assets = createSessionAssets({ cache, origin: null, clock: fakeClock().now });
  deepEqual(await assets.request(key("x.brd")), bytes(3));
  equal(await assets.request(key("y.brd")), null);
  assets.hint(hints(["now", "x.brd"], ["next", "y.brd"]));
  deepEqual(assets.state().hints, { received: 2, completed: 2, failed: 0, pending: 0 });
});

test("two blockers at once report the one waiting longest, so the spinner's clock started when time first froze", async () => {
  const clock = fakeClock();
  const origin = manualOrigin(["a", "b"]);
  const assets = createSessionAssets({ cache: new Map(), origin: origin.origin, clock: clock.now });
  const first = assets.request(key("a"));
  clock.advance(200);
  const second = assets.request(key("b"));
  deepEqual(assets.state().blocking, { key: key("a"), since: 1_000 });
  origin.settle("a", bytes(1));
  await first;
  deepEqual(assets.state().blocking, { key: key("b"), since: 1_200 });
  origin.settle("b", bytes(2));
  await second;
  equal(assets.state().blocking, null);
});

test("ensure caches what a cue names, skips what the package lacks, and records instead of rejecting when the origin fails", async () => {
  const origin = manualOrigin(["song.mid", "broken.wav"]);
  const assets = createSessionAssets({ cache: new Map(), origin: origin.origin, clock: fakeClock().now });
  const ensuring = assets.ensure([key("song.mid"), key("absent.wav"), key("broken.wav")]);
  origin.settle("song.mid", bytes(5));
  origin.fail("broken.wav", "reset");
  await ensuring;
  deepEqual(assets.peek(key("song.mid")), bytes(5));
  equal(assets.peek(key("absent.wav")), null);
  deepEqual(assets.state().failures.map((failure) => failure.during), ["ensure"]);
  equal(assets.state().stalls.length, 0, "a cue's wait is not the simulation's stall");
});

test("shared records a cue's successful cached or in-flight read, not merely a hint", async () => {
  const origin = manualOrigin(["playing.mid", "cached.mid", "failed.mid"]);
  const cache = new Map<AssetKey, Uint8Array>();
  const assets = createSessionAssets({ cache, origin: origin.origin, clock: fakeClock().now, concurrency: 3 });
  assets.hint(hints(["now", "playing.mid"], ["now", "cached.mid"], ["now", "failed.mid"]));
  const cue = assets.ensure([key("playing.mid")]);
  deepEqual(assets.state().shared, [], "neither a hint nor a pending cue proves a successful read");
  origin.settle("playing.mid", bytes(1, 2, 3));
  await cue;
  deepEqual(assets.peek(key("playing.mid")), bytes(1, 2, 3));
  deepEqual(assets.state().shared, [key("playing.mid")], "the cue resolved from the in-flight hinted read");
  equal(origin.started.filter((name) => name === key("playing.mid")).length, 1);

  origin.settle("cached.mid", bytes(4));
  await flush();
  await assets.ensure([key("cached.mid")]);
  deepEqual(assets.state().shared, [key("playing.mid"), key("cached.mid")], "the cue read the completed hinted cache");
  equal(origin.started.filter((name) => name === key("cached.mid")).length, 1);

  const failed = assets.ensure([key("failed.mid")]);
  origin.fail("failed.mid", "offline");
  await failed;
  deepEqual(assets.state().shared, [key("playing.mid"), key("cached.mid")], "a failed read cannot be shared");
  deepEqual(assets.state().failures.filter((failure) => failure.during === "ensure").map((failure) => failure.key), [key("failed.mid")]);
});

// #1065: `shared` is evidence that a cue's own read resolved from bytes a hint's read supplied. A hint that merely
// names a key, over bytes some other tier supplied, is not that evidence.

test("shared is not earned when a hint names a key whose bytes were already cached (an eager package)", async () => {
  const origin = manualOrigin(["eager.mid"]);
  const cache = new Map<AssetKey, Uint8Array>([[key("eager.mid"), bytes(9)]]);
  const assets = createSessionAssets({ cache, origin: origin.origin, clock: fakeClock().now });
  assets.hint(hints(["now", "eager.mid"]));
  await assets.ensure([key("eager.mid")]);
  deepEqual(assets.state().shared, [], "the hint supplied nothing: the bytes were there first");
  equal(origin.started.length, 0);
});

test("shared is not earned by a read a blocking request began, whether the cue joins it in flight or reads it cached", async () => {
  const origin = manualOrigin(["asked.mid"]);
  const assets = createSessionAssets({ cache: new Map(), origin: origin.origin, clock: fakeClock().now });
  const asked = assets.request(key("asked.mid"));
  assets.hint(hints(["now", "asked.mid"]));
  const joined = assets.ensure([key("asked.mid")]);
  origin.settle("asked.mid", bytes(1));
  await Promise.all([asked, joined]);
  deepEqual(assets.state().shared, [], "the hint arrived after the request began the read, so the read is not the hint's");
  await assets.ensure([key("asked.mid")]);
  deepEqual(assets.state().shared, [], "the request's bytes stay the request's once cached");
  equal(origin.started.length, 1);
});

test("shared is not earned by a cue's own read of a hinted key whose hint was still queued, nor by a second cue joining that read", async () => {
  const origin = manualOrigin(["busy.mid", "queued.mid"]);
  const assets = createSessionAssets({ cache: new Map(), origin: origin.origin, clock: fakeClock().now, concurrency: 1 });
  assets.hint(hints(["now", "busy.mid"], ["now", "queued.mid"]));
  deepEqual(origin.started, [key("busy.mid")], "the one hint slot is busy, so the hint for queued.mid has not started");
  const own = assets.ensure([key("queued.mid")]);
  const second = assets.ensure([key("queued.mid")]);
  origin.settle("queued.mid", bytes(2));
  await Promise.all([own, second]);
  deepEqual(assets.state().shared, [], "the cue began that read itself");
  await assets.ensure([key("queued.mid")]);
  deepEqual(assets.state().shared, [], "and its bytes do not become the hint's");
  equal(origin.started.filter((name) => name === key("queued.mid")).length, 1);
});

test("shared is not earned when the cache's bytes are no longer those the hint's read delivered: replaced, or evicted and fetched again", async () => {
  const origin = manualOrigin(["song.mid"]);
  const cache = new Map<AssetKey, Uint8Array>();
  const assets = createSessionAssets({ cache, origin: origin.origin, clock: fakeClock().now });
  assets.hint(hints(["now", "song.mid"]));
  origin.settle("song.mid", bytes(1, 2));
  await flush();
  deepEqual(assets.peek(key("song.mid")), bytes(1, 2));

  cache.set(key("song.mid"), bytes(1, 2));
  await assets.ensure([key("song.mid")]);
  deepEqual(assets.state().shared, [], "equal bytes that did not come from the hint's read are not its bytes");

  cache.delete(key("song.mid"));
  const reread = assets.ensure([key("song.mid")]);
  origin.settle("song.mid", bytes(3));
  await reread;
  deepEqual(assets.state().shared, [], "an evicted key the cue had to fetch again was not served by the hint");
  equal(origin.started.length, 2);
});

test("shared still records a hint-initiated read that a blocking request or a second cue joined, in flight or cached", async () => {
  const origin = manualOrigin(["early.mid", "later.mid"]);
  const assets = createSessionAssets({ cache: new Map(), origin: origin.origin, clock: fakeClock().now });
  assets.hint(hints(["now", "early.mid"], ["now", "later.mid"]));
  const asked = assets.request(key("early.mid"));
  const cue = assets.ensure([key("later.mid")]);
  const second = assets.ensure([key("later.mid")]);
  origin.settle("early.mid", bytes(1));
  origin.settle("later.mid", bytes(2));
  await Promise.all([asked, cue, second]);
  deepEqual(assets.state().shared, [key("later.mid")], "the cue joined the hint's in-flight read; the request is not a cue");
  await assets.ensure([key("early.mid")]);
  deepEqual(assets.state().shared, [key("later.mid"), key("early.mid")], "a request that joined the hint's read leaves the bytes hint-supplied");
  equal(origin.started.length, 2, "one read per key");
  equal(assets.state().stalls[0]?.hinted, true);
});

test("arriving assets are offered to the decode worker by kind, and only those its scope covers", async () => {
  const offered: [string, PrepareKind][] = [];
  const decode: DecodeAhead = {
    prepare: (asset, _bytes, kind) => { offered.push([asset, kind]); },
    image: () => null,
    audio: () => null,
    settled: async () => undefined,
    stats: () => ({ submitted: 0, completed: 0, failed: 0, gaps: [] }),
    close: () => undefined,
  };
  const origin = manualOrigin(["a.png", "b.wav", "c.mid", "d.sf2", "e.brd"]);
  const assets = createSessionAssets({ cache: new Map(), origin: origin.origin, clock: fakeClock().now, decode });
  assets.hint(hints(["now", "a.png"], ["now", "b.wav"], ["next", "c.mid"], ["next", "d.sf2"], ["always", "e.brd"]));
  for (const name of ["a.png", "b.wav", "c.mid", "d.sf2", "e.brd"]) {
    origin.settle(name, bytes(1));
    await flush();
  }
  deepEqual(offered, [[key("a.png"), "image"], [key("b.wav"), "audio"], [key("c.mid"), "midi"], [key("d.sf2"), "soundfont"]]);
  equal(prepareKindFor(key("constructor")), null);
  equal(prepareKindFor(key("x.constructor")), null);
});

test("the spinner needs a wait of MORE than 300 ms: 250 ms and exactly 300 ms show nothing, 350 ms shows it, and resolving hides it", async () => {
  const clock = fakeClock(10_000);
  const origin = manualOrigin(["slow.brd"]);
  const assets = createSessionAssets({ cache: new Map(), origin: origin.origin, clock: clock.now });
  const element = { hidden: true as boolean | string };
  const overlay = createStallOverlay({ element, state: assets.state, clock: clock.now });
  equal(overlay.update(), false, "nothing is loading");
  const reading = assets.request(key("slow.brd"));
  clock.advance(250);
  equal(overlay.update(), false);
  equal(element.hidden, true);
  clock.advance(50);
  equal(SPINNER_DELAY_MS, 300);
  equal(overlay.update(), false, "exactly 300 ms is not more than 300 ms");
  clock.advance(50);
  equal(overlay.update(), true);
  equal(element.hidden, false);
  origin.settle("slow.brd", bytes(1));
  await reading;
  equal(overlay.update(), false);
  equal(element.hidden, true);
  equal(stallIsVisible(null, 1e9, 300), false);
});
