---
type: story
title: "Set up the Preact and TSX toolchain for editor-ui"
ticket: 16
status: draft
---

## Scope

Do the setup [ADR 0025](../../../docs/adr/0025-editor-ui-framework-preact-tsx.md) lists under "What 11.2 does first", before any editor code exists. This story was cut out of 11.2 on 2026-11-10 (see the epic Notes) so the model-and-UI story starts on a proven toolchain. It writes no product code: no `editor-ui`, `editor-model` or `platform-services` behaviour. Every proof runs on test-only sample files kept with the tools they test.

- Add `preact` pinned to one exact 11.x version (no range, as `esbuild` and `typescript` are pinned) and its `THIRD_PARTY_NOTICES` entry. Where `preact` is declared before the `editor-ui` package exists is an open question in the epic Notes.
- Set the JSX keys in the TypeScript configuration and the esbuild build (the automatic runtime with `preact` as the import source is the expected shape, ADR 0025 decision 2) and show that `tsc -b` and the bundle agree.
- Add a check that no `editor-ui` bundle contains `eval(` or `new Function` (ADR 0025 decision 6), and show that it fails on a bundle that does.
- Prove `.tsx` is inside the lint scope, the dependency-graph check and the provenance scan, including a `.tsx` file that imports a `host-*` package and fails lint and the graph check. ADR 0025 records that the spike did not run these.
- Add the dev-only DOM shim (ADR 0025 decision 8 names `@happy-dom/global-registrator` 21.0.4, MIT, one maintainer; this story may substitute another permissively licensed shim by amending that line) with its licence line, and show a sample component rendering under it in `node --test`.

## Acceptance

A reviewer can reproduce each proof from the commands in the story's notes: the sample `.tsx` type-checks and bundles with the same JSX settings; the bundle check passes on a clean bundle and fails on one containing `eval(` or `new Function`; the `host-*` import fails lint and the graph check; a sample component renders under the shim; `preact` and the shim pass `pnpm licence`, and `pnpm provenance` passes.

## Verification

A sample `.tsx` file type-checks under `tsc -b` and bundles under esbuild with the same JSX settings; the bundle check fails on a bundle that contains `eval(` or `new Function`; a `.tsx` file importing a `host-*` package fails both lint and the dependency-graph check; a sample component renders under the DOM shim in `node --test`; `preact` has no version range, and `pnpm licence` and `pnpm provenance` pass.

## Decisions and prerequisites

ADR 0025 (accepted) decides the framework; this story adds none. The strict-CSP probe of ADR 0025's follow-up list needs a mounted view, so it is part of 11.18, not here. A Preact version bump later is its own change and must pass the DOM and ARIA suite and the CSP probe (ADR 0025 decision 1).

Prerequisites: 11.1 (the contracts, now closed).
