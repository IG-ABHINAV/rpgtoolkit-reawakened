import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type {
  Breakpoint,
  DrawList,
  Engine,
  InputRecord,
  TickReport,
  SurfaceId,
  SurfacePixels,
} from "@tk-reawakened/core";
import { createNullAudio } from "../src/audio.ts";
import { createTestEngine } from "../src/double/test-engine.ts";
import { runLog } from "../src/driver.ts";
import type { Run } from "../src/golden.ts";

const GAMEPAD = { kind: "gamepad", device: 0, connected: false, axes: { x: 0, y: 0 }, buttons: 0 } as const;
test("runLog partitions ticks into windows and passes maxTicks = n", () => {
  const calls: { ticks: number; inputs: readonly InputRecord[]; maxTicks?: number | undefined }[] = [];

  const spyEngine: Engine = {
    advance(ticks: number, inputs: readonly InputRecord[], maxTicks?: number): TickReport {
      const before = calls.reduce((acc, c) => acc + c.ticks, 0);
      calls.push({ ticks, inputs, maxTicks });
      return {
        ticksRun: ticks,
        tickAfter: before + ticks,
        consumed: inputs,
        audioCues: [],
        requests: [],
        diagnostics: [],
        loading: false,
        paused: null,
        stateHash: "0123456789abcdef",
      };
    },
    drawList(_alpha?: number): DrawList {
      return { tick: 0, width: 320, height: 240, commands: [], marginCommands: [] };
    },
    surfacePixels(_id: SurfaceId, _rev: number): SurfacePixels | null {
      return null;
    },
    picturePixels(): SurfacePixels | null { return null; },
    recoveryCandidate() { return null; },
    resumeRecovery() { return false; },
    recoveryStatus() { return "none"; },
    setBreakpoints(_breakpoints: readonly Breakpoint[]): void {},
    registeredActionNames() { return []; },
    registerGameAction() { return true; },
    setPointerMovementSuppressed() {},
    reportUnknownAction() {},
    customTouchControlsDeclared() { return false; },
    hostFeatures() { return { touch: false, pointer: "none", keyboard: false, gamepad: false, haptics: false, orientation: null }; },
    hostDisplayGeometry() { return { content: { width: 320, height: 240 }, game: { x: 0, y: 0, width: 320, height: 240 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }; },
    surfaceCacheEpoch() { return 0; },
    accessibilityTree() { return []; },
    runnerControlPointerPreemption() { return null; },
  };

  const run: Run = {
    schema: 1,
    ticks: 7,
    log: [
      { tick: 0, event: GAMEPAD },
      { tick: 3, event: GAMEPAD },
      { tick: 6, event: GAMEPAD },
    ],
  };

  const audio = createNullAudio();
  const records = runLog(spyEngine, run, 3, audio);

  equal(records.length, 3);
  equal(calls.length, 3);

  // Call 1: ticks = 3, maxTicks = 3, window [0, 3)
  equal(calls[0]!.ticks, 3);
  equal(calls[0]!.maxTicks, 3);
  deepEqual(calls[0]!.inputs, [run.log[0]]);

  // Call 2: ticks = 3, maxTicks = 3, window [3, 6)
  equal(calls[1]!.ticks, 3);
  equal(calls[1]!.maxTicks, 3);
  deepEqual(calls[1]!.inputs, [run.log[1]]);

  // Call 3: ticks = 1, maxTicks = 3, window [6, 7)
  equal(calls[2]!.ticks, 1);
  equal(calls[2]!.maxTicks, 3);
  deepEqual(calls[2]!.inputs, [run.log[2]]);
});

test("runLog translates historical v1 gamepad buttons before active dispatch", () => {
  const base = createTestEngine();
  let received: readonly InputRecord[] = [];
  const engine: Engine = {
    ...base,
    advance(ticks, inputs, maxTicks) {
      received = inputs;
      return base.advance(ticks, inputs, maxTicks);
    },
  };
  const run: Run = {
    schema: 1,
    ticks: 1,
    log: [{ tick: 0, event: { ...GAMEPAD, buttons: 8 } }],
  };
  runLog(engine, run, 1, createNullAudio());
  const event = received[0]!.event;
  equal(event.kind, "gamepad");
  if (event.kind === "gamepad") equal(event.buttons, 1 << 15);
});

test("runLog returns records on empty log", () => {
  const engine = createTestEngine();
  const run: Run = {
    schema: 1,
    ticks: 24,
    log: [],
  };
  const audio = createNullAudio();
  const records = runLog(engine, run, 1, audio);
  equal(records.length, 24);
  equal(records[0]!.tick, 1);
  equal(records[23]!.tick, 24);
});

test("runLog throws on invalid n", () => {
  const engine = createTestEngine();
  const run: Run = { schema: 1, ticks: 5, log: [] };
  const audio = createNullAudio();
  throws(() => runLog(engine, run, 0, audio), RangeError);
  throws(() => runLog(engine, run, -1, audio), RangeError);
  throws(() => runLog(engine, run, 1.5, audio), RangeError);
});

test("runLog throws naming call and cause for engine violations", () => {
  const run: Run = {
    schema: 1,
    ticks: 5,
    log: [{ tick: 0, event: GAMEPAD }],
  };

  const createFaultyEngine = (modifyReport: (base: TickReport) => TickReport): Engine => ({
    advance(ticks: number, inputs: readonly InputRecord[]): TickReport {
      const base: TickReport = {
        ticksRun: ticks,
        tickAfter: ticks,
        consumed: inputs,
        audioCues: [],
        requests: [],
        diagnostics: [],
        loading: false,
        paused: null,
        stateHash: "0123456789abcdef",
      };
      return modifyReport(base);
    },
    drawList(): DrawList {
      return { tick: 0, width: 320, height: 240, commands: [], marginCommands: [] };
    },
    surfacePixels(): SurfacePixels | null {
      return null;
    },
    picturePixels(): SurfacePixels | null { return null; },
    setBreakpoints(): void {},
    recoveryCandidate() { return null; },
    resumeRecovery() { return false; },
    recoveryStatus() { return "none"; },
    registeredActionNames() { return []; },
    registerGameAction() { return true; },
    setPointerMovementSuppressed() {},
    reportUnknownAction() {},
    customTouchControlsDeclared() { return false; },
    hostFeatures() { return { touch: false, pointer: "none", keyboard: false, gamepad: false, haptics: false, orientation: null }; },
    hostDisplayGeometry() { return { content: { width: 320, height: 240 }, game: { x: 0, y: 0, width: 320, height: 240 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }; },
    surfaceCacheEpoch() { return 0; },
    accessibilityTree() { return []; },
    runnerControlPointerPreemption() { return null; },
  });
  const failureCases: readonly {
    name: string;
    modifier: (b: TickReport) => TickReport;
    expectedSnippet: string;
  }[] = [
    {
      name: "drops consumed record",
      modifier: (b) => ({ ...b, consumed: [] }),
      expectedSnippet: "consumed length 0 does not match fed length 1",
    },
    {
      name: "alters consumed record",
      modifier: (b) => ({
        ...b,
        consumed: [{ tick: 0, event: { kind: "video.ended", reqId: 1 } }],
      }),
      expectedSnippet: "consumed inputs do not match fed inputs",
    },
    {
      name: "ticksRun 0",
      modifier: (b) => ({ ...b, ticksRun: 0 }),
      expectedSnippet: "ticksRun 0 does not match expected 3",
    },
    {
      name: "ticksRun below n",
      modifier: (b) => ({ ...b, ticksRun: 1 }),
      expectedSnippet: "ticksRun 1 does not match expected 3",
    },
    {
      name: "ticksRun above n",
      modifier: (b) => ({ ...b, ticksRun: 10 }),
      expectedSnippet: "ticksRun 10 does not match expected 3",
    },
    {
      name: "tickAfter mismatch",
      modifier: (b) => ({ ...b, tickAfter: 99 }),
      expectedSnippet: "tickAfter 99 does not match expected",
    },
    {
      name: "loading true",
      modifier: (b) => ({ ...b, loading: true }),
      expectedSnippet: "loading is true",
    },
    {
      name: "paused not null",
      modifier: (b) => ({ ...b, paused: { thread: 1, frame: 0, line: 1 } }),
      expectedSnippet: "paused is not null",
    },
    {
      name: "malformed request",
      modifier: (b) => ({
        ...b,
        requests: [{ kind: "asset", key: "foo" as never } as never],
      }),
      expectedSnippet: "a request is malformed",
    },
    {
      name: "malformed diagnostic",
      modifier: (b) => ({
        ...b,
        diagnostics: [{ code: "E1", file: "main.rc", line: 1.5, message: "err" }],
      }),
      expectedSnippet: "a diagnostic is malformed",
    },
  ];

  for (const { name, modifier, expectedSnippet } of failureCases) {
    const faultyEngine = createFaultyEngine(modifier);
    throws(
      () => runLog(faultyEngine, run, 3, createNullAudio()),
      (err: unknown) => {
        return (
          err instanceof Error &&
          err.message.startsWith("runLog: call 0:") &&
          err.message.includes(expectedSnippet)
        );
      },
      `expected error naming call and cause (${expectedSnippet}) for ${name}`,
    );
  }
});

test("runLog forwards report.audioCues to audio.handle", () => {
  const engine = createTestEngine();
  const run: Run = {
    schema: 1,
    ticks: 2,
    log: [
      { tick: 0, event: { kind: "key", name: "A", code: "KeyA", char: null, down: true } },
      { tick: 1, event: { kind: "key", name: "B", code: "KeyB", char: null, down: true } },
    ],
  };
  const audio = createNullAudio();
  runLog(engine, run, 2, audio);
  equal(audio.cues.length, 2);
  const volumeCue = (cueId: number, tick: number) => ({
    cueId,
    tick,
    kind: "media.volume",
    track: null,
    voice: null,
    asset: null,
    loop: null,
    flags: null,
    positionTicks: null,
    volume: 100,
    targetVolume: null,
    durationTicks: null,
  });
  deepEqual(audio.cues[0], volumeCue(1, 0));
  deepEqual(audio.cues[1], volumeCue(2, 1));
});

test("runLog accepts non-empty requests and diagnostics and hands them to the observer", () => {
  const run: Run = { schema: 1, ticks: 4, log: [] };
  const diagnostic = { code: "unknown.command", file: "<inline>", line: 2, message: "no such" };
  const request = { kind: "asset", reqId: 1, key: "foo" as never } as const;
  const makeEngine = (): Engine => {
    let now = 0;
    return {
    advance(ticks: number): TickReport {
      now += ticks;
      return {
        ticksRun: ticks,
        tickAfter: now,
        consumed: [],
        audioCues: [],
        requests: [request],
        diagnostics: [diagnostic],
        loading: false,
        paused: null,
        stateHash: "0123456789abcdef",
      };
    },
    drawList(): DrawList {
      return { tick: 0, width: 320, height: 240, commands: [], marginCommands: [] };
    },
    surfacePixels(): SurfacePixels | null {
      return null;
    },
    picturePixels(): SurfacePixels | null { return null; },
    setBreakpoints(): void {},
    recoveryCandidate() { return null; },
    resumeRecovery() { return false; },
    recoveryStatus() { return "none"; },
    registeredActionNames() { return []; },
    registerGameAction() { return true; },
    setPointerMovementSuppressed() {},
    reportUnknownAction() {},
      customTouchControlsDeclared() { return false; },
      hostFeatures() { return { touch: false, pointer: "none", keyboard: false, gamepad: false, haptics: false, orientation: null }; },
      hostDisplayGeometry() { return { content: { width: 320, height: 240 }, game: { x: 0, y: 0, width: 320, height: 240 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }; },
      surfaceCacheEpoch() { return 0; },
      accessibilityTree() { return []; },
      runnerControlPointerPreemption() { return null; },
    };
  };
  const seen: { call: number; tickAfter: number; requests: number; diagnostics: unknown }[] = [];
  const records = runLog(makeEngine(), run, 2, createNullAudio(), (observation) => {
    seen.push({
      call: observation.call,
      tickAfter: observation.tickAfter,
      requests: observation.requests.length,
      diagnostics: observation.diagnostics,
    });
  });
  // The golden records keep their `{ tick, state, draw }` shape.
  deepEqual(Object.keys(records[0]!).sort(), ["draw", "state", "tick"]);
  equal(records.length, 2);
  deepEqual(seen, [
    { call: 0, tickAfter: 2, requests: 1, diagnostics: [diagnostic] },
    { call: 1, tickAfter: 4, requests: 1, diagnostics: [diagnostic] },
  ]);
  // Without an observer the report is still accepted.
  equal(runLog(makeEngine(), run, 2, createNullAudio()).length, 2);
});
