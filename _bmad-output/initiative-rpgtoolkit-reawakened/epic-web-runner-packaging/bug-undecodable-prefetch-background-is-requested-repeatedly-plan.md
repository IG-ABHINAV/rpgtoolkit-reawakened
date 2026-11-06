---
title: "Undecodable prefetch background is requested repeatedly"
ticket: 29
status: done
---

# Plan

Merged: PR #1144 (4eb1c9f8) makes an undecodable prefetch background reply be recorded as unavailable instead of re-requested every tick; it also fixes #1081 (entry 9.30). Issue #1142 is closed.
