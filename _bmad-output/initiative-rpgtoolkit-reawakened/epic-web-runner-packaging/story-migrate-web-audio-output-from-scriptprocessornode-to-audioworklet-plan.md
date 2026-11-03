---
title: 'Migrate Web Audio output from ScriptProcessorNode to AudioWorklet'
type: 'feature'
ticket: '18'
status: done
tracker_id: '#1044'
risk: 'high'
---

# Plan

Issue #1044 records the latency/deprecation follow-up, affected output and packaging seams, and the required real browser and desktop measurements. This is not a claim that the buffer mitigation itself delivers a Worklet.

## Notes

- Merged: PR #1165 (0ddb39b9) migrates Web Audio output to `AudioWorklet` (`apps/audio-worklet.js`); issue #1044 is closed. Browser tests assert real Worklet output, non-silent audio, correct length and sub-50 ms measured latency; desktop and mobile load the same worklet module under the `app://` scheme with no policy widening.
- Residual, not yet claimed: the PR's "What CI must still prove" lists the desktop (Electron) and mobile (Capacitor) audio/CSP paths on CI hardware, and a drop-out-condition report is not recorded in the PR. #1042's buffer mitigation (ee3db47e) remains in place as fallback.
