---
title: "Player buffer, Electron CSP hygiene and menu cell layout"
ticket: 22
status: done
---

# Plan

PR #1042 (ee3db47e) adjusts the buffer size based on an inferred underrun cause and fixes CSP/menu issues; it does not establish that the dropouts were fixed. #1043 remains open; the AudioWorklet migration in PR #1165 (0ddb39b9) supersedes the buffer workaround.
