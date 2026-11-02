/**
 * AudioWorklet processor for the runner's PCM sink (issue #1044).
 *
 * The processor renders one `PcmSink` directly on the audio thread. The main thread resolves assets and banks
 * synchronously, then forwards protocol messages here; the worklet never does a synchronous read. The bundle is a
 * single-file IIFE loaded from `/apps/audio-worklet.js` (browser) or `app://player/apps/audio-worklet.js` (desktop).
 *
 * `docs/spec/engine/runners.md#audio` and `docs/spec/engine/audio-media.md#runner-audio-protocol` own the contract.
 */

import type { AudioMessage } from "@tk-reawakened/synth";
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

  constructor() {
    super();
    this.sink = new PcmSink({
      readAsset: () => null,
      readBank: () => null,
      outputRateHz: sampleRate,
    });
    this.port.onmessage = (event: MessageEvent<ProcessorMessage>) => {
      const data = event.data;
      if (data.kind === "message") {
        this.handle(data.message);
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

  private handle(message: AudioMessage | WorkletSetBankMessage): void {
    if (message.kind === "setBank" && "bankBytes" in message) {
      this.sink.setBankBytes(message.bank, message.bankBytes, message.bankSha);
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
