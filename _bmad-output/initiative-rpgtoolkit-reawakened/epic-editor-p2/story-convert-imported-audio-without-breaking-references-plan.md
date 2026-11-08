---
type: story
title: "Convert imported audio without breaking references"
ticket: 12
status: draft
risk: high
---

## Scope

Implement the approved import-time conversion outside core and synth playback. Cover each approved MP3, Ogg Vorbis, Opus and FLAC input, PCM WAV output, encoder-delay/padding removal and exact decoded frame count, source mono/stereo rate and approved downsampling. Consume header detection and metadata from 6.5; retain the original logical names.

Use the ruled host tool service, preserve recovery originals and stage output before replacement. Record input/output digests, trim and resampling in the import report rather than game data. Failures, cancellation, unsupported inputs and missing host tools never overwrite a source or claim success. No browser decoder determines core timing.

## Acceptance and verification

Use small authored/licensed samples with independently known PCM/frame counts, including delay/padding and resampling boundaries. Reopen converted bytes through the existing metadata reader and play them through the real audio source. Prove preserved names, source recovery, cancel/failure and repeated conversion behavior. Keep unit cases under one second; explain any slower integration proof.

## Prerequisites

14.11, 6.5, 9.5 (browser audio output and its PCM source) and 11.3. Follow G1–G7, AD-18/19 and shared platform-services. This plan grants no unreviewed format or dependency choice.
