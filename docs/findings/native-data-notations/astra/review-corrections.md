# Post-review corrections to Astra's independent evidence

**Author/model:** Astra / `openai-codex/gpt-6-astra`. **Date:** 2026-11-08.

The parent preserved the original work at `/private/tmp/tkr-1778-astra-first-pass.tar.gz` before assigning these corrections. This document distinguishes that original evidence from the new experiments. It responds to the four independent review triages; it does not read or reconcile the other author's report/code. Parent-owned common-model comparison, fresh independent review of fixes and owner approval remain required.

## What changed materially

The original **100-case** matrix found 30 semantically correct clean merges and 70 textual conflicts. Its partial add/add and frame predicates were too weak, and it omitted disjoint-position additions sharing an ID. Therefore its zero-observed-false-clean statement was not sufficient evidence of identity safety.

The corrected **120-case** matrix now has:

- **30** clean merges matching a complete permitted document.
- **72** textual conflicts.
- **18 actual false-clean merges:** Git exits zero, but the result has duplicate placement/frame IDs. The corrected semantic guard and CLI reject every one.

All ten notations clean-merged same-ID frame additions at opposite ends. Eight clean-merged same-ID placement additions at positions 1 and 5 in the real six-placement Caoquest scene. The XML and SDLang **chosen mappings** produced a textual placement conflict instead; no clean result is credited for those two. This is not an intrinsic safety advantage: both mappings still clean-merged the duplicate-frame case. Their serialized array-position labels can add textual conflicts despite disjoint logical edits.

| Issue | Correction | Exercised evidence |
|---|---|---|
| [#1780](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1780) | Full-document sequence expectations, preserving all untouched fields, existing order, references and inserted content | Four positive permitted documents; 23 intentionally corrupted documents rejected; disabling full equality makes the guard assertion fail |
| [#1781](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1781) | Explicit actor-reference paths include `/designExample/performance/actor`; rename and checker use the declared paths, not arbitrary plugin string traversal | All ten adapters retain the independently constructed complete expected renamed document. A deliberately stale performance reference is diagnosed at its exact path, and all ten CLI calls exit 1 |
| [#1789](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1789) | Unique placement and frame identity checks, separate from schema shape | 18 actual clean Git duplicate results rejected; direct duplicate-placement-plus-frame inputs rejected in all ten formats; bypassed identity guard fails its assertion |
| [#1792](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1792) | Builder emits numeric references for tab/LF/CR, after standard entity escaping | Distinct keys `a\nb`, `a\tb`, `a\rb`, `a b`, literal `a&#10;b` and quote/ampersand/less-than content remain distinct under both FXP and Python ElementTree; actual Edge DOMParser also agrees |
| [#1795](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1795) | **Declared XML 1.0 character-domain restriction:** reject forbidden characters in keys/values and input; reject forbidden numeric references | Eleven forbidden code points tested in keys, values, literal input and decimal references; independent XML parser rejects the references. Hex/out-of-range references, valid range boundaries and literal CDATA/entity-escaped reference text are also exercised |
| [#1798](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1798) | Typed booleans accept only exact `true` or `false`; no typo-to-false coercion | `treu`, `FALSE`, empty text, `1`, `0` and padded ` true ` rejected; true/false positives pass; bypassing the guard restores the bad coercion and fails the assertion |

The reference review demonstrated a checker gap using a deliberately stale binding. The post-review proof does not depend on whether a particular earlier recursive rename happened to update it: it constructs expected changes independently, compares the **whole** output, and separately proves that omitting the performance update is detected. Opaque plugin data is not traversed as if core owns its reference semantics.

## Explicit experimental merge semantics

`semantic-checks.mjs` supplies complete allowed documents, not ID/count membership tests:

- Simultaneous independent appends allow either ordering of the **two added records only**. Existing ordering and every existing/new field must match.
- Frame insertion plus reversal means reversing the complete inserted sequence, preserving the insertion's original gap by identity. This is a declared experiment interpretation, not a proposed universal semantic merge policy.
- Frame removal plus editing the last surviving frame requires the exact resulting document.
- Edit/delete and same-ID competing insertions have no automatically permitted combined result.

The corruption probes change actor metadata, placement order/references, existing frame contents/order, inserted record contents, duplicate identities and unrelated root fields. A result cannot pass merely because the new IDs survived.

The CLI now reports `schemaValid` separately from `coreValid`. Duplicate-ID fixtures have `schemaValid: true`, `coreValid: false`, and `uniqueIdentity` errors with both occurrence paths. Cross-reference failures remain `unresolvedReferences` and cause exit 1. These are application checks, not features falsely credited to JSON Schema.

## XML scope and independent checks

The typed-v mapping now escapes text and attribute values itself instead of relying on the builder's single entity list. Ampersands are escaped first, so a literal string such as `&#10;` is not confused with a newline. Attribute keys receive numeric references for tab/LF/CR because XML attribute-value normalization would otherwise fold them to spaces. Character data keeps literal tab and newline for readability, and escapes CR as `&#13;` because parsers normalize raw CR to LF. Emitted example: `<v key="a&#10;b" ...>`, with inline source remaining multi-line.

This XML profile is **not an injective encoding of all possible JavaScript strings**: XML 1.0 forbids NUL, certain controls, isolated surrogate code units, U+FFFE and U+FFFF. The adapter now refuses these rather than claiming success through a permissive parser. It does not remove or replace them and does not introduce an opaque/base64 fallback. All 135 real selected documents remain within the exercised profile and roundtrip successfully.

The reference scanner is a lexical forbidden-character-reference guard, not a replacement XML parser; comments, CDATA and processing instructions contain literal text and are skipped by that particular check. Raw forbidden characters are still rejected everywhere. Python `xml.etree.ElementTree` independently checks XML parsing; the small reference decoder then interprets the typed-v mapping. Its boolean rule is the declared mapping rule, **not a claim that XML itself or `xs:boolean` forbids numeric boolean spellings**. General XML security, DTD/entity handling and full standards conformance are not established by these probes.

The relevant standard rules are [XML 1.0 characters](https://www.w3.org/TR/2008/REC-xml-20081126/#charsets) and [attribute-value normalization](https://www.w3.org/TR/2008/REC-xml-20081126/#AVNormalize). These were project-owned adapter defects/boundaries, not evidence that the notation inherently corrupts legal keys.

## Reviewer repros replayed on corrected code

The parent-owned repro scripts were inspected only for the Astra portions. Replaying their scenarios now gives:

- **Reference repro:** a rename covering actor, catalogue and placements but not `designExample.performance` yields `schemaValid: true`, `errors: []`, and `unresolvedReferences: [{ path: '/designExample/performance/actor', missing: 'actor:item/cao2.itm' }]`. The CLI exits 1. The complete rename rewrites 3 references and leaves nothing unresolved.
- **Edge follow-up repro:** its Astra XML encode of `{ payload: 'a\u0000b' }` now terminates with `Error: XML10_FORBIDDEN_CHARACTER U+0000` instead of producing a document that only the permissive parser accepted. This is the declared rejection boundary, so a caller that previously expected success must handle it.
- **Same-ID merges:** the reviewer's disjoint-position construction produces the duplicate identities at `/scene/placements/6/id` (first `/scene/placements/1/id`) and `/clip/frames/5/id` (first `/clip/frames/0/id`) for every format that merged cleanly. XML/SDLang placement files instead carry textual conflict markers and are not treated as merged documents.

These are recorded in [`review-replay-results.json`](data/review-replay-results.json); [`review-replay.mjs`](../../../../tools/research/native-data-notations/astra/review-replay.mjs) regenerates them. The external repro scripts themselves remain parent-owned artifacts and were not modified.

## Negative controls: the assertions were made to fail

The harness creates scratch-only mutant modules from the corrected implementation. It does not edit repository files while running. **Seven mutants were killed**: full equality always true; performance-reference omission; identity guard disabled; XML whitespace references removed; forbidden-character guard disabled; numeric-reference guard disabled; boolean lexical guard removed. Each produces an `ERR_ASSERTION` for its guarded expectation; an unrelated exception is not accepted as proof.

The corrected implementation's corresponding positive and negative probes pass. The numeric-reference mutation specifically proves the early reference diagnostic; a downstream check may still reject the resulting character by another route. It is not represented as evidence that removing that one guard necessarily permits every invalid input.

The exact failed assertion messages and restored outcomes are in [`post-review-results.json`](data/post-review-results.json). Full mutants and actual source/merge files remain under local `post-review/` and `results/FORMAT/`, not redistributed game content.

## Coverage retained and commands actually run

The four-source cohort, 95 selected sources and 135 logical documents are unchanged. The rerun reports **40/40 bundle** and **1,350/1,350 individual document** semantic roundtrips. Original hashes, physical-version evidence and declared **CRLF/CR → LF import normalization** are unchanged. No VM-equivalence claim is added.

From the worktree, each of the following ran against `/private/tmp/tkr-1778-astra-experiments`:

```sh
node tools/research/native-data-notations/astra/run.mjs /private/tmp/tkr-1778-astra-experiments
node tools/research/native-data-notations/astra/review-corrections.mjs /private/tmp/tkr-1778-astra-experiments
node tools/research/native-data-notations/astra/extra.mjs /private/tmp/tkr-1778-astra-experiments
node tools/research/native-data-notations/astra/browser.mjs /private/tmp/tkr-1778-astra-experiments
node tools/research/native-data-notations/astra/wasm.mjs /private/tmp/tkr-1778-astra-experiments
node tools/research/native-data-notations/astra/examples.mjs /private/tmp/tkr-1778-astra-experiments
node tools/research/native-data-notations/astra/text-rehearsal.mjs /private/tmp/tkr-1778-astra-experiments
node tools/research/native-data-notations/astra/strings.mjs /private/tmp/tkr-1778-astra-experiments
```

The correction harness initially required all 20 added Git cases to be clean; actual XML/SDLang placement conflicts disproved that expectation. It now records conflicts honestly and proves clean-result rejection where Git really returned zero. A patch-alignment syntax error was corrected before execution. Neither is hidden as a successful trial.

Actual Edge probes additionally exercise duplicate identities, stale performance references, full-document corruption and an independent DOMParser whitespace comparison. Official RON WASM, source normalization, real text edits, authored examples and substantial tile edits were rerun. Five composition-evaluator results are retained from the original experiments because those implementations were unchanged; they were **not** rerun for this correction.

No production/runtime changes, repository suites, commits or issue mutations occurred. The original retained tile-timing table remains explicitly historical; current single-sample timings are in `data/results.json`. No new benchmark ranking is claimed. The independent recommendations remain conditional, and **shared-model comparison has not been waived or completed by this worker**.

## Key source files

- [Complete allowed-document and identity/reference guards](../../../../tools/research/native-data-notations/astra/semantic-checks.mjs)
- [Correction/mutation experiment](../../../../tools/research/native-data-notations/astra/review-corrections.mjs)
- [Independent XML parser/typed-value probe](../../../../tools/research/native-data-notations/astra/xml-reference.py)
- [Corrected adapters](../../../../tools/research/native-data-notations/astra/adapters.mjs)
- [Corrected real merge matrix](../../../../tools/research/native-data-notations/astra/run.mjs)
