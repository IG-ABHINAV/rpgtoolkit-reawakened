/**
 * AudioWorklet processor for the runner's PCM sink (issue #1044).
 *
 * The processor renders one `PcmSink` directly on the audio thread. The main thread resolves assets and banks
 * synchronously, then forwards protocol messages here; the worklet never does a synchronous read. The bundle is a
 * single-file IIFE loaded from `/apps/audio-worklet.js` (browser) or `app://player/apps/audio-worklet.js` (desktop).
 *
 * `docs/spec/engine/runners.md#audio` and `docs/spec/engine/audio-media.md#runner-audio-protocol` own the contract.
 */

import { soundBankHasCompressedSamples, soundFontDecoderReady, type AudioMessage } from "@tk-reawakened/synth";
import { PcmSink, type WorkletSetBankMessage } from "./audio-sink.ts";

// The AudioWorklet global scope is not part of TypeScript's DOM lib. Declare the three globals this processor uses.
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;
declare const sampleRate: number;

/** Message from the main thread carrying one protocol record. */
interface WorkletControlMessage {
  readonly kind: "message";
  readonly message: AudioMessage | WorkletSetBankMessage;
}

/** Message asking the processor to report its render quantum size and sample rate. */
interface LatencyRequestMessage {
  readonly kind: "latency";
}

type ProcessorMessage = WorkletControlMessage | LatencyRequestMessage;

class TkrPcmProcessor extends AudioWorkletProcessor {
  private readonly sink: PcmSink;
  private readonly pending: (AudioMessage | WorkletSetBankMessage)[] = [];
  private pendingBank: WorkletSetBankMessage | null = null;
  private readonly pendingVoices = new Set<number>();
  private decoderState: "pending" | "ready" | "failed" = "pending";
  private decoderError = "";
  private failureReported = false;

  constructor() {
    super();
    this.sink = new PcmSink({
      readAsset: () => null,
      readBank: () => null,
      outputRateHz: sampleRate,
      onEvent: (event) => {
        if (event.kind === "ready" || event.kind === "ended" || event.kind === "error") this.port.postMessage(event);
      },
    });
    void soundFontDecoderReady.then(() => {
      this.decoderState = "ready";
      if (this.pendingBank !== null) this.handle(this.pendingBank);
      this.pendingBank = null;
      this.flushPending();
    }, (error: unknown) => {
      this.decoderState = "failed";
      this.decoderError = String(error);
      if (this.pendingBank !== null) this.handleWithoutDecoder(this.pendingBank);
      this.pendingBank = null;
      this.flushPending();
    });
    this.port.onmessage = (event: MessageEvent<ProcessorMessage>) => {
      const data = event.data;
      if (data.kind === "message") {
        if (this.decoderState === "ready") this.handle(data.message);
        else if (this.decoderState === "failed") this.handleWithoutDecoder(data.message);
        else this.handleWhilePending(data.message);
      } else if (data.kind === "latency") {
        const global = globalThis as unknown as { renderQuantumSize?: number };
        this.port.postMessage({
          kind: "latency",
          sampleRate,
          renderQuantumSize: global.renderQuantumSize ?? 128,
        });
      }
    };
  }

  private flushPending(): void {
    for (const message of this.pending) this.handle(message);
    this.pending.length = 0;
    this.pendingVoices.clear();
  }

  private handleWhilePending(message: AudioMessage | WorkletSetBankMessage): void {
    if (message.kind === "setBank" && "bankBytes" in message) {
      if (this.isCompressedBank(message)) {
        this.pendingBank = message;
      } else {
        this.pendingBank = null;
        this.handle(message);
        this.flushPending();
      }
      return;
    }
    if (message.kind === "load" && this.pendingBank !== null
      && message.data[0] === 0x4d && message.data[1] === 0x54
      && message.data[2] === 0x68 && message.data[3] === 0x64) {
      this.pendingVoices.add(message.voice);
      this.pending.push(message);
      return;
    }
    if ("voice" in message && message.voice !== null && this.pendingVoices.has(message.voice)) {
      if (message.kind === "stop") {
        const voice = message.voice;
        this.pendingVoices.delete(voice);
        for (let i = this.pending.length - 1; i >= 0; i--) {
          const queued = this.pending[i]!;
          if ("voice" in queued && queued.voice === voice) this.pending.splice(i, 1);
        }
      } else this.pending.push(message);
      return;
    }
    this.handle(message);
  }

  private isCompressedBank(message: AudioMessage | WorkletSetBankMessage): boolean {
    return message.kind === "setBank" && "bankBytes" in message
      && message.bankBytes !== null && soundBankHasCompressedSamples(message.bankBytes);
  }

  private handleWithoutDecoder(message: AudioMessage | WorkletSetBankMessage): void {
    if (this.isCompressedBank(message)) {
      if (!this.failureReported) {
        this.failureReported = true;
        this.port.postMessage({ kind: "decoder.error", detail: this.decoderError });
      }
      return;
    }
    this.handle(message);
  }

  private handle(message: AudioMessage | WorkletSetBankMessage): void {
    if (message.kind === "setBank" && "bankBytes" in message) {
      this.sink.setBankBytes(message.bank, message.bankBytes, message.bankSha);
      this.port.postMessage({ kind: "bank.accepted", bank: message.bank });
    } else {
      this.sink.handle(message as AudioMessage);
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (output === undefined || output.length < 2) return true;
    const left = output[0]!;
    const right = output[1]!;
    this.sink.render(left, right, left.length);
    return true;
  }
}

registerProcessor("tkr-pcm-processor", TkrPcmProcessor);
