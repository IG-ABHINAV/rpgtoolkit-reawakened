import { test } from "node:test";
import { ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeMidi } from "@tk-reawakened/core";
import { SoundBankLoader } from "spessasynth_core";
import { createSpessaMidiSource, soundFontDecoderReady } from "../src/index.ts";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIDI_PATH = join(TEST_DIR, "../../core/test/fixtures/audio/files/midi0-480-default-tempo.mid");
const BANK_PATH = join(TEST_DIR, "fixtures/test-minimal.sf2");
const OUTPUT_RATE_HZ = 22_050;
const MAX_BUFFER_SIZE = 256;

function render(source: ReturnType<typeof createSpessaMidiSource>, midi: Uint8Array): {
  readonly frames: number;
  readonly absoluteSum: number;
  readonly ended: boolean;
} {
  const opened = source.open(midi, {
    outputRateHz: OUTPUT_RATE_HZ,
    bank: { source: "bundled", id: "test-minimal", sha256: null },
  });
  if (!opened.ok) throw new Error(`SpessaSynth failed to open authored MIDI: ${opened.error.code}: ${opened.error.detail}`);

  const info = decodeMidi(midi);
  if (!info.ok || info.value.lengthTicks === null) throw new Error("core AudioInfo did not provide a finite MIDI length");
  const expectedFrames = Math.floor((info.value.lengthTicks * OUTPUT_RATE_HZ + 30) / 60);
  const left = new Float32Array(MAX_BUFFER_SIZE);
  const right = new Float32Array(MAX_BUFFER_SIZE);
  let frames = 0;
  let absoluteSum = 0;
  opened.value.start(0, false);
  while (!opened.value.ended) {
    const count = Math.min(MAX_BUFFER_SIZE, expectedFrames - frames);
    if (count <= 0) throw new Error("SpessaSynth exceeded the core AudioInfo duration");
    opened.value.render(left, right, count);
    for (let i = 0; i < count; i += 1) absoluteSum += Math.abs(left[i] ?? 0) + Math.abs(right[i] ?? 0);
    frames += count;
  }
  return { frames, absoluteSum, ended: opened.value.ended };
}

test("SpessaSynth renders authored MIDI to non-silent PCM at the core AudioInfo length", () => {
  const midi = new Uint8Array(readFileSync(MIDI_PATH));
  const bank = new Uint8Array(readFileSync(BANK_PATH));
  const source = createSpessaMidiSource({ bank, maxBufferSize: MAX_BUFFER_SIZE });
  const result = render(source, midi);
  const info = decodeMidi(midi);
  if (!info.ok || info.value.lengthTicks === null) throw new Error("core AudioInfo did not decode authored MIDI");
  const expectedFrames = Math.floor((info.value.lengthTicks * OUTPUT_RATE_HZ + 30) / 60);
  const toleranceFrames = Math.ceil(OUTPUT_RATE_HZ / 60);
  if (Math.abs(result.frames - expectedFrames) > toleranceFrames) {
    throw new Error(`rendered ${result.frames} frames; core AudioInfo predicts ${expectedFrames} ± ${toleranceFrames}`);
  }
  if (!result.ended) throw new Error("SpessaSynth did not finish the finite MIDI voice");
  if (result.absoluteSum <= 1e-4) throw new Error("SpessaSynth rendered silent PCM");
});

test("compressed SoundFont samples render after decoder initialization", async () => {
  // Authored fixture: test-minimal.sf2 with its single sample replaced by a generated 440 Hz Vorbis tone.
  await soundFontDecoderReady;
  const midi = new Uint8Array(readFileSync(MIDI_PATH));
  const bank = new Uint8Array(readFileSync(join(TEST_DIR, "fixtures/test-minimal.sf3")));
  ok(SoundBankLoader.fromArrayBuffer(bank.buffer.slice(bank.byteOffset, bank.byteOffset + bank.byteLength) as ArrayBuffer).samples.some((sample) => sample.isCompressed), "fixture contains a compressed sample");
  const result = render(createSpessaMidiSource({ bank, maxBufferSize: MAX_BUFFER_SIZE }), midi);
  if (!result.ended || result.absoluteSum <= 1e-4) throw new Error("SF3 playback ended early or produced silent PCM");
});
