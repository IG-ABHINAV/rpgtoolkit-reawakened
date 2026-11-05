---
title: 'Harden Android APK install timeout'
type: 'bugfix'
ticket: ''
created: '2026-11-04'
status: 'in-progress'
baseline_revision: '568618127a43c82484c2ea138b0bc53ca46aa60a'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['docs/guardrails.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** APK installation on a newly booted emulator shares a 15-second limit with ordinary adb calls and can fail without useful timeout details.

**Approach:** Give installation its own longer bounded timeout while retaining the shorter ordinary and attachment deadlines. Preserve process exit, signal, timeout and output evidence so timeouts, launch errors and package rejections are distinguishable. Keep the real emulator proof and its assertions unchanged.

</frozen-after-approval>

## Implementation Notes

One-shot: internal mobile proof command handling and focused subprocess regressions. Preserve the empty-stderr exit-1 `pidof` classification used to distinguish absent processes from transport failures. This work is separate from #1251; its CI may remain blocked until that issue's real emulator proof succeeds.

Node 24.21.0 mobile proof tests passed 15/15 and ESLint passed. Tests prove the 120-second install budget reaches the command executor, exercise actual child-process success and rejection, and simulate timeout/spawn metadata; they do not claim a slow real emulator was observed.

## Plan Change Log

## Review Triage Log

- Patched: the first version dropped timeout/spawn details from existing attachment and failure artifacts. Null-status failures now retain code and signal even when stderr is nonempty, while exit-1 `pidof` still has empty stderr.
- Patched: installation failures now report both stdout and stderr, so a package rejection is not hidden by a warning.
- Independent delta review found no remaining issues. Hosted emulator CI remains pending.

## Verification

Verify the installation-specific timeout is passed to the command executor, test synthetic timeout metadata and real subprocess success and rejection, run existing mobile proof tests and lint, and obtain independent review. The regression does not wait 15 seconds or simulate a slow real emulator. Real emulator CI is required and must not be called green while pending.
