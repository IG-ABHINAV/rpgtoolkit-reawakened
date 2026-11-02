/**
 * The runner's audio output: PCM from `synth` into the host's audio graph (`docs/spec/engine/runners.md#audio`).
 *
 * The sink is the other half of the cue player. The player decides *what* to send; the sink holds one `AudioSource`
 * voice per protocol voice id and **pulls** frames from them, which is what an audio graph does — a `ScriptProcessor`
 * in the browser, a buffer fill in a test. Pulling is also why the lane can assert on it without a speaker: the same
 * `render` call the graph makes is the one the test reads.
 *
 * The sink speaks protocol v1 (`packages/synth/src/protocol.ts`): `load`, `play`, `pause`, `resume`, `stop`, `seek`,
 * `setLoop`, `setVolume`, `fade` and `setBank`. `setBank` is recorded and does nothing yet: MIDI needs a SoundFont and the
 * bank picker is entry 9.6's, so a voice whose source needs a bank fails with `bank.missing` instead of playing silence.
 */

import type { AssetKey, Result } from "@tk-reawakened/core";
import {
  BANK_SIZE_CEILING,
  BankCache,
  BankError,
  createAudioSourceRegistry,
  createPcmSource,
  createSpessaMidiSource,
  openPrepared,
  validateBankBytes,
  missingPatches,
  type AudioMessage,
  type AudioSourceRegistry,
  type BankRef,
  type PatchRequest,
  type SourceError,
  type SourceVoice,
} from "@tk-reawakened/synth";
import type { PreparedAudio } from "./decode-types.ts";

/** What the sink tells the cue player, in the protocol's event vocabulary. */
export type SinkEvent =
  | { readonly kind: "ready"; readonly voice: number; readonly lengthTicks: number | null }
  | { readonly kind: "ended"; readonly voice: number }
  /**
   * A MIDI file asked for an instrument the bank does not have, so another plays instead (or the channel is silent).
   * It belongs to no voice, is reported once per bank (by SHA-256) and requested instrument, and never stops playback.
   */
  | {
      readonly kind: "bank.substitution";
      readonly bankId: string;
      readonly sha256: string;
      readonly request: PatchRequest;
      readonly substitute: { readonly bank: number; readonly program: number } | null;
      readonly asset: AssetKey;
    }
  /** A bank failure belongs to no voice and keeps the previous bank. */
  | { readonly kind: "error"; readonly voice: number | null; readonly code: string; readonly detail: string };

export type PcmSinkOptions = {
  /** The bytes of one asset; `null` when the host cannot supply it. */
  readonly readAsset: (asset: AssetKey) => Uint8Array | null;
  /** The bytes of one bank, by `BankRef`; `null` when the host cannot supply it (`bank.missing`). */
  readonly readBank?: (bank: BankRef) => Uint8Array | null;
  /**
   * The shared bank cache (`#audio-soundfont-cache`). The sink pins the current bank while it is in use, so eviction can
   * never remove it, and two games naming the same bytes share one entry by SHA-256.
   */
  readonly banks?: BankCache;
  /**
   * Audio a decode worker already prepared (`DecodeAhead.audio`), or `null` when none is ready. A prepared PCM at this
   * sink's `outputRateHz` opens its voice with no decoding, from the same samples `createPcmSource` would have made;
   * anything else (nothing ready, another rate, MIDI, a SoundFont) is opened as before. A prepared MIDI or SoundFont
   * result is advisory: the bank cache and every bank decision stay here, and no second cache exists.
   */
  readonly readPrepared?: (asset: AssetKey) => PreparedAudio | null;
  /** The formats this runner can play; defaults to PCM (WAV, PCM and IMA/MS ADPCM) and MIDI through the loaded bank. */
  readonly registry?: AudioSourceRegistry;
  /** The graph's sample rate. */
  readonly outputRateHz?: number;
  /** Where events go; the host turns `ended` into an `audio.ended` input. */
  readonly onEvent?: (event: SinkEvent) => void;
};

type SinkVoice = {
  readonly id: number;
  readonly track: string;
  readonly asset: AssetKey;
  readonly source: SourceVoice;
  cue: number;
  volume: number;
  bus: string | null;
  ended: boolean;
};

const TICKS_PER_SECOND = 60;

/** The closed error codes a source or the bank path may report through this sink. */
const BANK_CODES = ["bank.missing", "bank.invalid", "bank.unavailable"];

/** One `AudioBuffer`-shaped block per pull, and the deterministic record of what the sink has played. */
export type ScheduledPlay = {
  readonly voice: number;
  readonly track: string;
  readonly positionTicks: number;
  readonly loop: boolean;
  readonly lengthTicks: number | null;
};

export class PcmSink {
  private readonly readPrepared: ((asset: AssetKey) => PreparedAudio | null) | undefined;
  private readonly readAsset: (asset: AssetKey) => Uint8Array | null;
  private readonly registry: AudioSourceRegistry;
  private readonly outputRateHz: number;
  private readonly onEvent: ((event: SinkEvent) => void) | undefined;
  private readonly voices = new Map<number, SinkVoice>();
  private readonly busVolumes = new Map<string, number>();
  private masterVolume = 100;
  private readonly banks: BankCache;
  private bankRef: BankRef | null = null;
  private bankSha: string | null = null;
  private bankBytes: Uint8Array | null = null;
  private readonly played: ScheduledPlay[] = [];
  private readonly errors: SinkEvent[] = [];
  /** Substitutions already reported: bank SHA-256 + requested instrument, for the life of this sink (one player session). */
  private readonly reported = new Set<string>();

  constructor(options: PcmSinkOptions) {
    this.readAsset = options.readAsset;
    this.readPrepared = options.readPrepared;
    this.banks = options.banks ?? new BankCache({ load: options.readBank ?? (() => null) });
    this.outputRateHz = options.outputRateHz ?? 44_100;
    this.onEvent = options.onEvent;
    // The MIDI source reads the current bank at `open`, so a voice that arrives after a swap gets the new instruments.
    this.registry = options.registry ?? createAudioSourceRegistry([
      createPcmSource(),
      createSpessaMidiSource({
        bankResolver: (): Uint8Array | null => this.bankBytes,
      }),
    ]);
  }

  /** Every `play` the sink scheduled, in order: the record a lane compares instead of listening. */
  get scheduled(): readonly ScheduledPlay[] {
    return this.played;
  }

  /** The bank the player last set (`setBank`), or `null`. */
  get currentBank(): BankRef | null {
    return this.bankRef;
  }

  /** The cache entry the current bank pins, or `null`: the key a lane compares across two games. */
  get currentBankSha(): string | null {
    return this.bankSha;
  }

  /** The voices the sink holds, open or ended. */
  get open(): readonly { readonly id: number; readonly track: string; readonly asset: AssetKey }[] {
    return [...this.voices.values()].map((voice) => ({ id: voice.id, track: voice.track, asset: voice.asset }));
  }

  /** Handle one protocol message from the cue player. */
  handle(message: AudioMessage): void {
    switch (message.kind) {
      case "setBank": {
        this.setBank(message.bank);
        return;
      }
      case "load": {
        // A worker-prepared PCM at this rate needs no bytes and no decoding; the host's own decode is the fallback.
        const prepared = this.readPrepared?.(message.asset) ?? null;
        const env = { outputRateHz: this.outputRateHz, bank: this.bankRef };
        let source: Result<SourceVoice, SourceError>;
        let fetched: Uint8Array | null = null; // the asset's bytes, only if this load had to read them
        if (prepared !== null && prepared.kind === "pcm" && prepared.outputRateHz === this.outputRateHz) {
          source = openPrepared(prepared, env);
        } else {
          const bytes = message.data.byteLength > 0 ? message.data : this.readAsset(message.asset);
          if (bytes === null) {
            this.fail(message.voice, "source.failed", `${message.asset} is not readable`);
            return;
          }
          fetched = bytes;
          // The source reads the bank it needs from `env`; the bytes come from the cache through `bankResolver`.
          source = this.registry.open(bytes, () => env, extensionOf(message.asset));
        }
        if (!source.ok) {
          const code = BANK_CODES.includes(source.error.code) || source.error.code === "format.unsupported" || source.error.code === "format.malformed"
            ? source.error.code
            : "source.failed";
          this.fail(message.voice, code, source.error.detail);
          return;
        }
        this.reportMissingPatches(message.asset, fetched);
        this.voices.set(message.voice, {
          id: message.voice,
          track: message.track,
          asset: message.asset,
          source: source.value,
          cue: 0,
          volume: 100,
          bus: message.track,
          ended: false,
        });
        this.event({ kind: "ready", voice: message.voice, lengthTicks: source.value.lengthTicks });
        return;
      }
      case "play": {
        const voice = this.voices.get(message.voice);
        if (voice === undefined) {
          this.fail(message.voice, "protocol.state", "play for a voice that was never loaded");
          return;
        }
        voice.cue = message.cue;
        voice.volume = message.volume;
        voice.ended = false;
        voice.source.setVolume(message.volume);
        voice.source.setLoop(message.loop);
        voice.source.start(message.positionTicks, message.loop);
        this.played.push({
          voice: message.voice,
          track: voice.track,
          positionTicks: message.positionTicks,
          loop: message.loop,
          lengthTicks: voice.source.lengthTicks,
        });
        return;
      }
      case "pause":
        this.voices.get(message.voice)?.source.pause();
        return;
      case "resume":
        this.voices.get(message.voice)?.source.resume();
        return;
      case "stop": {
        const voice = this.voices.get(message.voice);
        if (voice === undefined) return;
        voice.source.stop();
        this.voices.delete(message.voice);
        return;
      }
      case "seek":
        this.voices.get(message.voice)?.source.seek(message.positionTicks);
        return;
      case "setLoop":
        this.voices.get(message.voice)?.source.setLoop(message.loop);
        return;
      case "setVolume": {
        const volume = clampVolume(message.volume);
        if (message.scope === "master") {
          this.masterVolume = volume;
          return;
        }
        if (message.scope === "bus") {
          if (message.bus !== null) this.busVolumes.set(message.bus, volume);
          return;
        }
        const voice = message.voice === null ? undefined : this.voices.get(message.voice);
        if (voice === undefined) return;
        voice.volume = volume;
        voice.source.setVolume(volume);
        return;
      }
      case "fade": {
        const voice = message.voice === null ? undefined : this.voices.get(message.voice);
        if (voice === undefined) return;
        voice.source.fade(message.fromVolume, message.targetVolume, message.durationTicks);
        return;
      }
      default: {
        const unreachable: never = message;
        throw new Error(`PcmSink: unknown message ${JSON.stringify(unreachable)}`);
      }
    }
  }

  /**
   * Pull `frames` into `left`/`right`, exactly as an audio graph's callback does. Silent voices write zeros; a finite
   * voice that reaches its end reports `ended` once. Bus and master volumes are applied here, not by the source.
   */
  render(left: Float32Array, right: Float32Array, frames: number): void {
    left.fill(0, 0, frames);
    right.fill(0, 0, frames);
    const scratchLeft = new Float32Array(frames);
    const scratchRight = new Float32Array(frames);
    for (const voice of this.voices.values()) {
      scratchLeft.fill(0, 0, frames);
      scratchRight.fill(0, 0, frames);
      voice.source.render(scratchLeft, scratchRight, frames);
      const bus = voice.bus === null ? 100 : (this.busVolumes.get(voice.bus) ?? 100);
      const gain = (clampVolume(voice.volume) / 100) * (bus / 100) * (this.masterVolume / 100);
      for (let index = 0; index < frames; index += 1) {
        left[index] = (left[index] ?? 0) + (scratchLeft[index] ?? 0) * gain;
        right[index] = (right[index] ?? 0) + (scratchRight[index] ?? 0) * gain;
      }
      if (voice.source.ended && !voice.ended) {
        voice.ended = true;
        this.event({ kind: "ended", voice: voice.id });
        this.voices.delete(voice.id);
      }
    }
  }

  /** The non-silent sample count of one pull: the deterministic "did it make sound" the lane asserts. */
  static energy(left: Float32Array, frames: number): number {
    let energy = 0;
    for (let index = 0; index < frames; index += 1) energy += Math.abs(left[index] ?? 0);
    return energy;
  }

  /**
   * Set the bank: resolve its bytes once through the cache, validate the container and the ceiling, and keep the
   * previous bank on any failure (#soundfont-user-bank item 5). The bank is pinned while it is in use, so a later swap
   * cannot evict it out from under a playing voice.
   */
  private setBank(bank: BankRef | null): void {
    if (bank === null) {
      this.releaseBank();
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = this.banks.acquire(bank);
    } catch (error) {
      const code = error instanceof BankError ? error.code : "bank.unavailable";
      this.fail(null, code, error instanceof Error ? error.message : String(error));
      return;
    }
    const sha = this.banks.entries.find((entry) => this.banks.bytesOf(entry.sha256) === bytes)?.sha256 ?? null;
    if (this.bankSha !== null && this.bankSha !== sha) this.banks.release(this.bankSha);
    else if (this.bankSha !== null && this.bankSha === sha) this.banks.release(sha); // the same bank acquired twice
    this.bankRef = bank;
    this.bankSha = sha;
    this.bankBytes = validateBankBytes(bytes);
  }

  /** Compare a MIDI file's instruments with the current bank's and report each one that needs a substitute, once. */
  private reportMissingPatches(asset: AssetKey, bytes: Uint8Array | null): void {
    if (bytes === null || this.bankBytes === null || this.bankSha === null || this.bankRef === null) return;
    const isMidi = bytes.length >= 4 && String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0) === "MThd";
    if (!isMidi) return;
    for (const { request, resolution } of missingPatches(bytes, this.bankBytes)) {
      const id = `${this.bankSha}|${request.percussion ? "p" : "m"}|${request.bank}|${request.program}`;
      if (this.reported.has(id)) continue;
      this.reported.add(id);
      this.event({
        kind: "bank.substitution",
        bankId: this.bankRef.id,
        sha256: this.bankSha,
        request,
        substitute: resolution.kind === "silent" ? null : { bank: resolution.bank, program: resolution.program },
        asset,
      });
    }
  }

  private releaseBank(): void {
    if (this.bankSha !== null) this.banks.release(this.bankSha);
    this.bankRef = null;
    this.bankSha = null;
    this.bankBytes = null;
  }

  private event(event: SinkEvent): void {
    if (event.kind === "error") this.errors.push(event);
    this.onEvent?.(event);
  }

  private fail(voice: number | null, code: string, detail: string): void {
    this.event({ kind: "error", voice, code, detail });
  }
}

/** The extension an asset key ends with, so the registry can prefer the source that declares it. */
function extensionOf(asset: AssetKey): string | null {
  const dot = asset.lastIndexOf(".");
  return dot < 0 ? null : asset.slice(dot + 1);
}

function clampVolume(volume: number): number {
  return Math.max(0, Math.min(100, Math.round(volume)));
}

/**
 * Attach a sink to a browser `AudioContext`: a `ScriptProcessorNode` pulls it, a master `GainNode` feeds the graph. The
 * sink is the only thing that knows about voices, so the graph node is three lines and no policy.
 */
export function connectSinkToGraph(context: AudioContext, sink: PcmSink, frames = 8192): { readonly node: ScriptProcessorNode; readonly disconnect: () => void } {
  const node = context.createScriptProcessor(frames, 2, 2);
  node.onaudioprocess = (event: AudioProcessingEvent): void => {
    const left = event.outputBuffer.getChannelData(0);
    const right = event.outputBuffer.getChannelData(1);
    sink.render(left, right, event.outputBuffer.length);
  };
  node.connect(context.destination);
  return {
    node,
    disconnect: (): void => {
      node.onaudioprocess = null;
      node.disconnect();
    },
  };
}

/** The runner's ceiling for a user or CDN bank, re-exported so a settings screen rejects early. */
export const USER_BANK_SIZE_CEILING = BANK_SIZE_CEILING;

/** Ticks as seconds at 60 Hz, for a length the lane reports next to the core's `AudioInfo.lengthTicks`. */
export function ticksToSeconds(ticks: number): number {
  return ticks / TICKS_PER_SECOND;
}
