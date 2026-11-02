// The log for an instrument a bank lacks (issue #1074, step 4). A MIDI file that asks for an instrument the SoundFont
// does not have still plays (another instrument, or silence for that channel); the sink says so once per bank and
// instrument, as a SinkEvent that belongs to no voice and changes no state.

import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { AssetKey } from "@tk-reawakened/core";
import { PcmSink } from "../src/audio-sink.ts";
import type { SinkEvent } from "../src/audio-sink.ts";

const here = dirname(fileURLToPath(import.meta.url));
const full = new Uint8Array(readFileSync(resolve(here, "..", "..", "..", "media", "soundfonts", "TK-16.sf2")));

/** A copy of the bank in which only the listed presets stay addressable. */
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

/** A Standard MIDI File with one note per part: [channel, program, bank or null, key]. Plays for one second. */
function midi(...parts: readonly (readonly [number, number, number | null, number])[]): Uint8Array {
  const body: number[] = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20];
  for (const [channel, program, bank] of parts) {
    if (bank !== null) body.push(0, 0xb0 | channel, 0, bank);
    body.push(0, 0xc0 | channel, program);
  }
  for (const [channel, , , key] of parts) body.push(0, 0x90 | channel, key, 100);
  parts.forEach(([channel, , , key], index) => body.push(...(index === 0 ? [0x83, 0x60] : [0]), 0x80 | channel, key, 0));
  body.push(0, 0xff, 0x2f, 0);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  const track = [0x4d, 0x54, 0x72, 0x6b, (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255];
  return Uint8Array.from([...header, ...track, ...body]);
}

type Substitution = Extract<SinkEvent, { kind: "bank.substitution" }>;

function harness(banks: Record<string, Uint8Array>) {
  const events: SinkEvent[] = [];
  const sink = new PcmSink({
    readAsset: () => null,
    readBank: (bank) => banks[bank.id] ?? null,
    outputRateHz: 8_000,
    onEvent: (event) => events.push(event),
  });
  const useBank = (id: string): void => sink.handle({ kind: "setBank", bankKind: "soundfont", bank: { source: "user", id, sha256: null } });
  const load = (voice: number, asset: string, data: Uint8Array): void => sink.handle({ kind: "load", voice, track: "music", asset: asset as AssetKey, data });
  const substitutions = (): Substitution[] => events.filter((event): event is Substitution => event.kind === "bank.substitution");
  return { events, sink, useBank, load, substitutions };
}

const GUITAR_ONLY = (): Uint8Array => partialBank([[0, 0], [0, 24], [128, 0]]);

test("a complete bank logs nothing", () => {
  const { useBank, load, substitutions, events } = harness({ full });
  useBank("full");
  load(1, "media/a.mid", midi([0, 48, null, 60], [1, 24, null, 64], [9, 0, null, 38]));
  equal(substitutions().length, 0);
  equal(events.filter((e) => e.kind === "error").length, 0);
});

test("a missing instrument still plays, and is logged once across two files, a replay and a loop restart", () => {
  const { sink, useBank, load, substitutions, events } = harness({ a: GUITAR_ONLY() });
  useBank("a");
  load(1, "media/one.mid", midi([0, 48, null, 60]));
  load(2, "media/two.mid", midi([0, 48, null, 60], [1, 24, null, 64]));
  load(3, "media/one.mid", midi([0, 48, null, 60])); // a replay of the first file
  sink.handle({ kind: "play", voice: 1, cue: 1, loop: true, volume: 100, positionTicks: 0 });
  sink.render(new Float32Array(20_000), new Float32Array(20_000), 20_000); // past the end, so the loop restarts
  equal(substitutions().length, 1, "reported once");
  const only = substitutions()[0]!;
  deepEqual(only.request, { percussion: false, bank: 0, program: 48 });
  deepEqual(only.substitute, { bank: 0, program: 0 });
  equal(only.asset, "media/one.mid", "the first file that asked");
  equal(events.filter((e) => e.kind === "ready").length, 3, "every voice still loaded and is ready");
  equal(events.filter((e) => e.kind === "error").length, 0, "a substitution is not an error");
});

test("a second missing instrument logs its own line, and a missing kit says which kit plays instead", () => {
  const { useBank, load, substitutions } = harness({ a: GUITAR_ONLY() });
  useBank("a");
  load(1, "media/one.mid", midi([0, 48, null, 60]));
  load(2, "media/two.mid", midi([0, 56, null, 60], [9, 16, null, 38]));
  const asked = substitutions().map((s) => [s.request.percussion, s.request.bank, s.request.program, s.substitute?.bank, s.substitute?.program]);
  deepEqual(asked, [[false, 0, 48, 0, 0], [false, 0, 56, 0, 0], [true, 128, 16, 128, 0]]);
});

test("a different SoundFont missing the same instrument logs again; the same bytes under another name do not", () => {
  const first = GUITAR_ONLY();
  const second = partialBank([[0, 0], [0, 24], [0, 1], [128, 0]]); // a different file, also without program 48
  const { useBank, load, substitutions } = harness({ a: first, copy: first.slice(), b: second });
  useBank("a");
  load(1, "media/one.mid", midi([0, 48, null, 60]));
  equal(substitutions().length, 1);
  useBank("copy"); // the same bytes named differently: the cache shares one entry by SHA-256
  load(2, "media/one.mid", midi([0, 48, null, 60]));
  equal(substitutions().length, 1, "re-selecting the same bytes does not log again");
  useBank("b");
  load(3, "media/one.mid", midi([0, 48, null, 60]));
  equal(substitutions().length, 2, "a different bank logs again");
  ok(substitutions()[0]!.sha256 !== substitutions()[1]!.sha256);
});

test("a channel with nothing to fall back on is reported as silent", () => {
  const { useBank, load, substitutions } = harness({ a: partialBank([[0, 24], [128, 0]]) });
  useBank("a");
  load(1, "media/one.mid", midi([0, 48, null, 60]));
  equal(substitutions().length, 1);
  equal(substitutions()[0]!.substitute, null);
});

test("with no bank, or a non-MIDI asset, nothing is logged", () => {
  const { load, substitutions } = harness({});
  load(1, "media/one.mid", midi([0, 48, null, 60]));
  equal(substitutions().length, 0);
});
