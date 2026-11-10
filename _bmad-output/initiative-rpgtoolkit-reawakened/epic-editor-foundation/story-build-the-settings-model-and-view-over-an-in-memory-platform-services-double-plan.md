---
type: story
title: "Build the settings model and view over an in-memory platform-services double"
ticket: 17
status: draft
---

## Scope

Create the three packages the tracer needs and prove them with no host: `platform-services` (the interface, in its own package by owner ruling of 2026-11-10), `editor-model` and `editor-ui`. This story was cut out of 11.2 so the model and the view are proven before any host exists.

- `platform-services` holds the interface of [AD-20](../architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md) that the tracer uses, at least `fs` read, write and stat, and an in-memory double of it (the package's `./testing` entry, AD-22). It does not import Preact, `core` I/O or any host.
- `editor-model` holds a `.gam` document: the bytes read with `readMainFile`, edited through a serialisable command stack, written with `writeMainFile`, with document identity as in ADR 0022 D1 and the minor version and unknown residue the reader keeps preserved. It checks first that the writer re-emits the minor it was given for the supported versions (ADR 0022 D2.1) and refuses a read-write open otherwise.
- `editor-ui` mounts a Preact settings view with `mount(el, ctx) -> { dispose }` (ADR 0025 decision 4). The one tracer field is the game title (`gameTitle`, `docs/spec/formats/main-file.md#layout`); it shows dirty state and save errors.
- The edge list `tools/deps/edges.json` gains `platform-services` and its edges, and the spine's generated diagram is regenerated with `pnpm graph:write`. The spine's AD-20 wording is brought in line first, in its own docs commit (G7).

## Acceptance

The tests run against the in-memory double on real `.gam` bytes: edit the title, save, reopen and compare; a command is accepted or rejected whole; a failing save keeps the model dirty, keeps the edit visible and shows the error naming the document (ADR 0022 D3.1 and D3.3); disposing the view keeps the document and its undo stack. `editor-ui` and `editor-model` import no `host-*` package.

## Verification

Over the double, on real `.gam` bytes: editing the title, saving and reopening gives the edited title with every other byte, the file's minor version and its unknown residue preserved; a failing save keeps the model dirty, keeps the edit visible and shows the error naming the document (ADR 0022 D3.3); `editor-ui` imports no `host-*` package, proven by the dependency-graph check on the new packages.

## Decisions and prerequisites

Owner rulings, 2026-11-10: the `platform-services` interface is its own package, and the tracer field is the game title. The outside check for this high-risk story is 11.18: the same model and view code, unchanged, passes the shared behaviour test on two real hosts.

Prerequisites: 11.16 (toolchain), 2.9 (the main-file reader and writer, whose supported versions are checked here).
