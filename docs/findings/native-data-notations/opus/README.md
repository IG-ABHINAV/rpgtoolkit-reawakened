# Native data notations: Opus independent investigation (#1778)

**Independent first-pass report, with a post-review [correction record](CORRECTIONS.md).** Review found defects in my adapters, oracles and checker (#1780, #1782–#1797). They were fixed and the affected experiments re-run; where first-pass prose below disagrees with CORRECTIONS.md or the re-run `results/`, those take precedence. It is not a cross-reviewed or approved format decision. Nothing here selects a schema, notation, multi-format policy, runtime or editor change. YAML is treated as the owner's hypothesis, not as the expected winner.

| | |
|---|---|
| Investigator | "Opus" assignment. Runtime-reported model: **anthropic/claude-opus-5-5** |
| Independence | Astra's outputs were not read. Per the owner's later instruction, review is done by separate reviewers. |
| Input revision | Repository baseline `20e0209d`; public `@tk-reawakened/core` decoders (prebuilt) |
| Runtime exercised | Node **v26.13.0**, not the pinned 24.21.0, so this is no supported-runtime claim. Also exercised: headless Chrome for Testing 150, Java 1.8.0_511, Rust/cargo 1.99.1, git 2.55.0, macOS (`sw_vers` 27.2), Apple M1 Pro, 16 GB. |
| Scratch (bulk, not tracked) | `/private/tmp/tkr-1778-opus-experiments`: decoded models, whole-game projections in 14 notation variants (~194 MB), git work trees, diffs, binaries |

Linked documents:

- [Candidate facts and dispositions](candidates.md): every named candidate in all three tracks.
- [Source-to-projection mapping and accounting](mapping.md).
- [Text-editor walkthrough](walkthrough.md): agent rehearsal, plus a short walkthrough for Jensen.
- Authored examples, including invalid ones, in nine notations: [`examples/`](examples/).
- Machine-readable results: [`results/`](results/).
- Tooling: [`tools/research/native-data-notations/opus/`](../../../../tools/research/native-data-notations/opus/).

## What I did

1. **Decoded the pinned cohort** (demo, Chimeran Empire, Caoquest, Crystal Immortality) with the public core decoders, after verifying every consumed file's SHA-256 against the shared inventory: 0 mismatches. Crystal's nested `zip.zip` was extracted to scratch with `bsdtar`; no installer was run and no RPGCode was executed. Board variants were taken from stored headers. Caoquest has **14 Toolkit 2 text boards**, which makes it the older tile-based case.
2. **Proposed my own logical regrouping** and projected **every decoded document of all four games**: demo 26, Chimeran 361, Caoquest 82, Crystal 708 documents. Every decoded field path is classified as mapped, compat, or not projected with a reason; **0 are unaccounted**. All projected documents validate against my draft JSON Schema 2020-12. The checker found real broken references, including sentinels. See [mapping.md](mapping.md).
3. **Round-tripped every projected document** through 14 notation/printer variants: YAML; JSON and JSON-layout; JSON5 and JSON5-layout; Hjson; TOML and TOML-rows; KDL (JiK); EDN and EDN one-line; RON and RON-compact; XML. **Semantic round trip 100% for all variants**: 1,177 documents × 14.
4. Ran the **editing/merging suite** on real constructions:
   - Crystal `castle3left`: 6 placements of 2 actors.
   - Crystal clip `water1`: 7 frames.
   - Crystal `city1` tiles: 50×50×8, 20,000 cells, 357 palette entries.
   - Demo `start` scene: geometry, inline and external RPGCode.
   - Chimeran Crystal Staff / Mage Sword / Icharus (item → skill).
   - Authored plugin data.
   - **603 real `git merge` runs** across 19 scenarios (stock ort strategy, no custom merge drivers; corrected run).
5. Exercised **parsing in Node and headless Chrome** from identical esbuild bundles. Exercised **schema dialect behaviour** with two validators.
6. Exercised **all five programmable languages** with real tools.

## Findings (facts; numbers come from `results/`)

### F1. Diff and merge shape is decided by the writer's layout more than by the notation

Two layouts were tested for the same notation and data (scopes kept separate, #1785). With the library-default writer, JSON (`JSON.stringify(v,null,2)`), JSON5 and RON-pretty put **every number on its own line**:
- **One document**, Crystal `city1` tiles (50×50×8): JSON 308,536 bytes / 23,221 lines; with an inline-scalar-array layout 100,504 bytes / 2,485 lines.
- **Whole project**, Crystal (708 documents): JSON 13,494,660 bytes; layout 6,046,874 bytes.

Writers without that control:
- `toml-patch` either explodes arrays or emits a whole tile layer on **one line**. The longest TOML line on Crystal is 26,500 characters, even after re-flowing tile rows, because it also writes nested arrays of tables inline.
- `edn-data` writes one line per document; the longest is 60,842 characters.
- RON `compact_arrays` puts a whole layer on one line (9,918 characters).

The notations themselves allow good layouts:
- TOML 1.1.0 (released 2025-12-24) allows multi-line inline tables, and both TOML parsers accept them.
- EDN, RON and KDL allow line breaks anywhere.

So any candidate needs a **canonical writer with an explicit layout contract**. For JSON, JSON5 and EDN that writer is project-owned code here, labelled as such.

### F2. 603 merges: no incorrect clean merge accepted by the checker; 53 clean textual merges were semantically wrong

Across 19 scenarios × 14 variants × up to 3 edit paths (re-emit, format-preserving library edit, raw hunk replay), judged against the **whole** permitted document ([merge-matrix.md](results/merge-matrix.md)):
- **260** clean merges equal to the expected document exactly;
- **131** expected conflicts and **68** order-ambiguous conflicts;
- **91** spurious conflicts;
- **53 textually clean merges that are semantically wrong**: the same new ID added at disjoint positions produced duplicate identities. Git did not detect them; `check.mjs` rejects every one as `duplicate-id`;
- **0** clean merges that were wrong *and* passed the checker, and 0 unparseable results.

43 replays could not apply (simulation limit) and 152 cells have no applicable path; those are not counted as merges.
- Incompatible edits always conflicted: same field, edit vs delete, opposite reorders, same tile cell.
- Simultaneous appends and same-position frame insertions always conflicted. Order is genuinely ambiguous there, so this is acceptable.

Costs, shown as spurious conflicts (`s`) in [merge-matrix.md](results/merge-matrix.md):
- Deleting adjacent clip frames conflicted everywhere: adjacent changed lines.
- Two fields of the same placement conflicted where the writer put them on adjacent lines: Hjson condensed objects, TOML inline tables, KDL properties.
- Two different cells in one tile row conflicted with row-per-line layouts, but merged cleanly with the exploded JSON/JSON5/RON/Hjson layouts. That is the trade against those layouts' 3× size.
- TOML default, RON-compact and EDN one-line also conflicted on different rows, because a whole layer was one line.

Raw-hunk replay could not apply onto the commented file for some deletions and reorders (`!`). That is a limitation of the simulation, not of a notation.

### F3. Among the JS libraries surveyed, comment-preserving edits were found for YAML, JSON(C), TOML, KDL, Hjson and XML, but not for JSON5, EDN or RON

Survey scope: npm registry searches and the packages named in [candidates.md](candidates.md) on 2026-11-08. This is not a proof that no such library exists.

| | Preserve-edit lib | Comments kept | CRLF kept | Notes |
|---|---|---|---|---|
| YAML | `yaml` Document | yes | **no** | |
| JSON | `jsonc-parser` | n/a (no comments) | yes | |
| TOML | `toml-patch` | yes, except a section comment removed with its deleted table | yes | |
| KDL | `@bgotink/kdl` | yes | yes | inserted nodes need copied whitespace trivia (done here) |
| Hjson | `Hjson.rt` | yes | **no** | |
| XML | xmldom | yes | **no** | XML 1.0 normalises line ends |
| JSON5 / EDN / RON | none found among the JS packages surveyed (`json5`, `jsonc-parser` rejects JSON5 keys, `edn-data`, `rusty-object-notation`) | — | — | EDN has `rewrite-edn` on the JVM (EPL-1.0, G6-blocked): it kept comments in a probe |

Every format-preserving single-property edit produced a 1-line diff on the demo scene. Re-emitting an authored file through any library writer dropped all comments.

### F4. RPGCode under the declared LF normalisation: no content or escaping corruption

Recovered programs are CRLF: Chimeran 233/233, Crystal 592/593, Caoquest 46/47. The demo is LF. Per the owner's rule and `docs/spec/formats/rpgcode-program.md` ("the engine accepts CRLF, CR or LF"), the experiment normalises CRLF/CR → LF on import and keeps the original SHA-256 for provenance.

Cases tested:
- An authored edge script: quotes, backslashes, `"""`, `'''`, `]]>`, `-->`, `*/`, `#"`, `"#`, a tab, trailing spaces, `é`.
- Real CRLF and LF programs.
- The demo's inline hook.

After normalisation, every variant returned the script text **exactly**. Extracting it to an external file and inlining it back was exact, and the binding became the explicit `{program: …}`.

Separately, as an informational check only, the un-normalised CR bytes survived re-emit everywhere except Hjson multi-line strings.

Hand-typed pitfalls observed:
- **KDL** `"""` with `\ ` *silently* drops the backslash and following whitespace (`#"""…"""#` is exact).
- **YAML** `|` silently adds a final newline (`|-` is exact).
- **TOML** `"""` with an unescaped `\` is rejected loudly.

Normalised-text equality is not a claim of VM or save-continuation equivalence.

### F5. Schema validation is notation-independent; source locations are not

The JSON-model value from any notation validates identically with Ajv 2020 (core schema plus per-namespace plugin schemas).

Mapping an error to `file:line:col` worked for YAML, JSON, TOML (via `toml-eslint-parser`), KDL and XML. It did not work for JSON5, Hjson, EDN or RON: their libraries expose no node positions, so only syntax errors carry positions there.

Plugin data:
- Missing schema → `unvalidated-no-schema`.
- Data `version: 2` vs installed v1 → `unvalidated-version-mismatch`, with the unknown field preserved.
- Content was preserved through re-emit and through unrelated format-preserving edits in every variant.
- Invalid data was reported with a location where the codec supports locations.

**Dialect check:** a 2020-12 `$dynamicRef` to a `$dynamicAnchor` declared under `$defs` is **mis-evaluated by Ajv 8.20.0**. It rejects the valid instance by applying the root schema. Hyperjump `@hyperjump/json-schema` 1.18.0 evaluates all four probes as expected. Ajv's default class refuses the 2020-12 meta-schema URI. Stripping the URI makes it **silently ignore** `unevaluatedProperties`. So "supports JSON Schema" needs a named dialect, a named validator, and tests.

### F6. Node and browser parity for every JS library exercised

Corrected run: every library step makes positive and negative semantic assertions (round trip, malformed input rejected, expected edit, validator accepts valid / rejects invalid at the expected path), then results are compared across hosts. The **current rebuilt bundle** was run in Node 26.13.0 and in Chrome for Testing 150 (headless, driven over CDP by `cdp-browser-run.mjs`); `results/host-probe-parity.json` records the comparison. Every step passes in both hosts except `edn-data`, which fails `rejectsMalformed`. An accept-everything schema fails the validator assertions as intended. Libraries: `yaml`, `@bgotink/kdl` (+JiK), `toml-patch`/`smol-toml`, `json5`, `hjson`, `jsonc-parser`, `edn-data`, `@xmldom/xmldom`/`fast-xml-parser`, Ajv 2020 and `@o3co/ts.hocon`.

Integration costs:
- Hjson and ts.hocon import Node built-ins and need shims in the browser.
- `jsonc-parser`'s UMD `main` breaks the Node bundle unless ESM is preferred.
- Ajv compiles validators with `new Function`. Under a strict CSP this needs standalone precompilation; not exercised.

Minified + gzip (esbuild): yaml 32 KB; toml-patch 55 KB (smol-toml 7 KB); KDL 11 KB; json5 10 KB; hjson 7 KB; jsonc-parser 7 KB; edn-data 3 KB; xmldom 31 KB; Ajv 2020 41 KB.

Among the JS implementations surveyed, none was usable for RON (`rusty-object-notation` 1.0.2, the only npm package found) or for SDLang (`sdlang` 0.2.2, the only npm package found). No wasm build of the Rust `ron` crate was attempted. See [candidates](candidates.md).

### F7. Duplicate keys and malformed input: several libraries accept them silently

| | Behaviour |
|---|---|
| YAML, TOML, my XML binding | reject duplicate keys |
| JSON, JSON5, Hjson, edn-data, ron-bridge | last wins |
| KDL | last property wins, which the KDL spec permits |
| `edn-data` | returns `null` for truncated input (`{:a 1`) instead of throwing; Clojure's reader throws (EOF / duplicate key) |
| EDN as a notation | a stray `"` can turn the rest of a document into a string and still parse; only the schema caught it |

### F8. Programmable languages are schema/generation tools, not the editable source of truth

All five regenerated the real `castle3left` placements. For "where would a graphical edit be written?":

| Language | Overriding a computed value |
|---|---|
| CUE | concrete override is an **error** listing every contributing file:line |
| Nickel | **error** unless the value is a `default` |
| Dhall | `//` overrides; `/\` errors |
| Pkl | `amends` **silently** wins |
| HOCON | later definition **silently** wins; `origin()` gives file:line per value. The same absolute root resolves identically from four working directories (corrected; the first pass's include/cwd claim is withdrawn) |

Hazards observed:
- **Silent environment dependence:** Pkl reads env by default; Dhall `env:`; HOCON `${?VAR}` resolves by default; a missing non-`required` HOCON include is silently ignored.
- **Authored key order lost:** Nickel, Dhall and HOCON (Java renderer) sort or reorder keys.
- **Browser:** no official browser or TS evaluator for CUE, Nickel, Dhall or Pkl. A community CUE wasm and Nickel's in-repo `wasm-repl` exist but were not evaluated further.
- **Strong result:** `cue vet` validated plain **YAML and TOML data files** against a CUE definition, with **data-file line:col**. That makes CUE a plausible schema layer even if it is not the authored file format.

### F9. The data itself

The real cohort supports the owner's boundaries:
- 52/77 world actors are separate from 40/62 inventory items in Chimeran/Crystal, linked without duplication.
- Characters already carry learnable skills.
- The demo combines inline and external RPGCode.
- A **real item-grants-skill idiom** exists (Chimeran Crystal Staff → `MageSword!` variable → Icharus's `mage-sword-1` slot). It is done with scripts and variables, which an explicit `grants` would replace.

Inline programs in the cohort are single-line; multi-line text matters when creators inline or extract programs. Inline RPGCode references legacy file names (`send("out.brd", …)`), which data-level renames cannot update. The checker reports them as script-literal warnings.

## Inferences and tradeoffs (my judgement)

- **Plausible finalists:**
  - **YAML** (`yaml` Document API): readability, multi-line scripts, comment-preserving edits, locations, browser parity. Costs: indentation/chomping pitfalls and CRLF loss under the Document API.
  - **KDL** (`@bgotink/kdl`): the most compact readable output (Crystal 4.1 MB), format-preserving edits with CRLF, locations, smallest bundle. Costs: JiK's generic `-` items or a schema-directed binding to write; one active maintainer; a silent escape pitfall.
  - **TOML (conditional)**: an excellent preserve/patch library and locations. Costs: no null, awkward deep nesting, and a writer that would need layout work for tile layers and nested lists.
  - **JSON** remains the tooling baseline but is the weakest for hand-editing scripts.
- **Strong supporting tools rather than primary syntax:** CUE (schema/vet across YAML/TOML/JSON with locations) and Hyperjump (2020-12 conformance).
- **Not recommended as primary authoring files on this evidence:**
  - JSON5, Hjson, EDN: no format-preserving editor found among the JS packages surveyed, no node positions in the exercised libraries, library defects.
  - RON: no usable JS implementation among those surveyed (one npm package); a wasm build of the reference crate was not attempted.
  - XML: verbose without a schema-driven binding.
  - SDLang: the only JS/TS implementation surveyed fails basic cases; the Java implementation surveyed is LGPL-2.1 (G6-blocked); the D and C# implementations were not run.
  - HOCON / Pkl / Dhall / Nickel as the source of truth: computed values, environment dependence, key order.
- **Whatever is chosen**, the measured needs are:
  - a canonical writer with an explicit layout contract (rows per line, scalar arrays inline, one property per line where merge locality matters);
  - a project-wide reference checker; JSON Schema cannot do this;
  - explicit script bindings;
  - explicit LF normalisation with provenance hashes;
  - namespaced, preserved plugin data with a validation status.
- **Supporting several input syntaxes** multiplies the location, preserve-edit and layout work per notation measured here, roughly one adapter of 100–300 lines plus tests each. One predictable authoring format is cheaper. Not decided.

## Per-criterion disposition (ticket acceptance criteria)

| # | Criterion | Opus evidence | Status |
|---|---|---|---|
| 1 | Every candidate has an evidence-backed disposition | [candidates.md](candidates.md): 9 hands-on notations plus the JSON control, SDLang (blocked, with demonstrated library defects), and HOCON/CUE/Dhall/Nickel/Pkl exercised with versions and licences | Met for this investigator |
| 2 | Same logical data compared fairly | One logical model; whole-game projections for **all four** cohort games, with provenance, accounting and before/after trees ([mapping.md](mapping.md)); the same values in every notation; malformed examples in `examples/*-invalid` | Met within this investigation. **The ticket's shared comparison on agreed representative constructions is still required and not yet done**; the integration owner will arrange it after both first passes. |
| 3 | Editing and merging exercised | 603 real git merges (whole-document oracles), no-op/CRLF/comment assertions, one-property diffs, insert/remove/reorder, same-ID additions, tile row edits, RPGCode, rename, missing-plugin round trips ([results](results/)) | Met |
| 4 | Integration and authoring costs visible | Bundle sizes, browser shims, printer ownership, location support, dialect conformance, licence/G6, programmable host boundaries | Met. CSP/standalone Ajv and RON/CUE wasm not exercised. |
| 5 | Recommendations preserve owner choice | Finalists and tradeoffs only; YAML treated as a hypothesis | Met; Jensen's acceptance is still pending |
| 6 | Independent experimental evidence | This report, the model identity above, commands below | Met for Opus; the joint comparison belongs to the integration owner |
| 7 | Usable without the graphical editor | [walkthrough.md](walkthrough.md): agent rehearsal, real diffs, checker commands, and a walkthrough for Jensen | Agent rehearsal done. **No human usability evidence yet.** |

## Defects and issues to file (evidence above; none in this repository's runtime)

1. Upstream `ajv` 8.20.0: `$dynamicRef` to a `$dynamicAnchor` under `$defs` is mis-resolved. Probe: [`schemas/dialect-probe.schema.json`](../../../../tools/research/native-data-notations/opus/schemas/dialect-probe.schema.json).
2. Upstream `edn-data` 1.2.2: returns `null` for unterminated input; accepts duplicate map keys, which the EDN spec forbids.
3. Upstream `sdlang` 0.2.2: float/null/semicolon/binary/date/escaping failures; ESM build not loadable in Node.
4. Upstream `rusty-object-notation` 1.0.2: map entries dropped; raw strings misparsed.
5. Upstream `nickel` 1.18.0 macOS arm64 binary: links `/nix/store/...libiconv.2.dylib`.
6. Repository spec, existing open question Q8 ([older-binary-versions.md](../../../spec/formats/legacy/older-binary-versions.md#character-before-minor-8)): three more character minor-4 files with residue (Crystal `Dupcyk.tem` 72 bytes containing tile names, `Invisible.tem` 64, `Pearl.tem` 5). The decoder leaves them as residue. This needs spec investigation; it is not a new code defect.
7. Data observations, not defects:
   - Crystal capture lacks the tilesets it references (`rpgmakeralt7.tst` and others); corrected broken-reference totals are in [mapping.md](mapping.md);
   - `None`/`none` sentinels appear as program and board names;
   - the Chimeran zero-byte `Item/.itm` is inventoried as a separate ID.

## Open questions for Jensen

- Should identities be authored IDs or derived from paths? Placement/region/frame IDs are synthesized today (`<actor>-<n>`); what keeps them stable across re-import?
- Should tile layers stay a sibling document? Which merge trade is preferred: rows per line (compact, row-level conflicts) or finer cells (3× size, cell-level merges)?
- Is a project-owned canonical writer acceptable for the chosen notation, and with what layout contract?
- `null` and fixed-slot legacy arrays: the projection keeps `null` in legacy tile slots (9,277 nulls). TOML forces a mapping.
- Should CUE (or another schema layer) validate authored files in addition to JSON Schema?
- Human walkthrough: which notation felt safest to edit by hand?

## Reproduce

From this worktree (core prebuilt). The complete script, with every package pin, download URL, esbuild command and browser shim, is [`reproduce.sh`](../../../../tools/research/native-data-notations/opus/reproduce.sh):

```sh
export E=/private/tmp/tkr-1778-opus-experiments INVENTORY=<1778-shared-inputs.json> \
  DEMO=<repo>/fixtures/legacy/demo LUDO=<ludotheque>/games CHROME=<Chrome for Testing executable>
sh tools/research/native-data-notations/opus/reproduce.sh setup     # isolated npm pins, CLI tools, jars, RON bridge, Crystal extraction
sh tools/research/native-data-notations/opus/reproduce.sh pipeline  # decode, project, check, round trip, merges, walkthrough, programmable, examples
sh tools/research/native-data-notations/opus/reproduce.sh browser   # Node and browser bundles with shims; Node run; Chrome run over CDP; parity
sh tools/research/native-data-notations/opus/reproduce.sh checks    # correction checks for #1780–#1797
```

Exercised as scripts in the corrected run: the `pipeline` commands, the `browser` bundle, Node and CDP commands, and `checks`. The `setup` step was **not** run from a clean install; it reproduces commands I ran individually in the first pass.

Crystal input: `bsdtar -xf <ludotheque>/CrystalImmortality/zip.zip` into `$E/inputs/CrystalImmortality-zip`, then link `Game/Crystalo/*` and `Main` into `$E/inputs/CrystalImmortality`.

Local artifacts for inspection:
- `$E/projection/<game>/model/**` (logical JSON);
- `$E/projection/<game>/notations/<variant>/**` (every document in every notation);
- `$E/projection/<game>/{provenance,accounting,diagnostics}.json`;
- `$E/results/diffs/**`;
- `$E/walkthrough/<notation>/`.

## Files (tracked, all new)

- `docs/findings/native-data-notations/opus/`: this report, `CORRECTIONS.md`, `candidates.md`, `mapping.md`, `walkthrough.md`, `examples/` (authored), `results/`.
- `tools/research/native-data-notations/opus/`:
  - Scripts: `decode-cohort.mjs`, `project.mjs`, `notations.mjs`, `check.mjs`, `roundtrip-corpus.mjs`, `experiments.mjs`, `walkthrough.mjs`, `make-examples.mjs`, `browser-probe.mjs`, `cdp-browser-run.mjs`, `correction-checks.mjs`, `reproduce.sh`.
  - `schemas/`, `fixtures/authored-mini.json`.
  - `programmable/{cue,nickel,pkl,dhall,hocon}/` plus `run.mjs`.
  - `ron-bridge/` (Rust source only).
