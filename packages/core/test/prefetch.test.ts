// The prefetch planner and its emission (docs/spec/engine/runners.md#prefetch,
// docs/spec/engine/audio-media.md#audio-prefetch, entry 9.8).
//
// Two things are proved here. First the plan itself: three tiers over facts the engine holds, deterministic order, a
// deduplicated set, and a tier-only view. Second its **hash neutrality both ways** — the same board run against a host
// that observes the hints and one that discards them produces the identical state hash, while the observing host really
// did see a hint (so the comparison is not vacuous).

import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetKey } from "../src/formats/resolver/resolver.ts";
import { PACKAGE_ROOT } from "../src/formats/resolver/model.ts";
import { createAssetIndex } from "../src/formats/resolver/index.ts";
import { createEmptyBoard } from "../src/formats/board/model.ts";
import { writeBoard } from "../src/formats/board/writer.ts";
import { createEngine, type EngineInit } from "../src/engine/engine.ts";
import type { RunnerRequest } from "../src/ports/requests.ts";
import { hashDrawList } from "../src/canon/canon.ts";
import { planPrefetch, prefetchSignature, prefetchTier, type PrefetchFacts } from "../src/prefetch/plan.ts";

function facts(overrides: Partial<PrefetchFacts> = {}): PrefetchFacts {
  return {
    boardMusic: null,
    boardMusicIsMidi: false,
    linkedBoardMusic: [],
    battle: null,
    main: { cursorMoveSound: null, cursorSelectSound: null, cursorCancelSound: null },
    defaultBank: null,
    ...overrides,
  };
}

test("the tiers hold what the runner page says, and only that", () => {
  const plan = planPrefetch(facts({
    boardMusic: assetKey("Media/town.mid"),
    boardMusicIsMidi: true,
    linkedBoardMusic: [assetKey("Media/cave.mid"), null],
    battle: { music: "fight.mid", menuMoveSound: "tick.wav", menuChooseSound: "choose.wav", readySound: "ready.wav", cantDoSound: "nope.wav" },
    main: { cursorMoveSound: assetKey("Media/move.wav"), cursorSelectSound: assetKey("Media/select.wav"), cursorCancelSound: assetKey("Media/cancel.wav") },
    defaultBank: assetKey("Media/tk16.sf2"),
  }));
  deepEqual(prefetchTier(plan, "now"), ["media/tk16.sf2", "media/town.mid"], "the board's music, and the bank because it is a MIDI");
  deepEqual(prefetchTier(plan, "next"), ["choose.wav", "fight.mid", "media/cave.mid", "nope.wav", "ready.wav", "tick.wav"], "the battle background's five fields and the linked board's music, in key order");
  deepEqual(prefetchTier(plan, "always"), ["media/cancel.wav", "media/move.wav", "media/select.wav"], "the menu sounds; the bank is already a now key");
  equal(plan.length, 11);
});

test("a WAV board music does not pull the bank into the now tier", () => {
  const plan = planPrefetch(facts({ boardMusic: assetKey("Media/theme.wav"), boardMusicIsMidi: false, defaultBank: assetKey("Media/tk16.sf2") }));
  deepEqual(prefetchTier(plan, "now"), ["media/theme.wav"]);
  deepEqual(prefetchTier(plan, "always"), ["media/tk16.sf2"], "the bank is still always");
});

test("the plan is deduplicated within a tier and ordered by tier then key", () => {
  const plan = planPrefetch(facts({
    boardMusic: assetKey("Media/town.mid"),
    linkedBoardMusic: [assetKey("Media/town.mid"), assetKey("Media/town.mid")],
    main: { cursorMoveSound: assetKey("Media/move.wav"), cursorSelectSound: assetKey("Media/move.wav"), cursorCancelSound: null },
  }));
  deepEqual(plan, [
    { tier: "now", key: "media/town.mid" },
    { tier: "always", key: "media/move.wav" },
  ]);
  // The same facts always yield the same signature, which is what keeps a repeated board entry silent.
  equal(prefetchSignature(plan), prefetchSignature(planPrefetch(facts({
    boardMusic: assetKey("Media/town.mid"),
    linkedBoardMusic: [assetKey("Media/town.mid"), assetKey("Media/town.mid")],
    main: { cursorMoveSound: assetKey("Media/move.wav"), cursorSelectSound: assetKey("Media/move.wav"), cursorCancelSound: null },
  }))));
});

test("no facts means no plan, so a host is never told to fetch nothing", () => {
  deepEqual(planPrefetch(facts()), []);
  equal(prefetchSignature(planPrefetch(facts())), "");
});

// ---------------------------------------------------------------- emission and hash neutrality

function boardBytes(music: string): Uint8Array {
  const empty = createEmptyBoard();
  const written = writeBoard({ ...empty, properties: { ...empty.properties, backgroundMusic: music } });
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

type Run = { readonly stateHash: string; readonly drawHash: string; readonly hints: readonly string[] };

/** Boot `b.brd` (music `town.mid`) and run `ticks`, observing every request; `observe` decides what is recorded. */
function bootAndRun(observe: boolean): Run {
  const paths = new Map<string, Uint8Array>([
    ["Boards/a.brd", boardBytes("")],
    ["Boards/b.brd", boardBytes("town.mid")],
    ["Media/town.mid", new Uint8Array([0x4d, 0x54, 0x68, 0x64])],
    ["Media/move.wav", new Uint8Array([0x52, 0x49, 0x46, 0x46])],
    ["Media/select.wav", new Uint8Array([0x52, 0x49, 0x46, 0x46])],
  ]);
  const files = new Map<string, Uint8Array>();
  for (const [path, bytes] of paths) files.set(assetKey(path), bytes);
  const init: EngineInit = {
    seed: 5,
    assetIndex: createAssetIndex([...paths.keys()]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "b.brd",
    width: 32,
    height: 32,
    maxTicks: 60,
    program: "end()\n",
  };
  const engine = createEngine(init);
  const hints: string[] = [];
  /** Record the hints one report carried, when this run observes them. */
  const note = (report: { readonly requests: readonly RunnerRequest[] }): void => {
    if (!observe) return;
    for (const request of report.requests) {
      if (request.kind !== "prefetch") continue;
      for (const hint of request.hints) hints.push(`${hint.tier}:${hint.key}`);
    }
  };
  let report = engine.advance(6, []);
  note(report);
  for (let guard = 0; guard < 40 && report.loading; guard += 1) {
    const replies = report.requests.flatMap((request: RunnerRequest) =>
      request.kind === "asset" ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }] : [],
    );
    report = engine.advance(6, replies);
    note(report);
  }
  // The draw hash is the list's, so a hint that leaked into a command would move it (AD-3).
  const drawHash = hashDrawList(engine.drawList(0, { shading: true, images: true, sprites: true }));
  return { stateHash: report.stateHash, drawHash, hints };
}

test("the engine emits the ruled hints for a board that names music, and a host that ignores them hashes the same", () => {
  const observed = bootAndRun(true);
  const discarded = bootAndRun(false);
  ok(observed.hints.length > 0, `a hint was emitted: ${observed.hints.join(",")}`);
  ok(observed.hints.includes("now:media/town.mid"), `the board's music is a now hint: ${observed.hints.join(",")}`);
  equal(observed.stateHash, discarded.stateHash, "a hint never changes the state hash");
  equal(observed.drawHash, discarded.drawHash, "a hint never changes the draw hash");
});

test("undecodable battle background is requested once and loading clears", () => {
  const board = createEmptyBoard();
  const written = writeBoard({ ...board, properties: { ...board.properties, battleBackground: "fight.raw" } });
  if (!written.ok) throw new Error(written.error.message);
  const boardData = written.value;
  const backgroundKey = assetKey("Bkrounds/fight.raw");
  function run(background: Uint8Array | null) {
    const engine = createEngine({
      seed: 5,
      assetIndex: createAssetIndex(["Boards/b.brd", "Bkrounds/fight.raw"]),
      assetRoot: PACKAGE_ROOT,
      initialBoard: "b.brd",
      width: 32,
      height: 32,
      maxTicks: 60,
      program: "end()\n",
    });
    let report = engine.advance(1, []);
    const counts: number[] = [];
    const hashes: string[] = [];
    const diagnostics: string[] = [];
    const loadingAfterBackgroundReply: boolean[] = [];
    for (let step = 0; step < 8; step += 1) {
      counts.push(report.requests.filter((request) => request.kind === "asset" && request.key === backgroundKey).length);
      hashes.push(report.stateHash);
      diagnostics.push(...report.diagnostics.filter((item) => item.file === backgroundKey).map((item) => item.code));
      const replies = report.requests.flatMap((request) =>
        request.kind === "asset"
          ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId,
            bytes: request.key === backgroundKey ? background : request.key === assetKey("Boards/b.brd") ? boardData : null } }]
          : [],
      );
      report = engine.advance(1, replies);
      if (counts[counts.length - 1] === 1) loadingAfterBackgroundReply.push(report.loading);
    }
    return { counts, hashes, diagnostics, loadingAfterBackgroundReply, loading: report.loading, tick: report.tickAfter };
  }
  const invalid = run(new Uint8Array([0x0a, 0x00]));
  equal(invalid.counts.reduce((sum, count) => sum + count, 0), 1, `background requests per advance: ${invalid.counts.join(",")}`);
  deepEqual(invalid.loadingAfterBackgroundReply, [false], "loading clears on the advance consuming the undecodable reply");
  equal(invalid.loading, false, "loading clears after undecodable reply");
  ok(invalid.tick > 0, "simulation progresses after undecodable reply");
  deepEqual(invalid.diagnostics, ["asset.invalid"]);
  deepEqual(invalid, run(new Uint8Array([0x0a, 0x00])), "identical inputs give identical reports");
  const missing = run(null);
  deepEqual(invalid.hashes, missing.hashes, "decode failure and missing reply have identical per-tick state hashes");
  const valid = run(new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../docs/spec/examples/versions/fight-background/background_minor3.bkg"))));
  deepEqual(invalid.hashes, valid.hashes, "negative and positive prefetch caches are absent from per-tick state hashes");
});

test("the plan emits battle background and main menu hints in the ruled tiers", () => {
  const plan = planPrefetch(facts({
    boardMusic: assetKey("Media/town.mid"),
    boardMusicIsMidi: true,
    battle: {
      music: "fight.mid",
      menuMoveSound: "tick.wav",
      menuChooseSound: "choose.wav",
      readySound: "ready.wav",
      cantDoSound: "nope.wav",
    },
    main: {
      cursorMoveSound: assetKey("Media/move.wav"),
      cursorSelectSound: assetKey("Media/select.wav"),
      cursorCancelSound: assetKey("Media/cancel.wav"),
    },
  }));
  const hints = plan.map((hint) => `${hint.tier}:${hint.key}`);
  ok(hints.includes("next:fight.mid"), `battle music is a next hint: ${hints.join(",")}`);
  ok(hints.includes("next:choose.wav"), `battle menu choose is a next hint: ${hints.join(",")}`);
  ok(hints.includes("next:tick.wav"), `battle menu move is a next hint: ${hints.join(",")}`);
  ok(hints.includes("next:ready.wav"), `battle ready is a next hint: ${hints.join(",")}`);
  ok(hints.includes("next:nope.wav"), `battle can't-do is a next hint: ${hints.join(",")}`);
  ok(hints.includes("always:media/move.wav"), `main menu move is an always hint: ${hints.join(",")}`);
  ok(hints.includes("always:media/select.wav"), `main menu select is an always hint: ${hints.join(",")}`);
  ok(hints.includes("always:media/cancel.wav"), `main menu cancel is an always hint: ${hints.join(",")}`);
});

test("the plan signature is stable and the same facts produce the same signature", () => {
  const a = planPrefetch(facts({
    battle: { music: "fight.mid", menuMoveSound: "a.wav", menuChooseSound: "b.wav", readySound: "c.wav", cantDoSound: "d.wav" },
    main: { cursorMoveSound: assetKey("Media/move.wav"), cursorSelectSound: null, cursorCancelSound: null },
  }));
  const b = planPrefetch(facts({
    battle: { music: "fight.mid", menuMoveSound: "a.wav", menuChooseSound: "b.wav", readySound: "c.wav", cantDoSound: "d.wav" },
    main: { cursorMoveSound: assetKey("Media/move.wav"), cursorSelectSound: null, cursorCancelSound: null },
  }));
  equal(prefetchSignature(a), prefetchSignature(b));
});
