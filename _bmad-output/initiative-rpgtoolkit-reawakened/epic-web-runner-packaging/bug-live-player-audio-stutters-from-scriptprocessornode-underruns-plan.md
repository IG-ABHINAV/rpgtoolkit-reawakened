---
title: 'Live player audio stutters from ScriptProcessorNode underruns'
type: 'bug'
ticket: '17'
status: 'in-review'
tracker_id: '#1043'
risk: 'medium'
---

# Plan

PR #1042 proposes the buffer mitigation. Issue #1043 records the original evidence, required real-output proof, and the buffer-assertion perturbation; a buffer-size check alone does not prove playback is dropout-free.

## Gap record (2026-11-03 audit; in-review, no status change here)

The mitigation this plan stubs (the buffer default) is superseded: the
ScriptProcessorNode default was the too-small 1024 frames, PR #1042 (`ee3db47e`)
raised it 1024 to 8192 as the stopgap, and PR #1165 (`0ddb39b9`, closed as
#1044) migrated the shipped path to AudioWorklet
— same-origin `apps/audio-worklet.js` (and the `app://` path on desktop) with 128-frame quanta, measured
8.7 ms onset latency against the 50 ms target, committed as CHANGELOG evidence. The browser
`audio.spec.ts` asserts the shipped graph is the worklet (`graphKind === "worklet"`), the onset latency
stays under 50 ms, and `graphBufferSize` is `null`; a ScriptProcessorNode regression fails that
assertion, which is the perturbation this issue's verify asks for in the worklet world. Remaining gap
precisely: the issue's own verify wants a representative live-run capture showing no audible dropouts
(the 11 Hz warble / 0.5 s gaps from the owner's 48 kHz recording never re-evidenced on the merged
path, and #1042's capture was untracked), so close the issue only after that capture is recorded; the
code and lane work to satisfy the verify already exists at merged main.
