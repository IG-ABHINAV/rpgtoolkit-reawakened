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
- Residual verification gap tracked by #1215: add an Electron/browser runtime probe proving a disallowed script does not execute. Keep this plan in-review until that evidence exists.
- PR #1155 filed #1156 for the mobile player page CSP gap; that issue is now closed by merged PR #1159 (b215d1bd).
