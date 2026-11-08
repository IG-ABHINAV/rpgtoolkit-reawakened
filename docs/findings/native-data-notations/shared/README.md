# Shared-model comparison

The two investigations proposed different logical models, so their per-notation
results could not be compared directly. This step removes that confound: one agreed
construction, driven through **both investigators' own adapter sets** with identical
data. Where the two disagree here, the difference is a library or printer choice —
not a different model, and not the notation.

- Construction: [`construction.mjs`](../../../../tools/research/native-data-notations/shared/construction.mjs)
- Harness: [`compare.mjs`](../../../../tools/research/native-data-notations/shared/compare.mjs)
- Results: [`results/shared-comparison.json`](results/shared-comparison.json),
  with every encoded document in `shared-encoded-texts.json` beside it when run.

## What the construction contains

Every item the ticket lists, in one value. All values are authored or generated
deterministically — the harness uses a seeded xorshift, not `Math.random` — and no
recovered game content is included.

| Item | Where | Notes |
|---|---|---|
| Actor definition | `actors/gatekeeper` | Non-ASCII name, collision and activation polygons |
| Several scene placements of that actor | `scenes/courtyard/scene` | Three placements with authored IDs; one with a `null` program |
| Inventory item and an illustrative skill grant | `items/ember-staff` | `grants` is a **proposed** design example, not a legacy field |
| Skill with actor-specific performance binding | `skills/spark` | `perform["actor:mira"]` |
| Ordered presentation clip | `clips/gatekeeper/walk-south` | Three ordered frames, one with a sound |
| Geometry and a substantial tile layer | `scenes/courtyard/tiles` | 48×36×3 = 5,184 cells, four-entry palette |
| Inline RPGCode and an external program reference | Scene placements | Quotes, backslashes, `"""`, pipes, a tab, a Windows path |
| Namespaced plugin properties, schema present and absent | `extensions` | Includes an object shaped like a `$null` marker, and keys containing a space and a slash |

Value-domain edges carried deliberately: `0.15`, `0.30000000000000004`, `-1`, `0`,
`65535`, explicit `null` (including inside fixed-slot arrays), booleans, Unicode,
and multi-line strings.

## Experiments

| # | Experiment | What it measures |
|---|---|---|
| 1 | Encode and decode all seven documents in each notation | Semantic round trip on real structure, plus bytes, lines and longest line |
| 2 | Open/save with no changes | Whether an untouched save is byte-identical |
| 3 | Change one property (canonical re-emit, and the adapter's preserve path where one exists) | Diff size and whether unrelated content churned |
| 4 | Change one tile cell in a 5,184-cell layer | Patch size for the same logical edit |
| 5 | Insert one placement | Diff size and semantic correctness |
| 6 | Stock `git merge-file`, five scenarios | Clean merges, conflicts, false-clean results, duplicate identities |
| 7 | Inline script round trip | Content equality, with newline normalisation permitted |
| 8 | Printer probe: one row per line versus one cell per line | Whether layout alone changes the merge outcome |

Merges use `git merge-file -p`, which is the same three-way text merge `git merge`
applies to text files. No merge driver is configured. Every conflict-free result is
decoded and compared against the complete expected document, not accepted because
Git returned zero.

## Results

All eighteen adapter/notation pairs round-tripped all seven documents exactly.

### Sizes on identical data

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

Identical data and identical notation differ by 3.3× between two competent YAML
writers. The XML rows are **not** comparable to each other: the two chose different
XML vocabularies, which is itself a finding about XML as an authoring surface.

### Open/save and edits

- No-op save is byte-identical for every pair except Astra's Hjson, which rewrote
  two lines of whitespace.
- A one-property edit changes two lines (one deletion, one addition) in every pair —
  including every adapter's preserve path.
- A one-tile-cell edit also changes two lines everywhere, but the patch body ranges
  from 48 bytes (JSON, one value per line) to 10,706 bytes (TOML, whole layer on one
  line) — about 220×.

### Merges: 90 runs, five scenarios, ten notation variants

| Scenario | Clean | Conflicts | Correct | False-clean accepted |
|---|---:|---:|---:|---:|
| Independent raw-text edits of different values | 18 | 0 | 18 | 0 |
| Adjacent placements, different properties | 18 | 0 | 18 | 0 |
| Two cells in one tile row | 0 | 18 | 0 | 0 |
| Same value changed incompatibly | 0 | 18 | 0 | 0 |
| Same new ID added at disjoint positions | 18 | 0 | 0 | 18 |

The last row is the important one: **every notation merged two branches that added
the same ID at different positions without any textual conflict, and produced a
duplicate identity.** Only a semantic check can see it.

### Printer probe: the layout, not the notation, decides

Same notation (JSON), same content, same tile layer:

| Layout | Bytes | Lines | Two cells in one row, separate branches |
|---|---:|---:|---|
| one row per line | 16,559 | 72 | conflict |
| one cell per line | 30,671 | 1,836 | clean merge, correctly decoded |

- Inline-script behaviour, including YAML block scalars and merging edits to different
  lines of one script, is in [inline RPGCode](rpgcode-scripts.md).

## What this comparison does not establish

- It does not rank notations. It isolates the printer's contribution, which both
  investigations independently identified as dominant.
- It does not test the two investigators' own projections, which stay in their
  reports; it tests identical data through their adapters.
- It does not claim any notation is unsafe. Adapter defects found here were filed,
  fixed and re-run; the surviving behaviour is described above.
- It does not establish human usability. Nobody has edited these files by hand yet.

## Reproduce

```sh
node tools/research/native-data-notations/shared/compare.mjs \
  --astra-tools <astra worktree>/tools/research/native-data-notations/astra \
  --astra-libs  <astra scratch>/node_modules \
  --opus-tools  <opus worktree>/tools/research/native-data-notations/opus \
  --opus-libs   <opus scratch> \
  --work <scratch>/shared-work \
  --out  <scratch>/compare.json
```

Exit status is 0 when the harness completes; the printed summary reports round-trip
counts, false-clean merges, silently lost edits and broken script content. The
committed result was produced on Node v26.13.0 / git 2.55.0 / macOS 27.2 / Apple
M1 Pro, with the investigators' isolated library installs.

## Key source files

- [Construction](../../../../tools/research/native-data-notations/shared/construction.mjs), [harness](../../../../tools/research/native-data-notations/shared/compare.mjs).
- [Astra adapters](../../../../tools/research/native-data-notations/astra/adapters.mjs), [Opus codecs](../../../../tools/research/native-data-notations/opus/notations.mjs).
