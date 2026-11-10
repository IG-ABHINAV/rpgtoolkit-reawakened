---
type: story
title: "Secure desktop process and service boundary"
status: draft
risk: high
ticket: 2
---

## Scope

Implement the main/preload/renderer trust boundary, restricted platform-services bridge and the ADR 0013 `app://` secure scheme with no service worker.

## Acceptance

Context isolation, sandbox and disabled renderer Node access apply; navigation, external URLs, IPC senders and input payloads are restricted; filesystem operations are scoped to authorised project roots with traversal and symlink escape refused.

## Verification

Drive allowed calls and adversarial IPC, traversal, external navigation and service worker attempts against the packaged application; check the G6 exception marker.

## Prerequisites and decisions

Document project-scoped authority and user-granted external file flows in conformance with 11.1 before coding; no unreviewed security exception.
