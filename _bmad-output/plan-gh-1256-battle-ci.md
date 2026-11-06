---
title: 'Reduce battle UI recovery snapshot overhead'
type: 'refactor'
ticket: ''
created: '2026-11-04'
status: 'built'
baseline_revision: '568618127a43c82484c2ea138b0bc53ca46aa60a'
route: 'oneshot'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['docs/guardrails.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The coverage-enabled battle UI shard is slow, and pre-battle recovery snapshots redundantly serialize and parse the same state before serializing it again.

**Approach:** Measure the pinned-Node CI shard and representative case; if verified worthwhile, remove redundant recovery serialization without changing canonical bytes, state hashes, tick behavior, assertions, or coverage. Keep G1–G7 and the existing save/recovery contract.

</frozen-after-approval>

## Implementation Notes

One-shot: a narrowly scoped internal serialization change and focused byte-equivalence regression need no public contract change. The prior profile implicated recovery candidate serialization; independent investigation found this runs at the pre-battle boundary, not every battle advance. Existing revision-safe surface serialization and hash caches must remain intact. Accept only measured improvement, otherwise report the evidence honestly.

The pinned Node 24.21.0, coverage-enabled selected-row profile also attributed 15.69% of samples to string canonicalization under state hashing and 7.34% to canonicalization under recovery capture. The implementation therefore adds an equivalent native escape path for long surrogate-free strings while retaining strict rejection of invalid UTF-16. No state, hash, save, or recovery contract changes.

Baseline and optimized runs used Node 24.21.0 on the same macOS arm64 workstation with V8 coverage. The exact `core-battle` CI shard passed 304/304 both times: baseline 253.64 s wall / 883.59 s user CPU, optimized 93.62 s wall / 458.27 s user CPU. Host contention differed substantially (baseline 2,397,501 involuntary context switches; optimized 295,581), so wall-time change is not a CI prediction. Back-to-back coverage runs of the 11 list/overlay cases passed 11/11 both times: 87.74 s / 159.82 s user CPU before and 51.68 s / 89.53 s user CPU after; selected-row case 14.23 s to 8.46 s and long-list case 20.12 s to 13.09 s. No assertions or tick observations changed. Shard coverage report changed from 65.81% lines / 64.64% branches to 65.74% / 64.56%; detailed LCOV comparison identified changed sprite-animation hit reporting outside modified files. Investigate this drift rather than assuming a cause; CI's merged coverage gate remains authoritative.

The unmodified baseline was repeated in a clean detached worktree: 304/304 passed, 203.62 s wall / 867.10 s user CPU, with the same 134 covered sprite-animation lines as the optimized run. The first baseline reported 180 covered lines. Since identical source and test inputs produce both reports, #1330 tracks the unexplained coverage-report variability; it is not evidence of an intentional reduction. Focused case-pair LCOV differed only in the two changed source files.

The second optimized shard also passed 304/304 in 92.90 s wall / 453.99 s user CPU and reported 180 covered sprite-animation lines, showing the same reporting variability in both versions. The independent reviewer checked the recorded LCOV findings and reported no remaining substantive source or test findings.

Focused canonical/save/surface tests passed 65/65 on Node 24.21.0; typecheck, lint, Node golden, closing and corpus checks, and Bun golden/closing passed. No golden files were regenerated.

## Plan Change Log

## Review Triage Log

- The reviewer correctly identified missing proof when review was launched. Paired coverage-enabled case timings and the full shard's initial before/after results are recorded above; the cross-file LCOV drift is being investigated and the merged threshold must still pass CI.

## Verification

Run the exact coverage-enabled `core-battle` CI shard on Node 24.21.0, a representative CPU profile, paired before/after timings, focused save/recovery tests, typecheck, lint, and golden checks. Compare outputs without regenerating goldens. Record conditions and noise; do not infer CI timings from local runs.
