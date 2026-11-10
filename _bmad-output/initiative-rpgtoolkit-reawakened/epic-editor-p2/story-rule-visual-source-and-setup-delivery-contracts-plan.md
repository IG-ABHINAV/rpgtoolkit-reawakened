---
type: story
title: "Rule visual source and setup delivery contracts"
ticket: 1
status: draft
risk: high
---

# Rule visual source and setup delivery contracts

## Scope

Specifies and obtains owner approval for the structured event source/code boundary, visual fixture representation against 11.9, and setup installer, uninstaller, targets, signing and unsupported-host semantics without changing the selected hosts.

Document example event and fixture representations, ownership and behavior when switching views or editing unsupported code; decide supported setup formats, target platforms, distribution, installer/uninstaller safety, signing and failure/cancel behavior, with approval before consumers start.

Include T-45's small screen-layout canvas: define coordinate/placement authority, generated commands and the numeric/keyboard editing alternative. Also settle skin authoring explicitly: `docs/spec/formats/main-file.md` records `skinButton` and `skinWindow` as preserved legacy fields ignored by the engine. Name the authoritative document and whether preview is editor-only or requires a separately specified runtime consumer; record and pin any new provider before 14.4 starts. Do not invent a separate skin format or claim those legacy fields already affect gameplay.

## Acceptance and verification

A person approves documented source authority, lossless unsupported-code handling, fixture storage and executable mapping, and package/install safety and capability rules with examples.

## Dependencies and decisions

Requires 11.1. Owner decision required: Resolve the supported structured command subset, fixture/code authority and target-specific installer and uninstaller guarantees before implementation.
