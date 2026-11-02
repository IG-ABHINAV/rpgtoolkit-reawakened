// The owner's fallback order for instruments a bank lacks (docs/spec/engine/audio-media.md#midi-bank-fallback, issue
// #1074), checked on the pure rule and, through SpessaSynth, on what actually plays. SpessaSynth's own choice differs
// (it may take another bank's program, the first preset it lists, or any drum preset, and it never goes silent), so the
// wrapper hands it an exact bank and program; these tests fail if that stops being true.

import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { bankPresetTable, describePatchGap, missingPatches, resolvePatch, SpessaSynthMidiSynth } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const full = new Uint8Array(readFileSync(resolve(here, "..", "..", "..", "media", "soundfonts", "TK-16.sf2")));

/** A copy of a SoundFont in which only the listed presets stay addressable (the rest move to an unreachable bank). */
function partialBank(keep: readonly (readonly [number, number])[]): Uint8Array {
  const bytes = full.slice();
  const view = new DataView(bytes.buffer);
  const walk = (from: number, to: number): void => {
    let at = from;
    while (at + 8 <= to) {
      const tag = String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
      const size = view.getUint32(at + 4, true);
      if (tag === "LIST") walk(at + 12, at + 8 + size);
      else if (tag === "phdr") {
        for (let i = 0; i < Math.floor(size / 38) - 1; i++) {
          const record = at + 8 + i * 38;
          const program = view.getUint16(record + 20, true);
          const bank = view.getUint16(record + 22, true);
          if (!keep.some(([b, p]) => b === bank && p === program)) view.setUint16(record + 22, 999, true);
        }
      }
      at += 8 + size + (size & 1);
    }
  };
  walk(12, bytes.length);
  return bytes;
}

/** A one-note Standard MIDI File: optional bank select and program change on a channel, then middle C for one second. */
function oneNote(channel: number, program: number | null, bank: number | null, key = 60): Uint8Array {
  const body: number[] = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20];
  if (bank !== null) body.push(0, 0xb0 | channel, 0, bank);
  if (program !== null) body.push(0, 0xc0 | channel, program);
  body.push(0, 0x90 | channel, key, 100, 0x83, 0x60, 0x80 | channel, key, 0, 0, 0xff, 0x2f, 0);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  const track = [0x4d, 0x54, 0x72, 0x6b, (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255];
  return Uint8Array.from([...header, ...track, ...body]);
}

const RATE = 22_050;
/** A quarter of a second of the first channel, rendered through the real wrapper with the given bank. */
function play(bank: Uint8Array, midi: Uint8Array): Float32Array {
  const opened = new SpessaSynthMidiSynth({ bank }).open(midi, { outputRateHz: RATE, bank: { source: "bundled", id: "test", sha256: null } });
  ok(opened.ok, "the voice opens");
  const voice = opened.value;
  voice.setVolume(100);
  voice.start(0, false);
  const left = new Float32Array(RATE / 4);
  voice.render(left, new Float32Array(left.length), left.length);
  return left;
}
const energy = (x: Float32Array): number => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const distance = (a: Float32Array, b: Float32Array): number => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]!) ** 2, 0) / a.length) / (energy(a) || 1);

test("the fallback rule: melodic goes requested, same program in bank 0, program 0 of bank 0, then silence", () => {
  const set = (...presets: string[]): ReadonlySet<string> => new Set(presets);
  const ask = (bank: number, program: number) => ({ percussion: false, bank, program });
  deepEqual(resolvePatch(ask(1, 24), set("1:24", "0:24", "0:0")), { kind: "exact", bank: 1, program: 24 });
  deepEqual(resolvePatch(ask(1, 24), set("0:24", "0:0")), { kind: "substitute", bank: 0, program: 24 });
  deepEqual(resolvePatch(ask(1, 24), set("0:0", "2:24")), { kind: "substitute", bank: 0, program: 0 });
  deepEqual(resolvePatch(ask(1, 24), set("2:24", "0:7")), { kind: "silent" });
});

test("the fallback rule: percussion goes requested kit, kit 0, then silence, and never a melodic preset", () => {
  const set = (...presets: string[]): ReadonlySet<string> => new Set(presets);
  const kit = (program: number) => ({ percussion: true, bank: 128, program });
  deepEqual(resolvePatch(kit(16), set("128:16", "128:0")), { kind: "exact", bank: 128, program: 16 });
  deepEqual(resolvePatch(kit(16), set("128:0", "0:0")), { kind: "substitute", bank: 128, program: 0 });
  deepEqual(resolvePatch(kit(16), set("0:0", "0:16")), { kind: "silent" });
});

test("TK-16 has presets (0, 0..127) and the kit (128, 0), so it needs no substitute for a full General MIDI file", () => {
  const table = bankPresetTable(full);
  equal(table.size, 129);
  for (let program = 0; program < 128; program++) ok(table.has(`0:${program}`));
  ok(table.has("128:0"));
  deepEqual(missingPatches(oneNote(0, 99, null), full), []);
  deepEqual(missingPatches(oneNote(9, 40, null), full).map((d) => d.request.program), [40], "a kit program the bank lacks is reported");
});

test("what plays: a missing program takes program 0, a missing bank takes bank 0, a missing kit takes kit 0", () => {
  const bank = partialBank([[0, 0], [0, 24], [128, 0]]);
  const piano = play(full, oneNote(0, 0, null));
  const guitar = play(full, oneNote(0, 24, null));
  const kit = play(full, oneNote(9, null, null, 38));
  ok(distance(piano, guitar) > 0.5, "the references really differ");
  ok(distance(play(bank, oneNote(0, 48, null)), piano) < 0.02, "program 48 is missing: bank 0 program 0 plays");
  ok(distance(play(bank, oneNote(0, 24, 1)), guitar) < 0.02, "bank 1 program 24 is missing: bank 0 program 24 plays");
  ok(distance(play(bank, oneNote(0, 99, 1)), piano) < 0.02, "nothing in bank 1: bank 0 program 0 plays");
  ok(distance(play(bank, oneNote(9, 16, null, 38)), kit) < 0.02, "kit 16 is missing: kit 0 plays");
  ok(distance(play(bank, oneNote(0, 24, null)), guitar) < 0.02, "a program the bank has is untouched");
});

test("what plays: silent only when nothing qualifies (SpessaSynth would play another preset here)", () => {
  const noKit = partialBank([[0, 0], [0, 24]]);
  ok(energy(play(noKit, oneNote(9, 0, null, 38))) < 1e-5, "no kit at all: the drum channel is silent");
  const noDefault = partialBank([[0, 24], [128, 0]]);
  ok(energy(play(noDefault, oneNote(0, 48, null))) < 1e-5, "no program 48 and no bank 0 program 0: silent");
  ok(energy(play(noDefault, oneNote(0, 24, null))) > 0.005, "a channel that does resolve still plays");
});

test("a channel that never sends a program change asks for program 0", () => {
  const withoutDefault = partialBank([[0, 24], [128, 0]]);
  const asked = missingPatches(oneNote(0, null, null), withoutDefault);
  deepEqual(asked.map((d) => [d.request.bank, d.request.program, d.resolution.kind]), [[0, 0, "silent"]]);
});

test("the log line gives the raw 0-127 values, labelled, and says what plays instead", () => {
  const line = describePatchGap({
    bankId: "media/soundfonts/test.sf2",
    sha256: "ab".repeat(32),
    request: { percussion: false, bank: 0, program: 48 },
    substitute: { bank: 0, program: 0 },
    asset: "media/theme.mid",
  });
  ok(line.includes("program 48 (0-based; GM program 49)"), line);
  ok(line.includes("bank 0 program 0 plays instead") && line.includes("media/theme.mid") && line.includes("abababababab"), line);
  ok(describePatchGap({ bankId: "b", sha256: "00".repeat(32), request: { percussion: true, bank: 128, program: 16 }, substitute: null, asset: "a.mid" }).includes("silent"));
});
