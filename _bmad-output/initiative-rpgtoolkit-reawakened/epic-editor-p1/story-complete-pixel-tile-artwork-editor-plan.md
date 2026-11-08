---
type: story
title: "Complete pixel tile artwork editor"
ticket: 3
status: draft
risk: high
---

## Intent

Complete the T-36 pixel editor using the entry 2 decision, including all drawing, palette, transformations, image import, layering, shading, effects and append or overwrite save modes.

## Scope and acceptance

Include pencil, dropper, fill, erase, line, ellipse, rectangle, replace colour, DOS 16 palette, RGB/key, clear, 90/180/270 rotate, flip/mirror, cut corner, skew wrap/broken, wrap-scroll, iso conversion, layer opacity, shade, greyscale, blur, motion blur, blocker/angle/length shadow, texturise and translucentise; disclose known/uncertain shared uses and return to board selection; unsupported image formats are named, never silently substituted.

## Verification

Fixtures exercise every T-36 operation, keyboard/numeric editing, transparent pixels and iso preview, staged cancellation and undo, and each saved tile reopens and renders in the runner.

## Dependencies and decisions

Prerequisites: 1, 2. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-36 maps to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.
