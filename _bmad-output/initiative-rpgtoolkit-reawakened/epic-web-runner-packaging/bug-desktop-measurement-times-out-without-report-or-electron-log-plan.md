---
title: "Desktop measurement times out without report or Electron log on macOS"
ticket: 28
status: done
---

# Plan

Merged: PR #1149 (efe6f7ee) hardens the desktop measurement harness so a failed or slow run still produces a report with child-exit diagnostics and the Electron log; issue #1076 is closed. The underlying root cause of the timeout/hang was not diagnosed.
