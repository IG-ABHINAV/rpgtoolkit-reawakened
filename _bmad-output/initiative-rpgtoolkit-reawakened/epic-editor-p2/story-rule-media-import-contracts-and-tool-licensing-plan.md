---
type: story
title: "Rule media import contracts and tool licensing"
ticket: 11
status: draft
risk: high
---

## Scope

Review `docs/spec/engine/audio-media.md#audio-import-policy`, `#video-policy` and `#audio-authoring-handoff`, including their pending-owner-review labels. Obtain a docs-first ruling before implementation; do not invent a runtime codec or presume that a proposed portable profile was verified.

Specify MP3/Ogg Vorbis/Opus/FLAC to WAV, gapless trimming, source channels/sample rate and bounded resampling; AVI/MPG/MOV to the portable profile verified by 9.3. Preserve logical names without rewriting game references. Define separate recovery originals, staging, reporting, cancellation and repeated imports. Decide the exact versioned decoder/encoder licences and transitive licences under G6, or the explicit interface to a user-installed external tool; an external tool is not permission to redistribute it.

Name browser/VS Code/desktop capabilities, installation prompts and unsupported-operation behavior. Pin any additional runtime or host provider that the evidence reveals before dependent stories are runnable; an unresolved licence or codec gap blocks implementation. No scope may be silently dropped.

## Acceptance and verification

Owner-approved contract and real tool/profile probes demonstrate each permitted route, licences and host limitation. This is a decision/evidence story, not an implemented importer. Amend affected specs first and record approval; do not reopen unrelated settled audio settings or Monaco/Electron.

## Prerequisites

11.1, 6.3 and 9.3. Follow G1–G7, AD-18/19 and the shared platform-services contract. This plan does not grant an unreviewed format or dependency choice.
