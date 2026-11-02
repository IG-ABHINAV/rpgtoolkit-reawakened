/**
 * The live session's asset tiers (docs/spec/engine/runners.md#prefetch, #load-modes): a synchronous in-memory cache the
 * renderer and the audio path read, in front of an asynchronous origin (the package source: memory, durable copy, then
 * network by validated range).
 *
 * Three callers fill the cache, and only one of them may stop the simulation:
 *
 * - `request` answers the engine's blocking `asset` request. A request the cache cannot answer *is* a stall: time is
 *   frozen while it waits, so it is recorded (key, whether a hint had named it, how long) and is observable through
 *   `state()` while it lasts.
 * - `hint` takes the core's prefetch plan. It schedules prioritised background reads (`now`, then `next`, then `always`)
 *   and never blocks, never throws and never changes anything a hash reads.
 * - `ensure` makes sure a set of keys is cached for the audio cue chain, which is its own ordered chain and not the
 *   simulation's.
 *
 * An unreachable origin is a thrown error from `request` (the page shows it as a load error); it is never turned into an
 * "asset missing" reply, because that would tell the engine a file does not exist when it only could not be reached.
 */

import { assetKey, type AssetKey, type PrefetchHint, type PrefetchTier } from "@tk-reawakened/core";
import type { DecodeAhead, PrepareKind } from "./decode-types.ts";
import type { PackageSource } from "./package-source.ts";

/** Where assets come from when the cache does not hold them. `read` returns a copy the caller owns, or throws. */
export interface AssetOrigin {
  has(key: AssetKey): boolean;
  read(key: AssetKey): Promise<Uint8Array>;
}

/** One time the engine waited for an asset the cache could not answer. */
export type AssetStall = {
  readonly key: AssetKey;
  /** Whether a prefetch hint had named this key before the engine asked (a hinted stall means the hint was late). */
  readonly hinted: boolean;
  /** `clock()` when the wait began. */
  readonly startedAt: number;
  readonly durationMs: number;
};

export type AssetFailure = { readonly key: AssetKey; readonly during: "request" | "hint" | "ensure"; readonly message: string };

export type AssetLoadState = {
  /** The asset the engine is waiting on right now, or `null`. */
  readonly blocking: { readonly key: AssetKey; readonly since: number } | null;
  /** Every completed stall, in order. */
  readonly stalls: readonly AssetStall[];
  readonly hints: {
    readonly received: number;
    readonly completed: number;
    readonly failed: number;
    readonly pending: number;
  };
  readonly failures: readonly AssetFailure[];
  /**
   * Keys whose cue read was served by a read a hint began: the cue found those very bytes cached or joined that read in
   * flight (docs/spec/engine/runners.md#prefetch). A hint over bytes already cached, or over a read a request or a cue had
   * started, earns nothing. Diagnostic evidence, not a performance metric.
   */
  readonly shared: readonly AssetKey[];
};

export type SessionAssetsOptions = {
  /** The synchronous cache. It may arrive pre-filled (an eager package); anything the origin supplies is added to it. */
  readonly cache: Map<AssetKey, Uint8Array>;
  /** `null` when the cache already holds the whole package. */
  readonly origin: AssetOrigin | null;
  readonly clock: () => number;
  readonly decode?: DecodeAhead | null;
  /** How many hint reads may run at once. Blocking requests never wait for these slots. Defaults to 2. */
  readonly concurrency?: number;
  /** Called after every change `state()` would show, for a page that renders it. */
  readonly onChange?: () => void;
};

export interface SessionAssets {
  /** The cached bytes for `key`, or `null`. Synchronous: this is what the renderer and the audio path read. */
  peek(key: AssetKey): Uint8Array | null;
  /** The engine's blocking request. `null` only when the package does not carry the key. Rejects when the origin fails. */
  request(key: AssetKey): Promise<Uint8Array | null>;
  /** Schedule the plan's reads in the background. Returns at once. */
  hint(hints: readonly PrefetchHint[]): void;
  /** Cache `keys` (those the origin has), for the cue chain. Resolves when each is cached or has failed; never rejects. */
  ensure(keys: readonly AssetKey[]): Promise<void>;
  state(): AssetLoadState;
  /** Stop scheduling and drop late results. */
  close(): void;
}

const TIER_RANK: Readonly<Record<PrefetchTier, number>> = { now: 0, next: 1, always: 2 };

const KIND_BY_EXTENSION: Readonly<Record<string, PrepareKind>> = {
  tst: "image",
  iso: "image",
  bmp: "image",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  ico: "image",
  wav: "audio",
  mid: "midi",
  midi: "midi",
  kar: "midi",
  rmi: "midi",
  sf2: "soundfont",
  sf3: "soundfont",
};

/** What a decode-ahead job for `key` would prepare, or `null` when nothing in the worker's scope applies to it. */
export function prepareKindFor(key: AssetKey): PrepareKind | null {
  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return key.includes(".") && Object.hasOwn(KIND_BY_EXTENSION, extension) ? (KIND_BY_EXTENSION[extension] ?? null) : null;
}

type Job = { readonly key: AssetKey; readonly rank: number; readonly order: number };
/** Who asks `load` for a key: a prefetch hint, the engine's blocking request, or the audio cue chain. */
type Reader = "hint" | "request" | "cue";

function describe(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

/** The longest-waiting blocker, so the spinner's clock starts when time first froze, not when the last request joined. */
function earliestBlocker(blockers: ReadonlyMap<AssetKey, { readonly since: number }>): AssetLoadState["blocking"] {
  let earliest: { readonly key: AssetKey; readonly since: number } | null = null;
  for (const [key, entry] of blockers) if (earliest === null || entry.since < earliest.since) earliest = { key, since: entry.since };
  return earliest;
}

export function createSessionAssets(options: SessionAssetsOptions): SessionAssets {
  const { cache, origin, clock } = options;
  const limit = Math.max(1, options.concurrency ?? 2);
  const inFlight = new Map<AssetKey, Promise<Uint8Array | null>>();
  const hinted = new Set<AssetKey>();
  /** The bytes each hint-began read delivered, by identity, so a replaced or refetched entry is no longer the hint's. */
  const hintSupplied = new WeakMap<Uint8Array, AssetKey>();
  const shared = new Set<AssetKey>();
  const queue: Job[] = [];
  const stalls: AssetStall[] = [];
  const failures: AssetFailure[] = [];
  const counts = { received: 0, completed: 0, failed: 0 };
  const blockers = new Map<AssetKey, { readonly since: number; count: number }>();
  let running = 0;
  let nextOrder = 0;
  let closed = false;
  const changed = (): void => options.onChange?.();

  /** Read `key` through the origin once, however many callers want it, and cache what arrives. */
  function load(key: AssetKey, reader: Reader): Promise<Uint8Array | null> {
    const cached = cache.get(key);
    if (cached !== undefined) {
      if (reader === "cue" && hintSupplied.get(cached) === key) shared.add(key);
      return Promise.resolve(cached);
    }
    const pending = inFlight.get(key);
    if (pending !== undefined) {
      if (reader !== "cue") return pending;
      return pending.then((bytes) => {
        if (bytes !== null && !closed && hintSupplied.get(bytes) === key && cache.get(key) === bytes) shared.add(key);
        return bytes;
      });
    }
    if (origin === null || !origin.has(key)) return Promise.resolve(null);
    const reading = origin.read(key).then((bytes) => {
      inFlight.delete(key);
      if (!closed) {
        cache.set(key, bytes);
        if (reader === "hint") hintSupplied.set(bytes, key);
        const kind = prepareKindFor(key);
        if (kind !== null) options.decode?.prepare(key, bytes, kind);
      }
      return bytes;
    }, (cause: unknown) => {
      inFlight.delete(key);
      throw cause;
    });
    inFlight.set(key, reading);
    return reading;
  }

  function pump(): void {
    while (!closed && running < limit && queue.length > 0) {
      const job = queue.shift() as Job;
      running += 1;
      load(job.key, "hint").then(
        () => {
          counts.completed += 1;
        },
        (cause: unknown) => {
          counts.failed += 1;
          failures.push({ key: job.key, during: "hint", message: describe(cause) });
        },
      ).finally(() => {
        running -= 1;
        changed();
        pump();
      });
    }
  }

  return {
    peek: (key) => cache.get(key) ?? null,
    async request(key) {
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      if (origin === null || !origin.has(key)) return null;
      const wasHinted = hinted.has(key);
      const held = blockers.get(key);
      const startedAt = held?.since ?? clock();
      if (held === undefined) blockers.set(key, { since: startedAt, count: 1 });
      else held.count += 1;
      changed();
      try {
        return await load(key, "request");
      } catch (cause) {
        failures.push({ key, during: "request", message: describe(cause) });
        throw cause;
      } finally {
        const entry = blockers.get(key);
        if (entry !== undefined && (entry.count -= 1) <= 0) blockers.delete(key);
        stalls.push({ key, hinted: wasHinted, startedAt, durationMs: Math.max(0, clock() - startedAt) });
        changed();
      }
    },
    hint(hints) {
      if (closed) return;
      counts.received += hints.length;
      for (const hint of hints) {
        hinted.add(hint.key);
        if (cache.has(hint.key) || inFlight.has(hint.key) || queue.some((job) => job.key === hint.key)) {
          counts.completed += cache.has(hint.key) ? 1 : 0;
          continue;
        }
        if (origin === null || !origin.has(hint.key)) {
          counts.completed += 1;
          continue;
        }
        queue.push({ key: hint.key, rank: TIER_RANK[hint.tier], order: nextOrder });
        nextOrder += 1;
      }
      queue.sort((left, right) => left.rank - right.rank || left.order - right.order);
      changed();
      pump();
    },
    async ensure(keys) {
      await Promise.all(keys.map(async (key) => {
        try {
          await load(key, "cue");
        } catch (cause) {
          failures.push({ key, during: "ensure", message: describe(cause) });
        }
      }));
    },
    state: () => ({
      blocking: earliestBlocker(blockers),
      stalls: [...stalls],
      hints: { ...counts, pending: queue.length + running },
      failures: [...failures],
      shared: [...shared],
    }),
    close() {
      closed = true;
      queue.length = 0;
    },
  };
}

/** Whether a stall that began at `since` has lasted **more than** `thresholdMs` at `now` (the spinner's rule). */
export function stallIsVisible(blocking: AssetLoadState["blocking"], now: number, thresholdMs: number): boolean {
  return blocking !== null && now - blocking.since > thresholdMs;
}

/**
 * A package source as the session's origin: the engine's canonical keys mapped to the entries that carry them. A read
 * is the source's verified, tiered read (memory, then the durable copy, then a validated range of the network).
 */
export function packageOrigin(source: PackageSource): AssetOrigin {
  const pathByKey = new Map<AssetKey, string>();
  for (const entry of source.entries) pathByKey.set(assetKey(entry.path), entry.path);
  return {
    has: (key) => pathByKey.has(key),
    read(key) {
      const path = pathByKey.get(key);
      return path === undefined ? Promise.reject(new Error(`runner-web: ${key} is not in the package`)) : source.read(path);
    },
  };
}
