---
type: story
title: "Independent editor release signing and updates"
status: draft
risk: high
ticket: 8
---

## Scope

Create independent editor release artifacts, signing/notarisation, update and release automation using the ruled Electron pin and G6 binary inventory.

## Acceptance

Editor and player install side by side with separate identities, release cadence and update state; editor upgrade verifies authenticity, retains projects and leaves player unchanged; macOS notarisation and OS-specific signing obligations are met.

## Verification

With authorised credentials install and update real editor artifacts on each OS, verify signatures, notarisation, Chromium inventory and failure behavior; record artifact digests and release evidence.

## Prerequisites and decisions

Requires 15.7 and the independent player application artifact from 9.10 (#936), not merely the runner-desktop package in 9.11. Use that real installed artifact for side-by-side and update-isolation acceptance.

Human must provide platform signing/notarisation credentials, release access and update channel/rollback policy; do not claim a signed release from local builds.
