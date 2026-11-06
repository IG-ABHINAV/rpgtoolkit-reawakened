---
title: "Correct retired demo closing hashes quoted as current"
ticket: 31
status: done
---

# Plan

Merged: PR #1154 (503ea161) corrected docs/playing-the-desktop-player.md and CHANGELOG.md to stop quoting retired demo closing hashes and point at golden/regression/closing.json. Its `Fixes #1146` reference closed an unrelated stale-draw issue; that behavior had already been fixed independently by PR #1153 (9e497a33). No separate issue for this documentation correction has been established. The closing-baseline re-record itself is board-rendering entry 4.41 / #1048 (PR #1131, d3838a7e), the cross-epic prerequisite.
