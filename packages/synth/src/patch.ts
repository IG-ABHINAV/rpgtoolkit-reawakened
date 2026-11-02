import { BasicMIDI, MIDIMessage, type MIDIMessageType } from "spessasynth_core";

// Which instrument a MIDI file's program changes get from a bank, by the owner's ruling
// (docs/spec/engine/audio-media.md#midi-bank-fallback), and the one log line for each that had to be substituted.
//
//   melodic:    the requested bank and program, then bank 0 with the same program, then bank 0 program 0; silent only if
//               none of those exist.
//   percussion: bank 128 with the same program, then bank 128 program 0; silent only if neither exists.
//
// SpessaSynth chooses differently when a patch is missing (it may take another bank's program, the first preset it
// lists, or any drum preset, and it never goes silent), so the wrapper resolves each request here and hands the synth
// an exact bank and program. Bank 128 is the percussion bank, as in a SoundFont; program numbers are 0-127.

/** One instrument a MIDI file asks for. */
export interface PatchRequest {
  readonly percussion: boolean;
  /** Bank select MSB for a melodic channel; 128 for percussion. */
  readonly bank: number;
  /** 0-127. General MIDI numbers programs from 1, so program 48 here is GM program 49. */
  readonly program: number;
}

export type PatchResolution =
  | { readonly kind: "exact" | "substitute"; readonly bank: number; readonly program: number }
  | { readonly kind: "silent" };

export interface PatchDecision {
  readonly request: PatchRequest;
  readonly resolution: PatchResolution;
}

const key = (bank: number, program: number): string => `${bank}:${program}`;

/** The `bank:program` of every preset in a SoundFont's preset header table; empty if the bytes are not a SoundFont. */
export function bankPresetTable(bytes: Uint8Array): ReadonlySet<string> {
  const presets = new Set<string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number): string => String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "sfbk") return presets;
  const walk = (from: number, to: number): void => {
    let at = from;
    while (at + 8 <= to && at + 8 <= bytes.length) {
      const size = view.getUint32(at + 4, true);
      if (tag(at) === "LIST") walk(at + 12, Math.min(to, at + 8 + size));
      else if (tag(at) === "phdr") {
        // 38-byte records; the last is the terminal "EOP" record.
        const count = Math.floor(size / 38) - 1;
        for (let i = 0; i < count; i++) {
          const record = at + 8 + i * 38;
          presets.add(key(view.getUint16(record + 22, true), view.getUint16(record + 20, true)));
        }
      }
      at += 8 + size + (size & 1);
    }
  };
  walk(12, bytes.length);
  return presets;
}

/** The owner's fallback order for one request. */
export function resolvePatch(request: PatchRequest, presets: ReadonlySet<string>): PatchResolution {
  const order = request.percussion
    ? [[128, request.program], [128, 0]]
    : [[request.bank, request.program], [0, request.program], [0, 0]];
  for (const [index, [bank, program]] of order.entries()) {
    if (presets.has(key(bank!, program!))) return { kind: index === 0 ? "exact" : "substitute", bank: bank!, program: program! };
  }
  return { kind: "silent" };
}

interface ChannelState {
  bank: number;
  program: number;
  silent: boolean;
}

/**
 * Rewrites a MIDI file's patch selection into exact bank and program messages, in time order, and records what each
 * request resolved to. Notes on a channel whose request resolved to silence are dropped; everything else passes
 * through unchanged. With no preset table (a bank that did not parse) every message passes through.
 */
export class PatchRouter {
  readonly decisions = new Map<string, PatchDecision>();
  private readonly presets: ReadonlySet<string> | null;
  private readonly channels: ChannelState[] = Array.from({ length: 16 }, () => ({ bank: 0, program: -1, silent: false }));

  constructor(presets: ReadonlySet<string>) {
    this.presets = presets.size === 0 ? null : presets;
  }

  route(event: MIDIMessage): MIDIMessage[] {
    if (this.presets === null) return [event];
    const type = event.statusByte & 0xf0;
    const channel = event.statusByte & 0x0f;
    const state = this.channels[channel]!;
    if (type === 0xb0 && event.data[0] === 0) {
      state.bank = event.data[1] ?? 0; // the explicit bank select is sent with each resolved program change
      return [];
    }
    if (type === 0xc0) {
      state.program = event.data[0] ?? 0;
      return this.select(event.ticks, channel);
    }
    if (type === 0x90 && (event.data[1] ?? 0) > 0) {
      const selected = state.program < 0 ? (state.program = 0, this.select(event.ticks, channel)) : [];
      return state.silent ? [] : [...selected, event];
    }
    return [event];
  }

  private select(ticks: number, channel: number): MIDIMessage[] {
    const state = this.channels[channel]!;
    const request: PatchRequest = channel === 9
      ? { percussion: true, bank: 128, program: state.program }
      : { percussion: false, bank: state.bank, program: state.program };
    const resolution = resolvePatch(request, this.presets!);
    this.decisions.set(`${request.percussion ? "p" : "m"}:${request.bank}:${request.program}`, { request, resolution });
    state.silent = resolution.kind === "silent";
    if (resolution.kind === "silent") return [];
    const out: MIDIMessage[] = [];
    if (!request.percussion) out.push(new MIDIMessage(ticks, (0xb0 | channel) as MIDIMessageType, Uint8Array.of(0, resolution.bank)));
    out.push(new MIDIMessage(ticks, (0xc0 | channel) as MIDIMessageType, Uint8Array.of(resolution.program)));
    return out;
  }
}

/** Every instrument a MIDI file asks for that the bank does not have exactly, in the order they were first asked for. */
export function missingPatches(midiBytes: Uint8Array, bankBytes: Uint8Array): readonly PatchDecision[] {
  try {
    const midi = BasicMIDI.fromArrayBuffer(midiBytes.buffer.slice(midiBytes.byteOffset, midiBytes.byteOffset + midiBytes.byteLength) as ArrayBuffer);
    const router = new PatchRouter(bankPresetTable(bankBytes));
    for (const entry of midi.timeline) {
      const event = midi.tracks[entry.tr]?.events[entry.ev];
      if (event !== undefined) router.route(event);
    }
    return [...router.decisions.values()].filter((decision) => decision.resolution.kind !== "exact");
  } catch {
    return []; // an unreadable MIDI file is the source's error to report, not this log's
  }
}

/** The one line a host logs for a substituted instrument. Raw 0-127 values, labelled, because GM counts from 1. */
export function describePatchGap(gap: {
  readonly bankId: string;
  readonly sha256: string;
  readonly request: PatchRequest;
  readonly substitute: { readonly bank: number; readonly program: number } | null;
  readonly asset: string;
}): string {
  const { request, substitute } = gap;
  const wanted = request.percussion
    ? `percussion program ${request.program} (0-based; GM program ${request.program + 1})`
    : `bank ${request.bank} program ${request.program} (0-based; GM program ${request.program + 1})`;
  const instead = substitute === null
    ? "so that channel is silent"
    : request.percussion
      ? `so percussion program ${substitute.program} plays instead`
      : `so bank ${substitute.bank} program ${substitute.program} plays instead`;
  return `SoundFont ${gap.bankId} (sha256 ${gap.sha256.slice(0, 12)}) has no ${wanted}, first asked for by ${gap.asset}, ${instead}`;
}
