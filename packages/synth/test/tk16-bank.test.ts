// The TK-16 banks as built (issue #1074; docs/spec/engine/audio-media.md#path-c-bank). The old tests only asserted that
// the bank loads and is not silent, which is how a bank with unlooped-cycle loops, one root key and 16 programs shipped.
// These read the SoundFont's own tables for what must hold of every bank, and render through SpessaSynth for what only
// the synth can show. Set TK16_BANK_DIR to point them at a different folder (used to prove each test fails on its defect).

import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SoundBankLoader, SpessaSynthProcessor } from "spessasynth_core";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
// `process` exists at runtime; the test project is typed without Node globals, so declare just what is read.
declare const process: { readonly env: Record<string, string | undefined> };
const bankDir = process.env["TK16_BANK_DIR"] ?? resolve(root, "media", "soundfonts");
const BANKS = ["TK-16.sf2", "TK-16-Whimsical.sf2", "TK-16-Arcade.sf2"];

interface Sf2 {
  readonly presets: { name: string; preset: number; bank: number; bag: number }[];
  readonly pbag: number[];
  readonly pgen: { op: number; amount: number }[];
  readonly insts: { name: string; bag: number }[];
  readonly ibag: number[];
  readonly igen: { op: number; amount: number }[];
  readonly shdr: { name: string; start: number; end: number; loopStart: number; loopEnd: number; rate: number; root: number; cents: number }[];
  readonly pcm: Int16Array;
}

function parse(bytes: Uint8Array): Sf2 {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number): string => String.fromCharCode(...bytes.subarray(at, at + length));
  const chunks = new Map<string, Uint8Array>();
  const walk = (from: number, to: number): void => {
    let at = from;
    while (at + 8 <= to) {
      const tag = text(at, 4);
      const size = view.getUint32(at + 4, true);
      if (tag === "LIST") walk(at + 12, at + 8 + size);
      else chunks.set(tag, bytes.subarray(at + 8, at + 8 + size));
      at += 8 + size + (size & 1);
    }
  };
  walk(12, bytes.length);
  const need = (tag: string): Uint8Array => chunks.get(tag) ?? new Uint8Array(0);
  const records = <T>(tag: string, size: number, read: (v: DataView, o: number) => T): T[] => {
    const b = need(tag);
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return Array.from({ length: Math.floor(b.length / size) }, (_, i) => read(v, i * size));
  };
  const name = (v: DataView, o: number): string => {
    let out = "";
    for (let i = 0; i < 20 && v.getUint8(o + i) !== 0; i++) out += String.fromCharCode(v.getUint8(o + i));
    return out;
  };
  const smpl = need("smpl");
  return {
    presets: records("phdr", 38, (v, o) => ({ name: name(v, o), preset: v.getUint16(o + 20, true), bank: v.getUint16(o + 22, true), bag: v.getUint16(o + 24, true) })),
    pbag: records("pbag", 4, (v, o) => v.getUint16(o, true)),
    pgen: records("pgen", 4, (v, o) => ({ op: v.getUint16(o, true), amount: v.getInt16(o + 2, true) })),
    insts: records("inst", 22, (v, o) => ({ name: name(v, o), bag: v.getUint16(o + 20, true) })),
    ibag: records("ibag", 4, (v, o) => v.getUint16(o, true)),
    igen: records("igen", 4, (v, o) => ({ op: v.getUint16(o, true), amount: v.getInt16(o + 2, true) })),
    shdr: records("shdr", 46, (v, o) => ({
      name: name(v, o), start: v.getUint32(o + 20, true), end: v.getUint32(o + 24, true), loopStart: v.getUint32(o + 28, true), loopEnd: v.getUint32(o + 32, true),
      rate: v.getUint32(o + 36, true), root: v.getUint8(o + 40), cents: v.getInt8(o + 41),
    })),
    pcm: new Int16Array(smpl.buffer.slice(smpl.byteOffset, smpl.byteOffset + smpl.length)),
  };
}

const GEN = { keyRange: 43, sample: 53, mode: 54, coarse: 51, scale: 56, release: 38 } as const;
const loaded = new Map<string, { bytes: Uint8Array; sf2: Sf2 }>();
function bank(file: string): { bytes: Uint8Array; sf2: Sf2 } {
  let hit = loaded.get(file);
  if (!hit) {
    const bytes = readFileSync(resolve(bankDir, file));
    hit = { bytes, sf2: parse(bytes) };
    loaded.set(file, hit);
  }
  return hit;
}

/** Zones of one instrument as generator maps. */
function zones(sf2: Sf2, instrument: string): Map<number, number>[] {
  const index = sf2.insts.findIndex((i) => i.name === instrument);
  ok(index >= 0, `instrument ${instrument} exists`);
  const first = sf2.insts[index]!.bag;
  const last = sf2.insts[index + 1]!.bag;
  const out: Map<number, number>[] = [];
  for (let bag = first; bag < last; bag++) {
    const map = new Map<number, number>();
    for (let g = sf2.ibag[bag]!; g < sf2.ibag[bag + 1]!; g++) map.set(sf2.igen[g]!.op, sf2.igen[g]!.amount);
    out.push(map);
  }
  return out;
}

const keyHz = (key: number): number => 440 * 2 ** ((key - 69) / 12);
const loopedSamples = (sf2: Sf2) => sf2.shdr.slice(0, -1).filter((s) => s.loopEnd > s.loopStart);

for (const file of BANKS) {
  test(`${file}: presets (0, 0..127) and the kit (128, 0) all exist`, () => {
    const { sf2 } = bank(file);
    const have = new Set(sf2.presets.map((p) => `${p.bank}:${p.preset}`));
    for (let program = 0; program < 128; program++) ok(have.has(`0:${program}`), `program ${program}`);
    ok(have.has("128:0"), "percussion kit");
    // Each melodic preset must point at a real instrument.
    for (let p = 0; p < 128; p++) {
      const gens = sf2.pgen.slice(sf2.pbag[sf2.presets[p]!.bag]!, sf2.pbag[sf2.presets[p]!.bag + 1]!);
      ok(gens.some((g) => g.op === 41 && g.amount < sf2.insts.length - 1), `program ${p} has an instrument`);
    }
  });

  test(`${file}: every loop is whole cycles in whole 16-frame blocks, and joins no harder than the wave moves`, () => {
    const { sf2 } = bank(file);
    const looped = loopedSamples(sf2);
    ok(looped.length >= 45, "the melodic zones are looped");
    for (const s of looped) {
      const length = s.loopEnd - s.loopStart;
      equal(length % 16, 0, `${s.name}: loop of ${length} frames`);
      const wave = Array.from(sf2.pcm.subarray(s.loopStart, s.loopEnd));
      const largestStep = Math.max(...wave.slice(1).map((v, i) => Math.abs(v - wave[i]!)));
      const join = Math.abs(wave[0]! - wave[wave.length - 1]!);
      // One 8-bit step of slack (256 of 32768) covers the banks' deliberate word-length reduction and dither; a real seam
      // (the old shared 64-960 loop) jumps by thousands.
      ok(join <= largestStep + 256, `${s.name}: join jumps ${join}, the wave itself moves at most ${largestStep}`);
    }
  });

  test(`${file}: each loop plays its written note (rate / period within 1 cent of the root key)`, () => {
    const { sf2 } = bank(file);
    const provenance = JSON.parse(readFileSync(resolve(root, "tools", "licences", "tk16-provenance.json"), "utf8")) as {
      banks: { file: string; samples: { name: string; periodFrames?: number; loopCycles?: number }[] }[];
    };
    const record = provenance.banks.find((b) => b.file.endsWith(`/${file}`));
    ok(record, "the provenance manifest lists this bank");
    const periods = new Map(record.samples.map((s) => [s.name, s]));
    for (const s of loopedSamples(sf2)) {
      const info = periods.get(s.name);
      ok(info?.periodFrames !== undefined && info.loopCycles !== undefined, `${s.name} has period data`);
      const period = info.periodFrames!;
      equal((s.loopEnd - s.loopStart) % (period * info.loopCycles!), 0, `${s.name}: loop holds whole cycles of the waveform`);
      const actualHz = s.rate / period;
      const cents = 1200 * Math.log2(actualHz / keyHz(s.root));
      ok(Math.abs(cents) <= 1, `${s.name}: ${cents.toFixed(2)} cents from root key ${s.root}`);
    }
    // The old defect: every sample claimed root 60. Roots must differ across the keyboard.
    const roots = new Set(loopedSamples(sf2).map((s) => s.root));
    ok(roots.size >= 4, `roots vary (${[...roots].sort().join(",")})`);
  });

  test(`${file}: the kit has a distinct one-shot sound on every key 35-81`, () => {
    const { sf2 } = bank(file);
    const kit = zones(sf2, "TK Drums");
    const sampleForKey = new Map<number, number>();
    for (const zone of kit) {
      const range = zone.get(GEN.keyRange)!;
      const lo = range & 0xff;
      const hi = (range >> 8) & 0xff;
      equal(lo, hi, "one key per zone");
      equal(zone.get(GEN.mode) ?? 0, 0, `key ${lo} does not loop`);
      sampleForKey.set(lo, zone.get(GEN.sample)!);
    }
    for (let key = 35; key <= 81; key++) ok(sampleForKey.has(key), `key ${key} is mapped`);
    equal(sampleForKey.size, 47, "no keys outside 35-81");
    // Different named sounds are different samples, not one sample at another pitch (the old kit was one for all).
    for (const group of [[35, 36], [38, 40], [42, 44, 46], [49, 52, 55], [51, 53], [60, 62, 65], [67, 69, 70], [71, 73, 78], [80, 81]]) {
      const ids = new Set(group.map((k) => sampleForKey.get(k)));
      equal(ids.size, group.length, `keys ${group.join(", ")} are different sounds`);
    }
    // Every one-shot makes sound and ends on its own within 2.5 s even at the lowest tom pitch.
    for (const zone of kit) {
      const key = zone.get(GEN.keyRange)! & 0xff;
      const s = sf2.shdr[zone.get(GEN.sample)!]!;
      const peak = Math.max(...Array.from(sf2.pcm.subarray(s.start, s.end), Math.abs));
      ok(peak > 2000, `key ${key} is not silent`);
      const scale = (zone.get(GEN.scale) ?? 100) / 100;
      const semitones = (zone.get(GEN.coarse) ?? 0) + (key - s.root) * scale;
      const seconds = (s.end - s.start) / (s.rate * 2 ** (semitones / 12));
      ok(seconds < 2.5, `key ${key} lasts ${seconds.toFixed(2)} s`);
    }
  });
}

// --- rendered through SpessaSynth ------------------------------------------------------------------------------------

const SR = 22_050;
const BUF = 128;
function synth(file: string): SpessaSynthProcessor {
  const { bytes } = bank(file);
  const processor = new SpessaSynthProcessor(SR, { maxBufferSize: BUF, effectsEnabled: false, eventsEnabled: false });
  processor.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer), "tk");
  return processor;
}
function render(processor: SpessaSynthProcessor, seconds: number): Float32Array {
  const total = Math.floor(seconds * SR);
  const out = new Float32Array(total);
  const left = new Float32Array(BUF);
  const right = new Float32Array(BUF);
  for (let at = 0; at < total; at += BUF) {
    const count = Math.min(BUF, total - at);
    left.fill(0);
    right.fill(0);
    processor.process(left, right, 0, count);
    for (let i = 0; i < count; i++) out[at + i] = (left[i]! + right[i]!) / 2;
  }
  return out;
}
const rms = (x: Float32Array): number => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / Math.max(1, x.length));
const db = (a: number, b: number): number => 20 * Math.log10(a / b);

/** Frequency of the strongest partial within +-60 cents of the written note, by a windowed single-bin scan. */
function peakCents(x: Float32Array, key: number): number {
  const f0 = keyHz(key);
  let best = -1;
  let at = 0;
  for (let c = -60; c <= 60; c++) {
    const w = (2 * Math.PI * f0 * 2 ** (c / 1200)) / SR;
    let re = 0;
    let im = 0;
    for (let i = 0; i < x.length; i++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / x.length);
      re += x[i]! * hann * Math.cos(w * i);
      im += x[i]! * hann * Math.sin(w * i);
    }
    const m = Math.hypot(re, im);
    if (m > best) {
      best = m;
      at = c;
    }
  }
  return at;
}

// One program for each melodic timbre that has a pitch. The noise timbre (programs 120-127) is exempt: it has no pitch.
const FAMILIES: [number, string][] = [[0, "piano"], [4, "electric piano"], [16, "organ"], [24, "guitar"], [48, "strings"], [56, "brass"], [73, "flute"], [80, "synth"]];

test("TK-16 plays the written note: each family within 5 cents at notes 60, 64 and 72 (rendered)", () => {
  for (const [program, family] of FAMILIES) {
    for (const key of [60, 64, 72]) {
      const processor = synth("TK-16.sf2");
      processor.programChange(0, program);
      processor.noteOn(0, key, 100);
      render(processor, 0.02);
      // Measured before vibrato starts (its delay is at least 0.18 s) so only the loop's tuning is judged.
      const cents = peakCents(render(processor, 0.16), key);
      ok(Math.abs(cents) <= 5, `${family} (program ${program}) at key ${key} is ${cents} cents off`);
    }
  }
});

test("TK-16 envelopes: struck and plucked families decay, held families sustain (rendered)", () => {
  const level = (program: number, from: number, length: number): number => {
    const processor = synth("TK-16.sf2");
    processor.programChange(0, program);
    processor.noteOn(0, 60, 100);
    render(processor, from);
    return rms(render(processor, length));
  };
  for (const [program, family] of [[0, "piano"], [24, "guitar"], [8, "celesta"], [46, "harp"]] as const) {
    const early = level(program, 0.05, 0.1);
    const late = level(program, 0.95, 0.1);
    ok(db(early, late) >= 12, `${family} falls ${db(early, late).toFixed(1)} dB between 0.1 s and 1.0 s`);
  }
  for (const [program, family] of [[16, "organ"], [48, "strings"], [88, "pad"]] as const) {
    // After the swell: the pad takes about a second to open, so judge sustain at 1.2 s against 2.4 s.
    const early = level(program, 1.2, 0.1);
    const late = level(program, 2.4, 0.1);
    ok(Math.abs(db(early, late)) < 6, `${family} holds: ${db(early, late).toFixed(1)} dB between 1.2 s and 2.4 s`);
  }
});

test("TK-16 kit: keys sound different, end on their own, and answer velocity (rendered)", () => {
  const hit = (key: number, velocity: number, seconds: number): Float32Array => {
    const processor = synth("TK-16.sf2");
    processor.noteOn(9, key, velocity);
    return render(processor, seconds);
  };
  const kick = hit(36, 110, 0.4);
  const snare = hit(38, 110, 0.4);
  const hat = hit(42, 110, 0.4);
  ok(rms(kick) > 0.001 && rms(snare) > 0.001 && rms(hat) > 0.001, "all sound");
  const correlation = (a: Float32Array, b: Float32Array): number => {
    let ab = 0;
    for (let i = 0; i < a.length; i++) ab += a[i]! * b[i]!;
    return Math.abs(ab) / (Math.sqrt(a.reduce((s, v) => s + v * v, 0)) * Math.sqrt(b.reduce((s, v) => s + v * v, 0)) + 1e-12);
  };
  ok(correlation(kick, snare) < 0.5 && correlation(snare, hat) < 0.5, "kick, snare and hat are not one sample at three pitches");
  const open = hit(46, 110, 2.0);
  ok(rms(open.subarray(open.length - 2205)) < 0.001, "an open hat ends without a note off");
  ok(rms(hit(38, 110, 0.3)) > rms(hit(38, 30, 0.3)) * 1.5, "a harder hit is louder");
});
