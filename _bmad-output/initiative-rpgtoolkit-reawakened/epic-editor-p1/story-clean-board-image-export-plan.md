---
type: story
title: "Clean board image export"
ticket: 14
status: draft
risk: medium
---

## Intent

Export the current view or entire board as PNG using the shared AD-29 compositor without overlays; encode indexed PNG when there are 256 colours or fewer and true-colour PNG above that boundary.

## Scope and acceptance

The owner-approved `docs/spec/formats/images.md#storage-policy` supersedes the legacy T-32 PNG/JPEG/BMP inventory for authored exports. Do not reopen that selection or implement JPEG/BMP writers. Preserve original imported image bytes; this rule concerns newly generated pictures.

## Verification

Compare decoded output pixels with the actual composition for view/whole-board and content options, assert indexed versus true-colour encoding at the 256-colour boundary, and exercise cancellation and unavailable host output.

## Dependencies and decisions

Prerequisites: 13, 4.14, 4.15, 4.18. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-32 maps to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.
