---
title: "The SoundFont path, the bank cache and the runner's video half"
type: 'feature'
ticket: 6
created: '2026-10-31'
status: done
tracker_id: "#931"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/931"
baseline_revision: 'ccffeee9'
risk: 'high'
context:
  - 'docs/spec/engine/audio-media.md#soundfont-layers, #soundfont-state, #soundfont-cue, #soundfont-user-bank, #path-b-bank, #audio-soundfont-cache'
  - 'docs/spec/engine/audio-media.md#video-request, #video-policy, #video-wait-hold, #video-music, #video-headless'
  - 'docs/spec/engine/runners.md#audio'
  - 'media/soundfonts/TK-16.sf2, THIRD_PARTY_NOTICES, tools/licences/tk16-provenance.json'
  - 'docs/guardrails.md, G6 (licence bar), G4 (the runner owns no logic)'
---

# The SoundFont path, the bank cache and the runner's video half

## Intent

Make MIDI audible through a bank the project may ship, through the four ranks the spec names, with a cache that cannot
pull a bank out from under a playing voice — and give the browser the video half the envelope names, where every
`playVideo` is answered exactly once and nothing can hang a game.

## Scope

`packages/synth` (bank resolution and the cache), `packages/runner-web` (the bank path in the sink, `VideoHost` and its
presentation rule), the two pages and the lane. No player-facing picker *UI* (entry 9/entry 10), no bank prefetch (entry 9), no
played-video fixture (entry 7).

## Decisions taken here

1. **Four ranks, resolved in one exhaustive function.** `effectiveBank({player, author, runner, bundled})` returns the
   first non-null and names the rank, so a diagnostic can say why this bank is playing. The cue's `soundfont.set` asset is
   the author layer, and a player choice passed by the host wins over it — a cue can never override the player, which is
   MEDIA-5's rule. No fifth rank exists in the type, so one cannot be reintroduced silently.
2. **The spec still carried the retired fifth rank.** Its user-bank rule 6 said "rank 2/3/4/5 resolution"; it now says
   2/3/4 and records that the fifth never comes back. That is the only docs change the owner's constraint required.
3. **A bank is validated, not trusted.** RIFF `sfbk` or `bank.invalid`; above the 8 MiB ceiling or `bank.unavailable`; a
   declared SHA-256 that does not match the bytes is `bank.invalid`. A failure keeps the previous bank and reports the
   code, which is the contract's user-bank rule 5.
4. **The cache is keyed by SHA-256, and pins what it lends.** `acquire` hashes the bytes it was given (a `BankRef`'s
   `sha256` is only checked, never used as the key without hashing), so two games naming the same bytes — even under
   different ids — share one entry and one load. Eviction only considers entries with no users: the cache may exceed its
   capacity rather than break a voice, and `sweep()` is the explicit tidy.
5. **SHA-256 is written out in `synth`.** The cache is synchronous and the runner is a browser, so WebCrypto's async
   digest and `node:crypto` are both out. The implementation is checked against the published vectors (empty and
   `abc`) and against the bank's own recorded hash.
6. **TK-16 is the bundled layer, and it works.** `media/soundfonts/TK-16.sf2` hashes to the notice's
   `5419f02b…`, is a RIFF `sfbk` container, and a 120-tick MIDI fixture renders non-silent PCM through it in Node and in
   headless Chromium. It is the bundled *layer*, not an owner-approved default: selecting it as the default is PB-10, a
   listening decision, so a host that wants it off simply passes no bundled layer. The notice's wording is unchanged.
7. **Video is policy plus a DOM binding.** `VideoHost` owns the rules (one outstanding, one reply, hold and release) and
   `present` is injected, so a test drives it without a DOM and the page binds a real `<video>`. A missing asset, an
   undecodable container and a busy request each get their one reply; the hold goes in only for a video that started.
8. **No VP9/WebM fixture ships yet.** The lane therefore proves the three failure and policy paths and the hold/release,
   and the played path is named as entry 7's rather than faked with a substitute container.

## Verification

- Node: `packages/synth/test/bank.test.ts` (8) — rank precedence and the absent fifth, the file's own hash, the SHA
  vectors, container/ceiling/hash-refusal, one-entry-two-games sharing, eviction skipping a pinned bank, and
  `bank.missing`.
- Node: `packages/runner-web/test/audio-sink.test.ts` (13) — TK-16 loads and MIDI renders non-silent; a bankless MIDI
  voice is `bank.missing` while WAV is unaffected; `bank.invalid` keeps the previous bank; an oversized bank is
  `bank.unavailable`.
- Node: `packages/runner-web/test/video.test.ts` (7) — one reply per request on the missing, undecodable and busy
  paths, hold/release ordering, unknown `reqId` ignored, and the presentation CSS.
- Chromium: `tools/browser/tests/audio.spec.ts` now also asserts the bank's SHA-256 and a non-silent 120-tick MIDI
  render; `tools/browser/tests/video.spec.ts` asserts the three reply paths, the hold/release and the CSS.

## Landing

Merged as **`888db1c6`** — "feat(entry 6): the SoundFont path, the SHA-256 bank cache and the runner's video half" (PR
[#991](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/991), squash; #931 closed as completed). One commit.

TK-16 loads and renders in Node and in headless Chromium, and the notice's SHA-256 is verified by our own implementation.
The spec's stale "rank 2/3/4/5" is the one docs change this entry made, and no licence record changed. CI run
41255342953 green on every check, including `unit (synth)`, `unit (runner-web)`, the `browser` lane (6 tests) and the
coverage `gate`.

## Out of scope

The player-facing bank picker UI and durable storage of a user bank (entry 9/entry 10), bank prefetch tiers (entry 9), the played
video path and its fixture (entry 7), and any change to TK-16's licence record.

## Close-out record

Merged in PR #991 (merge commit `888db1c67`, 2026-11-01). What is proven: the
four-rank precedence with the bundled bank, the SHA-256 bank cache with one
stored bank shared across two games, the `bank.invalid` refusal for a
mismatched hash, and eviction that never removes the bank in use — at unit
level (the committed audio spec asserts the bundled bank's SHA-256 through the
player). Honest caveat, recorded rather than rewritten into the verify: the
user-`.sf2` picker limb was never built — `packages/runner-web/app/audio.ts`
hard-codes the bundled bank in `bankLayers` with no file input, so a person
cannot choose a bank in the shipped player. Tracked for the player page as
issue #1228 (bug). Ledger entry reconciled to closed issue #931 in the
2026-11-03 ticket audit.
