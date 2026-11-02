// The three authored pieces (fixtures/pieces, CC0) through the three TK-16 banks. Each piece is written for one bank's
// strengths, so these tests hold them to what must be true of any piece in any bank: it parses and stays inside the
// kit and the playable range, it sounds, it does not clip, it renders the same twice, and the banks differ.

import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { BasicMIDI, SoundBankLoader, SpessaSynthProcessor } from "spessasynth_core";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const PIECES = ["1-classic-departure", "2-whimsical-mushroom-market", "3-arcade-boss-rush"];
const BANKS = ["TK-16.sf2", "TK-16-Whimsical.sf2", "TK-16-Arcade.sf2"];
const SR = 22_050;
const BUF = 128;
const EXCERPT_SECONDS = 2;

const midiBytes = (piece: string): Uint8Array => readFileSync(resolve(here, "fixtures", "pieces", `${piece}.mid`));
const parse = (piece: string): BasicMIDI => {
  const bytes = midiBytes(piece);
  return BasicMIDI.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer);
};

/** Render the opening of a piece through a bank. */
function excerpt(piece: string, bankFile: string): Float32Array {
  const midi = parse(piece);
  const bank = readFileSync(resolve(root, "media", "soundfonts", bankFile));
  const processor = new SpessaSynthProcessor(SR, { maxBufferSize: BUF, effectsEnabled: false, eventsEnabled: false });
  processor.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(bank.buffer.slice(bank.byteOffset, bank.byteOffset + bank.length) as ArrayBuffer), "tk");
  for (const entry of midi.timeline) {
    const event = midi.tracks[entry.tr]?.events[entry.ev];
    if (event !== undefined) {
      const time = midi.midiTicksToSeconds(event.ticks);
      if (time <= EXCERPT_SECONDS) processor.processMessage(event, 0, { time });
    }
  }
  const total = EXCERPT_SECONDS * SR;
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

const rms = (x: Float32Array): number => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length);
const peak = (x: Float32Array): number => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

for (const piece of PIECES) {
  test(`${piece}: parses, runs 30 s or more, and stays inside the kit and the playable range`, () => {
    const midi = parse(piece);
    ok(midi.duration >= 30, `lasts ${midi.duration.toFixed(1)} s`);
    const programs = new Set<number>();
    for (const track of midi.tracks) {
      for (const event of track.events) {
        const type = event.statusByte & 0xf0;
        const channel = event.statusByte & 0x0f;
        if (type === 0xc0) programs.add(event.data[0]!);
        if (type === 0x90 && event.data[1]! > 0) {
          const note = event.data[0]!;
          if (channel === 9) ok(note >= 35 && note <= 81, `drum key ${note} is on the kit (35-81)`);
          else ok(note >= 24 && note <= 108, `note ${note} is playable`);
        }
      }
    }
    ok(programs.size >= 6, `uses ${programs.size} programs`);
  });

  test(`${piece}: sounds in every bank, does not clip, renders the same twice, and the banks differ`, () => {
    const renders = BANKS.map((bank) => excerpt(piece, bank));
    for (const [index, render] of renders.entries()) {
      ok(rms(render) > 0.005, `${BANKS[index]} is audible (rms ${rms(render).toFixed(4)})`);
      ok(peak(render) < 1, `${BANKS[index]} does not clip (peak ${peak(render).toFixed(2)})`);
    }
    const again = excerpt(piece, BANKS[0]!);
    equal(again.every((v, i) => v === renders[0]![i]), true, "the same bank renders the same samples twice");
    // Compare shape, not loudness: scale each to unit rms and ask how far apart they are.
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]] as const) {
      const x = renders[a]!;
      const y = renders[b]!;
      const scale = rms(x) / rms(y);
      const difference = rms(Float32Array.from(x, (v, i) => v - y[i]! * scale)) / rms(x);
      ok(difference > 0.3, `${BANKS[a]} and ${BANKS[b]} sound different on ${piece} (difference ${difference.toFixed(2)})`);
    }
  });
}
