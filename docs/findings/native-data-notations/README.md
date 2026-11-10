# Native game-data notations: integrated findings (#1778)

Two independent investigations, a shared-model comparison, and four independent
reviews of the resulting evidence. **No notation, syntax, schema, multi-format
policy, runtime or editor change is adopted here.** YAML was the owner's stated
preference going in and is treated as a hypothesis throughout.

| | |
|---|---|
| Ticket | [#1778](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1778) |
| Input revision | `20e0209d` (includes research #1771 / PR #1776 and planning PR #1779) |
| Investigators | Astra — `openai-codex/gpt-6-astra`; Opus — `anthropic/claude-opus-5-5` |
| Independence | Neither investigator read the other's output. Each conducted the whole comparison, not a format split. |
| Reviewers | Four separate agents, none an author, each reviewing both reports without seeing the others' findings |
| Exercised runtime | Node v26.13.0 (repository pin is 24.21.0), git 2.55.0, macOS 27.2, Apple M1 Pro; Chrome for Testing 150 for browser probes |
| Status | Research complete. **Owner accepted (2026-11-08): YAML is the authored format, JSON the derived data form.** Remaining design items are listed below. |

Read the originals beside this summary, not instead of it:

- [Astra's independent report](astra/README.md) — model, candidates, projections, walkthrough, corrections.
- [Opus's independent report](opus/README.md) — model, candidates, projections, walkthrough, corrections.
- [Shared-model comparison](shared/README.md) and its [machine-readable results](shared/results/shared-comparison.json).
- [Inline RPGCode: block scalars and script-line merges](shared/rpgcode-scripts.md) — follow-up on the owner's block-scalar question.
- [Independent review record](reviews.md) — what each reviewer found, what was filed, what was fixed.

## What was asked, and what this answers

The owner set the priority order: **Git-friendly edits and merges first, ordinary
text-editor readability and hand-editing second, machine parsing and serialization
in our TypeScript/JavaScript hosts third.** The question was not "which format is
familiar" but which notation, paired with which schema and editing libraries, makes
populated game data survive real editing and merging.

Both investigators reached the same conclusion on the owner's first priority, and
the shared-model comparison shows why:

> **The layout contract of the writer decides diffs and merges far more than the
> notation does. Which notation you pick matters much less than deciding, and
> owning, exactly how a document is laid out on lines.**

Neither investigator found a notation whose syntax confers a merge advantage. Both
found the same three-way behaviour in every notation tested: independent edits merge
cleanly, incompatible edits conflict, and a duplicate identity introduced on two
branches merges cleanly and silently.

## How the evidence was produced

1. **Two independent investigations.** Astra and Opus each received the same pinned
   inputs and experiment questions, and each proposed its own logical regrouping,
   its own projections and its own conclusions. Neither saw the other's work.
2. **A shared construction.** Because independent logical models cannot be compared
   directly, the integration step defined one agreed construction covering every item
   the ticket lists — an actor, several placements of it, an item with a proposed
   skill grant, a skill with an actor-specific performance binding, an ordered clip,
   geometry, a substantial tile layer, inline RPGCode beside an external program
   reference, and namespaced plugin properties with and without a schema
   ([`construction.mjs`](../../../tools/research/native-data-notations/shared/construction.mjs)).
   Both investigators' own adapter sets then ran on the identical value, so any
   remaining difference is a library or printer choice, not a different model.
3. **Independent review.** Four fresh agents reviewed both reports — adversarial,
   edge-case, verification-gap and editorial — without seeing each other's findings.
   They were told to reproduce, not to agree.
4. **Correction and rerun.** Every reviewed defect was filed as a tracked issue, then
   fixed by the investigator who owned the artifact and the affected experiments were
   re-run. Original first passes are preserved unchanged; each report keeps a
   correction record that explicitly supersedes its first-pass prose.

## Inputs and provenance

Both investigators used the same four pinned projects and verified the bytes they
consumed against the shared inventory (2,536 entries with full SHA-256):

| Project | Role in the comparison | Archive status |
|---|---|---|
| demo (`fixtures/legacy/demo`) | NPC/world presence, inline hooks | Direct files, 75/75 hashes matched |
| ChimeranEmpire | Repeated services and pickups, CRLF programs | Direct files plus archive members |
| Caoquest | Older tile-based material (Toolkit 2 text boards at stored 2.1) | Direct files plus archive members |
| CrystalImmortality | Script-heavy, 50×50×8 scenes, nested ZIP payload | Extracted to scratch only; installer never run |

Astra verified 1,692 payload hashes and read 878 RPGCode programs as text; Opus
verified every consumed file with 0 mismatches and projected 1,177 documents across
the four games. **No RPGCode, game or installer was executed at any point.** Board
eras were taken from stored headers, not from normalized decoder versions — a
correction that both investigations ended up applying.

## What both investigations agree on

Each point below is supported independently by both reports and, where marked, by
the shared comparison.

### 1. Layout, not notation, decides diff and merge shape — verified on identical data

The same seven-document value, same notations, two competent adapter sets:

| Notation | Astra bytes / lines / longest line | Opus bytes / lines / longest line |
|---|---:|---:|
| JSON (library default) | 75,727 / 5,810 / 391 | 75,727 / 5,810 / 391 |
| JSON (scalar arrays inline) | — | 21,981 / 416 / 391 |
| YAML | 66,267 / 5,446 / 88 | 20,249 / 318 / 152 |
| KDL | 16,030 / 408 / 388 | 15,185 / 273 / 399 |
| TOML | 19,852 / 234 / 5,337 | 19,783 / 185 / 5,337 |
| TOML (tile rows reflowed) | — | 20,045 / 320 / 401 |
| JSON5 | 75,585 / 5,810 / 372 | 75,585 / 5,810 / 372 |
| Hjson | 70,139 / 5,872 / 389 | 68,692 / 5,632 / 90 |
| EDN | 16,439 / 416 / 390 | 16,271 / 416 / 389 |
| XML | 234,923 / 5,815 / 91 | 106,310 / 428 / 887 |

Two YAML rows, one notation, the same data: **66 kB in 5,446 lines against 20 kB in
318 lines.** Neither is wrong; one writer exploded every scalar onto its own line.
The same holds for JSON (75 kB against 22 kB) and for TOML's longest line (5,337
characters against 401).

The XML row is not comparable between the two because they chose different XML
vocabularies; it is shown to be honest about that, not to score them.

A single tile-cell edit in a 5,184-cell layer changes exactly two lines in every
notation, but the patch body differs by about 220× — 48 bytes for JSON against
10,706 for TOML, because TOML keeps the whole layer on one line.

### 2. The printer, not the notation, decides whether neighbouring edits merge

Same notation (JSON), same semantic content, same tile layer, two layouts:

| Tile layout | File size | Lines | Two cells in one row edited on separate branches |
|---|---:|---:|---|
| one row per line | 16,559 B | 72 | **conflict** |
| one cell per line | 30,671 B | 1,836 | **clean merge, correctly decoded** |

That is the whole trade in one row pair: finer layout buys merge locality and costs
roughly 1.9× here (Opus measured about 3× on the real 50×50×8 Crystal scene). It is
a decision a project must make and enforce, in any notation.

### 3. Nothing in the syntax prevents conflicts or duplicate identities

Ninety stock `git merge-file` runs on the shared construction — five scenarios
across ten notation variants (eight shared, two more from Opus's set):

| Scenario | Clean merges | Conflicts | Semantically correct | False-clean accepted |
|---|---:|---:|---:|---:|
| Independent raw-text edits of different values | 18 | 0 | 18 | 0 |
| Adjacent placements, different properties | 18 | 0 | 18 | 0 |
| Two cells in one tile row (row-per-line layout) | 0 | 18 | 0 | 0 |
| Same value changed incompatibly | 0 | 18 | 0 | 0 |
| Same new ID added at disjoint positions | 18 | 0 | 0 | **18 clean, wrong, and only visible if you check identities** |

In every notation, both branches adding a record with the same ID at different
positions merged textually cleanly and produced a duplicate identity. Git is a text
merge; no notation makes it understand authored identity. Astra's corrected matrix
rejects 18 such results out of 120 cases; Opus's corrected matrix records 53
textually clean merges that were semantically wrong out of 603, and rejects all of
them with an identity check.

**A clean merge is not evidence of a correct merge.** The project needs an identity
and reference checker regardless of notation.

### 4. Inline RPGCode is safe to normalise, and every notation preserved it

> Added after the owner noticed that neither report examined YAML block scalars in
> depth (each noted the `|`/`|-` trailing-newline trap; Astra checked one block
> spelling). The follow-up is in [inline RPGCode](shared/rpgcode-scripts.md): it measures
> script-line merges and block-scalar behaviour, and its results change what this
> section's conclusion means for Git. Read it alongside this section.

Under the owner's ruling that line endings may be normalised, scripts round-tripped
through all eighteen adapter/notation pairs with content identical before any
normalisation was even needed — quotes, backslashes, a triple-quote run, a pipe,
a tab, a Windows path and non-ASCII text all survived. Extracting an inline script
to an external program file and inlining it back was exact, with the binding made
explicit.

**Content surviving is not the same as lines merging.** The follow-up measured 126
real three-way merges of edits to different lines of one inline script. Distant edits
merged cleanly in every form where the script was written as real lines, and conflicted
in every form where it was one escaped line. JSON has no multi-line string at all, so it
cannot merge them; every other notation can spell a script as lines, but only the YAML
library (and XML, and Opus's Hjson configuration) did so by default. TOML, KDL and EDN
need a project-owned writer to match it.

Three hand-typing traps were reproduced and are worth knowing:
KDL `"""` silently drops a backslash followed by a space (`#"""…"""#` is exact);
YAML `|` silently adds a final newline (`|-` is exact); TOML rejects an unescaped
backslash loudly, which is the safe behaviour.

### 5. Preserve-capable editing exists for some notations and not others

Among the JavaScript libraries surveyed, format-preserving single-property edits
existed for YAML, JSON(C), TOML, KDL, Hjson and XML, and were not found for JSON5,
EDN or RON. Every format-preserving edit produced a one-line diff. Re-emitting an
authored file through any library writer dropped comments.

That is a **library** fact, and both investigators were careful to keep it separate
from the notation: TOML 1.1 allows multi-line inline tables, and EDN, RON and KDL
permit line breaks anywhere, so a project-owned writer can produce good layouts in
those notations too — at the cost of writing and maintaining that writer.

### 6. Schema validation is notation-independent; error locations are not

The same JSON-domain value validated identically no matter which notation carried
it. Mapping an error back to `file:line:col` worked for YAML, JSON, TOML, KDL and
XML, and did not work for JSON5, Hjson, EDN or RON, whose libraries expose no node
positions.

Two findings that outlive this comparison: Ajv 8.20.0 mis-evaluates a valid
2020-12 `$dynamicRef`, while Hyperjump evaluates it correctly; and Ajv silently
ignores `unevaluatedProperties` when the `$schema` URI is stripped. "Supports JSON
Schema" needs a named dialect, a named validator and tests.

### 7. Programmable languages are schema or generation tools, not editable documents

HOCON, CUE, Dhall, Nickel and Pkl were all exercised on real placements. All five
can regenerate the real data. Overriding a computed value is an error in CUE and
Nickel, wins silently in Pkl and HOCON, and needs explicit merge operators in Dhall.
Pkl, Dhall and HOCON read environment variables in their default configurations;
Nickel, Dhall and HOCON reorder keys. `cue vet` validated plain YAML and TOML files
and reported line and column in the data file.

No second behaviour language is adopted, and nothing here shows that ordinary
game-data editing should become an evaluation-and-provenance problem.

### 8. Node and browser parity holds for the JavaScript libraries

Both investigators ran the same bundles in Node and in a real Chromium. With
semantic assertions — valid accepted, invalid rejected, edit produced the intended
value — the libraries agree across hosts, except that `edn-data` accepts truncated
input in both. An early version of the parity probe only compared output hashes;
review showed that would pass even when both hosts were identically wrong, and it
was corrected.

## Where the two investigations differ (retained, not averaged away)

| Question | Astra | Opus | Integration view |
|---|---|---|---|
| Shortlist | YAML and KDL | YAML, KDL, TOML with reservations | YAML and KDL are the only names both put forward without reservation. TOML's candidacy rests on the null mapping and nested-array editing costs, which Astra judged material enough to keep out of the shortlist. That disagreement is a judgement call for Jensen, not a fact to settle. |
| Item-grants-skill | An owner-requested design example; no legacy field supplies it | Chimeran already achieves it *through scripts*: the Crystal Staff's equip script sets a flag that unlocks Icharus's Mage Sword slot | **Both are right and they are different claims.** No legacy property declares "this item grants this skill"; the behaviour does exist as scripting, which is exactly the evidence that a declared grant is worth adding. |
| XML | The generic typed mapping tested here is too noisy to recommend | Not recommended as a shortlist candidate | Agreement in substance; Astra's reason is stated more precisely (the *mapping* is noisy, not XML). |
| Hjson | Worth considering if its presentation is preferred | Not a finalist | Differs on weight, not on measurement. Astra's own no-op result is the worst of the eighteen (2 lines rewritten on open/save), which supports Opus's placement. |
| Tile layout cost | Two changed lines everywhere; treats layout as a per-notation detail | Makes the row-versus-cell trade explicit at ~3× size | The shared printer probe confirms Opus's framing: the trade is real and belongs to the project, not the notation. |

Unresolved, and left to Jensen on purpose: whether finalists should be carried
forward as *one* authoring syntax or as a small supported set. Cost evidence exists
(one adapter of roughly 100–300 lines plus tests per notation, per Opus) but the
policy question is the owner's.

## Corrections that changed the evidence

Independent review found real defects in both investigations. All were filed
([#1780](#filed-defects)–[#1798](#filed-defects)), fixed by the owning investigator,
and the affected experiments re-run. The ones that changed a conclusion:

- **Both merge oracles were too weak.** They accepted results based on added IDs and
  list length, so a corrupted document could be recorded as preserved. Corrected
  oracles compare the whole document against permitted results.
- **Astra's rename check skipped one declared reference** (an actor-specific
  performance binding), so a stale reference passed. Now diagnosed.
- **Opus's TOML null marker was not injective**: a genuine plugin object shaped like
  the marker decoded as `null`, silently corrupting unavailable plugin content. The
  mapping is now escaped.
- **Opus's JSON "no-op" measurement returned untouched text without parsing**;
  corrected to a real parse and save.
- **Opus's browser probe compared hashes without asserting semantics**; a wrong
  answer in both hosts would have passed.
- **Opus's first report mixed whole-project byte totals with one document's line
  counts**, overstating a scene's size; corrected and split.
- **Opus withdrew a HOCON claim** after review showed the first probe opened the
  wrong file from a changed working directory. Relative includes were never
  working-directory dependent.
- **Both XML adapters lost or normalised attribute whitespace**, invisible to a
  same-library round trip and visible to a conforming parser. Both now escape it.

The **first-pass reports are preserved unchanged** alongside the corrections, which
is why some numbers in them no longer match the re-run results. In every case the
correction record and the re-run results take precedence.

## Filed defects

Tracked as [`bug`](https://github.com/tk-reawakened/rpgtoolkit-reawakened/labels/bug)
issues, each with a reproducer. Most are in experimental research adapters, not
shipped runtime; three are upstream library defects.

| Issue | What it is |
|---|---|
| [#1780](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1780) | Merge oracles accepted corrupted existing records |
| [#1781](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1781) | Rename left a performance binding unresolved |
| [#1782](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1782) | TOML null marker corrupted marker-shaped objects |
| [#1783](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1783) | JSON no-op bypassed parsing |
| [#1784](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1784) | Browser parity probe ignored semantics |
| [#1785](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1785) | Report mixed project and document measurements |
| [#1786](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1786) | Reference traversal skipped declared references |
| [#1787](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1787) | Scene rename left its tile document behind |
| [#1788](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1788) | Rename overwrote an existing target |
| [#1789](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1789) | Duplicate identities from clean merges went undetected |
| [#1790](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1790) | EDN printer corrupted arbitrary string keys |
| [#1791](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1791) | XML `__proto__` key lost and altered the object prototype |
| [#1792](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1792) | XML attribute whitespace was normalised |
| [#1793](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1793) | KDL insertion appended instead of inserting |
| [#1794](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1794) | KDL scalar-array move crashed |
| [#1795](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1795) | XML adapters emitted forbidden characters |
| [#1796](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1796) | Board provenance confused stored and normalised versions |
| [#1797](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1797) | HOCON probe opened the wrong root file |
| [#1798](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1798) | XML boolean decoder accepted malformed values |

Separately recorded in the corpus research rather than here:
[#1772](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1772) tracks
decoder coverage. Measurement of three further Crystal character files with
residual bytes is recorded in Opus's mapping notes under the existing open question
Q8; it extends that gap, it does not create a new one.

## What remains unproven

State these as limits, not caveats:

1. **No human usability evidence.** Every authoring rehearsal in both reports was
   performed by an agent. Jensen's own walkthrough is the missing data point;
   both walkthroughs are ready to try.
2. **No production conversion or playability claim.** The projections are research
   artifacts spanning real projects. They do not show that any game round-trips
   through an editor, and several recovered files still fail to decode.
3. **No supported-runtime claim.** Experiments ran on Node 26.13.0, not the pinned
   24.21.0.
4. **No VM or save-continuation claim.** Script equality is text equality.
5. **Reference failures in the corpus are real.** With the corrected reference
   coverage, the projections report 2,075 broken references in Crystal — mostly
   tileset references to sets absent from the capture — 37 in Chimeran, 15 in
   Caoquest and none in the demo, including `None` sentinels used as program and
   board names. The model must tolerate these; they are corpus facts, not notation
   evidence.
6. **YAML block scalars were only lightly covered by the two investigations.** They
   noted the `|` versus `|-` trailing-newline trap and Astra verified one block
   spelling; neither tested the other header forms, awkward content, hand-editing
   damage or the merge consequence. The follow-up found two silent hand-editing failures (a dedented line that
   contains `: `, and changing `|-` to `>`) that a creator could hit; whether a strict
   core schema catches the stray key it produces was not exercised.
7. **Order-and-identity stability across re-import is unresolved.** Placement and
   frame identities were authored in the shared construction and synthesised during
   the investigations; what keeps them stable across importer runs is a design
   question for the format, not something this research settles.

## Owner decision (2026-11-08)

**Decision: YAML is the authored (read/write) format and JSON is the derived (read/data)
form.** Recorded from the owner's review of this research. The research recommends
nothing beyond what it measured; the choice and its reasons below are the owner's.
Still **not** approved by this PR: the exact YAML value profile, the schema, the layout
contract, authored-versus-derived ids, and any editor change. Those are follow-up design
work. The hands-on editor walkthrough has not yet been done.

- **Leaning YAML.** The owner uses YAML at work and for Home Assistant, has seen it win
  out repeatedly where people hand-author content, and reports that VS Code and other
  editors support it fully, including schema validation and help finding indentation
  errors. This is the owner's experience, not an agent measurement and not a
  controlled usability result.
- **Nullable values are wanted in positional arrays** (for example legacy tile slots).
  That removes TOML, which has no null: the only workaround found was a per-slot marker
  object, or a sentinel value the owner would rather avoid.
- **Working direction (owner, 2026-11-08): start with YAML as the authored/editor view
  and JSON as the internal form for passing data around.** The research supports
  the pairing in one respect: schema validation gave identical results whichever
  notation carried the data. It does not yet show that the YAML file can stay the
  source of truth through a JSON round trip: comments, block-scalar style and layout
  live only in the YAML, so edits must go through a comment-preserving YAML editing
  path, not JSON back to YAML. No YAML value profile (no tags, anchors or dates;
  YAML 1.2 core types; unique keys) has been approved.
- **A concrete profile, checker and walkthrough now exist:** [YAML authored, JSON derived](yaml-profile/README.md). Under it, the silent dedent failure is caught by a strict schema with a line and column (in the checker; not tested in an editor).
- **Hjson is the alternative.** It has native null and forgiving script strings, but its
  library exposes no error locations, rewrites layout on edit, and has not had a release
  since November 2020.
- **Script handling under YAML.** The hazards found (a dedented line containing `: `
  silently ending the script; `|` or `>` replacing `|-`) are indentation mistakes that
  editors can surface. Normalising scripts to `|-` and having the editor write scripts
  are mitigations to adopt. A strict schema rejecting stray keys under `run`, and the
  editor behaviour the owner describes, were **not** exercised by this research.

## Decisions this research hands back to Jensen

1. **Layout contract.** Accept that a project-owned canonical writer with an explicit
   layout contract is required, and that this, not notation choice, is what buys
   merge quality. If yes: choose rows-per-line (compact, row-level conflicts) or
   cell-level (≈2–3× size, finer merges).
2. **Finalists.** YAML and KDL are the only names both investigations put forward
   without reservation. Is TOML kept as a third candidate, given its null mapping and
   nested-array editing cost?
3. **One syntax or several.** Supporting more than one authoring syntax multiplies
   adapter, location and preserve-edit work per notation.
4. **Authored versus derived identity.** Placements, regions and frames were given
   authored IDs here. Should identity be authored, derived from position, or both?
5. **Tile layers as sibling documents.** Both investigators kept tile layers beside
   the scene. Confirm that grouping.
6. **Schema layering.** JSON Schema 2020-12 with a named validator, plus optionally a
   CUE layer that validates the authored files — or JSON Schema alone?
7. **Walkthrough.** Try [Astra's](astra/human-edit.md) and
   [Opus's](opus/walkthrough.md) text-only authoring rehearsals and report which
   notation felt safest to edit by hand. That answer is worth more than any agent
   judgement in these reports.

## Reproduce

The full per-investigator commands are in
[Astra's reproduce notes](astra/reproduce.md) and
[Opus's reproduce section](opus/README.md#reproduce). The shared comparison needs
both investigators' tool directories and their isolated library installs:

```sh
node tools/research/native-data-notations/shared/compare.mjs \
  --astra-tools <astra worktree>/tools/research/native-data-notations/astra \
  --astra-libs  <astra scratch>/node_modules \
  --opus-tools  <opus worktree>/tools/research/native-data-notations/opus \
  --opus-libs   <opus scratch> \
  --work <scratch>/shared-work \
  --out  <scratch>/compare.json
```

It writes a summary to stdout and the full result to ``--out``, plus an adjacent
`shared-encoded-texts.json` holding every encoded document for inspection. The
result committed here was produced with that command on the exercised runtime above.

## Key source files

- [Shared construction](../../../tools/research/native-data-notations/shared/construction.mjs), [comparison harness](../../../tools/research/native-data-notations/shared/compare.mjs), [results](shared/results/shared-comparison.json).
- [Astra tooling](../../../tools/research/native-data-notations/astra/) and [report](astra/README.md).
- [Opus tooling](../../../tools/research/native-data-notations/opus/) and [report](opus/README.md).
- Prior corpus research: [native-data-boundaries](../native-data-boundaries/README.md).
- Constraints: [G1–G7](../../guardrails.md).
