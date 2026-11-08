---
type: story
title: "Build and inspect game setup"
ticket: 6
status: draft
risk: high
---

# Build and inspect game setup

## Scope

Builds the ruled installable setup from the 12.9 game package with explicit destination, file and dependency review, installer and uninstaller handling and capability-gated host operations.

Consume 12.9 artifacts, distinguish setup ZIP from editable project and game package, and route native installation or signing only through an explicit supported service.

## Acceptance and verification

A clean supported recipient installs, runs and uninstalls the packaged game as ruled, cancellation preserves inputs, and unsupported browser installation and signing are explained without fallback.

## Dependencies and decisions

Requires 14.1, 12.9. Follow the approved contracts and capability declarations; do not assume unimplemented provider behavior.
