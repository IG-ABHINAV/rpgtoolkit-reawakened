---
title: 'Diagnose Android screenshot utility context'
type: 'bugfix'
ticket: ''
created: '2026-11-06'
status: 'in-progress'
baseline_revision: '6f4a3bc34fb0d1cd38f24830703af9d44227b469'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Android CI times out in Playwright screenshot viewport evaluation, blocking the required gate; the precise pending stage is unknown.

**Approach:** Instrument the actual Playwright path temporarily with bounded metadata-only markers in a diagnostic CI run, preserving all proof assertions and deadlines. Use the resulting evidence to identify and fix the cause rather than bypassing the screenshot.

</frozen-after-approval>

## Implementation Notes

Oneshot investigation: the necessary instrumentation is narrowly scoped; implementation of a fix depends on the observed failure.

## Plan Change Log

## Review Triage Log

## Verification

- Check the diagnostic patch matches the pinned Playwright bundle exactly and produces valid JavaScript.
- Run the actual Android CI proof and inspect its markers; no local emulator is attached.
- Verify any eventual fix with the unweakened required gate.
