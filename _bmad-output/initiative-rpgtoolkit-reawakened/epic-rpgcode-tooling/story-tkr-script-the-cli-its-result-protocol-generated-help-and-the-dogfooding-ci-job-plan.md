---
title: "tkr script: the CLI, its result protocol, generated help and the dogfooding CI job"
ticket: 9
status: in-progress
---

## Intent

Entry 10.9 builds `packages/script-cli`, the `tkr script` command-line front end defined by TOOL-9 (`docs/spec/engine/rpgcode-tooling.md#tool-9`). It is one binary with five subcommands — `check`, `fmt`, `test`, `docs`, `index` — each producing the same `tkr-script-result/1` envelope, the four stable exit codes, and byte-stable `--json` output.

## Dependencies actually merged

- 10.4 (index) — `buildIndex` and `INDEX_SCHEMA` in `packages/script-tools/src/index-document.ts`.
- 10.6 (linter) — `lint`, `readLintConfig` and `RULES` in `packages/script-tools/src/lint.ts`.
- 10.7 (formatter) — `formatSource`, `formatChanged`, `formatCheck` in `packages/script-tools/src/format.ts`.
- 10.8 (runner) — the runner slice is merged as `d4e2d29f` but the story is still `status: blocked` on owner-gated matcher gaps.

## What this branch builds

- `tkr script check` — parser diagnostics plus lint over `.prg`/`.rnc` sources, honouring `tkr-lint.json`.
- `tkr script fmt` and `fmt --check` — rewrites or reports changes, refuses TK2.
- `tkr script index` — emits the TOOL-6 machine-readable index document.
- `tkr script docs` — emits the generated quick reference from the registered catalogue.
- `tkr script test` — drives the 10.8 runner over `*.spec.prg` files.
- The `tkr-script-result/1` envelope, validated in tests against `docs/spec/schemas/tkr-script-result.schema.json`.
- The four documented exit codes: 0 ok, 1 findings, 2 usage/config error, 3 internal error.
- Deterministic `--json` output so the same inputs produce the same bytes.
- A `script-dogfood` CI job that runs the four ready subcommands over `stock/` and `docs/spec/examples/game`, and `test` over authored passing fixtures, comparing against committed baselines in `packages/script-cli/baselines/`.

The CLI implementation merged in PR #1017 (merge commit 6b4357ed).

## Owner-gated matchers: `test` refuses to run silently

The 10.8 runner cannot be claimed complete while the following matchers are still owner decisions:

- **F-A** — array `toEqual`/`toContain` and `toThrow`.
- **F-D** — fractional `toBeCloseTo`.
- **F-E** — group hooks under per-case re-run (beforeAll/afterAll semantics for nested describes).
- **F-G** — a missing `#include` is silent until something calls into it.

`tkr script test` scans each spec source before invoking the runner. If it sees an owner-gated matcher (e.g. `toThrow`, `toEqual(...[...])`, `toBeCloseTo(..., 0.001)`), the run fails with exit code 1 and a diagnostic naming the unbuilt matcher. This keeps the CLI honest: it does not silently pass a spec whose assertion surface is incomplete.

## What remains blocked

This entry stays `status: in-progress` until 10.8 closes. When the owner rules on F-A/F-D/F-E/F-G (and the proposed PKG-7 load path / F-F tear-off in #1010), the preflight scanner is removed or narrowed and `test` is claimed complete against the full approved matcher API.
