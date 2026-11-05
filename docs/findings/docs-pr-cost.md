# Making documentation PRs cost next to nothing

Findings for the owner's question (2026-11): how to make documentation pull requests
cost next to nothing to commit, on both the CI side and the human side.

## What already exists

ADR 0016 (`docs/adr/0016-ci-classified-steps.md`) introduced the change classifier
(`tools/ci/classify-changes.mjs`). For a pull request whose every changed path is on the
inert list, the expensive jobs (`golden`, `golden-bun`, `browser`, `desktop`, `mobile`,
`script-dogfood`) defer their heavy steps and print a one-line `DEFER` verdict. No job is
ever skipped.

As of this change, the inert set also covers **every Markdown file under `docs/` except
`docs/spec/`** (the normative spec, which `golden` dump-checks) and **the whole `_bmad/`
tree** (consumed only by manual ticket tooling). That removes most documentation work from
the expensive jobs.

## What still costs, and why

Two jobs are explicitly never deferred by ADR 0016:

- `checks` — typecheck, lint, licence, provenance, graph, catalogue, command-docs, no-skips,
  make-package, mobile proof, desktop measure, icons. For a docs-only PR most of these are
  no-ops, but they still install, build and run.
- `unit` — the fifteen-shard matrix. It fetches fixtures, builds, and runs every test file.
  For a docs-only PR this is pure waste, but `gate` merges the shard LCOV reports and
  enforces the repository line/branch coverage thresholds, so the shards must produce
  reports.

The human side also still costs: the full PR template (G1–G7 checkboxes that do not apply
to a doc fix), and the expectation that a docs PR carries the same review weight as a
behaviour change.

## Option A — keep the conservative position (done)

Stop here. Docs PRs already defer the expensive jobs; `checks` and `unit` still run. No
policy change, no risk. This is the state after the change in this commit.

## Option B — defer `unit` and the heavy part of `checks` for docs-only PRs

Introduce a second classifier tier, `docs-only`, that is true only when every changed path
is inert *and* is documentation (Markdown under `docs/` or `_bmad-output/`, root `*.md`,
`_bmad/**`, issue templates). Then:

1. `unit` defers entirely when `docs-only` is true. `gate` skips the LCOV merge and the
   coverage threshold check in that case (coverage cannot move when no code changed).
2. `checks` keeps only the doc-relevant sub-steps (`provenance`, `catalogue:check` when a
   command/catalogue doc is touched, `command-docs:check` when `docs/spec/...` is touched —
   but that case is not docs-only anyway). Typecheck, lint, licence, graph, no-skips,
   make-package, mobile proof, desktop measure and icons defer.
3. Amend ADR 0016 to record that `checks` and `unit` *may* defer for a positive
   `docs-only` determination, while keeping the "never skip a job" rule (jobs still run and
   report `DEFER`).

Cost: a new classifier output (`docs_only`), gate changes, and careful tests. Risk: a
mistaken `docs-only` verdict could hide a code change that happens to live under `docs/`
(e.g. a generated file). Mitigation: the tier is opt-in and positive — it requires every
path to be on a *documentation* allowlist, not merely inert; any path under `packages/`,
`tools/`, `stock/`, `golden/`, `docs/spec/` or `.github/workflows/` forces `run`.

## Option C — also cut the human cost

Regardless of CI, reduce the paperwork for a docs PR:

- Add a "Documentation only" section to the PR template that replaces the G1–G6
  checkboxes (which do not apply) with a single "I verified the rendered Markdown and
  links" line. Reviewers still read the diff.
- State in `CONTRIBUTING.md` that docs-only PRs need only `pnpm provenance` (already a
  no-op for docs) and a link check, not the full command list.
- Keep ticket-ledger sync (`tools/migrate-tickets-to-github.py`) out of the docs PR flow:
  it is a maintainer action, not a contributor gate.

## Status

Option A, B and C are now implemented (see the commit that added this note):

- **A** — classifier treats all non-spec `docs/**/*.md` and the whole `_bmad/` tree as inert.
- **B** — `checks` keeps only `provenance` and `unit` defers entirely for inert (documentation-only)
  PRs; `gate` skips the LCOV merge and coverage threshold. ADR 0016 amended accordingly.
- **C** — PR template carries a documentation-only note; CONTRIBUTING states the lighter check
  set for docs PRs.

## Open question

Does a "docs-only" PR ever touch `tools/` or `packages/` indirectly (e.g. regenerating a
catalogue stub)? If so, that PR is not docs-only and must run everything. The classification
must stay positive and fail closed, consistent with ADR 0016.
EOF
echo written