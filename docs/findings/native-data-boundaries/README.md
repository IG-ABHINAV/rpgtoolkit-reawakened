# Native data boundaries: corpus research

Research for [#1771](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1771), 2026-11-08. **Evidence and candidate constructions, not an approved native format.** No runtime, editor, game file or normative spec was changed.

## Direction

The owner's requested direction is text-first, Git-friendly authored data, with logical encapsulation driving the contracts rather than historical file layouts or editor screens. Keep separately meaningful documents separate. Pixel/image payloads can remain binary; text playlists and presentation wrappers are useful candidates. Creators should not have to hand-edit JSON or another serialization language. TOML, YAML and JSON remain undecided.

An actor may be an item, NPC or other participant that appears and moves in the world. Skills remain distinct, with menu presentation and potentially character-specific performance presentation; items may grant skills. RPGCode may be inline in an owning field or referenced from a separate file. Large repeated script patterns should be investigated as possible missing properties, reusable actions, behaviours or editor capabilities—not automatically converted to data.

## Start here

- [Candidate constructions and logical grouping](candidate-constructions.md): what the data could become, with definition/placement/state boundaries.
- [Repeated RPGCode and possible missing capabilities](script-patterns.md): source-grounded examples and cautions.
- [Coverage and limitations](coverage.md): every source collection, unreadable/unsupported material, and interpretation rules.
- [Decode-gap classification](decode-gaps.md): every refused data file from the census sorted into unsupported version, damaged capture, missing format evidence or reader defect (#1772).
- Field catalogue: [actors/items/skills/effects](fields-actors.md), [project/world](fields-world-project.md), [presentation](fields-presentation.md), [save/package/media boundaries](fields-compatibility-runtime.md).

## What was measured

The scan includes all 37 Ludotheque folders, the shipped demo and Basic fixtures, the recovered game-download directory, and additional/mirrored game packages. Identical package hashes reuse collection identities; additional releases are named `Archive-<package stem>`. **60 collection labels are not a claim of 60 distinct games**, and successful metadata decoding is not proof of playability.

| Measurement | Result |
|---|---:|
| Source collection labels | 60 |
| Deduplicated inventory records, including packages/media/support files | 15,897 |
| Successfully decoded data files | 5,379 |
| Standalone RPGCode sources screened, not run | 4,294 |
| Candidate data files refused by current decoders | 1,200 |
| Zero-byte candidate data files, separately accounted | 51 |
| Distinct decoded-model field paths | 440 |
| Static relationship rows, before runtime reachability | 59,107 |
| Verified demo inline-source candidates | 3 |

The field catalogue describes **documented physical fields**, including versions absent from these games. The machine census describes **decoded-model fields actually observed**, including synthesized defaults and conversion results. Neither substitutes for the other. A 0, empty string or absent old-version field is not automatically an unused native feature.

For example, the 194 decoded `.anm` files contain 9,894 physical frame slots but only 852 nonempty image references. Those are mostly sparse fixed-capacity legacy arrays, not a reason for a native clip to require 51 editable frames. Conversely, board lookup-table indices and referenced tile numbers carry identity: removing holes or reordering tiles without rewriting references is not harmless cleanup.

## How the files relate today

| Owner | Stored relationship | Current target / important boundary |
|---|---|---|
| Main game | Startup/runtime/key/battle/game-over hooks; initial board/character; encounter enemies; plugin and media names | Project boot/rules span several families; one `.gam` is not the full game database |
| Main game's legacy editor setting | `languageFile` | Editor-only `.lng` resource candidates under `Resources`; ignored by the game engine, not a runtime dependency |
| Board | Placed actors, trigger/entry/thread programs, edge links, background/music, battle environment, tile LUT and free images | Placement and local overrides are separate from actor definitions; edge links can name a board or program |
| Character | Special-move eligibility, movement/stance/idle graphics, portrait, level-up program, script-variable aliases | Learning eligibility belongs to the character-to-skill relationship; variable aliases are not files |
| Item | Inventory/equip/menu/battle capabilities plus world movement/geometry, hooks and graphics | The historical item family includes NPC-like world actors, not just inventory objects |
| Enemy | Skill/weakness/strength lists, AI/defeat/escape programs, stances and rewards | Combat capability and presentation already cross file boundaries |
| Special move | Program, status-effect file and animation | Mechanics, persistent effect and presentation are related but distinct |
| Status effect | Per-round program and periodic stat effects | Definition is separate from an actor's active duration/state |
| Animation / animated tile | Ordered image/tile references, timing, colour key and optional frame sound | Text playlist around pixel/image assets is already a natural boundary |
| Tile bitmap / legacy tile art | Tile references and tints, or actual pixel payload | `.gph` can be text **pixel data**; it is not merely a metadata wrapper |
| Battle background | Image/composed picture, music and event sounds | Reusable environment presentation, not enemy mechanics |
| RPGCode | Literal or computed asset names, actor/item handles and arbitrary behavior | Literal screening cannot recover every dependency or prove which branch runs |

The graph rows preserve **declared-field** versus **script-literal-candidate** evidence. Reference matching uses ASCII-folded type-folder paths within a collection, not basename guessing. A unique candidate is not proof that a specific `.gam` selects that project root; archive bundles may contain multiple projects. A missing candidate is not automatically a broken game: it can be a sentinel, generated name, external dependency, unsupported package or an incomplete capture. Handles such as allowed-character names are not treated as filenames.

## Reproducible evidence

| File | Contents |
|---|---|
| [data/summary.json](data/summary.json) | Collection roots, package hashes, read status, archive anomalies, safety limits and totals |
| [data/assets.jsonl](data/assets.jsonl) | Every inventory record, full SHA-256, all retained source locators, decoder outcome/version/diagnostic |
| [data/fields.jsonl](data/fields.jsonl) | Every observed model field path; files/occurrences/types/empty/zero counts, ranges and source examples |
| [data/relationships.jsonl](data/relationships.jsonl) | Source, field, reference kind/value, multiplicity, candidate targets and evidence class; inline source represented by hash and length |
| [data/scripts.jsonl](data/scripts.jsonl) | Script screens and structural fingerprints; no complete script text |
| [data/archive-probes.json](data/archive-probes.json) | Secondary non-executing libarchive probes of unique non-ZIP containers |

These generated ledgers contain metadata, not game images, audio, pixel buffers or program bodies. Stable IDs combine collection, logical path and a content-hash prefix; full hashes remain in the asset ledger. JSONL is used for queryable **research output**, not selected as the future game format.

### Reproduce

Use the repository's pinned Node and pnpm, Python 3, and `bsdtar` (for legacy ZIP name-separator disagreement recovery). Install and build the workspace before running the census: the Node host imports the public `@tk-reawakened/core` package entry point. Run from this repository root. Set `ARCHIVE`, `GAMES`, and `FIXTURES` to your local recovered archive, Ludotheque games directory, and fetched legacy fixtures directory:

```sh
pnpm install --frozen-lockfile
pnpm build
python3 tools/research/native-data-census.py \
  --games "$GAMES" --fixtures "$FIXTURES" \
  --downloads "$ARCHIVE/wayback/mysticsoftware.net/games" \
  --package "LittleMan=$ARCHIVE/wayback/aljo.afraid.org/games/littleman/LittleMan.zip" \
  --package "BusDriver=$ARCHIVE/wayback/aljo.afraid.org/games/busd/busd.zip" \
  --package "FinalDestiny=$ARCHIVE/archive-org/FinalDestiny_201810/Final_Destiny.zip" \
  --package "Caoquest=$ARCHIVE/wayback/mysticsoftware.net/games.mysticsoftware.net/caoquest.zip" \
  --package "ChimeranEmpire=$ARCHIVE/wayback/mysticsoftware.net/games.mysticsoftware.net/chimeran_empire.zip" \
  --package "School2Demo=$ARCHIVE/wayback/mysticsoftware.net/games.mysticsoftware.net/School2Demo.zip" \
  --package "GrandDragonElite=$ARCHIVE/wayback/mysticsoftware.net/games.mysticsoftware.net/GrandDragonElite.exe" \
  --output /tmp/native-data-census
```

The Python host inventories bytes and archive members; the Node host calls the existing decoders through the built core package and aggregates fields/references. Rebuild after changing core source so generated `dist` output is current. The source decoder baseline for these results is **`3958832e`**. The original captured smoke used direct source imports and **Node v26.13.0**, not the repository-pinned Node 24.21.0; it is research-run evidence, not a supported-runtime or full-suite claim. The original local package-manager setup was unavailable, so that isolated worktree reused the already-installed core dependency directory without changing it. The package-boundary correction and its verification are recorded in [coverage](coverage.md#verification).

Only the chosen output directory and temporary spool files are written. No installer, game or RPGCode is executed. Archives are not extracted to the filesystem. The full `census.json` is a convenience view generated locally; the committed ledgers avoid duplicating it. Secondary archive probing and the source-example checks are recorded in [coverage](coverage.md#verification), not silently implied by the census totals.

## Conclusions the evidence supports

1. Separate **definitions, placements and runtime state** before choosing serialization syntax.
2. The actor discussion is justified by existing world-item usage, but the corpus does not choose inheritance versus capabilities/composition for us.
3. Reusable presentation/clip wrappers fit current data; keeping pixels in image assets is compatible with text-first authoring.
4. Preserve skill definitions separately from who learns/grants them and how a particular actor performs them.
5. Support explicit inline/file script bindings; use repeated code as a feature-discovery tool, not an automatic rewriting rule.
6. The current decoders do not cover every recovered variant. [#1772](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1772) tracks that gap; do not promise a lossless migration of all games from this research alone.

The notation comparison that follows from these boundaries is in
[the native-data-notations findings](../native-data-notations/README.md): two
independent investigations, a shared-model comparison on one agreed construction,
and four independent reviews. It records evidence and tradeoffs only; no notation
is adopted there.

## Key source files

- [Normative format index](../../spec/formats/README.md), [legacy text variants](../../spec/formats/legacy/text-formats.md), [older binary variants](../../spec/formats/legacy/older-binary-versions.md).
- [Read-only collector](../../../tools/research/native-data-census.py), [decoder/screening host](../../../tools/research/native-data-decode.mjs).
- [Core decoder registry](../../../packages/core/src/formats/registry/core-decoders.ts), [G1–G7](../../guardrails.md).
- External source sets: Ludotheque; recovered game packages under the archive's `wayback/` and `archive-org/`; fetched demo/Basic. The archive's `tk-corpus` download pages are metadata, not a substitute for the recovered payloads inspected here.
