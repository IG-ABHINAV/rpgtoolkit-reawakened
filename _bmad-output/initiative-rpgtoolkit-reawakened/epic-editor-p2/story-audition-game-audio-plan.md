---
type: story
title: "Audition game audio"
ticket: 5
status: draft
risk: medium
---

# Audition game audio

## Scope

Provides accessible play, stop and loop audition of supported game audio through existing synth and host audio services, including the project default SoundFont and explicit capability and autoplay failures.

Use packages/synth and platform-services rather than another sound engine; report unsupported formats and browser autoplay unlock explicitly. The Epic 6 handoff also names MP3/OGG and AVI transcode on import; this audition story does not implement an importer or transcoder, and the initiative owner must assign or decide that separate handoff rather than treat preview as fulfilling it.

## Acceptance and verification

MIDI and WAV play and stop in supported hosts with the configured SoundFont, loop is observable, unsupported media is explained, and audition does not alter or save the source asset.

## Dependencies and decisions

Requires 6.5 (WAV/MIDI metadata), 6.15 (audio protocol), 9.5 (synth cue player and web output), 9.6 (SoundFont resolution), 11.1, 11.4 and 11.6 (project setting). Follow the approved contracts and capability declarations; do not assume unimplemented provider behavior.
