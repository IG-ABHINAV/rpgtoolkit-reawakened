import { BasicMIDI, SoundBankLoader, SpessaSynthProcessor } from "spessasynth_core";
import { err } from "@tk-reawakened/core";
import type { Result } from "@tk-reawakened/core";
import { midiLengthTicks } from "./midi.ts";
import { PatchRouter, bankPresetTable } from "./patch.ts";
import { opened } from "./source.ts";
import type { AudioSource, SourceEnv, SourceError, SourceVoice } from "./source.ts";
import type { BankRef } from "./protocol.ts";
import type { MidiSynth } from "./midi.ts";

export interface SpessaSynthOptions {
  readonly bank?: Uint8Array | ArrayBuffer;
  readonly bankResolver?: (bank: BankRef) => Uint8Array | ArrayBuffer | null;
  readonly maxBufferSize?: number;
}

function asArrayBuffer(data: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

class SpessaVoice implements SourceVoice {
  readonly lengthTicks: number;
  private readonly midi: BasicMIDI;
  private readonly bank: Uint8Array | ArrayBuffer;
  private readonly presets: ReadonlySet<string>;
  private readonly sampleRate: number;
  private readonly maxBufferSize: number;
  private readonly lengthFrames: number;
  private processor: SpessaSynthProcessor;
  private position = 0;
  private playing = false;
  private loop = false;
  private volumeValue = 100;
  private fadeFrom = 100;
  private fadeTarget = 100;
  private fadeFrames = 0;
  private fadeElapsed = 0;

  constructor(bytes: Uint8Array, bank: Uint8Array | ArrayBuffer, sampleRate: number, lengthTicks: number, maxBufferSize: number) {
    this.midi = BasicMIDI.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    this.bank = bank;
    this.presets = bankPresetTable(bank instanceof Uint8Array ? bank : new Uint8Array(bank));
    this.sampleRate = sampleRate;
    this.lengthTicks = lengthTicks;
    this.maxBufferSize = Math.max(32, maxBufferSize);
    this.lengthFrames = Math.max(1, Math.floor((lengthTicks * sampleRate + 30) / 60));
    this.processor = this.createProcessor();
  }

  get ended(): boolean {
    return !this.loop && this.position >= this.lengthFrames;
  }

  start(positionTicks: number, loop: boolean): void {
    this.loop = loop;
    this.position = Math.max(0, Math.floor((positionTicks * this.sampleRate) / 60));
    if (this.loop) this.position %= this.lengthFrames;
    this.processor = this.createProcessor();
    this.skipTo(this.position);
    this.playing = !this.ended;
  }

  stop(): void { this.playing = false; }
  pause(): void { this.playing = false; }
  resume(): void { this.playing = !this.ended; }

  seek(positionTicks: number): void {
    this.position = Math.max(0, Math.floor((positionTicks * this.sampleRate) / 60));
    if (this.loop) this.position %= this.lengthFrames;
    this.processor = this.createProcessor();
    this.skipTo(this.position);
    this.playing = !this.ended;
  }

  setLoop(loop: boolean): void { this.loop = loop; }
  setVolume(volume: number): void { this.volumeValue = Math.max(0, Math.min(100, Math.round(volume))); this.fadeFrames = 0; }

  fade(fromVolume: number, targetVolume: number, durationTicks: number): void {
    this.fadeFrom = Math.max(0, Math.min(100, Math.round(fromVolume)));
    this.fadeTarget = Math.max(0, Math.min(100, Math.round(targetVolume)));
    this.fadeElapsed = 0;
    this.fadeFrames = Math.max(0, Math.round(durationTicks * this.sampleRate / 60));
    this.volumeValue = this.fadeFrames === 0 ? this.fadeTarget : this.fadeFrom;
  }

  render(left: Float32Array, right: Float32Array, frames: number): void {
    left.fill(0, 0, frames);
    right.fill(0, 0, frames);
    let offset = 0;
    while (offset < frames && this.playing) {
      if (this.ended) { this.playing = false; break; }
      const remaining = this.lengthFrames - this.position;
      const count = Math.min(frames - offset, remaining, this.maxBufferSize);
      const renderedLeft = left.subarray(offset, offset + count);
      const renderedRight = right.subarray(offset, offset + count);
      this.processor.process(renderedLeft, renderedRight, 0, count);
      for (let i = 0; i < count; i++) {
        const gain = this.fadeFrames > 0
          ? (this.fadeFrom + (this.fadeTarget - this.fadeFrom) * Math.min(1, this.fadeElapsed / this.fadeFrames)) / 100
          : this.volumeValue / 100;
        renderedLeft[i] = (renderedLeft[i] ?? 0) * gain;
        renderedRight[i] = (renderedRight[i] ?? 0) * gain;
        if (this.fadeFrames > 0) {
          this.fadeElapsed += 1;
          if (this.fadeElapsed >= this.fadeFrames) { this.fadeFrames = 0; this.volumeValue = this.fadeTarget; }
        }
      }
      this.position += count;
      offset += count;
      if (this.position >= this.lengthFrames && this.loop) {
        this.position = 0;
        this.processor = this.createProcessor();
      } else if (this.position >= this.lengthFrames) {
        this.playing = false;
      }
    }
  }

  private createProcessor(): SpessaSynthProcessor {
    const processor = new SpessaSynthProcessor(this.sampleRate, {
      maxBufferSize: this.maxBufferSize,
      effectsEnabled: false,
      eventsEnabled: false,
    });
    processor.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(asArrayBuffer(this.bank)), "tkr");
    // Patch selection follows the owner's fallback order (patch.ts), not SpessaSynth's: the synth is only ever asked for
    // an instrument the bank has, and a channel with none is silent.
    const router = new PatchRouter(this.presets);
    for (const timeline of this.midi.timeline) {
      const event = this.midi.tracks[timeline.tr]?.events[timeline.ev];
      if (event === undefined) continue;
      const time = this.midi.midiTicksToSeconds(event.ticks);
      for (const message of router.route(event)) processor.processMessage(message, 0, { time });
    }
    return processor;
  }

  private skipTo(frames: number): void {
    if (frames <= 0) return;
    const left = new Float32Array(this.maxBufferSize);
    const right = new Float32Array(this.maxBufferSize);
    let remaining = frames;
    while (remaining > 0) {
      const count = Math.min(remaining, this.maxBufferSize);
      this.processor.process(left, right, 0, count);
      remaining -= count;
    }
  }
}

/** Synchronous SpessaSynth wrapper used by the runner-side source seam. */
export class SpessaSynthMidiSynth implements MidiSynth {
  readonly id = "spessasynth";
  private readonly options: SpessaSynthOptions;

  constructor(options: SpessaSynthOptions = {}) {
    this.options = options;
  }

  open(bytes: Uint8Array, env: SourceEnv): Result<SourceVoice, SourceError> {
    const bank = env.bank === null ? null : this.options.bankResolver?.(env.bank) ?? this.options.bank ?? null;
    if (bank === null) return err<SourceVoice, SourceError>({ code: "bank.unavailable", detail: "no SoundFont bytes are configured" });
    const length = midiLengthTicks(bytes);
    if (!length.ok) return err<SourceVoice, SourceError>(length.error);
    try {
      return opened<SourceVoice>(new SpessaVoice(bytes, bank, env.outputRateHz, length.value, this.options.maxBufferSize ?? 2048));
    } catch (error) {
      return err<SourceVoice, SourceError>({ code: "bank.invalid", detail: error instanceof Error ? error.message : String(error) });
    }
  }
}

export function createSpessaMidiSource(options: SpessaSynthOptions = {}): AudioSource {
  return {
    id: "audio.midi",
    extensions: ["mid", "midi", "kar"],
    detect: (header) => header.length >= 4 && String.fromCharCode(header[0] ?? 0, header[1] ?? 0, header[2] ?? 0, header[3] ?? 0) === "MThd",
    bank: "soundfont",
    open: (bytes, env) => new SpessaSynthMidiSynth(options).open(bytes, env),
  };
}
