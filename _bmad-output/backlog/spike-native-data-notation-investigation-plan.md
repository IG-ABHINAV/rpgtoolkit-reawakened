---
ticket: 1
status: in-progress
risk: low
---

# Native-data notation investigation execution

## Authorization and boundaries

Jensen approved execution on 2026-11-08 and clarified that Astra and Opus each investigate the whole question independently. Different agents independently review their recorded reports afterward. The seven acceptance criteria in the [ticket](spike-native-data-notation-investigation.md#acceptance-criteria) remain the completion contract. No native notation or production schema is selected by this research. Owner acceptance is required before issue #1778 closes.

## Pinned inputs and ownership

- Source revision: `20e0209d`, including merged research #1771 / PR #1776 and planning PR #1779.
- Common cohort: demo, ChimeranEmpire, Caoquest and CrystalImmortality. Inspect all four; show substantive projections for at least three including demo. Verify each consumed source against the shared inventory hashes.
- Astra: `openai-codex/gpt-6-astra`, branch `research/1778-astra-notations`, owns `docs/findings/native-data-notations/astra/` and `tools/research/native-data-notations/astra/`.
- Opus: `anthropic/claude-opus-5-5`, branch `research/1778-opus-notations`, owns the corresponding `opus/` directories.
- Integration: `research/1778-notation-synthesis`, owns the joint comparison, ticket metadata, independent-review records and publication.
- Investigators cannot read one another's reports during independent research. Preserve first-pass report provenance before corrections or shared-model comparison.

## Execution sequence

1. Pin cohort identities and provenance; build public decoder entry points in isolated worktrees.
2. Both authors independently perform all candidate tracks and required editing, validation, merge, provenance and host experiments. Record actual results, failed experiments and evidence-backed unavailable tooling; do not simulate outputs.
3. Preserve the independent findings. Different reviewers each inspect both reports independently, without sharing reviewer conclusions first. Verify measurement methods, corpus mappings, semantic merge assertions, authoring costs, parser/library versus notation distinctions, licences and unsupported claims.
4. Run a shared-model comparison after the independent proposals exist. Reconcile factual errors, retain substantive disagreements and disclose any model-dependent results.
5. Exercise the published commands, validate links and evidence, run consolidated repository checks, and publish a research PR linked to #1778 and the previous findings.
6. Preserve each worktree's work in a pushed named branch before safe cleanup. Leave issue #1778 open for Jensen's acceptance.

## Verification ledger

Core decoder prerequisites built successfully in all three isolated worktrees using the installed TypeScript compiler. This is setup evidence, not evidence that any notation experiment passed. The environment provides Node 26.13.0 rather than the repository's pinned Node 24.21.0; reports must identify the actual exercised runtime.

Every candidate needs an explicit disposition. Every experiment needs a runnable result, a demonstrated limitation or an evidenced unavailable prerequisite. A format need not pass every experiment to be fairly evaluated. A clean Git merge is not evidence of correctness until decoded values, identities, references and order are checked. Agent authoring rehearsals are not human usability testing.
