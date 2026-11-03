---
title: 'Desktop renderer lacks CSP and uses deprecated console-message callback'
type: 'bug'
ticket: '19'
status: in-review
tracker_id: '#1049'
risk: 'high'
---

# Plan

PR #1042 proposes the normal-player policy and event-object listener. Issue #1049 records the report-page coverage gap and the checks needed for enforced policies and preserved diagnostics.

## Notes

- Merged: PR #1155 (adbc5e93) gives every desktop/web player page the strict shared CSP and makes the test enumerate all player pages; desktop measurement passes end to end under the policy. Issue #1049 is closed.
- The web HTTP runtime-block verification gap tracked by #1215 is implemented by PR #1229 and will close with that PR.
- PR #1155 filed #1156 for the mobile player page CSP gap; that issue is now closed by merged PR #1159 (b215d1bd).
- Web HTTP runtime verification for #1215: `tools/browser/tests/csp-runtime.spec.ts` loads `/packages/runner-web/app/index.html?game=demo&package=fixtures/packages/demo.tpk&tracer=1`, observes the allowed `apps/player.js` loading, and verifies the demo package reaches tick 120 with its loaded report and no player/load error. It then injects an inline script, confirms it remains unexecuted, and observes `securitypolicyviolation` with `effectiveDirective=script-src-elem` and `blockedURI=inline`.
- Perturbation proof: `CSP_PROBE_WEAKENED=1 pnpm exec playwright test tools/browser/tests/csp-runtime.spec.ts` invokes the route matched by URL pathname, strips the CSP meta tag from the page response only, and fails because `window.__cspDisallowedScriptRan` is true. The shipped HTML was not weakened.
- Residual Electron gap is tracked by #1230, "[Runner] Verify desktop Electron app:// CSP blocks disallowed scripts at runtime". That issue must verify blocked inline execution and CSP refusal/event while allowed desktop app resources continue loading. Entry 9.19 remains in-review until the `app://` evidence is complete.
