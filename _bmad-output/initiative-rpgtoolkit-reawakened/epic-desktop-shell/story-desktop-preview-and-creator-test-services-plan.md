---
type: story
title: "Desktop preview and creator test services"
status: draft
risk: high
ticket: 6
---

## Scope

Embed the existing runner and connect shared game, program and creator-test APIs through desktop host services.

## Acceptance

Normal run, program fixture and saved-test execution use the requested input revision and report real results; editor changes do not silently alter an active test; failure is visible.

## Verification

Run a real project and minimal authored fixture through the real engine, change a document during execution and check run identity and result provenance.

## Prerequisites and decisions

11.8 and 11.9 provide actual run and test capabilities; do not duplicate the runner or invent test APIs.
