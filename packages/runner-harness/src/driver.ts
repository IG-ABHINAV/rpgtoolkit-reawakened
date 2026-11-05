import {
  canon,
  encodeLog,
  hashDrawList,
  type Diagnostic,
  type Engine,
  type InputRecordV1,
  type InputRecord,
  type RunnerRequest,
  type TickReport,
} from "@tk-reawakened/core";
import type { AudioSink } from "./audio.ts";
import type { Run, TickRecord } from "./golden.ts";

function isBlobKey(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const blob = value as { readonly area?: unknown; readonly path?: unknown };
  return (blob.area === "saves" || blob.area === "files") && typeof blob.path === "string";
}

function isBytes(value: unknown): boolean {
  return value instanceof Uint8Array;
}

function isRequest(value: unknown): value is RunnerRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const request = value as { readonly kind?: unknown; readonly reqId?: unknown; readonly [key: string]: unknown };
  if (typeof request.kind !== "string" || !Number.isInteger(request.reqId)) return false;
  switch (request.kind) {
    case "asset":
    case "playVideo":
      return typeof request.key === "string";
    case "loadBlob":
      return isBlobKey(request.blob);
    case "saveBlob":
      return isBlobKey(request.blob) && isBytes(request.bytes);
    case "listBlobs":
      return request.area === "saves" || request.area === "files";
    case "extension.call":
      return typeof request.name === "string" && Array.isArray(request.args);
    case "prefetch": {
      // A hint is observed, never dropped: the harness validates its shape and records it like any other request.
      const hints = request.hints;
      if (!Array.isArray(hints)) return false;
      return hints.every((hint) => {
        if (typeof hint !== "object" || hint === null || Array.isArray(hint)) return false;
        const entry = hint as { readonly tier?: unknown; readonly key?: unknown };
        return (entry.tier === "now" || entry.tier === "next" || entry.tier === "always") && typeof entry.key === "string";
      });
    }
    case "quit":
      return true;
    case "openUrl":
      return typeof request.url === "string";
    default:
      return false;
  }
}

/**
 * The non-empty part of one `advance` report: the host requests and the located
 * runtime diagnostics (AD-24) it carried. `runLog` hands it to the observer
 * without putting it in the golden records, so the golden shape is unchanged.
 */
export type ReportObservation = {
  readonly call: number;
  readonly tickAfter: number;
  readonly requests: readonly RunnerRequest[];
  readonly diagnostics: readonly Diagnostic[];
};

/** Called once per `advance` call whose report has requests or diagnostics. */
export type ReportObserver = (observation: ReportObservation) => void;

/** Every successful `advance` result and the exact stamped records the runner submitted. */
export type TickObservation = {
  readonly call: number;
  readonly tickBefore: number;
  readonly tickAfter: number;
  readonly ticksRun: number;
  readonly loading: boolean;
  readonly paused: TickReport["paused"];
  readonly diagnostics: readonly Diagnostic[];
  readonly fed: readonly InputRecord[];
  readonly consumed: readonly InputRecord[];
  readonly stateHash: string;
};

/** Called for each `advance`, after runLog checks timing and consumed-input contracts. */
export type TickObserver = (observation: TickObservation) => void;

const V1_GAMEPAD_BUTTON_BITS = [12, 13, 14, 15, 0, 1, 9] as const;

function upgradeV1Record(record: InputRecordV1): InputRecord {
  if (record.event.kind !== "gamepad") return record;
  let buttons = 0;
  for (let bit = 0; bit < V1_GAMEPAD_BUTTON_BITS.length; bit++) {
    if ((record.event.buttons & (1 << bit)) !== 0) buttons |= 1 << V1_GAMEPAD_BUTTON_BITS[bit]!;
  }
  return { ...record, event: { ...record.event, buttons } };
}

export function runLog(
  engine: Engine,
  run: Run,
  n: number,
  audio: AudioSink,
  observer?: ReportObserver,
  tickObserver?: TickObserver,
): TickRecord[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError("runLog: n must be an integer >= 1");
  }

  const records: TickRecord[] = [];
  let currentTick = 0;
  let callIndex = 0;
  let inputIndex = 0;

  while (currentTick < run.ticks) {
    const ticksToRun = Math.min(n, run.ticks - currentTick);
    const before = currentTick;
    const endWindow = before + ticksToRun;

    const fedInputs: InputRecord[] = [];
    while (
      inputIndex < run.log.length &&
      run.log[inputIndex]!.tick < endWindow
    ) {
      const rec = run.log[inputIndex]!;
      if (rec.tick < before) {
        throw new RangeError(
          `runLog: call ${callIndex}: record tick ${rec.tick} is before window [${before}, ${endWindow})`,
        );
      }
      fedInputs.push(run.schema === 1 ? upgradeV1Record(rec as InputRecordV1) : rec as InputRecord);
      inputIndex++;
    }

    const fedCanon = canon(encodeLog(fedInputs));
    const report = engine.advance(ticksToRun, fedInputs, n);

    if (report.ticksRun !== ticksToRun) {
      throw new Error(
        `runLog: call ${callIndex}: ticksRun ${report.ticksRun} does not match expected ${ticksToRun}`,
      );
    }
    if (report.tickAfter !== before + report.ticksRun) {
      throw new Error(
        `runLog: call ${callIndex}: tickAfter ${report.tickAfter} does not match expected ${before + report.ticksRun}`,
      );
    }
    if (report.loading !== false) {
      throw new Error(`runLog: call ${callIndex}: loading is true`);
    }
    if (report.paused !== null) {
      throw new Error(`runLog: call ${callIndex}: paused is not null`);
    }
    for (const request of report.requests) {
      if (!isRequest(request)) {
        throw new Error(`runLog: call ${callIndex}: a request is malformed`);
      }
    }
    for (const diagnostic of report.diagnostics) {
      if (
        typeof diagnostic !== "object" ||
        diagnostic === null ||
        typeof diagnostic.code !== "string" ||
        typeof diagnostic.file !== "string" ||
        !Number.isInteger(diagnostic.line) ||
        diagnostic.line < 0 ||
        typeof diagnostic.message !== "string"
      ) {
        throw new Error(`runLog: call ${callIndex}: a diagnostic is malformed`);
      }
    }
    if (report.requests.length > 0 || report.diagnostics.length > 0) {
      observer?.({
        call: callIndex,
        tickAfter: report.tickAfter,
        requests: report.requests,
        diagnostics: report.diagnostics,
      });
    }

    if (report.consumed.length !== fedInputs.length) {
      throw new Error(
        `runLog: call ${callIndex}: consumed length ${report.consumed.length} does not match fed length ${fedInputs.length}`,
      );
    }
    const consumedCanon = canon(encodeLog(report.consumed));
    if (consumedCanon !== fedCanon) {
      throw new Error(
        `runLog: call ${callIndex}: consumed inputs do not match fed inputs`,
      );
    }

    tickObserver?.({
      call: callIndex,
      tickBefore: before,
      tickAfter: report.tickAfter,
      ticksRun: report.ticksRun,
      loading: report.loading,
      paused: report.paused,
      diagnostics: report.diagnostics,
      fed: fedInputs,
      consumed: report.consumed,
      stateHash: report.stateHash,
    });
    for (const cue of report.audioCues) {
      audio.handle(cue);
    }

    records.push({
      tick: report.tickAfter,
      state: report.stateHash,
      draw: hashDrawList(engine.drawList(0)),
    });

    currentTick = report.tickAfter;
    callIndex++;
  }

  if (inputIndex < run.log.length) {
    throw new Error(
      `runLog: unconsumed inputs remaining after run: ${run.log.length - inputIndex} records`,
    );
  }

  return records;
}
