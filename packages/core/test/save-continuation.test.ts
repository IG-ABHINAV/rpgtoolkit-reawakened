// A game save must never capture a thread parked on a host request that has no
// answer yet (AD-17, docs/spec/formats/save-game.md#reawakened-full-engine-save-and-load):
// the restore would drop the request and that thread could never resume.
// `finalizeBlobRequests` therefore waits for every other in-flight blob request
// before it serializes a game save.
//
// Two things make the invariant hold: the VM gives every host request a global
// wait, so a parked request freezes the tick and no second thread reaches `Save`
// in the same phase (this test drives both cases and asserts the ordering), and
// the finalizer refuses to snapshot while another blob entry is pending, which
// keeps the invariant structural if the wake rules ever change.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { TextDecoder, TextEncoder } from "node:util";
import {
  assetKey,
  IR_VERSION,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
  restoreGameState,
  snapshot,
  startThread,
  writeBoard,
  writeMainFile,
  type AssetKey,
  type InputRecord,
  type GameState,
} from "../src/index.ts";
import { noActiveAudioContinuationProjection } from "./hash-projections.ts";
import { hashState } from "../src/canon/canon.ts";

const encoder = new TextEncoder();

type Files = Map<AssetKey, Uint8Array>;

/** A boot-mode game with an authored board and a start-up program that just ends. */
function runningGame(): { files: Files; mainBytes: Uint8Array; paths: string[] } {
  const main = { ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd" };
  const written = writeMainFile(main);
  if (!written.ok) throw new Error(written.error.message);
  const empty = createEmptyBoard();
  const board = writeBoard({ ...empty, properties: { ...empty.properties, start: { x: 32, y: 32, layer: 1 } } });
  if (!board.ok) throw new Error(board.error.message);
  const paths = ["main.gam", "boards/start.brd", "boards/after.brd", "prg/start.prg"];
  const files: Files = new Map([
    [assetKey("main.gam"), written.value],
    [assetKey("boards/start.brd"), board.value],
    [assetKey("boards/after.brd"), board.value],
    [assetKey("prg/start.prg"), encoder.encode("end()\n")],
  ]);
  return { files, mainBytes: written.value, paths };
}

type SavedThread = { readonly id: number; readonly status: string; readonly wait: { readonly kind: string; readonly reqId: number; readonly reply: { readonly ok: boolean } | null } | null };
type SavedState = { readonly vm: { readonly threads: readonly SavedThread[] }; readonly engine: { readonly nextRequestId: number; readonly pending: readonly unknown[] }; readonly audio: { readonly cueId: number; readonly tracks: readonly { readonly voices: readonly unknown[] }[] } };


test("a game save never captures a thread parked on an unanswered host request", () => {
  const game = runningGame();
  let started = false;
  let uninterruptedState: GameState | null = null;
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(game.paths),
    assetRoot: { kind: "package" },
    mainFile: "main.gam",
    gameIdentity: "in-flight-test",
    width: 64,
    height: 64,
    maxTicks: 200,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    // Once the game is running, start two ordinary (non-blocking) threads on the
    // same tick: one parks on a file write, the other calls Save.
    phaseRegistrations: [{
      phase: "events",
      run: (state) => {
        uninterruptedState = state;
        if (!started) {
          if (state.engine.boot?.stage !== "running") return;
          started = true;
          startThread(state.vm, {
            ref: { kind: "inline", text: 'h = openfileoutput("log.txt", "files")\nend()\n', ir: IR_VERSION },
            kind: "board",
            owner: "script",
          });
          startThread(state.vm, {
            ref: { kind: "inline", text: 'Save("slot")\nafter = 42\nend()\n', ir: IR_VERSION },
            kind: "board",
            owner: "script",
          });
        } else if (state.vm.globals.after === 42 && !state.vm.threads.some((thread) => thread.owner === "world")) {
          startThread(state.vm, { ref: { kind: "inline", text: 'send("after.brd", 1, 1, 1)\nend()\n', ir: IR_VERSION }, kind: "board", owner: "world" });
        }
      },
    }],
  });

  let replies: InputRecord[] = [];
  let savedBytes: Uint8Array | null = null;
  let sawFileWrite = false;
  let writeTick = -1;
  let saveTick = -1;
  let gameSaveRequestId = -1;
  for (let guard = 0; guard < 40 && savedBytes === null; guard += 1) {
    const report = engine.advance(1, replies);
    replies = [];
    for (const request of report.requests) {
      if (request.kind === "asset") {
        replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
      } else if (request.kind === "saveBlob" && request.blob.path.endsWith(".sav")) {
        savedBytes = new Uint8Array(request.bytes);
        gameSaveRequestId = request.reqId;
        saveTick = report.tickAfter;
      } else if (request.kind === "saveBlob") {
        sawFileWrite = true;
        writeTick = report.tickAfter;
        // Answer the file write only on the next advance, so the game save has a
        // real chance to be finalized while that request is still in flight.
      }
    }
    if (savedBytes !== null) break;
    if (report.loading && replies.length === 0) {
      const pendingFile = report.requests.find((request) => request.kind === "saveBlob" && !request.blob.path.endsWith(".sav"));
      if (pendingFile !== undefined) {
        replies.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: pendingFile.reqId, ok: true } });
      }
    }
  }

  ok(sawFileWrite, "the worker thread really issued a file write request");
  ok(writeTick < saveTick, "the save is finalized only after the file write was answered");
  ok(savedBytes !== null, "the game save reached the host");
  const saved = JSON.parse(new TextDecoder().decode(savedBytes as Uint8Array)) as SavedState;
  const unanswered = saved.vm.threads.filter((thread) => thread.wait?.kind === "blob" && thread.wait.reply === null);
  equal(unanswered.length, 0, `a saved thread must never wait on a request the host never answered: ${JSON.stringify(unanswered.map((thread) => thread.id))}`);
  const answered = saved.vm.threads.filter((thread) => thread.wait?.kind === "blob" && thread.wait.reply !== null);
  equal(answered.length, 1, "the saving thread is the only parked blob thread, and its reply is recorded");
  equal(saved.engine.pending.length, 0, "settled save has no outstanding request IDs");
  ok(saved.engine.nextRequestId > 1, "settled save preserves the next request ID after issuing the file write and save");
  // Verify correlation independently of full continuation hash equality (#1054).
  replies = [{ tick: saveTick, event: { kind: "blob.saved", reqId: gameSaveRequestId, ok: true } }];
  let uninterruptedRequestId: number | null = null;
  let uninterruptedCheckpoint: GameState | null = null;
  let uninterruptedHash: string | null = null;
  for (let guard = 0; guard < 40 && uninterruptedRequestId === null; guard += 1) {
    const report = engine.advance(1, replies);
    equal(report.audioCues.length, 0, "uninterrupted continuation emits no audio cues");
    replies = [];
    for (const request of report.requests) {
      if (request.kind !== "asset") continue;
      if (request.key === assetKey("boards/after.brd")) {
        uninterruptedRequestId = request.reqId;
        ok(uninterruptedState !== null);
        uninterruptedCheckpoint = restoreGameState(snapshot(uninterruptedState));
        uninterruptedHash = report.stateHash;
      }
      replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
    }
  }
  equal(uninterruptedRequestId, saved.engine.nextRequestId, "the uninterrupted continuation uses the saved next request ID");

  let startedLoad = false;
  const loadedState: { current: GameState | null } = { current: null };
  let loadCounter = -1;
  let restoredCheckpoint: GameState | null = null;
  let restoredHash: string | null = null;
  const loadCues: { readonly kind: string; readonly cueId: number }[] = [];
  const loadedEngine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(game.paths),
    assetRoot: { kind: "package" },
    mainFile: "main.gam",
    gameIdentity: "in-flight-test",
    width: 64,
    height: 64,
    maxTicks: 200,
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    phaseRegistrations: [{
      phase: "events",
      run: (state) => {
        loadedState.current = state;
        if (!startedLoad && state.engine.boot?.stage === "running") {
          startedLoad = true;
          startThread(state.vm, { ref: { kind: "inline", text: 'Load("slot")\nend()\n', ir: IR_VERSION }, kind: "board", owner: "script" });
        } else if (state.vm.globals.after === 42 && !state.vm.threads.some((thread) => thread.owner === "world")) {
          startThread(state.vm, { ref: { kind: "inline", text: 'send("after.brd", 1, 1, 1)\nend()\n', ir: IR_VERSION }, kind: "board", owner: "world" });
        }
      },
    }],
  });
  replies = [];
  let loaded = false;
  let restoredRequestId: number | null = null;
  let boardReplyAccepted = false;
  for (let guard = 0; guard < 40 && !boardReplyAccepted; guard += 1) {
    const report = loadedEngine.advance(1, replies);
    if (loaded) loadCues.push(...report.audioCues);
    if (restoredRequestId !== null && !report.loading) boardReplyAccepted = true;
    replies = [];
    for (const request of report.requests) {
      if (request.kind === "asset") {
        if (request.key === assetKey("boards/after.brd")) {
          restoredRequestId = request.reqId;
          ok(loadedState.current !== null);
          restoredCheckpoint = restoreGameState(snapshot(loadedState.current));
          restoredHash = report.stateHash;
        }
        replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
      } else if (request.kind === "loadBlob") {
        loaded = true;
        ok(loadedState.current !== null);
        loadCounter = loadedState.current.audio.cueId;
        replies.push({ tick: report.tickAfter, event: { kind: "blob.loaded", reqId: request.reqId, bytes: savedBytes } });
      }
    }
  }
  ok(loaded, "the engine loads the deferred save through Load");
  equal(restoredRequestId, saved.engine.nextRequestId, "the restored continuation uses the saved next request ID");
  ok(boardReplyAccepted, "the reply carrying that ID releases the restored board request");
  ok(uninterruptedCheckpoint !== null && restoredCheckpoint !== null);
  ok(saved.audio.tracks.every((track) => track.voices.length === 0));
  ok(uninterruptedCheckpoint.audio.tracks.every((track) => track.voices.length === 0));
  ok(restoredCheckpoint.audio.tracks.every((track) => track.voices.length === 0));
  ok(loadCounter <= saved.audio.cueId);
  equal(uninterruptedCheckpoint.audio.cueId, saved.audio.cueId);
  equal(restoredCheckpoint.audio.cueId, saved.audio.cueId + 1);
  deepEqual(loadCues.map(({ kind, cueId }) => ({ kind, cueId })), [{ kind: "soundfont.set", cueId: saved.audio.cueId }]);
  ok(uninterruptedHash !== restoredHash, "the real replay hashes remain distinct");
  deepEqual(noActiveAudioContinuationProjection(restoredCheckpoint), noActiveAudioContinuationProjection(uninterruptedCheckpoint));
  const perturbed = restoreGameState(snapshot(restoredCheckpoint));
  perturbed.vm.globals.after = 43;
  ok(hashState(noActiveAudioContinuationProjection(perturbed)) !== hashState(noActiveAudioContinuationProjection(uninterruptedCheckpoint)), "a changed game variable is not normalized");
});
