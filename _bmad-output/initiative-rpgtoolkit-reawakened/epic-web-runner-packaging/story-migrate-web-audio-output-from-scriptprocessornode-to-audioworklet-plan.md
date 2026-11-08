---
title: 'Migrate Web Audio output from ScriptProcessorNode to AudioWorklet'
type: 'feature'
ticket: '18'
status: built
tracker_id: '#1044'
risk: 'high'
---

# Plan

Issue #1044 records the latency/deprecation follow-up, affected output and packaging seams, and the required real browser and desktop measurements. This is not a claim that the buffer mitigation itself delivers a Worklet.

## Notes

- Merged: PR #1165 (0ddb39b9) migrates Web Audio output to `AudioWorklet` (`apps/audio-worklet.js`); issue #1044 is closed. Browser tests assert real Worklet output, non-silent audio, correct length and sub-50 ms measured latency.
- Not done: PR #1165's own body says desktop (Electron) and mobile (Capacitor) audio/CSP paths remain for CI hardware/emulator proof, and its acceptance evidence is browser-only; no dropout-condition report is recorded. Desktop uses `app://player/apps/audio-worklet.js`; the mobile app does not use that `app://` scheme.
- `packages/runner-web/src/audio-sink.ts` retains a 2048-frame `ScriptProcessorNode` fallback (lines 446, 456). Do not attribute that buffer size to #1042's prior mitigation. Keep this ticket built, not done, until desktop playback plus the dropout report are evidenced or the owner accepts the gap in writing.
