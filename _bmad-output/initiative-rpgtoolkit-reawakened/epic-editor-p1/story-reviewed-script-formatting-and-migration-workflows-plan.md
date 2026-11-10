---
type: story
title: "Reviewed script formatting and migration workflows"
ticket: 16
status: draft
risk: high
---

## Intent

Expose formatting, canonical case and project-wide pre-3.1 update and cleanup through reviewed per-file editor workflows backed by the existing language-tool providers.

## Scope and acceptance

Reuse 10.5 syntax code actions and 10.7 formatter, adding missing orchestration or provider coverage rather than another rewrite engine; include quoted strings and keys, comparisons, sigils, comments, # prefix and loose dialogue, with failure retention and review before apply.

## Verification

Across native VS Code and Monaco hosts, fixtures verify correct provider results, per-file opt-out, original/result diff, unsupported fragments, cancel and behaviour-preserving accepted changes.

## Dependencies and decisions

Prerequisites: 1, 11.3, 11.7, 10.5, 10.7. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-42, T-43, T-44, T-46 map to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.
