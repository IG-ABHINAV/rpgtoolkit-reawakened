import {
  decodeLog,
  validateInputEvent,
  type InputEventV1,
  type InputRecord,
  type InputRecordV1,
  type PlainData,
  type PortData,
} from "@tk-reawakened/core";

export type TickRecord = {
  readonly tick: number;
  readonly state: string;
  readonly draw: string;
};

export type LegacyRun = {
  readonly schema: 1;
  readonly ticks: number;
  readonly log: readonly InputRecordV1[];
};

/** Active v2 replay logs carry normalized records without legacy conversion. */
export type ActiveRun = {
  readonly schema: 2;
  readonly ticks: number;
  readonly log: readonly InputRecord[];
};

export type Run = LegacyRun | ActiveRun;

export type Golden = {
  readonly schema: 1;
  readonly records: readonly TickRecord[];
};

function checkNoExtraKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  prefix: string,
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      throw new Error(`${prefix}: unexpected extra field '${key}'`);
    }
  }
}

/**
 * Decode one run record once and check its event against the port contract.
 *
 * The record must carry an own `event` that is a non-null, non-array object;
 * otherwise the failure names `event`. `decodeLog` then restores each
 * `{t:"bytes",hex}` leaf to `Uint8Array` and names the dotted path of a codec
 * failure; `validateInputEvent` names the field of a contract failure. Both
 * messages carry the record index. This is the only place that knows about
 * event shapes; `parseRun` keeps run-file structure.
 */
export function parseEvent(raw: unknown, recordIndex: number): InputEventV1 {
  const missingEvent = `run.json: record ${recordIndex}: event: missing or not an object`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(missingEvent);
  }
  if (!("event" in raw)) {
    throw new Error(missingEvent);
  }
  const rawEvent = raw.event;
  if (
    typeof rawEvent !== "object" ||
    rawEvent === null ||
    Array.isArray(rawEvent)
  ) {
    throw new Error(missingEvent);
  }

  let decoded: PortData;
  try {
    decoded = decodeLog(raw as PlainData);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`run.json: record ${recordIndex}: ${message}`);
  }

  const result = validateInputEvent(readEventField(decoded));
  if (!result.ok) {
    const prefix = `run.json: record ${recordIndex}: `;
    throw new Error(
      result.path === ""
        ? prefix + result.message
        : `${prefix}${result.path}: ${result.message}`,
    );
  }
  if (result.value.kind === "action" || result.value.kind === "host.gamepads") {
    throw new Error(`run.json: record ${recordIndex}: kind: unknown input event`);
  }
  if (result.value.kind === "gamepad" && result.value.buttons > 0x7f) {
    throw new Error(`run.json: record ${recordIndex}: buttons: expected a 7-bit legacy button mask`);
  }
  return result.value;
}

/** The `event` member of a decoded record, or `undefined` when it is not one. */
function readEventField(decoded: PortData): unknown {
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    Array.isArray(decoded) ||
    decoded instanceof Uint8Array
  ) {
    return undefined;
  }
  if ("event" in decoded) {
    return decoded.event;
  }
  return undefined;
}

export function parseRun(text: string): LegacyRun {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `run.json: invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("run.json: root must be an object");
  }
  const root = parsed as Record<string, unknown>;
  checkNoExtraKeys(root, ["schema", "ticks", "log"], "run.json");

  if (root.schema !== 1) {
    throw new Error("run.json: schema must be 1");
  }
  if (
    typeof root.ticks !== "number" ||
    !Number.isInteger(root.ticks) ||
    root.ticks < 1
  ) {
    throw new Error("run.json: ticks must be an integer >= 1");
  }
  if (!Array.isArray(root.log)) {
    throw new Error("run.json: log must be an array");
  }

  const log: InputRecordV1[] = [];
  for (let i = 0; i < root.log.length; i++) {
    const rawRec = root.log[i];
    if (
      typeof rawRec !== "object" ||
      rawRec === null ||
      Array.isArray(rawRec)
    ) {
      throw new Error(`run.json: record ${i}: must be an object`);
    }
    const rec = rawRec as Record<string, unknown>;
    checkNoExtraKeys(rec, ["tick", "event"], `run.json: record ${i}`);

    if (
      typeof rec.tick !== "number" ||
      !Number.isInteger(rec.tick) ||
      rec.tick < 0
    ) {
      throw new Error(
        `run.json: record ${i}: tick must be a finite integer >= 0`,
      );
    }
    if (rec.tick >= root.ticks) {
      throw new Error(
        `run.json: record ${i}: tick ${rec.tick} must be < ticks ${root.ticks}`,
      );
    }
    if (i > 0 && rec.tick < log[i - 1]!.tick) {
      throw new Error(
        `run.json: record ${i}: tick ${rec.tick} violates non-decreasing order`,
      );
    }

    const event = parseEvent(rec, i);

    log.push({
      tick: rec.tick,
      event,
    });
  }

  return {
    schema: 1,
    ticks: root.ticks,
    log,
  };
}

export function parseGolden(text: string): Golden {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `golden.json: invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("golden.json: root must be an object");
  }
  const root = parsed as Record<string, unknown>;
  checkNoExtraKeys(root, ["schema", "records"], "golden.json");

  if (root.schema !== 1) {
    throw new Error("golden.json: schema must be 1");
  }
  if (!Array.isArray(root.records)) {
    throw new Error("golden.json: records must be an array");
  }

  const hex16 = /^[0-9a-f]{16}$/;
  const records: TickRecord[] = [];
  for (let i = 0; i < root.records.length; i++) {
    const raw = root.records[i];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`golden.json: record ${i}: must be an object`);
    }
    const rec = raw as Record<string, unknown>;
    checkNoExtraKeys(rec, ["tick", "state", "draw"], `golden.json: record ${i}`);

    if (rec.tick !== i + 1) {
      throw new Error(
        `golden.json: record ${i}: tick must be ${i + 1}, got ${String(rec.tick)}`,
      );
    }
    if (typeof rec.state !== "string" || !hex16.test(rec.state)) {
      throw new Error(
        `golden.json: record ${i}: state must be a 16-character lowercase hex string`,
      );
    }
    if (typeof rec.draw !== "string" || !hex16.test(rec.draw)) {
      throw new Error(
        `golden.json: record ${i}: draw must be a 16-character lowercase hex string`,
      );
    }
    records.push({
      tick: rec.tick,
      state: rec.state,
      draw: rec.draw,
    });
  }

  return {
    schema: 1,
    records,
  };
}

export function formatGolden(records: readonly TickRecord[]): string {
  const lines: string[] = ['{\n  "schema": 1,\n  "records": ['];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    const comma = i < records.length - 1 ? "," : "";
    lines.push(
      `    {"tick": ${rec.tick}, "state": "${rec.state}", "draw": "${rec.draw}"}${comma}`,
    );
  }
  lines.push("  ]\n}\n");
  return lines.join("\n");
}

export function compareGolden(
  actual: readonly TickRecord[],
  expected: readonly TickRecord[],
): { ok: true } | { ok: false; message: string } {
  const minLen = Math.min(actual.length, expected.length);
  for (let i = 0; i < minLen; i++) {
    const act = actual[i]!;
    const exp = expected[i]!;
    const tick = act.tick;

    const stateDiff = act.state !== exp.state;
    const drawDiff = act.draw !== exp.draw;

    if (stateDiff || drawDiff) {
      const parts: string[] = [];
      if (stateDiff) {
        parts.push(
          `state hash differs (expected ${exp.state}, actual ${act.state})`,
        );
      }
      if (drawDiff) {
        parts.push(
          `draw-list hash differs (expected ${exp.draw}, actual ${act.draw})`,
        );
      }
      return {
        ok: false,
        message: `golden: tick ${tick}: ${parts.join("; ")}`,
      };
    }
  }

  if (actual.length > expected.length) {
    const extraTick = actual[expected.length]!.tick;
    return {
      ok: false,
      message: `golden: run has tick ${extraTick} the golden lacks`,
    };
  }

  if (actual.length < expected.length) {
    const missingTick = expected[actual.length]!.tick;
    return {
      ok: false,
      message: `golden: golden has tick ${missingTick} the run lacks`,
    };
  }

  return { ok: true };
}
