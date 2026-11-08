// The runtime input-event validator (AD-14, AD-5, CAP-12/CAP-13).
//
// One valid event of each kind (including `pointer.cancel` and the `null`
// forms of `char` and `bytes`) is accepted and returned unchanged; every malformed
// shape is rejected with the path of the offending field; and no input,
// however hostile, makes the validator throw.
import { test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateInputEvent } from "../src/index.ts";
import { decodeLog, encodeLog } from "../src/canon/log.ts";

test("validateInputEvent accepts one valid event of each kind", () => {
  const valid: readonly (readonly [string, unknown])[] = [
    ["key with char", { kind: "key", name: "A", code: "KeyA", char: "a", down: true }],
    ["key with null char", { kind: "key", name: "ENTER", code: "Enter", char: null, down: false }],
    ["pointer", { kind: "pointer", x: 10, y: -20, buttons: 0 }],
    ["pointer.cancel", { kind: "pointer.cancel" }],
    ["semantic action", { kind: "action", action: "game.fireball", down: true, source: "runner.fallback", modalId: null }],
    ["modal-scoped confirm", { kind: "action", action: "confirm", down: true, source: "runner.fallback", modalId: 1 }],
    ["gamepad", { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 0 }],
    ["gamepad W3C button 16", { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 1 << 16 }],
    ["gamepad all physical buttons", { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 0x1ffff }],
    ["host gamepad snapshot", { kind: "host.gamepads", devices: [{ device: 0, axes: { x: 1000, y: 0 }, buttons: 1 << 16 }] }],
    ["host gamepad snapshot all physical buttons", { kind: "host.gamepads", devices: [{ device: 0, axes: { x: 0, y: 0 }, buttons: 0x1ffff }] }],
    ["focus", { kind: "focus", state: "gained" }],
    ["asset with bytes", { kind: "asset", reqId: 1, bytes: new Uint8Array([1, 2]) }],
    ["asset with null bytes", { kind: "asset", reqId: 1, bytes: null }],
    ["blob.loaded with null bytes", { kind: "blob.loaded", reqId: 2, bytes: null }],
    ["blob.loaded with bytes", { kind: "blob.loaded", reqId: 2, bytes: new Uint8Array([]) }],
    ["blob.saved", { kind: "blob.saved", reqId: 3, ok: false }],
    ["blob.listed", { kind: "blob.listed", reqId: 4, names: ["a", "b"] }],
    ["extension.result object", { kind: "extension.result", reqId: 5, result: { x: 1 } }],
    ["extension.result null", { kind: "extension.result", reqId: 5, result: null }],
    [
      "extension.result bytes",
      { kind: "extension.result", reqId: 5, result: new Uint8Array([1]) },
    ],
    ["audio.ended", { kind: "audio.ended", cueId: 7 }],
    ["video.ended", { kind: "video.ended", reqId: 1 }],
  ];

  for (const [label, event] of valid) {
    const result = validateInputEvent(event);
    equal(result.ok, true, label);
    if (result.ok) deepEqual(result.value, event, label);
  }
});

test("validateInputEvent names the path of the first failure", () => {
  const rejected: readonly (readonly [string, unknown, string])[] = [
    ["absent char", { kind: "key", name: "A", code: "KeyA", down: true }, "char"],
    [
      "undefined char",
      { kind: "key", name: "A", code: "KeyA", char: undefined, down: true },
      "char",
    ],
    ["undefined bytes", { kind: "asset", reqId: 1, bytes: undefined }, "bytes"],
    ["undefined reqId", { kind: "asset", reqId: undefined, bytes: null }, "reqId"],
    [
      "undefined name",
      { kind: "key", name: undefined, code: "KeyA", char: null, down: true },
      "name",
    ],
    ["string x", { kind: "pointer", x: "10", y: 0, buttons: 0 }, "x"],
    ["fractional x", { kind: "pointer", x: 1.5, y: 0, buttons: 0 }, "x"],
    ["negative buttons", { kind: "pointer", x: 0, y: 0, buttons: -1 }, "buttons"],
    ["non-number bytes", { kind: "asset", reqId: 2, bytes: 5 }, "bytes"],
    [
      "object bytes",
      { kind: "asset", reqId: 1, bytes: { t: "bytes", hex: "00" } },
      "bytes",
    ],
    ["unknown kind", { kind: "nope" }, "kind"],
    ["absent kind", {}, "kind"],
    ["empty semantic action", { kind: "action", action: "", down: true, source: "runner.fallback", modalId: null }, "action"],
    ["semantic action requires modalId", { kind: "action", action: "confirm", down: true, source: "runner.fallback" }, "modalId"],
    ["modal scope only accepts confirm or cancel", { kind: "action", action: "game.fireball", down: true, source: "runner.fallback", modalId: 1 }, "action"],
    ["extra key", { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 0, extra: 1 }, "extra"],
    ["pointer.cancel rejects payload fields", { kind: "pointer.cancel", x: 1 }, "x"],
    [
      "missing on an asset reply",
      { kind: "asset", reqId: 1, bytes: null, missing: true },
      "missing",
    ],
    [
      "missing on a blob reply",
      { kind: "blob.loaded", reqId: 1, bytes: new Uint8Array(), missing: true },
      "missing",
    ],
    ["empty name", { kind: "key", name: "", code: "KeyA", char: null, down: true }, "name"],
    ["empty code", { kind: "key", name: "A", code: "", char: null, down: true }, "code"],
    ["two code points", { kind: "key", name: "A", code: "KeyA", char: "AB", down: true }, "char"],
    [
      "lone surrogate char",
      { kind: "key", name: "A", code: "KeyA", char: "\ud800", down: true },
      "char",
    ],
    ["non-string name in list", { kind: "blob.listed", reqId: 1, names: ["a", 2] }, "names"],
    ["non-boolean ok", { kind: "blob.saved", reqId: 1, ok: "yes" }, "ok"],
    ["bad focus state", { kind: "focus", state: "maybe" }, "state"],
    ["negative cueId", { kind: "audio.ended", cueId: -1 }, "cueId"],
    ["absent result", { kind: "extension.result", reqId: 1 }, "result"],
    [
      "undefined result",
      { kind: "extension.result", reqId: 1, result: undefined },
      "result",
    ],
    [
      "function result",
      { kind: "extension.result", reqId: 1, result: () => 1 },
      "result",
    ],
    ["Map result", { kind: "extension.result", reqId: 1, result: new Map() }, "result"],
    ["NaN result", { kind: "extension.result", reqId: 1, result: NaN }, "result"],
    [
      "nested undefined result",
      { kind: "extension.result", reqId: 1, result: { a: undefined } },
      "result",
    ],
    ["gamepad button outside W3C range", { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 1 << 17 }, "buttons"],
    ["unsorted host gamepad snapshot", { kind: "host.gamepads", devices: [{ device: 1, axes: { x: 0, y: 0 }, buttons: 0 }, { device: 0, axes: { x: 0, y: 0 }, buttons: 0 }] }, "devices[1].device"],
    [
      "extra key on a key event",
      { kind: "key", name: "A", code: "KeyA", char: null, down: true, extra: 1 },
      "extra",
    ],
  ];

  for (const [label, event, path] of rejected) {
    const result = validateInputEvent(event);
    equal(result.ok, false, label);
    if (!result.ok) equal(result.path, path, label);
  }

  const cyclicResult: { self?: unknown } = {};
  cyclicResult.self = cyclicResult;
  const cyclicOutcome = validateInputEvent({
    kind: "extension.result",
    reqId: 1,
    result: cyclicResult,
  });
  equal(cyclicOutcome.ok, false, "cyclic result");
  if (!cyclicOutcome.ok) equal(cyclicOutcome.path, "result", "cyclic result");
});

test("validateInputEvent never throws on hostile input", () => {
  const notObjects: readonly (readonly [string, unknown])[] = [
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
    ["string", "key"],
    ["boolean", true],
    ["symbol", Symbol("s")],
    ["function", () => 1],
  ];
  for (const [label, value] of notObjects) {
    const result = validateInputEvent(value);
    equal(result.ok, false, label);
    if (!result.ok) equal(result.path, "", label);
  }

  for (const [label, value] of [
    ["empty array", []],
    ["array of events", [{ kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 0 }]],
  ] as readonly (readonly [string, unknown])[]) {
    const result = validateInputEvent(value);
    equal(result.ok, false, label);
    if (!result.ok) equal(result.path, "", label);
  }

  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  equal(validateInputEvent(cyclic).ok, false, "cyclic object");

  const throwingGetter: Record<string, unknown> = {};
  Object.defineProperty(throwingGetter, "kind", {
    get() {
      throw new Error("boom");
    },
  });
  const throwingOutcome = validateInputEvent(throwingGetter);
  equal(throwingOutcome.ok, false, "throwing getter");
  if (!throwingOutcome.ok) equal(throwingOutcome.path, "", "throwing getter");
});

test("validateInputEvent returns a fresh value, not the input reference", () => {
  const input = { kind: "gamepad", device: 0, connected: true, axes: { x: 0, y: 0 }, buttons: 0 };
  const result = validateInputEvent(input);
  equal(result.ok, true);
  if (!result.ok) return;

  input.kind = "nope";
  equal(result.value.kind, "gamepad");
});

test("runtime validation rejects the generated v2 modal-scoped game action vector", () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const vectorsPath = join(root, "../../../tools/fixtures/runner-protocol/vectors-v2.json");
  const rootRecord = JSON.parse(readFileSync(vectorsPath, "utf8")) as {
    readonly vectors: readonly { readonly id: string; readonly record: { readonly event?: unknown } }[];
  };
  const vector = rootRecord.vectors.find((row) => row.id === "refuse-modal-scoped-game-action");
  if (vector === undefined) throw new Error("generated v2 modal-action refusal vector is missing");
  equal(validateInputEvent(vector.record.event).ok, false, vector.id);
});

test("runtime gamepad validation matches published v2 device and axis boundaries", () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const vectorsPath = join(root, "../../../tools/fixtures/runner-protocol/vectors-v2.json");
  const { vectors } = JSON.parse(readFileSync(vectorsPath, "utf8")) as {
    readonly vectors: readonly { readonly id: string; readonly valid: boolean; readonly record: { readonly event: unknown } }[];
  };
  const boundaries = vectors.filter((vector) => vector.id.startsWith("gamepad-boundary-"));
  equal(boundaries.length, 22);
  for (const vector of boundaries) {
    const result = validateInputEvent(vector.record.event);
    equal(result.ok, vector.valid, vector.id);
    if (result.ok) {
      deepEqual(result.value, vector.record.event, vector.id);
    } else {
      const field = vector.id.includes("-device-") ? "device" : vector.id.includes("-x-") ? "axes.x" : "axes.y";
      const prefix = vector.id.includes("-host-gamepads-") ? "devices[0]." : "";
      equal(result.path, prefix + field, vector.id);
    }
  }
});

test("runtime and published v2 gamepad axis shapes reject missing and extra keys", () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const vectorsPath = join(root, "../../../tools/fixtures/runner-protocol/vectors-v2.json");
  const { vectors } = JSON.parse(readFileSync(vectorsPath, "utf8")) as {
    readonly vectors: readonly { readonly id: string; readonly valid: boolean; readonly record: { readonly event: unknown } }[];
  };
  const cases = vectors.filter((vector) => vector.id.startsWith("gamepad-axes-"));
  equal(cases.length, 6);
  for (const vector of cases) {
    equal(vector.valid, false, vector.id);
    const result = validateInputEvent(vector.record.event);
    equal(result.ok, false, vector.id);
    if (!result.ok) equal(result.path, vector.id.includes("-host-gamepads-") ? "devices[0].axes" : "axes", vector.id);
  }
});

test("gamepad axes require plain enumerable data fields safe for the log codec", () => {
  const symbolExtra = { x: 0, y: 0, [Symbol("z")]: 1 };
  const hiddenExtra = Object.defineProperty({ x: 0, y: 0 }, "z", { value: 1, enumerable: false });
  const hiddenX = Object.defineProperty({ y: 0 }, "x", { value: 0, enumerable: false });
  const accessor = Object.defineProperty({ y: 0 }, "x", { get: () => 0, enumerable: true });
  const customPrototype = Object.assign(Object.create({}), { x: 0, y: 0 }) as object;
  const nullPrototype = Object.assign(Object.create(null), { x: -1000, y: 1000 }) as object;
  for (const kind of ["gamepad", "host.gamepads"] as const) {
    const event = (axes: object): unknown => kind === "gamepad"
      ? { kind, device: 0, connected: true, axes, buttons: 0 }
      : { kind, devices: [{ device: 0, axes, buttons: 0 }] };
    for (const [label, axes] of [
      ["symbol extra", symbolExtra], ["hidden extra", hiddenExtra], ["hidden x", hiddenX],
      ["accessor", accessor], ["custom prototype", customPrototype],
    ] as const) {
      const result = validateInputEvent(event(axes));
      equal(result.ok, false, `${kind}: ${label}`);
      if (!result.ok) equal(result.path, kind === "gamepad" ? "axes" : "devices[0].axes", `${kind}: ${label}`);
    }
    for (const axes of [{ x: 0, y: 0 }, nullPrototype]) {
      const result = validateInputEvent(event(axes));
      equal(result.ok, true, kind);
      if (!result.ok) throw new Error(result.message);
      const encoded = encodeLog(result.value);
      deepEqual(JSON.parse(JSON.stringify(encoded)), JSON.parse(JSON.stringify(event(axes))), kind);
      deepEqual(decodeLog(JSON.parse(JSON.stringify(encoded))), JSON.parse(JSON.stringify(event(axes))), kind);
    }
  }
});

for (const kind of ["gamepad", "host.gamepads"] as const) {
  test(`${kind} rejects stateful axes accessor before validation or logging`, () => {
    let reads = 0;
    const sample = Object.defineProperty({ device: 0, buttons: 0 }, "axes", {
      enumerable: true,
      get: () => ++reads === 1 ? { x: 0, y: 0 } : { x: 0, y: 0, z: 1 },
    });
    const event = kind === "gamepad"
      ? Object.assign(sample, { kind, connected: true })
      : { kind, devices: [sample] };
    const result = validateInputEvent(event);
    equal(result.ok, false);
    if (!result.ok) equal(result.path, kind === "gamepad" ? "axes" : "devices[0].axes");
    equal(reads, 0, "validation must not invoke the getter");
  });
}

for (const kind of ["gamepad", "host.gamepads"] as const) {
  test(`${kind} snapshots validated axes before hostile later reads and log encoding`, () => {
    const axes: { x: number; y: number; z?: number } = { x: 7, y: -8 };
    const sample = Object.defineProperty({ device: 0, axes }, "buttons", {
      enumerable: true,
      get: () => { axes.z = 1; return 0; },
    });
    const event = kind === "gamepad"
      ? Object.assign(sample, { kind, connected: true })
      : { kind, devices: [sample] };
    const result = validateInputEvent(event);
    equal(result.ok, true);
    if (!result.ok) throw new Error(result.message);
    axes.x = 123;
    const encoded = JSON.parse(JSON.stringify(encodeLog(result.value)));
    const decoded = decodeLog(encoded);
    const expected = kind === "gamepad"
      ? { kind, device: 0, connected: true, axes: { x: 7, y: -8 }, buttons: 0 }
      : { kind, devices: [{ device: 0, axes: { x: 7, y: -8 }, buttons: 0 }] };
    deepEqual(encoded, expected);
    deepEqual(decoded, expected);
  });
}

test("host.gamepads snapshots the validated devices getter result", () => {
  let reads = 0;
  const sample = { device: 0, axes: { x: 0, y: 0 }, buttons: 0 };
  const event = {
    kind: "host.gamepads",
    get devices() {
      return ++reads === 1 ? [sample] : [{ ...sample, axes: { x: 0, y: 0, z: 1 } }];
    },
  };
  const result = validateInputEvent(event);
  equal(result.ok, true);
  if (!result.ok) throw new Error(result.message);
  equal(reads, 1);
  const encoded = JSON.parse(JSON.stringify(encodeLog(result.value)));
  const expected = { kind: "host.gamepads", devices: [sample] };
  deepEqual(encoded, expected);
  deepEqual(decodeLog(encoded), expected);
  equal(reads, 1);
});

test("runtime gamepad snapshot ordering matches published v2 vectors", () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const path = join(root, "../../../tools/fixtures/runner-protocol/vectors-v2.json");
  const { vectors } = JSON.parse(readFileSync(path, "utf8")) as {
    readonly vectors: readonly { readonly id: string; readonly valid: boolean; readonly record: { readonly event: unknown } }[];
  };
  const ordering = vectors.filter((vector) => vector.id.startsWith("host-gamepads-order-"));
  equal(ordering.length, 7);
  for (const vector of ordering) equal(validateInputEvent(vector.record.event).ok, vector.valid, vector.id);
});
