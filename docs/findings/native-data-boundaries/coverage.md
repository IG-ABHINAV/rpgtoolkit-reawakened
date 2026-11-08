# Corpus coverage and interpretation

This is an inventory of accessible local game data, not a compatibility pass or a count of playable games. A collection may contain several bundled projects, historical copies, templates or support software. The 37 Ludotheque folders are all included; so are demo/Basic and additional recovered releases. The archive's historical game roster and current capture directories differ, so the scan uses actual payloads rather than treating the roster as exhaustive.

## Per-collection outcome

`Inventory` includes all deduplicated file kinds, not only authored game definitions. `Decoded` means a current data decoder returned a model. `Scripts` means source was screened, never executed. `Refused` includes malformed, undocumented and intentionally unsupported versions; it is not a bug count. `Empty` is the separate zero-byte data category. A zero in a column does not establish that a game's original design lacked the feature.

| Collection | Inventory | Decoded | Scripts | Refused | Empty |
|---|---:|---:|---:|---:|---:|
| AICSMIS | 2 | 0 | 0 | 0 | 0 |
| AMUAftermath | 3 | 0 | 0 | 0 | 0 |
| Archive-Fantasyes | 235 | 98 | 89 | 0 | 0 |
| Archive-LunarQuestP1 | 917 | 210 | 139 | 71 | 0 |
| Archive-MissionImprobable | 237 | 82 | 41 | 0 | 0 |
| Archive-MysteriousBattles | 158 | 60 | 26 | 0 | 0 |
| Archive-Nes3_0 | 1 | 0 | 0 | 0 | 0 |
| Archive-Omega | 191 | 67 | 44 | 12 | 0 |
| Archive-SilverSky_Demo1 | 424 | 123 | 83 | 6 | 4 |
| Archive-WarriorLegends | 2 | 0 | 0 | 0 | 0 |
| Archive-devilsnight | 177 | 66 | 36 | 0 | 0 |
| Archive-just_another_day | 2 | 0 | 0 | 0 | 0 |
| Archive-legacy_of_hell_ninja | 165 | 63 | 18 | 0 | 2 |
| Archive-legend | 1869 | 636 | 910 | 154 | 5 |
| Archive-legendofatalna2 | 2363 | 1189 | 567 | 580 | 3 |
| Archive-legendofosiris1.1 | 614 | 134 | 129 | 2 | 6 |
| Archive-lunardragon | 358 | 83 | 72 | 42 | 0 |
| Archive-marovia | 190 | 35 | 39 | 1 | 0 |
| Archive-minicars | 63 | 21 | 5 | 1 | 0 |
| Archive-oasis | 582 | 135 | 169 | 57 | 8 |
| Archive-phenomenaldemo2 | 294 | 79 | 112 | 55 | 0 |
| Archive-pl2demo | 1 | 0 | 0 | 0 | 0 |
| Archive-toughdragon_vs_md | 538 | 243 | 95 | 10 | 3 |
| AxeOfYulon | 3 | 0 | 0 | 0 | 0 |
| Basic | 58 | 13 | 3 | 0 | 0 |
| Blitz | 62 | 0 | 0 | 0 | 0 |
| BusDriver | 56 | 11 | 1 | 0 | 0 |
| Caoquest | 192 | 80 | 46 | 0 | 0 |
| ChickitHunt | 765 | 188 | 187 | 0 | 7 |
| ChimeranEmpire | 694 | 288 | 233 | 0 | 3 |
| CoderChallenge | 104 | 16 | 18 | 0 | 0 |
| CrystalImmortality | 1575 | 493 | 592 | 0 | 0 |
| DangerDingo | 243 | 73 | 66 | 0 | 1 |
| DarkAge | 21 | 0 | 0 | 0 | 0 |
| DarkAge2Demo | 49 | 0 | 0 | 0 | 0 |
| DarkAgeEX | 9 | 0 | 0 | 0 | 0 |
| EternalBlade | 299 | 65 | 61 | 0 | 1 |
| FinalDestiny | 188 | 61 | 55 | 0 | 2 |
| Firesword13 | 3 | 0 | 0 | 0 | 0 |
| FourthDimension | 5 | 0 | 0 | 0 | 0 |
| GrandDragonElite | 4 | 0 | 0 | 0 | 0 |
| Gw | 5 | 0 | 0 | 0 | 0 |
| ImperialNexus | 672 | 280 | 118 | 177 | 2 |
| JoD | 152 | 48 | 33 | 7 | 1 |
| JoD3 | 233 | 100 | 53 | 5 | 1 |
| JurassicQuest | 133 | 36 | 22 | 0 | 0 |
| LegendMagic | 3 | 0 | 0 | 0 | 0 |
| LegendStorm | 3 | 0 | 0 | 0 | 0 |
| LittleMan | 73 | 1 | 13 | 0 | 0 |
| LoZMasterOfTime | 3 | 0 | 0 | 0 | 0 |
| MysticalQuest | 484 | 172 | 139 | 19 | 2 |
| OutlandPolice | 15 | 0 | 0 | 0 | 0 |
| RecursiveRampage | 8 | 0 | 0 | 0 | 0 |
| RunesOfManchia | 3 | 0 | 0 | 0 | 0 |
| School2Demo | 276 | 104 | 73 | 1 | 0 |
| TalismansOfTheNine | 10 | 0 | 0 | 0 | 0 |
| Traidon | 3 | 0 | 0 | 0 | 0 |
| Volcano1 | 3 | 0 | 0 | 0 | 0 |
| Worm | 27 | 0 | 0 | 0 | 0 |
| demo | 75 | 26 | 7 | 0 | 0 |

**Source identity:** records with identical collection, ASCII-folded logical type-folder path and SHA-256 are combined; all encountered source locators remain attached. Different bytes remain separate even when the path matches. This is a study of definitions and variants, not a count of installed instances. File IDs retain a readable path and 12 hash digits; the full SHA-256 is in the asset ledger. Some duplicate templates legitimately remain in different collections. No weighting treats them as independent product requirements.

## Packages and inaccessible material

The collector encountered 340 package/container occurrences: 113 were readable as ZIP (including nested ZIPs and ZIP-based SFX), and 227 were not. A second non-executing `bsdtar -tf -` probe covered all 73 unique non-ZIP hashes. Only two were readable there, both Visual Basic runtime redistributables, not additional game projects. The other 71 remain opaque to the available safe archive tools. No executable installer was run.

Eighty-four member reads across old package copies had local-header/central-directory path-separator disagreements. All 84 were read with libarchive and checked against the ZIP's declared uncompressed length **and CRC-32** before accepting the bytes. The original anomalies and recovery flags remain in `summary.json`; no archive header or source file was rewritten. Twenty-five additional inventory records were recovered; the decoded data/script totals did not change because those game records already existed in another inspected copy.

The limits are 128 MiB per member/file, 1 GiB total declared expansion per archive and nesting depth 8. No record in this captured run was skipped by those limits or by encryption. A future run records exclusions instead of silently ignoring them. This is a local research collector, not a general untrusted-package service.

Some collections are not extracted Toolkit projects: Outland Police contains Java source, Blitz/Gw/Worm include other-game/runtime payloads, and Recursive Rampage is a screenshot-only recovery. Their contents are inventoried but do not magically become Toolkit field evidence. Proprietary installers and damaged files are not assumed to be missing features. Patches, manuals, arbitrary web captures and the legacy engine source tree were not used to derive game behavior.

## Refused and absent data

There are 1,200 decoder refusals in the expanded corpus. The breakdown is boards 329, items 302, enemies 248, special moves 145, characters 58, battle backgrounds 49, tilesets 28, main files 22, single tiles 14, animated tiles 3 and animations 2. Examples include older registration encodings, missing text tails, unsupported version-1 tiles, unsupported tileset headers and truncated data. All diagnostics and source hashes are retained; no missing fields were filled in by the research helper to make a decode pass.

[#1772](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1772) tracks classification of these gaps. A decoder refusal is not automatically a reader defect: first distinguish deliberately unsupported versions, damaged capture, missing clean-room specification and an implementation error. `School2Demo/Boards/SchoolFloor1.brd` is already a named placeholder exclusion in the corpus runner. Zero-byte board/item/special-move placeholders also have existing runtime policies; this field census records that there are no authored bytes rather than synthesizing a model and counting its defaults as observation.

No `.tbm` file was successfully observed; its documented fields still belong in the catalogue. Saves are runtime-state boundaries, not candidate authored actor definitions: the catalogue inventories documented save sections but this scan does not deserialize player saves. Standard image/audio codec internals are not expanded into domain-property inventories. Pixel-bearing tileset/single-tile decoders were inspected statistically without copying their pixel buffers into the output. Programs beginning with NUL would be classified as compiled rather than interpreted as text; none was found here.

## Field and graph semantics

- Field paths such as `specialMoves[].file` collapse array positions for **statistics only**; the import/runtime still has to preserve meaningful slot identities and order.
- `files` counts a field once per decoded asset; `occurrences` counts visited values, including repeated array members. `definedFiles` excludes `undefined`; empty strings/arrays and numeric zero have separate counts. Null, undefined and absence are not asserted to be the same.
- Array length and numeric ranges describe normalized decoder output. A generated pre-vector board polygon or default actor speed is not proof that the source file physically stored it.
- References are collection-local ASCII-folded type-folder candidates. The scan does not choose a project root from each `.gam`, run a boot resolver, verify tile-number bounds, evaluate conditions, follow variable-computed filenames or decide which assets are reachable.
- The 59,107 graph rows split into 52,080 unique path candidates, 6,866 without a path candidate, 83 ambiguous path matches, 75 semantic handles and three inline-source candidates. Those are row counts, not unique target-file counts or confirmed missing assets. The `editor-language` kind marks 66 stored language-resource references that the engine ignores; they are not runtime dependencies.
- `script-literal-candidate` edges are weaker than declared fields. An unused string literal can name a real asset; an executed computed reference can escape the screen entirely.
- Structural script hashes mask quoted text and comments; shared libraries and templates are not independent corroboration. Source scope and wait/order cannot be inferred from a command-frequency table.

## Verification

The actual research command completed against the expanded corpus using existing source decoders; no full game, installer or RPGCode execution was performed. Direct sample decoding checked the demo's actor/placement/presentation relationships and its inline `send`/`itemPath` source. Source inspection checked pickup scripts and an inn's reusable-service versus bespoke-story split. Three punctuation-bearing filenames were disproved as inline source and corrected in the helper ([#1773](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1773)). The expanded input initially exceeded Node's single-string limit; the collector now spools and streams one asset record per line, and the same expanded run completes ([#1774](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1774)).

Two complete runs produced byte-identical SHA-256 digests for all five primary output files. Additional checks verified the ledger totals, that every graph source/target ID exists, the three filename corrections and three demo inline hooks, and all local Markdown links/anchors. A targeted publication scan found no local home paths, credential-query patterns or private network addresses in the research artifacts. These checks do not replace semantic review of every script or an exhaustive secret scanner.

Independent review found one omitted stored relationship: `.gam` editor-language references. The corrected census records all 66 nonempty values as `editor-language` candidates under `Resources`, preserving every earlier graph row unchanged. This research-only correction is tracked in [#1775](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1775); the narrative/field-catalogue review found no actionable errors.

The source baseline is `3958832e`; the exercised Node was v26.13.0. The pinned supported Node is 24.21.0. Local package-manager bootstrap and the main checkout's generated dump command were unavailable; the isolated research used source imports plus already-installed core dependencies. The local tooling issue is [#1770](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1770). Do not present this investigation as a full build, CI/golden pass, renderer validation or proof that any proposed native format can round-trip these games.

CI subsequently caught the research host's private cross-package source import ([#1777](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1777)). It now imports `CORE_DECODERS` through the existing public `@tk-reawakened/core` entry point, with no lint exemption. After an isolated `tsc -b packages/core` build, the repository lint command's `check-core-deps` and full `eslint .` both passed. A complete corpus run through that built package produced all five primary output files byte-identically to the committed evidence. This follow-up still used Node v26.13.0 and existing installed dependencies; it does not claim the pinned-runtime or full CI gates passed.

## Key source files

- [Summary and input package hashes](data/summary.json), [asset/diagnostic ledger](data/assets.jsonl), [fields](data/fields.jsonl), [relationships](data/relationships.jsonl), [script screens](data/scripts.jsonl), [secondary archive probes](data/archive-probes.json).
- [Read-only reproduction](README.md#reproduce), [candidate constructions](candidate-constructions.md), [pattern findings](script-patterns.md).
- [Existing named exclusion](../../../packages/runner-headless/src/dump/formats.ts), [format readers](../../../packages/core/src/formats/registry/core-decoders.ts), [physical format catalogue](../../spec/formats/README.md).
