---
id: 1
type: spike
title: "Astra and Opus: reshape recovered game data and compare native notations"
parent: none
covers: []
after: []
tracker_id: "#1778"
refined: true
hitl: true
risk: low
---

# Investigate Git-friendly native game-data notations with real editing experiments

## Description

Compare data notations using representative game data from research #1771 / PR #1776. Produce reproducible evidence and a recommendation for human review, not a production format implementation. Jensen and subsequent native-format/editor planning need the findings; no existing implementation ticket is newly blocked by this task.

Assign Astra and Opus as two independent investigators. Each must inspect the recovered data and produce hands-on game-data reorganizations and notation experiments, not merely review the other's answer. Use the same pinned input games and experiment questions, but preserve independent proposed logical constructions and conclusions before review. Different agents independently review the completed investigations; Astra and Opus do not review each other. An integration owner compares both reports, reconciles factual errors, and retains genuine disagreements for Jensen. Jensen accepts or rejects recommendations at the end; research can proceed without interim format decisions.

## Direction from the owner

- Formats describe logical data contracts, not editor screens. Keep separately meaningful documents separate; do not create one giant database.
- Actor means presence in a scene, not just pixels. Inventory items separately describe capabilities and effects on the party. A scene-specific representation must not duplicate the underlying party member, inventory or capabilities.
- Scenes are the forward concept behind legacy boards. Current battle scope retains the existing engine's transition to a separate battle scene. Live-action combat is a possible future plugin extension, not work for this task. Platformer design is out of scope.
- Use the existing plugin direction to extend operation, rather than anticipating all future behavior in one oversized scene model.
- Reserve namespaced ownership for plugin data on the relevant logical object. Core and plugins provide schemas for their respective data. Missing plugins must not cause their data to be deleted; preserved but unvalidated data is not automatically safe to execute.
- Editors serve creator tasks and may span contracts. Schemas may assist property editing but must not dictate the whole UI. Editor-plugin implementation is future work.
- Inline and external RPGCode are both legitimate. Actual pixel/image payloads may remain binary, with text presentation wrappers.
- YAML is currently preferred over JSON, not selected. Multiple syntaxes are permitted to investigate, not a support requirement.
- Human-readable and human-editable files are a primary requirement alongside Git friendliness. A willing creator must be able to understand and modify the data in an ordinary text editor without the graphical editor. Manual editing is supported, never required.

Evaluation priority: (1) Git-friendly edits and merges; (2) human readability and optional hand-editing; (3) machine parsing and serialization in our TypeScript/JavaScript ecosystem. Useful format features and solutions may justify a deeper look. Do not rank primarily by parser familiarity or convenience. For candidates that stand out, investigate the actual parsing/editing/serialization path across browser, Node and editor hosts, schema integration, semantic and comment-preserving round trips, deterministic value mapping, performance, bundle/dependency cost and licence constraints. Distinguish a notation limitation from a limitation of one available library. Explain what integration work a strong candidate would require rather than silently excluding it.

## Approach

No arbitrary time estimate is assigned. Bound the work by the candidate matrix and experiment set below. Finish with evidence-backed tradeoffs and explicit blocked cells, not an invented universal winner.

### Candidate tracks

1. Hands-on data-notation comparison: YAML, KDL, TOML, JSON5, Hjson, Rusty Object Notation (ron-rs/ron), EDN and XML. Include ordinary JSON as a control.
2. SDLang: preliminary investigation of specifications, schemas and available parser/editor tooling. Promote it to the same hands-on experiments if a viable implementation meets project constraints; otherwise document the exact blocker.
3. Separate composition/evaluation track: HOCON, CUE, Dhall, Nickel and Pkl. Investigate their semantics and run representative evaluation/validation and edit-provenance examples where tooling is available. Distinguish suitability as primary editable documents from schema, template or generation tools. Do not describe language-level merging/unification as Git conflict resolution.

For every candidate, identify versions, primary documentation, implementation choices, licence, maintenance evidence, browser/TypeScript feasibility, schema tooling and syntax/comment-preserving edit support. Unsupported cells require evidence of the missing prerequisite and what was tried; do not silently drop a candidate or simulate parser output. Never build a new parser just to rescue a candidate.

### Shared fixtures

Both Astra and Opus start from the actual demo and recovered corpus data, not just synthetic fixtures or the summary report. Select at least three existing projects together covering NPC-heavy, script-heavy and older tile-based material where the decoded evidence permits it. For each selected project, show the current document relationships, proposed redistribution into actor/item/scene/presentation/behavior contracts, a projected file tree, and populated examples in the candidate notations. Preserve traceability from original file and field to projected owner. Account explicitly for fields left unmapped or data that cannot decode. Experimental local projections may span a whole decoded project; they are not production conversions or proof of playability.
 
Within each investigator's comparison, use the same logical model across notations, stable authored identities and explicitly ordered collections. After independent proposals are recorded, run a shared comparison on agreed representative constructions so syntax results are not confounded by different models. Distinguish observed fields from synthesized defaults and proposed features. Small authored fixtures supplement the real-game experiments for edge cases; they do not replace them.

Represent: an actor definition; several scene placements of that actor; an inventory item and illustrative skill grant; a skill with actor-specific performance binding; an ordered presentation clip; geometry and a substantial tile layer; inline RPGCode plus an external program reference; namespaced plugin properties whose schema can be present or absent. The item-grants-skill case is an owner-requested design example, not a claimed legacy field.

Include text-editor-only authoring rehearsals: locate an actor's definition from its placement, understand core versus plugin property ownership, change a property, edit an inline script, add a placement, and identify a broken reference. Provide before/after examples and validation commands that do not require the graphical editor. Assess discoverability, nesting, punctuation, escaping and how much context a person must hold; do not equate terse syntax with readability. Label agent-performed rehearsals as such, not as human usability testing, and prepare a short walkthrough Jensen can try.

Keep the same semantics across candidates. Where a notation cannot express a value directly, document its mapping and cost rather than changing the logical fixture to favor that notation. Record exact numbers, absence/null conventions, Unicode and multiline-string handling. Syntax-specific capabilities may receive a separate labeled experiment.

### Experiments

- Parse and validate authored examples; prove invalid examples are rejected or clearly reported as unvalidated.
- Open/save with no changes; compare bytes, comments, key order, unknown extension content and line endings.
- Change one property; record exact diff and unrelated churn.
- Make independent branch edits using actual Git three-way merges; check both textual result and decoded semantics. Separate authored raw-text edits from editor-style modifications through the chosen library.
- Change the same property incompatibly; verify the disagreement is surfaced, or document any silent overwrite. A conflict-free but incorrect merge is a failure.
- Insert, remove and reorder placements and clip frames; preserve identities and meaningful order. Include adjacent edits, edit-versus-delete and simultaneous additions.
- Edit one tile row/chunk without reformatting the entire scene. State layer dimensions and measure file/diff sizes and operation time on a disclosed machine/runtime.
- Edit embedded RPGCode, including quotes, backslashes, multiline content and delimiter-like text; extract to an external file and compare source content after explicitly declared newline normalization, plus explicit binding semantics. Jensen permits converting legacy line endings to normalized line endings: CRLF-to-LF alone is not corruption or a notation failure. Retain original source hashes for provenance and distinguish intentional normalization from other content changes. Normalized-text equality is not proof of VM/save-continuation equivalence.
- Rename a referenced asset using a common reference-edit operation; verify all known references and useful unresolved-reference diagnostics. Do not credit generic schema validators with project-wide resolution.
- Load/save without a plugin or its schema; preserve its content and distinguish unavailable validation from malformed data. Exercise schema version mismatch without silently discarding fields.
- Demonstrate namespaced plugin-schema validation and useful source locations for errors. Verify schema dialect support rather than relying on a 'JSON Schema supported' label.
- Exercise representative parser/validator/edit operations in Node and a browser for candidate libraries that claim both. Record unsupported host environments separately from actual failures.

For the programmable track, demonstrate where a graphical edit would be written when a value is inherited, computed or combined across files. Identify imports, environment dependence and evaluation requirements; preserve the repository's deterministic/host boundaries. No second behavior language is adopted by this research.

### Deliverables

One linked report with candidate facts, semantic mappings, measured results, concrete diffs and merge outcomes, tradeoffs, rejected approaches and unresolved questions. Include runnable experiment commands, minimal shareable fixtures, exact dependency/runtime versions, input provenance/hashes and machine-readable results. Separate facts, inferences and recommendations. Distinguish stock Git from any custom merge driver; do not quietly introduce a format-specific driver.

Record the result under docs/findings/native-data-notations/ in a research PR, linked from this task and the existing native-data-boundaries research. Retain useful experiment tooling and fixtures; remove throwaway scaffolding. Do not commit whole games, proprietary assets or complete recovered programs. Use small authored/anonymized fixtures and reproducible local corpus locators.

## Acceptance Criteria

1. **Every named candidate has an evidence-backed disposition.**
   Verify: the report accounts for all three tracks, cites primary sources and records exact tool versions, licences, exercised functionality and explicit limitations. A missing implementation is not an untested assertion of poor format quality.
2. **The same representative logical data is compared fairly.**
   Verify: both investigators deliver populated projections and before/after relationship maps for at least three existing projects, including the demo, with source provenance and unmapped-field accounting. Fixture mappings cover every listed construction, preserve references/order and distinguish corpus evidence from proposed behavior. A reviewer can reproduce parse/validate results and inspect malformed cases that fail validation.
3. **Editing and merging are exercised rather than rated by appearance.**
   Verify: runnable experiments and retained diffs cover every listed operation; real Git merges are checked for semantic preservation, false-clean conflicts and unrelated rewrite churn. No-op and missing-plugin round trips have explicit assertions.
4. **Integration and authoring costs are visible.**
   Verify: results distinguish notation, schema system, parser, editor library and evaluation/runtime requirements. Node/browser support, inline-code preservation, error locations, dependency suitability and schema composition are demonstrated or evidence-backed blockers are recorded.
5. **Recommendations preserve owner choice.**
   Verify: the report identifies tradeoffs and plausible finalists without approving a native schema, syntax, multi-format support or runtime/editor change. YAML preference is treated as a hypothesis. Jensen's acceptance or requested changes are recorded in the task before closure; research output may be submitted for review first.
6. **Astra and Opus both provide independent experimental evidence.**
   Verify: separate reports identify the actual model/version, input revision, tools, commands, projected game layouts, notation examples and outcomes. A joint comparison links both originals and explains disagreements without replacing them with artificial consensus. If either requested model is unavailable, report that blocker; do not silently substitute another model.
7. **Files remain usable by a willing human without the graphical editor.**
   Verify: both reports include ordinary-text-editor walkthroughs and actual diffs for the listed manual tasks. Core/plugin ownership, references and script boundaries can be explained from the documents and available schema/help. Report manual-edit friction honestly; no opaque packed data or compulsory code generation may be presented as equivalent to directly editable authoring files. Actual image/pixel payloads remain the agreed exception. Distinguish agent judgment from observed human usability.

## Boundaries

Research only. Experimental local game-data projections are in scope; production schema adoption, production game conversion, automatic script rewriting, a new combat system, an editor-plugin framework and guardrail exemptions are not. No legacy GPL engine source access. No claims that all recovered games decode or can migrate losslessly; research #1772 records known decode coverage gaps. Use docs and permitted game data only. Follow repository dependency/licence rules, public package boundaries and existing lint/build conventions. File defects discovered by the investigation and link evidence; do not expand this spike into unrelated repairs.

## References

- research — https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/1776
- source — https://github.com/tk-reawakened/rpgtoolkit-reawakened/blob/6b142e9bafdc38e7a9362adc172b66546c2e8a73/docs/findings/native-data-boundaries/README.md
- proposals — https://github.com/tk-reawakened/rpgtoolkit-reawakened/blob/6b142e9bafdc38e7a9362adc172b66546c2e8a73/docs/findings/native-data-boundaries/candidate-constructions.md
- behavior evidence — https://github.com/tk-reawakened/rpgtoolkit-reawakened/blob/6b142e9bafdc38e7a9362adc172b66546c2e8a73/docs/findings/native-data-boundaries/script-patterns.md
- constraints — docs/guardrails.md, G1–G7

## Notes

- Decision: 2026-11-08 — Jensen requested this investigation and a task for AI agents after agreeing to the comparison approach. No implementation or format decision is authorized.
- Decision: 2026-11-08 — Jensen approved execution against the recovered games. Astra and Opus investigate the full question independently. Different agents independently review the recorded reports afterward. Git-friendly edits and merges come first, optional human editing second, and ecosystem parsing/serialization third.
- Risk: low — experiments do not alter shipped behavior; misinterpretation is controlled by retained evidence and owner acceptance.
- Open question: final physical document grouping, notation, schema language/dialect and version/migration conventions remain findings to discuss, not prerequisites silently chosen for production.
- Open question: supporting several input syntaxes may be useful but is not required. Compare the cost against one predictable authoring format.
- Dependency: PR #1776 supplies the baseline evidence. It may be consumed at its pinned revision without waiting for merge. Confirm current source/data availability before experiments and record missing inputs rather than substituting mock corpus results.
- Handoff: one integration owner pins the shared input games and experiment questions. Astra and Opus own separate worktrees/output areas and independently investigate the same problem; do not divide the formats so neither sees the complete tradeoffs. Different agents independently review both recorded reports afterward. The owner integrates the comparison and runs consolidated repository checks after edits. Jensen authorized launching both investigators and clarified the separate-reviewer requirement on 2026-11-08.
