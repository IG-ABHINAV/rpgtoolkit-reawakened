// RFC 8785 canonical JSON, the FNV-1a 64-bit hash and the log codec (AD-11).
//
// The vectors are the RFC's own: the section 3.2.2 sample with its 3.2.4 UTF-8
// bytes, the 3.2.3 key-sorting sample and the Appendix B number table. The
// BigInt FNV-1a form is kept here as the oracle the 32-bit-limb hasher must
// agree with.
import { test } from "node:test";
import { deepEqual, equal, throws } from "node:assert/strict";
import { TextEncoder } from "node:util";
import {
  CANON_MAX_DEPTH,
  canon,
  decodeLog,
  encodeLog,
  fnv1a64,
  hashDrawList,
  hashState,
  reviveNonFinite,
  tagNonFinite,
  utf8Decode,
  utf8Encode,
} from "../src/index.ts";
import type { DrawList, PlainData, PortData, SurfaceId } from "../src/index.ts";

// RFC 8785 §3.2.2 sample and the §3.2.4 canonical UTF-8 bytes.
const RFC8785_SAMPLE: PlainData = {
  numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
  string: "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/",
  literals: [null, true, false],
};
const RFC8785_CANONICAL_HEX =
  "7b226c69746572616c73223a5b6e756c6c2c747275652c66616c73655d2c" +
  "226e756d62657273223a5b3333333333333333332e333333333333332c31" +
  "652b33302c342e352c302e3030322c31652d32375d2c22737472696e6722" +
  "3a22e282ac245c75303030665c6e4127425c225c5c5c5c5c222f227d";
// FNV-1a 64-bit of those bytes, from an independent reference implementation.
const RFC8785_CANONICAL_HASH = "7b377df9dfa5a295";

// RFC 8785 Appendix B table (26 entries: 24 finite numbers + NaN and Infinity).
function doubleFromHex(hex: string): number {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setBigUint64(0, BigInt("0x" + hex));
  return view.getFloat64(0);
}

const RFC8785_APPENDIX_B: readonly (readonly [string, string | null])[] = [
  ["0000000000000000", "0"],
  ["8000000000000000", "0"],
  ["0000000000000001", "5e-324"],
  ["8000000000000001", "-5e-324"],
  ["7fefffffffffffff", "1.7976931348623157e+308"],
  ["ffefffffffffffff", "-1.7976931348623157e+308"],
  ["4340000000000000", "9007199254740992"],
  ["c340000000000000", "-9007199254740992"],
  ["4430000000000000", "295147905179352830000"],
  ["7fffffffffffffff", null], // NaN
  ["7ff0000000000000", null], // Infinity
  ["44b52d02c7e14af5", "9.999999999999997e+22"],
  ["44b52d02c7e14af6", "1e+23"],
  ["44b52d02c7e14af7", "1.0000000000000001e+23"],
  ["444b1ae4d6e2ef4e", "999999999999999700000"],
  ["444b1ae4d6e2ef4f", "999999999999999900000"],
  ["444b1ae4d6e2ef50", "1e+21"],
  ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
  ["3eb0c6f7a0b5ed8d", "0.000001"],
  ["41b3de4355555553", "333333333.3333332"],
  ["41b3de4355555554", "333333333.33333325"],
  ["41b3de4355555555", "333333333.3333333"],
  ["41b3de4355555556", "333333333.3333334"],
  ["41b3de4355555557", "333333333.33333343"],
  ["becbf647612f3696", "-0.0000033333333333333333"],
  ["43143ff3c1cb0959", "1424953923781206.2"],
];

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function fnv1a64Oracle(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < bytes.length; i++) {
    hash = ((hash ^ BigInt(bytes[i]!)) * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

const WIDENED_STRING_FRAGMENTS: readonly string[] = [
  'quote"inside',
  "back\\slash",
  "control\b\t\n\f\r",
  "low\u0000\u001f",
  "del\u007f",
  "astral🚀🌟𝄞",
  "line\u2028sep\u2029",
  "euro\u20acé",
  "",
  '\\\\\"\"',
];

function makePlainData(random: () => number, depth: number): PlainData {
  const choice = random() % (depth <= 0 ? 4 : 6);
  if (choice === 0) return null;
  if (choice === 1) return (random() & 1) === 0;
  if (choice === 2) return (random() % 2000) / 4 - 250;
  if (choice === 3) {
    const frag = WIDENED_STRING_FRAGMENTS[random() % WIDENED_STRING_FRAGMENTS.length]!;
    return "s" + String(random() % 1000) + "_" + frag;
  }
  if (choice === 4) {
    const length = random() % 4;
    const items: PlainData[] = [];
    for (let i = 0; i < length; i++) items.push(makePlainData(random, depth - 1));
    return items;
  }
  const count = random() % 4;
  const record: { [key: string]: PlainData } = {};
  const keyPool = ["k0", "k1", "a", "A", "\u0001", "\r", "\u00e9"];
  for (let i = 0; i < count; i++) {
    record[keyPool[random() % keyPool.length]!] = makePlainData(random, depth - 1);
  }
  return record;
}

function drawList(surfaceRev: number): DrawList {
  return {
    tick: 0,
    width: 320,
    height: 200,
    marginCommands: [],
    commands: [
      {
        kind: "blit",
        source: { surface: 0 as SurfaceId, rev: surfaceRev },
        src: { x: 0, y: 0, w: 320, h: 200 },
        dst: { x: 0, y: 0, w: 320, h: 200 },
        key: null,
        tint: { r: -8, g: 0, b: 12 },
        alpha: 255,
        blend: "normal",
        iso2d: false,
      },
      { kind: "fill", rgb: { r: 0, g: 0, b: 0 } },
    ],
  };
}

test("canon serialises RFC 8785 literals and strings", () => {
  equal(canon(null), "null");
  equal(canon(true), "true");
  equal(canon(false), "false");
  equal(canon(""), '""');
  equal(canon("\b\t\n\f\r"), '"\\b\\t\\n\\f\\r"');
  equal(canon('"\\'), '"\\"\\\\"');
  equal(canon("/"), '"/"');
  equal(canon("\u20ac"), '"\u20ac"');
  equal(canon("\u0000\u001f"), '"\\u0000\\u001f"');
});

test("long escaped strings keep canonical bytes and reject invalid UTF-16", () => {
  for (const length of [126, 127, 128, 129, 4096]) {
    for (const suffix of ["\n", "\n\t\"\\\u0000", "\u00e9\u2028", "🚀"]) {
      const text = "x".repeat(length) + suffix;
      equal(canon(text), JSON.stringify(text), `length ${length}, suffix ${JSON.stringify(suffix)}`);
      equal(canon({ [text]: text }), `{${JSON.stringify(text)}:${JSON.stringify(text)}}`);
    }
    for (const suffix of ["\ud800", "\udc00", "\ud800x"]) {
      throws(() => canon("x".repeat(length) + suffix), TypeError);
      throws(() => canon({ ["x".repeat(length) + suffix]: 1 }), TypeError);
    }
  }
});

test("canon formats numbers per RFC 8785 Appendix B table and preserves hand-written cases", () => {
  for (const [hex, expected] of RFC8785_APPENDIX_B) {
    const val = doubleFromHex(hex);
    if (expected === null) {
      throws(() => canon(val), TypeError, `Appendix B hex ${hex} should throw TypeError`);
    } else {
      equal(canon(val), expected, `Appendix B hex ${hex}`);
    }
  }

  // Hand-written cases:
  equal(canon(0), "0");
  equal(canon(-0), "0");
  equal(canon({ a: -0 }), '{"a":0}');
  equal(canon(42), "42");
  equal(canon(3.14159), "3.14159");
  equal(canon(1e30), "1e+30");
  equal(canon(2e-3), "0.002");
  equal(canon(1e-27), "1e-27");
});

test("tagNonFinite and reviveNonFinite preserve non-finite numbers through canonical JSON", () => {
  equal(canon(tagNonFinite(NaN) as never), '{"t":"nan"}');
  equal(canon(tagNonFinite(Infinity) as never), '{"t":"inf"}');
  equal(canon(tagNonFinite(-Infinity) as never), '{"t":"-inf"}');
  equal(canon(tagNonFinite({ x: NaN }) as never), '{"x":{"t":"nan"}}');
  equal(canon(tagNonFinite({ pos: Infinity, neg: -Infinity }) as never), '{"neg":{"t":"-inf"},"pos":{"t":"inf"}}');
  equal(Number.isNaN(reviveNonFinite({ t: "nan" })), true);
  equal(reviveNonFinite({ t: "inf" }), Infinity);
  equal(reviveNonFinite({ t: "-inf" }), -Infinity);
  equal(reviveNonFinite(42), 42);
});

test("canon reproduces the RFC 8785 sample byte for byte", () => {
  deepEqual(utf8Encode(canon(RFC8785_SAMPLE)), hexToBytes(RFC8785_CANONICAL_HEX));
});

test("canon sorts keys by UTF-16 code unit", () => {
  equal(
    canon({ "\u20ac": "\u20ac", "\r": "cr", "1": "1", "\u0080": "c" }),
    '{"\\r":"cr","1":"1","\u0080":"c","\u20ac":"\u20ac"}',
  );
  equal(
    canon({
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\ud83d\ude00": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis",
    }),
    '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis","\u20ac":"Euro Sign","\ud83d\ude00":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
  );
});

test("canon is idempotent over generated plain data", () => {
  const random = makeRandom(0x9e3779b9);
  for (let i = 0; i < 300; i++) {
    const text = canon(makePlainData(random, 3));
    equal(canon(JSON.parse(text) as PlainData), text, `iteration ${i}`);
  }
});

test("canon keeps an own __proto__ key and pollutes nothing", () => {
  const value = JSON.parse('{"__proto__":{"polluted":true},"a":1}') as PlainData;
  const text = canon(value);
  equal(text, '{"__proto__":{"polluted":true},"a":1}');
  equal(canon(JSON.parse(text) as PlainData), text);
  const probe: { polluted?: unknown } = {};
  equal(probe.polluted, undefined);
});

class ArraySubclass<T = number> extends Array<T> {
  constructor(...items: T[]) {
    super(...items);
  }
}

test("canon rejects non-plain data with TypeError", () => {
  const cases: readonly (readonly [string, unknown])[] = [
    ["undefined", undefined],
    ["function", () => 1],
    ["symbol", Symbol("s")],
    ["bigint", 10n],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["Uint8Array", new Uint8Array([1, 2])],
    ["ArrayBuffer", new ArrayBuffer(4)],
    ["Map", new Map([["a", 1]])],
    ["Set", new Set([1])],
    ["Date", new Date(0)],
    ["class instance", new (class Holder { value = 1; })()],
    ["Array subclass instance", new ArraySubclass(1, 2)],
    ["sparse array", [1, , 3]],
    ["array property", Object.assign([1, 2], { extra: true })],
    ["accessor", { get value() { return 1; } }],
    ["lone high surrogate", "\ud800"],
    ["lone low surrogate", "\udc00"],
    ["high surrogate followed by non-low 'a'", "\ud800a"],
    ["high surrogate followed by high surrogate", "\ud800\ud800"],
    ["high surrogate followed by non-low bmp", "\ud800\ue000"],
    ["lone surrogate key", { "\ud800": 1 }],
    ["high surrogate followed by non-low 'a' key", { "\ud800a": 1 }],
    ["high surrogate followed by high surrogate key", { "\ud800\ud800": 1 }],
    ["high surrogate followed by non-low bmp key", { "\ud800\ue000": 1 }],
    ["lone high surrogate end (udbff)", "\udbff"],
    ["lone low surrogate end (udfff)", "\udfff"],
    ["lone high surrogate end (udbff) key", { "\udbff": 1 }],
    ["lone low surrogate end (udfff) key", { "\udfff": 1 }],
  ];
  for (const [label, value] of cases) {
    throws(() => canon(value as PlainData), TypeError, label);
  }

  const node: { self?: unknown } = {};
  node.self = node;
  throws(() => canon(node as unknown as PlainData), TypeError, "circular object");

  const circArr: unknown[] = [];
  circArr.push(circArr);
  throws(() => canon(circArr as PlainData), TypeError, "circular array");
});

test("canon rejects nesting beyond the deterministic depth bound", () => {
  let value: PlainData = 0;
  for (let depth = 0; depth <= CANON_MAX_DEPTH; depth++) value = { value };
  throws(
    () => canon(value),
    (error: unknown) =>
      error instanceof TypeError &&
      error.message === `canon: maximum nesting depth ${CANON_MAX_DEPTH} exceeded`,
  );
});

test("canon leaves DEL and line/paragraph separators unescaped", () => {
  equal(canon("\u007f"), '"\u007f"');
  equal(canon("\u2028"), '"\u2028"');
  equal(canon("\u2029"), '"\u2029"');
  equal(canon({ "\u007f": 1 }), '{"\u007f":1}');
  equal(canon({ "\u2028": 1 }), '{"\u2028":1}');
  equal(canon({ "\u2029": 1 }), '{"\u2029":1}');
  equal(canon("\udbff\udfff"), '"\udbff\udfff"');
  equal(canon({ "\udbff\udfff": 1 }), '{"\udbff\udfff":1}');
});

test("canon serialises shared non-circular references correctly", () => {
  const sharedObj = { x: 1 };
  const sharedArr = [1, 2];
  equal(
    canon({ a: sharedObj, b: sharedObj, c: sharedArr, d: sharedArr }),
    '{"a":{"x":1},"b":{"x":1},"c":[1,2],"d":[1,2]}',
  );
});

test("utf8Encode writes the expected bytes and rejects lone surrogates", () => {
  deepEqual(utf8Encode(""), new Uint8Array([]));
  deepEqual(utf8Encode("a"), new Uint8Array([0x61]));
  deepEqual(utf8Encode("\u0080"), new Uint8Array([0xc2, 0x80]));
  deepEqual(utf8Encode("\u20ac"), new Uint8Array([0xe2, 0x82, 0xac]));
  deepEqual(utf8Encode("\ud83d\ude00"), new Uint8Array([0xf0, 0x9f, 0x98, 0x80]));
  throws(() => utf8Encode("\ud800"), TypeError);
  throws(() => utf8Encode("\udc00"), TypeError);
  throws(() => utf8Encode("\ud800a"), TypeError);
  throws(() => utf8Encode("\ud800\ud800"), TypeError);
  throws(() => utf8Encode("\ud800\ue000"), TypeError);
});

test("utf8Encode matches TextEncoder across all scalar values and boundaries", () => {
  const encoder = new TextEncoder();
  const boundaries = [0x7f, 0x80, 0x7ff, 0x800, 0xffff, 0x10000, 0x10ffff];
  for (const cp of boundaries) {
    const str = String.fromCodePoint(cp);
    deepEqual(utf8Encode(str), encoder.encode(str), `boundary 0x${cp.toString(16)}`);
  }

  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const str = String.fromCodePoint(cp);
    const actual = utf8Encode(str);
    const expected = encoder.encode(str);
    equal(actual.length, expected.length);
    for (let j = 0; j < actual.length; j++) {
      equal(actual[j], expected[j]);
    }
  }
});

test("utf8Decode round-trips scalar values and rejects malformed or incomplete sequences", () => {
  const sample = "ascii \u0080 \u07ff \u0800 \ud7ff \ue000 \uffff \ud83d\ude00";
  deepEqual(utf8Decode(utf8Encode(sample)), sample);
  for (const invalid of [
    [0x80],
    [0xc0, 0x80],
    [0xe0, 0x80, 0x80],
    [0xed, 0xa0, 0x80],
    [0xf0, 0x80, 0x80, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
    [0xf5, 0x80, 0x80, 0x80],
    [0xe2, 0x82],
    [0xf0, 0x9f, 0x98],
  ]) throws(() => utf8Decode(new Uint8Array(invalid)), TypeError);
});

test("fnv1a64 matches the FNV-1a 64-bit vectors", () => {
  equal(fnv1a64(""), "cbf29ce484222325");
  equal(fnv1a64("a"), "af63dc4c8601ec8c");
  equal(fnv1a64("foobar"), "85944171f73967e8");
  equal(fnv1a64(new Uint8Array([0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72])), "85944171f73967e8");
  equal(fnv1a64(canon(RFC8785_SAMPLE)), RFC8785_CANONICAL_HASH);
});

test("the 32-bit-limb hasher agrees with the BigInt oracle over TextEncoder bytes", () => {
  const encoder = new TextEncoder();
  const random = makeRandom(0x12345678);
  for (let i = 0; i < 500; i++) {
    const bytes = new Uint8Array(random() % 64);
    for (let j = 0; j < bytes.length; j++) bytes[j] = random() & 0xff;
    equal(fnv1a64(bytes), fnv1a64Oracle(bytes), `bytes ${i}`);
  }
  for (let i = 0; i < 200; i++) {
    const text = "s" + String(random() % 1000000) + "\u20ac\ud83d\ude00\u00f6";
    equal(fnv1a64(text), fnv1a64Oracle(encoder.encode(text)), `text ${i}`);
  }
});

test("hashState hashes the canonical form and ignores key order", () => {
  const state: PlainData = { b: [1, 2, { c: "x" }], a: true };
  equal(hashState(state), fnv1a64(canon(state)));
  equal(hashState(state), hashState({ a: true, b: [1, 2, { c: "x" }] }));
});

test("hashState matches fixed external Python vector", () => {
  const state: PlainData = {
    active: true,
    player: { hp: 100, name: "Hero" },
    tick: 10,
  };
  const expectedCanon = '{"active":true,"player":{"hp":100,"name":"Hero"},"tick":10}';
  equal(canon(state), expectedCanon);
  equal(hashState(state), "32ea6801e5683996");
});

test("hashState matches fixed external Python vector with escapes and non-ASCII", () => {
  const state: PlainData = { text: "caf\u00e9 \u20ac \ud83d\ude00 \n" };
  const expectedCanon = '{"text":"caf\u00e9 \u20ac \ud83d\ude00 \\n"}';
  equal(canon(state), expectedCanon);
  equal(hashState(state), "fe8addec17d18c0b");
});

test("hashDrawList covers surface revs and is stable", () => {
  equal(hashDrawList(drawList(0)), fnv1a64(canon(drawList(0))));
  equal(hashDrawList(drawList(0)), hashDrawList(drawList(0)));
  equal(hashDrawList(drawList(0)) !== hashDrawList(drawList(1)), true);
});

test("hashDrawList matches fixed external Python vector", () => {
  const dl: DrawList = {
    tick: 1,
    width: 320,
    height: 240,
    marginCommands: [],
    commands: [
      {
        kind: "fill",
        rgb: { r: 0, g: 0, b: 0 },
      },
      {
        kind: "blit",
        source: { surface: 1 as SurfaceId, rev: 3 },
        src: { x: 0, y: 0, w: 16, h: 16 },
        dst: { x: 32, y: 64, w: 16, h: 16 },
        key: null,
        tint: { r: 0, g: 0, b: 0 },
        alpha: 255,
        blend: "normal",
        iso2d: false,
      },
    ],
  };
  const expectedCanon =
    '{"commands":[{"kind":"fill","rgb":{"b":0,"g":0,"r":0}},{"alpha":255,"blend":"normal","dst":{"h":16,"w":16,"x":32,"y":64},"iso2d":false,"key":null,"kind":"blit","source":{"rev":3,"surface":1},"src":{"h":16,"w":16,"x":0,"y":0},"tint":{"b":0,"g":0,"r":0}}],"height":240,"marginCommands":[],"tick":1,"width":320}';
  equal(canon(dl), expectedCanon);
  equal(hashDrawList(dl), "649ff89c98f2fdae");
});

test("encodeLog writes a lowercase-hex tag for bytes", () => {
  equal(canon(encodeLog(new Uint8Array([0xde, 0xad]))), '{"hex":"dead","t":"bytes"}');
});

test("canon rejects a log that still holds raw bytes", () => {
  throws(() => canon([new Uint8Array([1])] as unknown as PlainData), TypeError);
});

test("encodeLog refuses non-plain records instead of emptying them", () => {
  throws(() => encodeLog(new Map([["a", 1]]) as unknown as PortData), TypeError);
  throws(() => encodeLog(new (class Holder { value = 1; })() as unknown as PortData), TypeError);
});

test("a log round-trips through encodeLog, canon and decodeLog", () => {
  const log: PortData = [
    { tick: 0, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down: true } },
    { tick: 4, event: { kind: "asset", reqId: 1, bytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) } },
    { tick: 9, event: { kind: "blob.loaded", reqId: 2, bytes: null } },
    { tick: 9, event: { kind: "blob.listed", reqId: 3, names: ["a", "b"] } },
    { tick: 12, event: { kind: "audio.ended", cueId: 7 } },
  ];
  const text = canon(encodeLog(log));
  deepEqual(decodeLog(JSON.parse(text) as PlainData), log);
});

test("an explicit null survives the log and differs from an absent key", () => {
  // An absent value is written `null`; an omitted key is not the same record.
  equal(canon({ char: null }) !== canon({}), true);

  const withNull: PortData = [
    { tick: 0, event: { kind: "key", name: "A", code: "KeyA", char: null, down: true } },
  ];
  const absent: PortData = [
    { tick: 0, event: { kind: "key", name: "A", code: "KeyA", down: true } },
  ];
  equal(canon(encodeLog(withNull)) !== canon(encodeLog(absent)), true);

  const roundTripped = decodeLog(JSON.parse(canon(encodeLog(withNull)))) as {
    event: { char: unknown };
  }[];
  equal(roundTripped[0]!.event.char, null);
  deepEqual(roundTripped, withNull);
});

test("decodeLog names the dotted path of a malformed payload", () => {
  function messageOf(value: PlainData): string {
    try {
      decodeLog(value);
    } catch (error) {
      return (error as Error).message;
    }
    return "";
  }

  equal(
    messageOf({ event: { bytes: { t: "bytes", hex: "zz" } } }),
    "decodeLog: at event.bytes: invalid hex digit",
  );
  equal(
    messageOf({ event: { bytes: { t: "bytes", hex: "abc" } } }),
    "decodeLog: at event.bytes: odd-length hex string",
  );
  equal(
    messageOf([{ event: { bytes: { t: "bytes", hex: "zz" } } }]),
    "decodeLog: at [0].event.bytes: invalid hex digit",
  );
  // A failure at the value's own root keeps the plain message.
  equal(messageOf({ t: "bytes", hex: "zz" }), "decodeLog: invalid hex digit");
  equal(messageOf({ t: "bytes", hex: "abc" }), "decodeLog: odd-length hex string");
});

test("encodeLog and decodeLog round-trip own __proto__ keys without prototype pollution", () => {
  const primitiveProto = JSON.parse('{"__proto__":"primitive","data":1}') as PortData;
  const objectProto = JSON.parse('{"__proto__":{"nested":true},"data":2}') as PortData;
  const log: PortData = [primitiveProto, objectProto];

  const roundTripped = decodeLog(JSON.parse(canon(encodeLog(log)))) as PortData[];
  deepEqual(roundTripped, log);

  const [rec1, rec2] = roundTripped;
  equal(Object.prototype.hasOwnProperty.call(rec1, "__proto__"), true);
  equal(Object.prototype.hasOwnProperty.call(rec2, "__proto__"), true);
  equal(Object.getPrototypeOf(rec1), Object.prototype);
  equal(Object.getPrototypeOf(rec2), Object.prototype);
});

test("encodeLog throws TypeError on records that would collide with the bytes tag", () => {
  throws(() => encodeLog({ t: "bytes", hex: "zz" }), TypeError);
  throws(() => encodeLog({ t: "bytes", hex: "dead" }), TypeError);

  const nonColliding1: PortData = { t: "bytes", hex: "dead", extra: 1 };
  const nonColliding2: PortData = { t: "other", hex: "dead" };

  deepEqual(decodeLog(JSON.parse(canon(encodeLog(nonColliding1)))), nonColliding1);
  deepEqual(decodeLog(JSON.parse(canon(encodeLog(nonColliding2)))), nonColliding2);
});

test("log codec handles all byte values, subarray views and decode errors", () => {
  const allBytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) allBytes[i] = i;

  const emptyBytes = new Uint8Array(0);

  const backing = new Uint8Array([10, 20, 30, 40, 50]);
  const view = backing.subarray(1, 4);

  const testPayloads: readonly (readonly [string, Uint8Array])[] = [
    ["all 256 bytes", allBytes],
    ["empty bytes", emptyBytes],
    ["subarray view", view],
  ];

  for (const [label, bytes] of testPayloads) {
    const original: PortData = { bytes };
    const encoded = encodeLog(original);
    const decoded = decodeLog(JSON.parse(canon(encoded)) as PlainData) as { bytes: Uint8Array };
    deepEqual(decoded.bytes, bytes, `${label} content matches`);
    equal(decoded.bytes.byteOffset, 0, `${label} byteOffset is 0`);
    equal(decoded.bytes.buffer.byteLength, bytes.length, `${label} owns its whole buffer`);
  }

  throws(() => decodeLog({ t: "bytes", hex: "abc" }), TypeError, "odd-length hex");
  throws(() => decodeLog({ t: "bytes", hex: "zz" }), TypeError, "invalid digit");
  throws(() => decodeLog({ t: "bytes", hex: "DEAD" }), TypeError, "uppercase hex");
  deepEqual(decodeLog({ t: "bytes", hex: 5 } as PlainData), { t: "bytes", hex: 5 });
});

test("decodeLog preserves sparse-array length and holes", () => {
  const sparse: PlainData[] = [1];
  sparse[3] = 2;

  const decoded = decodeLog(sparse) as PlainData[];
  equal(decoded.length, 4);
  equal(0 in decoded, true, "index 0 present");
  equal(1 in decoded, false, "index 1 is a hole");
  equal(2 in decoded, false, "index 2 is a hole");
  equal(3 in decoded, true, "index 3 present");
  equal(decoded[0], 1);
  equal(decoded[3], 2);
});
