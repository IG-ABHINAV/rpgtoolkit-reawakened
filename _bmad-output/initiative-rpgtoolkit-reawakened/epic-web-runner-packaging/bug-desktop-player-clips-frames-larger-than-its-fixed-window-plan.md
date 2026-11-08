---
title: 'Desktop player clips frames larger than its fixed window'
type: 'bug'
ticket: '20'
status: done
tracker_id: '#1050'
risk: 'medium'
---

# Plan

Issue #1050 records the documented clipping, the unresolved display choice, and the large-frame, input mapping and simulation-neutrality checks.

## Notes

- Merged: PR #1085 (81503cf8) fits and centres the logical canvas in the resizable desktop viewport with shared `fitCanvas` and `ResizeObserver`, pointer mapping on the displayed rectangle, per the approved owner ruling recorded doc-first in `docs/spec/engine/runners.md` ("Desktop fit — Approved ruling (owner: Jensen, 2026-11-02)"). Live Electron input/fit probe exercised 480×360, 960×720 and 1900×1600 viewports; perturbations (removing the fit hookup, flex-start centre, `round` instead of `floor`) each made the probe fail. Issue #1050 is closed. State neutrality rests on the design separation, not on a paired state-hash test.
