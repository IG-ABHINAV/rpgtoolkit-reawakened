# Astra: independent native-data notation research

**Research issue:** [#1778](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1778) · **Date:** 2026-11-08 · **Model actually used:** `openai-codex/gpt-6-astra` · **Input revision:** `20e0209d`.

This is Astra's independent evidence plus **post-review corrections**, not an agreed format decision. No other investigator's report/code was read. Four independent review triages were supplied by the parent; the original is preserved at `/private/tmp/tkr-1778-astra-first-pass.tar.gz`. The owner requested different reviewers, not author cross-review.

## Read this first

- **[Post-review corrections and proof](review-corrections.md):** the expanded 120-case matrix contains **18 actual false-clean duplicate-ID merges**, all rejected by the corrected checks. The original zero-observed-false-clean statement is superseded for the expanded coverage.

- [Independent findings and measured outcomes](first-pass.md)
- [All fifteen candidates: implementations, licenses, tradeoffs and primary sources](candidates.md)
- [Four actual projects: relationships, proposed files and unmapped data](projections.md)
- [Text-editor-only walkthrough](human-edit.md)
- [Reproduction commands and artifact inventory](reproduce.md)
- [Machine-readable measurements](data/results.json), [post-review corrections and killed negative controls](data/post-review-results.json), [extra edge cases](data/extra-results.json), [browser](data/browser-results.json), [official RON WebAssembly](data/wasm-results.json), [composition evaluators](data/composition-results.json)
- [Source-to-owner accounting](data/source-mappings.json) and [selected original hashes and physical versions](data/physical-provenance.json)
- [Small authored YAML sample](examples/keeper.yaml), [KDL sample](examples/keeper.kdl), and the same populated construction in the other eight notations in `examples/`.

The real game projections and exact game-derived diffs are deliberately **local only**, under `/private/tmp/tkr-1778-astra-experiments`. This report does not redistribute recovered programs, media or complete game models. Helpers are under [tools/research/native-data-notations/astra](../../../../tools/research/native-data-notations/astra/).

## What is and is not complete

| Ticket criterion | Astra disposition |
|---|---|
| 1. Every named candidate | All ten data tracks and all five composition tracks exercised; tooling failures and mapping costs retained. |
| 2. Representative logical data | All four pinned projects examined; populated split-document projections in every data notation; original/default/converted fields distinguished. The later **shared-model** comparison is integration work, not silently claimed here. |
| 3. Real editing and merging | Raw text and library-driven edits, actual stock Git three-way merges, sequence operations, tile edits, negative cases and plugin retention recorded. |
| 4. Integration and authoring costs | Actual Node and Edge probes, including official RON compiled to WebAssembly; schema dialect and source-location experiments; dependencies and limitations recorded. |
| 5. Owner choice | Finalists and tradeoffs only. **Jensen's acceptance is pending**; no native schema, syntax, multi-format requirement or runtime change is approved. |
| 6. Independent authors | Original Astra evidence preserved; assigned corrections completed after external review. Parent owns fresh fix review, the other author's integration and the shared-model comparison. No claim about unseen work. |
| 7. Human-editable files | Agent-performed text rehearsals and a runnable ordinary-editor walkthrough; not a human usability study. |

**The issue must not be closed solely on this report:** owner acceptance, external review and integrated/shared-model comparison remain parent-owned gates. No repository builds, lint, tests or formatters were run; no commits, pushes or issue mutations were made.

The owner's clarification permitting **RPGCode LF normalization** is applied. CRLF-to-LF conversion is not counted as corruption or used to disqualify a notation. Original source hashes remain provenance; text equality is not VM/save-continuation equivalence.

## Key source files

- [Full research ticket](../../../../_bmad-output/backlog/spike-native-data-notation-investigation.md)
- [Prior corpus and boundary research](../../native-data-boundaries/README.md)
- [Independent projection helper](../../../../tools/research/native-data-notations/astra/project.py)
- [Executable comparison](../../../../tools/research/native-data-notations/astra/run.mjs)
