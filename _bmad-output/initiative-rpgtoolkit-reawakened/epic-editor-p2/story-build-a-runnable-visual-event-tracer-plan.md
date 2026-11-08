---
type: story
title: "Build a runnable visual event tracer"
ticket: 2
status: draft
risk: high
---

# Build a runnable visual event tracer

## Scope

Creates one editable structured event with typed parameters and generated RPGCode in the shared document, then validates and runs that saved program using the existing language and run services.

Use the same document identity and AD-19 host lifecycle; Monaco serves browser and standalone, while VS Code retains native text; never claim arbitrary conversion.

## Acceptance and verification

In browser and VS Code a creator adds a supported message action, saves the generated program, gets clean diagnostics and observes it run, while unsupported handwritten text stays intact.

## Dependencies and decisions

Requires 14.1, 11.2, 11.3, 11.7, 11.8. Follow the approved contracts and capability declarations; do not assume unimplemented provider behavior.
