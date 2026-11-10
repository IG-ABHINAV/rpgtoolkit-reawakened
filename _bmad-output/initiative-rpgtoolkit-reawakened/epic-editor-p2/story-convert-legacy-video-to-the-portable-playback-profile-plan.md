---
type: story
title: "Convert legacy video to the portable playback profile"
ticket: 13
status: draft
risk: high
---

## Scope

Implement the ruled AVI, MPG and MOV conversion using the approved host tool and portable profile, outside the runtime. Preserve logical names and recoverable originals, record input/output digests and conversion settings, and stage replacement safely.

Reuse 9.3 portable playback evidence; if the current runner does not support the approved profile, pin and complete a provider correction rather than simulating preview. Unavailable codecs/tools, cancellation, damaged inputs and failed conversion preserve existing project bytes. No bundled tool bypasses G6.

## Acceptance and verification

Convert tiny authored, rights-cleared clips for each input container, identify the actual output container/streams and play those bytes through the real runner at their original logical names. Check frame/audio presence and duration against the fixture, failure/cancel recovery and unsupported-host diagnostics. No nonempty-file-only proof.

## Prerequisites

14.11, 11.3, 9.3 (portable profile evidence) and 9.6 (VideoHost and DOM playback). Follow G1–G7, AD-18/19 and shared platform-services. This plan grants no unreviewed format or dependency choice.
