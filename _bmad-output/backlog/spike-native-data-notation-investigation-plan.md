---
ticket: 1
status: in-review
risk: low
---

# Native-data notation investigation execution

## Outcome

Both independent investigations are complete, independently reviewed, corrected and
integrated. Research is published for owner review in PR #1799; issue #1778 stays open
for Jensen's acceptance.

- Integrated report: `docs/findings/native-data-notations/README.md`
- Astra's preserved first pass: `docs/findings/native-data-notations/astra/`
- Opus's preserved first pass: `docs/findings/native-data-notations/opus/`
- Shared-model comparison: `docs/findings/native-data-notations/shared/`
- Review record: `docs/findings/native-data-notations/reviews.md`

**No format decision is made.** YAML remains the owner's hypothesis, not a result.

## What was executed

1. Pinned inputs: baseline `20e0209d`; demo, ChimeranEmpire, Caoquest and
   CrystalImmortality; each consumed byte verified against the shared inventory.
2. Two independent investigations, neither investigator reading the other's output.
   Astra: 1,692 payload hashes, 95 source files to 135 documents, ten notations,
   120-case merge matrix, Edge browser probes. Opus: four games to 1,177 documents,
   14 notation variants, 603 merges, Chrome parity.
3. Four independent reviewers, none an author, reviewing both reports without seeing
   each other's findings: adversarial, edge-case, verification-gap, editorial.
4. Nineteen defects filed (#1780–#1798) with reproducers, fixed by the owning
   investigator, affected experiments re-run.
5. Shared-model comparison: one agreed construction through both adapter sets —
   90 stock `git merge-file` runs, a printer-layout probe, round trips, and
   size/edit measurements on identical data.

## Verification ledger

- `pnpm provenance`: 0 violations across 1,059 files.
- `pnpm lint`: core dependency allowlist OK; ESLint clean, including an explicit run
  over the new research tooling.
- `pnpm licence`: PASSED, 0 violations; no workspace dependency changed.
- `pnpm fixtures:check`: 0 tracked files under `fixtures/`.
- Every new `.mjs` passes `node --check`; the shared harness was re-run to produce the
  committed results.
- Exercised runtime: Node v26.13.0 (repository pin 24.21.0), git 2.55.0, macOS 27.2,
  Apple M1 Pro, Chrome for Testing 150. No supported-runtime claim is made.

## Boundaries held

No legacy engine source was read (G7). No game, installer or RPGCode was executed.
Crystal's nested ZIP was extracted to scratch only. All notation libraries were
installed into isolated scratch directories, so no workspace manifest or lockfile
changed and G6 review is unaffected. No game payloads, media or complete recovered
programs were committed.

## What remains open

Owner acceptance; the layout-contract, finalist, multi-format, identity, tile-grouping
and schema-layering decisions; and human usability evidence. Both text-editor
walkthroughs are ready for Jensen to try, and that result cannot be produced by an
agent.
