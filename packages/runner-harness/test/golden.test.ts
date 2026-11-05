import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  compareGolden,
  formatGolden,
  parseGolden,
  parseRun,
  type TickRecord,
} from "../src/golden.ts";

const GAMEPAD = { kind: "gamepad", device: 0, connected: false, axes: { x: 0, y: 0 }, buttons: 0 } as const;
test("parseRun parses v1 events with non-BMP char and bytes", () => {
  const runText = JSON.stringify({
    schema: 1,
    ticks: 13,
    log: [
      {
        tick: 0,
        event: { kind: "key", name: 'quote"and\\slash', code: "KeyQ", char: "𐍈", down: true },
      },
      {
        tick: 1,
        event: { kind: "pointer", x: 10, y: 20, buttons: 2 },
      },
      {
        tick: 2,
        event: GAMEPAD,
      },
      {
        tick: 3,
        event: { kind: "focus", state: "lost" },
      },
      {
        tick: 4,
        event: { kind: "asset", reqId: 1, bytes: { t: "bytes", hex: "0a0b0c" } },
      },
      {
        tick: 5,
        event: { kind: "asset", reqId: 2, bytes: null },
      },
      {
        tick: 6,
        event: { kind: "blob.loaded", reqId: 3, bytes: { t: "bytes", hex: "de" } },
      },
      {
        tick: 7,
        event: { kind: "blob.saved", reqId: 4, ok: true },
      },
      {
        tick: 8,
        event: { kind: "blob.listed", reqId: 5, names: ["file1", "file2"] },
      },
      {
        tick: 9,
        event: { kind: "extension.result", reqId: 6, result: { val: 123 } },
      },
      {
        tick: 10,
        event: { kind: "audio.ended", cueId: 7 },
      },
      {
        tick: 11,
        event: { kind: "video.ended", reqId: 1 },
      },
    ],
  });

  const run = parseRun(runText);
  equal(run.schema, 1);
  equal(run.ticks, 13);
  equal(run.log.length, 12);

  const keyEv = run.log[0]!.event;
  if (keyEv.kind === "key") {
    equal(keyEv.name, 'quote"and\\slash');
    equal(keyEv.char, "𐍈");
    equal(keyEv.down, true);
  } else {
    throw new Error("expected key event");
  }

  const assetEv = run.log[4]!.event;
  if (assetEv.kind === "asset" && assetEv.bytes) {
    deepEqual(assetEv.bytes, new Uint8Array([0x0a, 0x0b, 0x0c]));
  } else {
    throw new Error("expected asset event with bytes");
  }
});



test("parseRun rejects bad files and root schema", () => {
  const badFiles: readonly { name: string; text: string }[] = [
    { name: "not json", text: "invalid-json" },
    { name: "root not object", text: "[]" },
    { name: "schema 2", text: JSON.stringify({ schema: 2, ticks: 1, log: [] }) },
    { name: "schema missing", text: JSON.stringify({ ticks: 1, log: [] }) },
    { name: "ticks missing", text: JSON.stringify({ schema: 1, log: [] }) },
    { name: "ticks 0", text: JSON.stringify({ schema: 1, ticks: 0, log: [] }) },
    { name: "ticks negative", text: JSON.stringify({ schema: 1, ticks: -5, log: [] }) },
    { name: "ticks fractional", text: JSON.stringify({ schema: 1, ticks: 3.5, log: [] }) },
    { name: "ticks string", text: JSON.stringify({ schema: 1, ticks: "3", log: [] }) },
    { name: "log not array", text: JSON.stringify({ schema: 1, ticks: 1, log: "bad" }) },
    { name: "semantic action is v2-only", text: JSON.stringify({ schema: 1, ticks: 1, log: [{ tick: 0, event: { kind: "action", action: "game.fireball", down: true, source: "runner.fallback" } }] }) },
  ];

  for (const { name, text } of badFiles) {
    throws(
      () => parseRun(text),
      (err: unknown) => err instanceof Error && err.message.startsWith("run.json:"),
      `expected parseRun to throw on ${name}`,
    );
  }
});

test("parseRun rejects bad records naming record index and field", () => {
  const badRecords: readonly { name: string; record: unknown; fieldSnippet: string }[] = [
    {
      name: "stamps 3 then 2",
      record: [
        { tick: 3, event: GAMEPAD },
        { tick: 2, event: GAMEPAD },
      ],
      fieldSnippet: "violates non-decreasing order",
    },
    {
      name: "negative stamp",
      record: [{ tick: -1, event: GAMEPAD }],
      fieldSnippet: "tick must be a finite integer >= 0",
    },
    {
      name: "fractional stamp",
      record: [{ tick: 1.5, event: GAMEPAD }],
      fieldSnippet: "tick must be a finite integer >= 0",
    },
    {
      name: "stamp >= ticks",
      record: [{ tick: 5, event: GAMEPAD }],
      fieldSnippet: "tick 5 must be < ticks 5",
    },
    {
      name: "record without an event",
      record: [{ tick: 0 }],
      fieldSnippet: "record 0: event",
    },
    {
      name: "record with a non-object event",
      record: [{ tick: 0, event: 5 }],
      fieldSnippet: "record 0: event",
    },
    {
      name: "second record is bad",
      record: [
        { tick: 0, event: GAMEPAD },
        { tick: 1, event: { kind: "unknown_kind" } },
      ],
      fieldSnippet: "record 1: kind",
    },
    {
      name: "unknown kind",
      record: [{ tick: 0, event: { kind: "unknown_kind" } }],
      fieldSnippet: "kind: unknown input event kind",
    },
    {
      name: "missing field in key",
      record: [{ tick: 0, event: { kind: "key", name: "A", down: true } }],
      fieldSnippet: "code: missing required key",
    },
    {
      name: "wrong type for down",
      record: [
        { tick: 0, event: { kind: "key", name: "A", code: "KeyA", char: null, down: "yes" } },
      ],
      fieldSnippet: "down: expected a boolean",
    },
    {
      name: "extra key missing on a reply",
      record: [
        {
          tick: 0,
          event: { kind: "asset", reqId: 1, bytes: { t: "bytes", hex: "00" }, missing: true },
        },
      ],
      fieldSnippet: "missing: unexpected key",
    },
    {
      name: "extra key in record",
      record: [{ tick: 0, event: GAMEPAD, extra: 1 }],
      fieldSnippet: "unexpected extra field 'extra'",
    },
    {
      name: "extra key in event",
      record: [{ tick: 0, event: { ...GAMEPAD, extra: 1 } }],
      fieldSnippet: "extra: unexpected key",
    },
    {
      name: "legacy gamepad masks reject bits outside the historical seven-bit shape",
      record: [{ tick: 0, event: { ...GAMEPAD, buttons: 0x80 } }],
      fieldSnippet: "buttons: expected a 7-bit legacy button mask",
    },

    {
      name: "invalid hex digits zz",
      record: [{ tick: 0, event: { kind: "asset", reqId: 1, bytes: { t: "bytes", hex: "zz" } } }],
      fieldSnippet: "decodeLog: at event.bytes: invalid hex digit",
    },
    {
      name: "odd-length hex",
      record: [{ tick: 0, event: { kind: "asset", reqId: 1, bytes: { t: "bytes", hex: "abc" } } }],
      fieldSnippet: "decodeLog: at event.bytes: odd-length hex string",
    },
    {
      name: "empty name in key",
      record: [
        { tick: 0, event: { kind: "key", name: "", code: "KeyA", char: null, down: true } },
      ],
      fieldSnippet: "name: expected a non-empty string",
    },
    {
      name: "multi-code-point char in key",
      record: [
        { tick: 0, event: { kind: "key", name: "A", code: "KeyA", char: "AB", down: true } },
      ],
      fieldSnippet: "char: expected null or a single code point",
    },
    {
      name: "extension.result missing result",
      record: [{ tick: 0, event: { kind: "extension.result", reqId: 1 } }],
      fieldSnippet: "result: missing required key",
    },
    {
      name: "extension.result malformed hex payload",
      record: [
        {
          tick: 0,
          event: { kind: "extension.result", reqId: 1, result: { t: "bytes", hex: "zz" } },
        },
      ],
      fieldSnippet: "decodeLog: at event.result: invalid hex digit",
    },
  ];

  for (const { name, record, fieldSnippet } of badRecords) {
    const text = JSON.stringify({
      schema: 1,
      ticks: 5,
      log: record,
    });
    throws(
      () => parseRun(text),
      (err: unknown) => {
        return (
          err instanceof Error &&
          err.message.includes("run.json: record") &&
          err.message.includes(fieldSnippet)
        );
      },
      `expected parseRun to throw on ${name}`,
    );
  }
});

test("parseGolden and formatGolden round-trip correctly", () => {
  const records: TickRecord[] = [
    { tick: 1, state: "0123456789abcdef", draw: "abcdef0123456789" },
    { tick: 2, state: "1123456789abcdef", draw: "bbcdef0123456789" },
  ];

  const formatted = formatGolden(records);
  const parsed = parseGolden(formatted);

  equal(parsed.schema, 1);
  deepEqual(parsed.records, records);
});

test("parseGolden rejects bad files and fields", () => {
  const badGoldens: readonly { name: string; text: string; snippet: string }[] = [
    { name: "not json", text: "bad", snippet: "invalid JSON" },
    { name: "root not object", text: "[]", snippet: "root must be an object" },
    { name: "schema 2", text: JSON.stringify({ schema: 2, records: [] }), snippet: "schema must be 1" },
    { name: "records not array", text: JSON.stringify({ schema: 1, records: 123 }), snippet: "records must be an array" },
    {
      name: "tick not 1..N",
      text: JSON.stringify({
        schema: 1,
        records: [{ tick: 2, state: "0123456789abcdef", draw: "0123456789abcdef" }],
      }),
      snippet: "tick must be 1",
    },
    {
      name: "state bad hex",
      text: JSON.stringify({
        schema: 1,
        records: [{ tick: 1, state: "bad_hex_chars!!", draw: "0123456789abcdef" }],
      }),
      snippet: "state must be a 16-character lowercase hex string",
    },
    {
      name: "state too short",
      text: JSON.stringify({
        schema: 1,
        records: [{ tick: 1, state: "0123456789", draw: "0123456789abcdef" }],
      }),
      snippet: "state must be a 16-character lowercase hex string",
    },
    {
      name: "draw uppercase hex",
      text: JSON.stringify({
        schema: 1,
        records: [{ tick: 1, state: "0123456789abcdef", draw: "0123456789ABCDEF" }],
      }),
      snippet: "draw must be a 16-character lowercase hex string",
    },
    {
      name: "extra field in record",
      text: JSON.stringify({
        schema: 1,
        records: [{ tick: 1, state: "0123456789abcdef", draw: "0123456789abcdef", extra: true }],
      }),
      snippet: "unexpected extra field 'extra'",
    },
  ];

  for (const { name, text, snippet } of badGoldens) {
    throws(
      () => parseGolden(text),
      (err: unknown) => err instanceof Error && err.message.includes(snippet),
      `expected parseGolden to throw on ${name}`,
    );
  }
});

test("compareGolden detects differences table-driven", () => {
  const baseRecords: readonly TickRecord[] = [
    { tick: 1, state: "0000000000000001", draw: "aaaaaaaaaaaaaaaa" },
    { tick: 2, state: "0000000000000002", draw: "bbbbbbbbbbbbbbbb" },
    { tick: 3, state: "0000000000000003", draw: "cccccccccccccccc" },
  ];

  // identical matches
  const matchResult = compareGolden(baseRecords, baseRecords);
  equal(matchResult.ok, true);

  const diffCases: readonly {
    name: string;
    actual: readonly TickRecord[];
    expected: readonly TickRecord[];
    expectedMessage: string;
  }[] = [
    {
      name: "state altered at tick 2",
      actual: [
        baseRecords[0]!,
        { tick: 2, state: "9999999999999999", draw: "bbbbbbbbbbbbbbbb" },
        baseRecords[2]!,
      ],
      expected: baseRecords,
      expectedMessage:
        "golden: tick 2: state hash differs (expected 0000000000000002, actual 9999999999999999)",
    },
    {
      name: "draw altered at tick 2",
      actual: [
        baseRecords[0]!,
        { tick: 2, state: "0000000000000002", draw: "9999999999999999" },
        baseRecords[2]!,
      ],
      expected: baseRecords,
      expectedMessage:
        "golden: tick 2: draw-list hash differs (expected bbbbbbbbbbbbbbbb, actual 9999999999999999)",
    },
    {
      name: "both state and draw altered at tick 2",
      actual: [
        baseRecords[0]!,
        { tick: 2, state: "9999999999999999", draw: "8888888888888888" },
        baseRecords[2]!,
      ],
      expected: baseRecords,
      expectedMessage:
        "golden: tick 2: state hash differs (expected 0000000000000002, actual 9999999999999999); draw-list hash differs (expected bbbbbbbbbbbbbbbb, actual 8888888888888888)",
    },
    {
      name: "two ticks altered (reports only first differing tick)",
      actual: [
        baseRecords[0]!,
        { tick: 2, state: "9999999999999999", draw: "bbbbbbbbbbbbbbbb" },
        { tick: 3, state: "8888888888888888", draw: "cccccccccccccccc" },
      ],
      expected: baseRecords,
      expectedMessage:
        "golden: tick 2: state hash differs (expected 0000000000000002, actual 9999999999999999)",
    },
    {
      name: "golden shorter (run has extra tick)",
      actual: baseRecords,
      expected: [baseRecords[0]!, baseRecords[1]!],
      expectedMessage: "golden: run has tick 3 the golden lacks",
    },
    {
      name: "golden longer (run missing tick)",
      actual: [baseRecords[0]!, baseRecords[1]!],
      expected: baseRecords,
      expectedMessage: "golden: golden has tick 3 the run lacks",
    },
  ];

  for (const { name, actual, expected, expectedMessage } of diffCases) {
    const res = compareGolden(actual, expected);
    equal(res.ok, false, `expected failure for ${name}`);
    if (!res.ok) {
      equal(res.message, expectedMessage, `message mismatch for ${name}`);
    }
  }
});
