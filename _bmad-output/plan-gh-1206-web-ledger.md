---
title: 'Reconcile web-runner ledger provenance'
type: 'bugfix'
ticket: ''
created: '2026-11-04'
status: 'built'
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

**Problem:** Web-runner ledger entries confuse a documentation issue with its pull requests, duplicate completed work, and label retired demo hashes as current. A docs-only PR's closing reference also obscures a distinct stale-draw issue.

**Approach:** Reconcile entries 15, 24 and 31 against live issue and PR history, preserve entry IDs and dependency links, distinguish historical measurements from the committed current golden, and verify the independently landed stale-draw fix. Never invent an issue or claim a rerun occurred.

</frozen-after-approval>

## Implementation Notes

One-shot: a focused metadata and historical-provenance correction; no runtime behavior, normative specification, or golden re-recording is intended. The 9.24 CI lane was split from 9.15 and must not be renumbered because other entries depend on it.

PR #1014 delivered issue #1013's documentation and its split CI lane. Its original desktop observation was `bff947dce3a11b4f` / `9a40be8a0b5ca816`; the later E-02 baseline was subsequently superseded. Current acceptance criteria refer to `golden/regression/closing.json` rather than a copied hash, including because open PR #1323 also changes that golden.

PR #1154 contained only the retired-hash documentation correction but incorrectly referenced and closed #1146. Independently, PR #1153 had already landed the outermost-only draw composition guard covering the distinct stale-draw issue; PR #1152 was closed unmerged. The board-rendering ticket remains open until its acceptance and perturbation evidence is recorded. No new tracker is invented for the documentation correction.

## Plan Change Log

## Review Triage Log

- Medium, patched: the initial edit weakened the separate live-parity acceptance. Restored its distinct session, ENTER schedule and no-tracer conditions while referencing the committed golden. The independent reviewer found no remaining issue in the delta.

## Verification

- Live issue, PR and merged-code history checked; committed closing golden inspected without re-recording it.
- Ticket store `status` exited 0 and reported 9.15, 9.24 and 9.31 done. TOML comparison preserved all 31 web-runner and 43 board-rendering IDs and their dependency lists.
- `python3 -m unittest discover -s _bmad/method/scripts/tests -v`: 5 passed.
- `pnpm dlx node@24.21.0 --test --test-name-pattern='a background board thread cannot redisplay' packages/core/test/script-surface-lifecycle.test.ts`: 1 passed.
- Independent quick review and delta review completed; no deferred findings.
