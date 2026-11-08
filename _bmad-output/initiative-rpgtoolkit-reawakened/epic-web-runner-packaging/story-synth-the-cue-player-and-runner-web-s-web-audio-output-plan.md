---
title: "synth: the cue player, and runner-web's Web Audio output"
type: 'feature'
ticket: 5
created: '2026-10-31'
status: done
tracker_id: "#930"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/930"
baseline_revision: '217a6bc6'
risk: 'high'
context:
  - 'docs/spec/engine/audio-media.md#cue-player, #audio-autoplay, #audio-focus, #audio-late-sounds, #runner-audio-protocol, #epic9-audio-handoff'
  - 'docs/spec/engine/runners.md#audio'
  - 'tools/fixtures/audio/sim.mjs (the cuePlayer oracle) and tools/fixtures/audio/common.mjs (the generator)'
  - 'packages/synth/schema/audio-protocol-v1.schema.json'
  - 'docs/guardrails.md, G3 (determinism), G4 (the runner owns no logic)'
---

# synth: the cue player, and runner-web's Web Audio output

## Intent

Close the browser's audio limb: the cue stream the core emits becomes protocol messages by one implementation every
runner copies, and the runner makes sound from it through PCM it pulls from `synth`'s own sources. The three runner
rules the spec states — autoplay unlock, the late-sound drop and the focus hold — are each a named test in Node and in
Chromium.

## Scope

`packages/synth` (the cue player), `packages/runner-web` (the PCM sink and its graph node), the audio kit generator and
the browser lane. No SoundFont path, no bank picker or shared bank cache (entry 6), no video (entry 6/entry 7), no prefetch (entry 9).

## Decisions taken here

1. **The start arithmetic is a pure function; the state machine is a class over it.** `cueStart(cue, readyTick, info)`
   is the table's `media.play`, `media.seek` and `media.fade` rows and nothing else, so it can be checked against the
   oracle on every committed expectation without a device. `CuePlayer` holds the maps and the queues.
2. **Lateness is measured when the voice is ready.** The cue's start is computed in `ready()`, never when the cue
   arrives. This is the rule, and it is also a defect the first draft had: a queued `play` was computed at cue time, so
   a slow decode never dropped anything. The lane now proves both sides — lateness 14 starts at 14, lateness 15 is
   stopped and never played.
3. **A voice that has not answered `ready` holds everything but its `load`.** The `load` goes out at once (it is what
   starts the source), and every other message — the `play`, a volume, a fade, a pause — waits in order and is realised
   or sent at `ready`. A failed voice drops its held messages.
4. **The autoplay lock mirrors, it does not drop.** While locked the player records what should be playing and sends no
   `load` or `play`; at unlock each mirrored voice's `load` goes out, and its cue is realised at the gesture's tick as an
   ordinary late start, so music joins at the caught-up position and only missed finite effects are stopped.
5. **The output pulls, so the lane can assert without a speaker.** `PcmSink` holds one `synth` `SourceVoice` per
   protocol voice and `render(left, right, frames)` is the whole output path; the browser graph is a
   `ScriptProcessorNode` that calls it. The deterministic assertion is the energy of that pull.
6. **The vector kit committed less than the arithmetic reads.** A runner expectation recorded only the cue's identity
   (`cueId`, `tick`, `kind`, `track`), so a `media.seek`'s `loop`/`playing` and a cue's `positionTicks`/`volume` came from
   generator-local defaults — the vector could not pin what it demonstrated. The generator now commits the whole cue plus
   `loop` and `playing`, and the fixtures were regenerated. Nothing in `packages/core` reads those fields; only the
   runner-side block changed.
7. **The analyser is reported, never asserted.** A headless `AudioContext` stays suspended without a gesture, so
   `resume()` is not awaited (awaiting it hangs the page) and the analyser reading is informational. The graph is still
   attached on the shipped path, and the plan records why the assertion is the sink's pull instead.

## Verification

- `packages/synth/test/cue-player.test.ts` — `cueStart` against **every** committed cue-player expectation in
  `packages/core/test/fixtures/audio/*.json`, plus the worked example `[0, 90, 60]`, the 15-tick threshold at 14 and 15,
  the fade arithmetic, and the three rules through `CuePlayer`.
- `packages/runner-web/test/audio-sink.test.ts` — the sink over real authored WAV fixtures: length in ticks,
  non-silence and silence past the end, bus mute, looping, `ended` once, pause/resume, stop, and the two error paths.
- `tools/browser/tests/audio.spec.ts` — the same three rules end to end in headless Chromium, plus the pulled energy and
  the fixture's 0.5 s length.

## Gap, by design

MIDI needs a SoundFont bank. `setBank` is recorded by the sink and a voice whose source needs one fails with
`bank.missing` rather than playing silence; the SoundFont path, the player's bank picker and the shared bank cache are
entry 6's. The bundled bank exists at `media/soundfonts/TK-16.sf2` but nothing loads it yet.

## Landing

Merged as **`ce6d105b`** — "feat(entry 5): the cue player, and PCM from the synth into the browser's audio graph" (PR
[#989](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/989), squash; #930 closed as completed). One commit.

The vector kit changed with it: a runner expectation committed only the cue's identity, so a `media.seek`'s
`loop`/`playing` and a cue's `positionTicks`/`volume` came from generator defaults and `seek-and-fade-cues-late` expected
a wrapped position no committed fact implied. The generator now commits the whole cue plus those two facts, and the kit
was regenerated; `packages/core` reads neither field, so only the runner-side block moved. No golden, hash or baseline
PNG changed. CI run 41253722426 green on every check, including `unit (synth)`, `unit (runner-web)`, the `browser` lane
and the coverage `gate`.

## Out of scope

The SoundFont path and bank cache (entry 6), video and the `video` wait (entry 6/entry 7), prefetch tiers (entry 9), the desktop and
mobile wrappers' audio devices (entry 11, entry 12).

## Close-out record

Merged in PR #989 (merge commit `ce6d105b7`, 2026-10-31). Verified in the
committed browser lane: `tools/browser/tests/audio.spec.ts` asserts analyser
non-silent energy, the fixture's own duration, locked-then-unlocked join and
the 15-tick drop. Ledger entry reconciled to closed issue #930 in the
2026-11-03 ticket audit.
