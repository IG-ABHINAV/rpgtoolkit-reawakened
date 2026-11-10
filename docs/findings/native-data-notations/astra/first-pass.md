# Independent first pass: make ownership clear before choosing punctuation

**Author/model:** Astra, `openai-codex/gpt-6-astra`. **Baseline:** `20e0209d`. **Recorded:** 2026-11-08. This report was produced without reading another investigator's output. Preserve it alongside, not underneath, the later integrated comparison.

## Post-review correction status

The archived original is preserved by the parent. [Correction evidence](review-corrections.md) addresses #1780, #1781, #1789, #1792, #1795 and #1798 with rerun real experiments and seven deliberately broken guards. The expanded matrix has **120 cases: 30 correct clean merges, 72 conflicts and 18 false-clean duplicate-ID merges rejected by the corrected validator**. XML now escapes attribute whitespace and rejects XML 1.0-forbidden characters and invalid typed booleans. The retained tile table below is the original timing sample, not a post-review benchmark; current measurements are in `data/results.json`. Shared-model comparison remains parent-owned.

## Recommendation, not a ruling

**Carry YAML and KDL forward as genuine primary-document finalists.** YAML makes labeled data and inline code approachable, but the tested `Document` API is not a byte-perfect concrete-syntax editor. KDL's tested AST preserved deliberately unusual formatting as well as comments, and its compact numeric rows worked well. Its JSON-in-KDL mapping and less familiar array/root conventions need a willing creator's judgment, not an assumed penalty.

**Keep JSON as the control.** The measured Git results do not establish that YAML, KDL or any other syntax intrinsically merges better. Separately meaningful files, stable IDs, ordered lists and disciplined edits mattered more in these trials.

Hjson deserves consideration if its presentation is preferred; explicit LF normalization removes the initial script-newline concern. JSON5 offers familiar syntax but its chosen serializer loses comments. TOML's null representation and nested array-table editing cost are material for this model. RON is **not excluded for being Rust**: the official parser was compiled to WebAssembly and exercised in a real browser. EDN remains a notation option, but the tested parser's malformed-input handling needs a different implementation or an upstream correction. XML could have a purpose-built vocabulary; the generic typed mapping tested here is too noisy to recommend as-is. SDLang's current tested JS implementation is not ready for this unrestricted value profile.

CUE and Pkl are plausible **optional schema/template/generation tools**; HOCON, Dhall and Nickel also evaluated successfully. None demonstrated a reason to make every ordinary game-data edit an evaluation/provenance problem. No second behavior language is adopted, and no multi-format support requirement follows from comparing formats.

These are judgments from the experiments below, **not human-usability observations or owner approval**.

## What was actually examined

The pinned inventory contains 2,536 entries. I independently read and verified SHA256 for **1,692 domain/program payloads**, using the public `@tk-reawakened/core` decoders, not legacy engine source. **1,689 decoded/read successfully**, including **878 RPGCode files read as text, never executed**. Tileset/font/pixel payload decoding was outside this domain projection; existing media references were retained.

Three ChimeranEmpire files are zero-byte placeholders and failed the public decoders: `Boards/Secret Weapon Shop 2.brd`, `SpcMove/Defenseless.spc`, and `SpcMove/UnMotivate.spc`. These are the already recorded corpus gap, not new notation failures. All share the empty-content SHA256 recorded in [physical provenance](data/physical-provenance.json).

| Actual project | Selected source files | Logical documents | Selected program lines | Scenes represented |
|---|---:|---:|---:|---|
| Demo | 9 | 13 | 67 | `start`, `out`; 20×11×2 and 20×15×2 |
| ChimeranEmpire | 28 | 39 | 136 | `Museum`, `Trogan 1`; both 19×11×8 |
| Caoquest | 20 | 35 | 104 | `house3`, `town`; 19×14×8 and 19×20×8 |
| CrystalImmortality | 38 | 48 | 3,200 | `Castle3left`, `city1`; 19×19×8 and 50×50×8 |

**95 selected source files became 135 documents.** All ten data candidates successfully encoded and decoded the same four comparison bundles **and all 1,350 individual projected documents**. These are populated partial-project research projections, not playable conversions or a whole-game migration claim. Full original-to-new trees and field accounting are in [projections](projections.md).

An important evidence correction: normalized board models all report minor 4, but **the physical files do not**. Demo boards are binary 2.4; ChimeranEmpire and CrystalImmortality examples are binary 2.2/pre-vector; Caoquest's are text 2.1/pre-vector. Header inspection plus the public decoder's `layout` establishes this. Inferring era from normalized `board.minor` alone would erase the older tile-based cohort.

## Independent logical construction

The same construction was used across all notations:

- A **scene** owns placements, geometry, tile rows, triggers and local environment—not copies of party members or inventory capabilities.
- An **actor** describes presence and refers to presentation and, where relevant, a separate party-member or inventory definition.
- A **party-member** owns actual character stats, equipment slots, skills and progression. A placement does not duplicate them.
- An **inventory item** owns use/equip effects. Ordinary NPC `.itm` records do not automatically become empty inventory documents. Ambiguous script-only uses remain explicitly unresolved in the compatibility ledger.
- **Presentation** and ordered **clips** refer to media; pixels remain external/binary.
- **Programs** are separate text documents where appropriate; inline code remains valid at its owning hook. A binding's context is explicit, but this experiment does not resolve legacy runtime-context equivalence.
- **Plugins** own their namespaced subtrees. The absent plugin's content survives but remains unvalidated and is not executable.

The item-grants-skill and actor-specific skill-performance binding are clearly labeled **owner-requested design examples**, not invented legacy facts. The authored miniature has three placements of one actor; the real Caoquest merge scene has six populated placements. The sample schema validates selected structural constraints only; it is not an adopted or exhaustive native schema.

## Value mapping and source text

The common value domain is ordinary acyclic JSON-like data: string keys, explicit null, booleans, finite numbers, arrays with meaningful order and objects whose property order is not semantic. Omitted properties remain omitted; null is not silently dropped. TOML's null marker includes an escape mechanism for real objects that happen to use the marker key, and the collision case was exercised. YAML/EDN tags, TOML dates, RON enums, XML entities beyond the chosen mapping and other rich native values are not secretly treated as equivalent to this domain.

The scalar probes include `0.15`, `1e-7`, the maximum safe integer, an intentionally unsafe integer literal, absent/null, Unicode, negative zero and marker collisions. SDLang's tested JS parser fails the exponent case; `smol-toml` rejects the unsafe integer at parse time. Most other paths require the declared safe-number validation profile after parsing. Negative zero is retained only by the tested YAML path; the comparison canonicalizes it to zero. A production contract requiring signed zero, arbitrary-precision numbers, NaN or Infinity would need a different explicit profile. Do not mistake the permissiveness of JSON5 or RON for an approved runtime numeric contract.

### Owner-approved LF normalization

**CRLF→LF is allowed, not corruption.** The final real projections normalize CRLF and CR to LF on import; original hashes and unmodified decoded sources remain in the local provenance/compatibility material. Every notation passed the explicit normalize→inline→extract→inline source comparison while preserving the test binding ID and context. Quotes, backslashes, Unicode and delimiter-like text also survived.

The earlier byte-preserving experiments are retained as diagnostics, not requirements. Hjson's default multiline serializer changes CRLF to LF; this is acceptable under the owner's ruling. It removes lone CR rather than replacing it with LF, so **normalization before serialization** matters: the explicit-normalization probe passed for CRLF, CR and delimiter-rich inputs. XML line-ending normalization likewise is not itself a rejection reason; the conservative mapping uses numeric character references when exact CR preservation is desired.

The [text-only walkthrough](human-edit.md) additionally records literal block-copy placement additions from real Caoquest data, broken-reference diagnostics and syntax-specific handwritten source strings. All ten parsed the copied placement to exactly seven intended occurrences. All ten preserved the authored multiline source and its final LF in their tested native spellings; conservative escaped serializer output is not a claim that raw multiline syntax is unavailable.

The repo's [RPGCode format documentation](../../../spec/formats/rpgcode-program.md) explicitly accepts CRLF, CR and LF, while [language documentation](../../../spec/engine/rpgcode-language.md) describes CRLF/LF source. No source-language exception requiring preserved CRLF was established. Byte-oriented `FileGet`/`FilePut` and source-file byte counts are different concerns documented in the file API; those observations would naturally change if a program inspected rewritten files. This study neither exercised such self-inspection nor proved VM/save-continuation equivalence.

## Actual Git experiment outcomes

`git merge-file -p LEFT BASE RIGHT` was run on real notation files, with no custom driver. Raw property-text edits were kept separate from library-generated edits. Every conflict-free result was parsed and checked against the intended logical result, not merely accepted because Git returned zero.

| Operation | Observed across ten data candidates |
|---|---|
| Raw independent actor-name / clip-delay edits | All clean; both intended changes preserved |
| Library-driven independent actor-name / clip-delay edits | All clean; both intended changes preserved |
| Raw incompatible edits to the same property | All conflicted |
| Library-driven incompatible edits to the same property | All conflicted |
| Adjacent `x` versus `y` changes | All conflicted |
| Placement edit versus delete | All conflicted |
| Simultaneous placement additions at the same location | All conflicted |
| Reverse placements versus edit the original first placement | All conflicted |
| Insert a clip frame versus reverse frames | All conflicted; 1–3 conflict regions |
| Remove first frame versus edit last frame | All clean; removal, order and edit preserved |
| Same-ID placement additions at disjoint positions | Eight actual clean merges with duplicate IDs, rejected; XML/SDLang mappings conflict |
| Same-ID frame additions at opposite ends | Ten actual clean merges with duplicate IDs, rejected |

The original 100 cases remain 30 correct clean merges and 70 conflicts when rerun with complete-document oracles. **The expanded 120-case matrix has 30 correct clean merges, 72 conflicts and 18 false-clean duplicate-ID results.** Every false-clean result is rejected by the corrected identity checks. This supersedes the original zero-observed-false-clean statement for the expanded coverage. Stable IDs alone do not make stock Git enforce uniqueness or understand sequence intent.

Each local `results/FORMAT/` folder retains exact `.base`, `.left`, `.right`, `.merged`, `.before`, `.after` and `.diff` artifacts. The index is [results.json](data/results.json).

### Open/save and one-property noise

For generated input plus one creator comment, JSON, YAML and KDL had zero no-op changed lines; JSON has no comment to preserve. TOML, JSON5, EDN, XML, SDLang and RON lost the comment through their object serializer (one deleted line). Hjson preserved the comment but changed **10 lines** of whitespace in the final actor-owned-extension fixture. Every raw one-property edit changed two lines: one deletion and one addition.

A separate deliberately noncanonical document exposed the difference between “retains comments” and “preserves source”: YAML kept comments, quotes and `2.000`, but normalized CRLF and flow spacing; Hjson kept comments but normalized layout and `2.000` to `2`; KDL preserved the tested source bytes exactly. This is limited evidence, not a promise for every syntax feature. TOML also reordered object keys in the supplemental populated sample, while preserving logical values and array order.

## Substantial tile experiment

The CrystalImmortality `city1.brd` projection contains **50×50 cells × 8 layers = 20,000 cells**, represented as **400 identified text rows**, with the tile lookup table intact. One cell in one row was changed. Every candidate preserved the intended decoded scene and produced exactly **two changed lines**, without an unrelated whole-scene textual rewrite. The implementation still serializes and parses the whole scene; this is not a claim of incremental computation.

Measured on **Apple M1 Pro, macOS 27.2 arm64, Node 26.13.0, Git 2.55.0**, one retained sample per operation ([exact sample evidence](data/tile-sample.json)):

| Candidate | Scene bytes | Encode changed scene + parse (ms) | Changed lines |
|---|---:|---:|---:|
| JSON | 339,170 | 1.26 | 2 |
| YAML | 273,046 | 149.64 | 2 |
| KDL | 137,221 | 26.64 | 2 |
| TOML | 137,825 | 4.55 | 2 |
| JSON5 | 332,921 | 21.93 | 2 |
| Hjson | 309,046 | 7.31 | 2 |
| EDN | 145,362 | 7.14 | 2 |
| XML | 1,053,093 | 171.99 | 2 |
| SDLang | 930,582 | 82.85 | 2 |
| RON | 550,361 | 38.14 | 2 |

RON includes native subprocess overhead in this table. XML/SDLang verbosity reflects the **generic typed mapping**, not an inherent lower bound for a domain vocabulary. EDN uses a labeled layout emitter because its stock emitter places the document on one line. These are workload observations, not statistically controlled rankings, editor latency guarantees or cross-machine benchmarks. Other selected scene measurements are retained in the JSON results.

## Validation, references and plugin ownership

All ten decoded fixtures passed the research core shape and present-plugin schema. Every selected fixture also has unique placement and frame IDs; the checker now enforces that separately, because schema shape alone cannot. Negative scene width and an invalid plugin radius were rejected. Missing `@missing/story` data and a deliberately mismatched plugin schema version were retained; mismatch generated an error instead of deleting content. The inspector always reports `executable: false` because this is research, and explicitly lists preserved-but-unvalidated plugins.

The XML adapter's value profile is explicitly narrower than arbitrary JavaScript strings. It rejects XML 1.0-forbidden characters in keys, values and input, rejects forbidden numeric character references, and accepts only `true`/`false` for its typed booleans. Legal tab/LF/CR in keys are emitted as numeric references and verified with Python `ElementTree` and Edge `DOMParser`. This is a declared boundary, not silent stripping; no base64 or lossy fallback is used.

JSON Schema **2020-12** was exercised with Ajv's `Ajv2020`, including `prefixItems` and `unevaluatedProperties` positive/negative probes. Merely advertising JSON Schema would not establish this. The plugin schema is separate from the core shape; its content lives on the relevant actor under `actor.extensions`, not in a global plugin-data bucket. None of this automatically creates a good editor UI.

The generic negative-case locator searches a unique invalid marker and must **not** be mistaken for a complete source-map implementation. Separate real parser-node probes found the bad actor-owned plugin radius at **YAML line 46, column 15** and **KDL line 75, columns 16–30** (exact offsets in [extra-results.json](data/extra-results.json)); these prove a useful parser-owned path exists. Mapping every schema JSON Pointer to source remains integration work. Other libraries' syntax diagnostics are recorded individually.

The common reference-edit operation now uses explicit placement and `/designExample/performance/actor` paths plus the actor catalogue. All ten complete renamed documents match an independently constructed expected result. Deliberately stale performance and missing placement references produce exact path/target diagnostics and CLI exit 1. Duplicate placement/frame IDs separately produce `uniqueIdentity` errors: schema shape can pass while `coreValid` is false. These are application checks, not Ajv features. Script literals, dynamic dependencies and out-of-sample project references remain outside scope.

Duplicate-key probes matter before schema validation: YAML, JSON-in-KDL and TOML rejected the duplicate. JSON, JSON5, Hjson, EDN, the RON JSON-value bridge and the XML/SDLang mappings kept the later value. A schema validator cannot recover an overwritten duplicate after parsing. This is a profile/integration requirement, not proof that all those notations mandate that policy.

## Real host/browser results

All nine JS/control paths were bundled and run in actual **Microsoft Edge 157.0.4341.42**, not jsdom: roundtrip, no-op semantics, property edit, positive schema and negative schema passed. Hjson needed its published browser bundle rather than the Node entry importing `os`. SDLang needed its actual ESM namespace rather than the Node CJS default assumption. These were host-entry issues, not format failures.

The official **ron-rs 0.12.3** was compiled with **Rust 1.93.0** to `wasm32-unknown-unknown`; a small allocation/conversion ABI, not a new parser, was exercised in Node and the same browser. Roundtrip, edit, valid/invalid schema and malformed-RON rejection passed. The unoptimized-for-size research artifact was **349,235 bytes raw / 121,614 gzip**; this excludes the JS schema validator. The generic bridge discards comments and typed RON-specific distinctions outside the JSON-domain model.

Standalone minified library export bundles and gzip sizes are in [browser results](data/browser-results.json). They are **not production app deltas**; the KDL standalone figure excludes its separately imported JSON mapping module, and shared dependencies/tree shaking differ. The repo pins Node **24.21.0**; this study ran **26.13.0** and makes no supported-runtime gate claim. Only this browser and macOS host were exercised.

## Composition/evaluation findings

All five official evaluators were available and actually run. A real demo-derived actor name/HP supplied the small source values; composition formulas and overrides were authored research, not legacy programs.

| Candidate | Evaluation and edit provenance observed |
|---|---|
| HOCON 1.4.10 / Java 27.0.1.0.3 | Local include/substitution produced HP 120; explicit override file produced 140. Typed accessor rejected a string. Origins identified inherited name in `defaults.conf`, HP in `actor.conf`, then `override.conf`. Environment fallback was explicitly disabled and tested. No arithmetic expression is inferred from HOCON substitution. |
| CUE 0.17.1 | Computed HP 120 conflicting with 140 produced a located unification error. An explicitly designed default `*120 | int` admitted 140. This is a contract decision, not automatic write-back or Git merging. |
| Dhall 1.42.2 / dhall-json 1.7.12 | Imported record plus expression produced 120; explicit record override produced 140; wrong type rejected with location. Evaluated JSON does not retain the creator's source expression. |
| Nickel 1.18.0 | A `force` field stayed 120 despite an attempted numeric-priority override of 140; a shadowed invalid string was likewise ignored. With an explicitly editable numeric-priority field, 140 applied and an unshadowed string failed its contract. Equal-priority incompatible values produced an error. This is documented priority semantics, not a discovered evaluator bug. |
| Pkl 0.33.0 | `amends`/`super.hp + 20` produced 120; explicit amendment produced 140. Wrong type was reported at the base constraint and override value. The graphical edit must target an amendment or the expression, not an arbitrary exported literal. |

The Nickel macOS binary initially referenced an unavailable Nix `libiconv`; using system libraries through `DYLD_LIBRARY_PATH=/usr/lib` made the real evaluator work. This is a reproduced packaging/host requirement, not a claim that Nickel is unavailable.

Only local imports were used in these examples. Apart from HOCON's explicit negative environment probe, this is not a sandbox or network-denial audit. Imported files, evaluator version and any permitted environment/network inputs would have to be pinned outside the deterministic simulation boundary. Native evaluator support is demonstrated; browser evaluator integrations for these five are **not** demonstrated. Comments survive in the untouched authored source files, not in exported JSON; no inverse “edit computed output back into source” system was built.

## Defects, limitations and owner questions

Evidence-backed defect leads for the integration owner to file or reconcile:

1. **`sdlang@0.2.2`:** native `value null` is rejected; `value 0.15` becomes zero unless a decimal suffix is supplied; the stock serializer fails to escape embedded quotes; exponent `1e-7d` is rejected. Minimal authored reproductions are in `extra.mjs` and [extra results](data/extra-results.json). The site specification supports null and unsuffixed decimals: these are implementation limitations, not a verdict against SDLang. The mapped experiment still completed the full cohort matrix; it is not a production-quality rescue.
2. **`edn-data@1.2.2`:** truncated vectors/maps/strings and a truncated complete fixture return null without a syntax diagnostic. The research core schema **does reject that null**, so this is not reported as an accepted valid game. A willing text editor would get a root-shape error rather than the missing-delimiter location. The malformed-input behavior should be checked upstream, not papered over with a new local parser.
3. **Nickel binary host packaging:** the pinned macOS executable's Nix `libiconv` path required a system-library workaround; exact binary hash and successful commands are retained. Language merge priority is not filed as a bug.

No production decoder/runtime defect was repaired or newly alleged from a stale summary. Initial harness errors (an incorrect KDL AST method, a missing strict tuple bound, path handling around a real `!` filename, and a key-order-sensitive supplemental comparison) were corrected as research tooling errors, not attributed to the languages.

Open choices remain: physical grouping granularity; whether KDL's source-preserving editing advantage outweighs YAML's presentation for this audience; how much comment/format preservation is promised; a constrained numeric/schema profile; whether any generation language is optional tooling; and the final human authoring judgment. The small research validators, generic XML/SDLang mappings, arbitrary native tags and untrusted-input hardening are not production-ready contracts.

**No adoption, owner acceptance, independent external review or joint/shared-model comparison is claimed.** The parent owns those and repository gates, issue filing and PR integration.

## Key source files

- [Primary sources and exact implementations](candidates.md)
- [Common experiment runner](../../../../tools/research/native-data-notations/astra/run.mjs)
- [Edge cases and normalization](../../../../tools/research/native-data-notations/astra/extra.mjs)
- [Source version/default provenance](../../../../tools/research/native-data-notations/astra/provenance.py)
- [RON browser bridge experiment](../../../../tools/research/native-data-notations/astra/wasm.mjs)
- [Composition experiments](../../../../tools/research/native-data-notations/astra/composition.py)
