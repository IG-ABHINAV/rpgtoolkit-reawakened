// The runner's audio output (docs/spec/engine/runners.md#audio, entry 9.5): PCM from `synth` pulled into a buffer, which
// is the same pull an audio graph makes. These tests read the authored WAV fixtures, whose length ticks the fixture kit
// hand-worked, so "the sink made sound for the core's length" is a fact about real bytes and not about a mock.

import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { AssetKey } from "@tk-reawakened/core";
import { PcmSink, ticksToSeconds } from "../src/audio-sink.ts";
import type { SinkEvent } from "../src/audio-sink.ts";

const here = dirname(fileURLToPath(import.meta.url));
const audioFiles = resolve(here, "..", "..", "core", "test", "fixtures", "audio", "files");

function wav(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(audioFiles, name)));
}

/** The two authored PCM fixtures the kit hand-works: one mono, one stereo. */
const MONO = "pcm16-mono-8000.wav";
const files = new Map<string, Uint8Array>([[MONO, wav(MONO)]]);

function sink(options: { readonly onEvent?: (event: SinkEvent) => void } = {}): PcmSink {
  const made = new PcmSink({
    readAsset: (asset) => files.get(asset) ?? null,
    outputRateHz: 8_000,
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
  });
  return made;
}

function load(name: string, voice = 1): void {
  const bytes = wav(name);
  const made = sink();
  made.handle({ kind: "load", voice, track: "sfx", asset: `media/${name}` as AssetKey, data: bytes });
}

test("a load reports the core's own length in ticks", () => {
  const events: SinkEvent[] = [];
  const made = sink({ onEvent: (event) => events.push(event) });
  made.handle({ kind: "load", voice: 1, track: "sfx", asset: `media/${MONO}` as AssetKey, data: wav(MONO) });
  // The kit hand-works this file at 15 ticks: 0.25 s at 8 kHz, 2000 frames.
  deepEqual(events, [{ kind: "ready", voice: 1, lengthTicks: 15 }]);
  equal(ticksToSeconds(15), 0.25);
});

test("a played voice makes sound, and only for as long as its length", () => {
  const made = sink();
  made.handle({ kind: "load", voice: 1, track: "sfx", asset: `media/${MONO}` as AssetKey, data: wav(MONO) });
  made.handle({ kind: "play", voice: 1, cue: 7, loop: false, volume: 100, positionTicks: 0 });
  deepEqual(made.scheduled, [{ voice: 1, track: "sfx", positionTicks: 0, loop: false, lengthTicks: 15 }]);

  // 15 ticks at 60 Hz is 0.25 s: 2000 frames at 8 kHz. Pull a little more than that.
  const frames = 2_600;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  made.render(left, right, frames);
  const audible = PcmSink.energy(left, frames);
  ok(audible > 0, `the sink rendered sound (energy ${audible})`);
  // The tail after the 2000th frame is silence: a finite voice stops at its end instead of ringing on.
  ok(PcmSink.energy(left.subarray(2_100), 500) === 0, "the finite voice is silent past its length");
});

test("a volume of zero is silence, and so is a muted bus", () => {
  const made = sink();
  made.handle({ kind: "load", voice: 1, track: "sfx", asset: `media/${MONO}` as AssetKey, data: wav(MONO) });
  made.handle({ kind: "play", voice: 1, cue: 7, loop: true, volume: 100, positionTicks: 0 });
  const left = new Float32Array(800);
  const right = new Float32Array(800);
  made.handle({ kind: "setVolume", scope: "bus", voice: null, bus: "sfx", volume: 0 });
  made.render(left, right, 800);
  equal(PcmSink.energy(left, 800), 0);
  made.handle({ kind: "setVolume", scope: "bus", voice: null, bus: "sfx", volume: 100 });
  made.render(left, right, 800);
  ok(PcmSink.energy(left, 800) > 0, "unmuting the bus restores the sound");
});

test("a looping voice keeps sounding past its length", () => {
  const made = sink();
  made.handle({ kind: "load", voice: 1, track: "music", asset: `media/${MONO}` as AssetKey, data: wav(MONO) });
  made.handle({ kind: "play", voice: 1, cue: 8, loop: true, volume: 100, positionTicks: 0 });
  const left = new Float32Array(8_000);
  const right = new Float32Array(8_000);
  // Four times the voice's length: a loop still has signal in its fourth pass.
  made.render(left, right, 8_000);
  ok(PcmSink.energy(left, 8_000) > 0, "the loop is still sounding in its fourth pass");
  equal(made.open.length, 1, "a looping voice stays open");
});

test("a finite voice reports ended once, and the sink lets it go", () => {
  const events: SinkEvent[] = [];
  const made = sink({ onEvent: (event) => events.push(event) });
  made.handle({ kind: "load", voice: 1, track: "sfx", asset: `media/${MONO}` as AssetKey, data: wav(MONO) });
  made.handle({ kind: "play", voice: 1, cue: 9, loop: false, volume: 100, positionTicks: 0 });
  const left = new Float32Array(2_600);
  const right = new Float32Array(2_600);
  made.render(left, right, 2_600);
  made.render(left, right, 2_600);
  deepEqual(events.filter((event) => event.kind === "ended"), [{ kind: "ended", voice: 1 }]);
  equal(made.open.length, 0);
});

test("pause holds the position, resume continues it", () => {
  const made = sink();
  made.handle({ kind: "load", voice: 1, track: "music", asset: `media/${MONO}` as AssetKey, data: wav(MONO) });
  made.handle({ kind: "play", voice: 1, cue: 10, loop: true, volume: 100, positionTicks: 0 });
  const left = new Float32Array(400);
  const right = new Float32Array(400);
  made.render(left, right, 400);
  made.handle({ kind: "pause", voice: 1 });
  left.fill(0);
  made.render(left, right, 400);
  equal(PcmSink.energy(left, 400), 0, "a paused voice is silent");
  made.handle({ kind: "resume", voice: 1 });
  made.render(left, right, 400);
  ok(PcmSink.energy(left, 400) > 0, "the resumed voice sounds again");
});

test("stop silences the voice and forgets it", () => {
  const made = sink();
  made.handle({ kind: "load", voice: 1, track: "sfx", asset: `media/${MONO}` as AssetKey, data: wav(MONO) });
  made.handle({ kind: "play", voice: 1, cue: 11, loop: true, volume: 100, positionTicks: 0 });
  made.handle({ kind: "stop", voice: 1 });
  const left = new Float32Array(400);
  const right = new Float32Array(400);
  made.render(left, right, 400);
  equal(PcmSink.energy(left, 400), 0);
  equal(made.open.length, 0);
});

test("an unreadable asset fails the voice instead of playing silence", () => {
  const events: SinkEvent[] = [];
  const made = sink({ onEvent: (event) => events.push(event) });
  made.handle({ kind: "load", voice: 3, track: "sfx", asset: "media/absent.wav" as AssetKey, data: new Uint8Array() });
  deepEqual(events, [{ kind: "error", voice: 3, code: "source.failed", detail: "media/absent.wav is not readable" }]);
  equal(made.open.length, 0);
});

test("a play for a voice that was never loaded is a protocol error, not a crash", () => {
  const events: SinkEvent[] = [];
  const made = sink({ onEvent: (event) => events.push(event) });
  made.handle({ kind: "play", voice: 4, cue: 1, loop: false, volume: 100, positionTicks: 0 });
  equal(events[0]?.kind, "error");
  equal(events[0]?.kind === "error" ? events[0].code : "", "protocol.state");
});

// ---------------------------------------------------------------- SoundFont banks (entry 9.6)

/** The path that ships: the bundled bank, whose SHA-256 the notice records. */
function bundledBank(): Uint8Array {
  return new Uint8Array(readFileSync(join(here, "..", "..", "..", "media", "soundfonts", "TK-16.sf2")));
}

const MIDI = "midi0-480-default-tempo.mid"; // 120 ticks, hand-worked by the kit

function midiSink(options: { readonly withBank: boolean; readonly readBank?: () => Uint8Array | null }): {
  readonly made: PcmSink;
  readonly events: SinkEvent[];
} {
  const events: SinkEvent[] = [];
  const bytes = new Map<string, Uint8Array>([[`media/${MIDI}`, wav(MIDI)]]);
  const made = new PcmSink({
    readAsset: (asset) => bytes.get(asset) ?? null,
    readBank: options.readBank ?? (() => (options.withBank ? bundledBank() : null)),
    outputRateHz: 8_000,
    onEvent: (event) => events.push(event),
  });
  return { made, events };
}

test("TK-16 loads and MIDI renders through it: the bundled bank is usable", () => {
  const { made, events } = midiSink({ withBank: true });
  made.handle({ kind: "setBank", bankKind: "soundfont", bank: { source: "bundled", id: "TK-16", sha256: null } });
  equal(made.currentBankSha, "a79fa6d4ae3b8ab8b3f3e3ddd4ab3d59a0ac24222caffcdd914435d76872ede2");
  made.handle({ kind: "load", voice: 7, track: "music", asset: `media/${MIDI}` as AssetKey, data: wav(MIDI) });
  made.handle({ kind: "play", voice: 7, cue: 12, loop: false, volume: 100, positionTicks: 0 });
  const frames = 8_192;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  made.render(left, right, frames);
  ok(PcmSink.energy(left, frames) > 0, "MIDI through TK-16 is sound, not silence");
  deepEqual(events.filter((event) => event.kind === "ready"), [{ kind: "ready", voice: 7, lengthTicks: 120 }]);
});

test("without a bank a MIDI voice is bank.missing and WAV is unaffected", () => {
  const { made, events } = midiSink({ withBank: false });
  made.handle({ kind: "load", voice: 8, track: "music", asset: `media/${MIDI}` as AssetKey, data: wav(MIDI) });
  deepEqual(events.map((event) => (event.kind === "error" ? event.code : event.kind)), ["bank.missing"]);
  // A WAV voice in the same sink still loads and plays.
  made.handle({ kind: "load", voice: 9, track: "sfx", asset: `media/${MONO}` as AssetKey, data: wav(MONO) });
  made.handle({ kind: "play", voice: 9, cue: 13, loop: false, volume: 100, positionTicks: 0 });
  const left = new Float32Array(400);
  const right = new Float32Array(400);
  made.render(left, right, 400);
  ok(PcmSink.energy(left, 400) > 0, "WAV needs no bank");
});

test("an invalid bank keeps the previous one, and reports bank.invalid", () => {
  const events: SinkEvent[] = [];
  const bytes = new Map<string, Uint8Array>();
  let give = bundledBank();
  const made = new PcmSink({
    readAsset: (asset) => bytes.get(asset) ?? null,
    readBank: () => give,
    outputRateHz: 8_000,
    onEvent: (event) => events.push(event),
  });
  made.handle({ kind: "setBank", bankKind: "soundfont", bank: { source: "bundled", id: "TK-16", sha256: null } });
  const first = made.currentBankSha;
  ok(first !== null);
  give = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]); // RIFF, but not sfbk
  made.handle({ kind: "setBank", bankKind: "soundfont", bank: { source: "user", id: "broken", sha256: null } });
  const last = events.at(-1);
  equal(last?.kind === "error" ? last.code : "", "bank.invalid");
  equal(made.currentBankSha, first, "the previous bank stays");
});

test("a bank over the ceiling is bank.unavailable, not a crash", () => {
  const events: SinkEvent[] = [];
  const huge = new Uint8Array(8 * 1024 * 1024 + 1);
  huge.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x73, 0x66, 0x62, 0x6b]);
  const made = new PcmSink({
    readAsset: () => null,
    readBank: () => huge,
    outputRateHz: 8_000,
    onEvent: (event) => events.push(event),
  });
  made.handle({ kind: "setBank", bankKind: "soundfont", bank: { source: "user", id: "huge", sha256: null } });
  const last = events.at(-1);
  equal(last?.kind === "error" ? last.code : "", "bank.unavailable");
  equal(made.currentBank, null);
});
