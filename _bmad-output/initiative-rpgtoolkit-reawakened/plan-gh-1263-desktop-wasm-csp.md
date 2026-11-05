---
title: 'Allow desktop SoundFont decoder initialization'
type: 'bugfix'
ticket: ''
created: '2026-11-04'
status: 'built'
baseline_revision: '7d5b874610a7e5f066c68dc3d8b620bd228bedb3'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The desktop renderer reports an unhandled WebAssembly CSP error during startup, disabling the Vorbis decoder used by compressed SoundFonts.

**Approach:** Identify the actual instantiation, use the narrowest permitted CSP for the desktop player and measurement page, and prove both normal demo startup and the affected decoder under the real Electron CSP. Keep arbitrary JavaScript evaluation blocked and do not alter other player policies.

</frozen-after-approval>

## Implementation Notes

`spessasynth_core` imports `stb-vorbis`, whose module initializer eagerly instantiates the WebAssembly Vorbis decoder, even for the bundled SF2. It is used to decode SF3 compressed samples. A desktop-only `wasm-unsafe-eval` source permits WebAssembly but not JavaScript `unsafe-eval`; the normative CSP text needs correction first.

The interactive desktop page waits for the dependency's decoder-ready promise before opening a game, so an immediate compressed-bank load cannot silently race initialization. The test SF3 is an authored tone compressed into the existing minimal SF2.

## Plan Change Log

## Review Triage Log

Independent review identified that text-only CSP and Node audio tests did not exercise Electron or startup readiness. Added a real `app://` integration probe to the existing CI desktop input probe; a second review identified a timing-dependent check, replaced with a synchronous post-await marker. The reviewer confirmed the revised guard.

## Verification

Typecheck, focused CSP and SF3 tests, and real macOS Electron demo probe passed. Under the desktop page CSP, compressed-bank playback produced nonzero PCM, JavaScript evaluation was blocked, deferred decoder initialization held startup, and rejected initialization was reported. Reverting the desktop CSP made the policy test fail; removing the readiness await made the real Electron probe fail. Both perturbations were restored. The same browser failure was reproduced and filed separately as #1325.
