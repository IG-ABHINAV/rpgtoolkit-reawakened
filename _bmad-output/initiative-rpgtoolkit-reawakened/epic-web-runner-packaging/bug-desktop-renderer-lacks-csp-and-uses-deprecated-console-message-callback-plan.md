---
title: 'Desktop renderer lacks CSP and uses deprecated console-message callback'
type: 'bug'
ticket: '19'
status: done
tracker_id: '#1049'
risk: 'high'
---

# Plan

PR #1042 proposes the normal-player policy and event-object listener. Issue #1049 records the report-page coverage gap and the checks needed for enforced policies and preserved diagnostics.

## Notes

- Merged: PR #1155 (adbc5e93) gives every desktop/web player page the strict shared CSP and makes the test enumerate all player pages; desktop measurement passes end to end under the policy. Issue #1049 is closed.
- Verification gap: the current evidence asserts CSP policy text, but does not prove execution of a disallowed script is blocked.
- PR #1155 filed #1156 for the mobile player page CSP gap; that issue is now closed by merged PR #1159 (b215d1bd).
