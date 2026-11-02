---
title: 'Package script functions do not join ordinary or namespaced lookup'
type: 'bug'
ticket: '21'
status: 'ready-for-dev'
tracker_id: '#1051'
risk: 'high'
---

# Plan

Issue #1051 records the built-harness reproduction and required lookup and regression checks.

**Approved ruling (owner: Jensen, 2026-11-02):** implement both bare and package-qualified calls and the [approved collision and restore rules](../../../docs/spec/engine/rpgcode-modules-and-objects.md#pkg-script-function-lookup-proposal). Package-level namespaces only; in-file directives are deferred to #1089. PKG-7's package-location policy remains independently pending and is not a blocker for this lookup fix.
