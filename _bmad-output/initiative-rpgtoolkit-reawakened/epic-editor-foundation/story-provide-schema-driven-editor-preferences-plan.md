---
type: story
title: "Provide schema-driven editor preferences"
ticket: 5
status: draft
---

## Scope

Implement background image, splash and tip toggles, English UI language, syntax colors/styles and board behavior/colors, plus ruled scopes, precedence, persistence and accessibility.

## Acceptance

Invalid values remain explainable; user/workspace/resource precedence and JSON editing follow 11.1 only where ruled, and preference changes remain distinct from .gam data.

## Verification

Changing, validating and resetting each supported preference updates both hosts consistently without modifying authored game data.

## Decisions and prerequisites

Schema format, scope, migration and extension contribution remain 11.1 decisions.

Prerequisites: 11.4.
