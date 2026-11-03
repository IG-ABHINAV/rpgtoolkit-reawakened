---
title: "Runner protocol drift check across schema, vectors and TypeScript"
ticket: 26
status: done
---

# Plan

Merged: PR #1108 (28732627) "Fixes #1066" — adds the strict JSON Schema evaluator, TypeScript-to-schema conformance comparison and unit-level perturbation tests proving schema-only, TypeScript-only and vector-only changes each fail `pnpm runner-protocol:check`; issue #1066 is closed. Follow-up PR #1116 (624e7d01) is also merged.
