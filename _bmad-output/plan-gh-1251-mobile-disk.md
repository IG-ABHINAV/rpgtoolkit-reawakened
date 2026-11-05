---
title: 'Reserve disk for the Android CI emulator'
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

**Problem:** The required Android CI emulator cannot create its userdata partition when the hosted runner runs out of disk. Reducing its configured partition size did not prevent the observed failure.

**Approach:** Reclaim unused hosted-runner toolchains before Android installation, install the required API 33 image before checking remaining space, and fail early with actionable disk evidence if the emulator cannot start safely. Keep the same real APK, KVM, emulator, interaction, persistence and gate requirements. Verify with workflow regression tests and the real hosted CI job; do not conflate the separate post-boot installation timeout.

</frozen-after-approval>

## Implementation Notes

One-shot: narrowly scoped workflow and workflow regression changes. The failing #1323 run logged 4316.08 MB free and 7372.80 MB required for userdata despite the 2048M setting. Use only unused hosted-runner toolchains, not the Android SDK, Java, Node, project, or proof artifacts. The disk check must inspect the filesystem that holds the AVD after the system image is installed.

The Node 24.21.0 workflow regression suite passed 20/20 and ESLint passed. The real hosted emulator proof remains pending CI.

## Plan Change Log

## Review Triage Log

- Patch: the initial disk check used `$HOME` rather than the actual AVD directory, which could be a different mount. It now creates and checks `$HOME/.android/avd`, the exact path set by the emulator action; the shell regression rejects other paths.
- The reviewer correctly noted the real hosted CI proof was not yet available; it must not be treated as passed until the pull request's mobile job finishes.

## Verification

Execute regression tests against the actual workflow shell, check workflow structure and syntax, obtain independent review, and verify the real API 33 emulator boots and completes the unchanged mobile proof in CI. A pending or failed CI run is not a pass.
