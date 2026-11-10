# Four real projects, one independent logical model

These are **selected, populated projections**, not whole-game conversions. Every notation receives the same values. Read [source mappings](data/source-mappings.json), [complete before/after path lists](data/projection-summary.json), and [physical versions and hashes](data/physical-provenance.json) alongside the examples below.

Local root: `/private/tmp/tkr-1778-astra-experiments/projects/`. For each game:

```text
GAME/
  actor/, party-member/, inventory/, presentation/, clip/, scene/, skill/, program/, project/
    <stable-id-slug>.json                 # neutral inspection documents
  notations/YAML/<kind>/<id-slug>.yaml   # actual split projection, all values populated
  notations/KDL/<kind>/<id-slug>.kdl
  notations/<other candidate>/<kind>/<id-slug>.<extension>
  comparison.<extension>                # comparison bundle, not proposed storage
  compatibility/<source-slug>.json       # local original decoded model + unmapped fields
  provenance.json                       # original locators, hashes, decoder observations
```

Not every game has every kind: for example, the demo selection has no `.gam` or evidenced inventory capability. Its grant/skill case is an explicitly authored supplement, not an invented legacy document. The full local programs stay outside tracked outputs; no binary media is copied into these proposed contracts.

## Ownership rules used here

| Source concept | Proposed owner | Important boundary |
|---|---|---|
| Scene placement of `.itm` | `scene.placements[]` referencing actor ID | Position, conditions and occurrence-specific hooks stay here; actor/party data is not copied into every placement |
| `.itm` presence/presentation | Actor + presentation | The file extension does not prove it is an inventory object |
| Evidenced use/equip/price/key-item capabilities | Inventory item, referenced by actor where relevant | Inventory effects apply to party/inventory semantics, not sprite appearance |
| `.tem` stats/skills/progression/equipment | Party-member definition | Actor refers to it; no per-scene cloned party member |
| Movement/stance/portrait/tile presentation | Presentation definition | Old tile-based graphics are kept as text references, not silently treated as modern animation filenames |
| `.anm` frame/timing sequence | Clip | Explicit frame identity and meaningful order; unused old slots remain in compatibility evidence |
| `.brd` grid and geometry | Scene | Stable layer/row IDs and readable numeric cells; lookup-table holes retained |
| `.spc` skill data | Skill | Capability/effect data is not replaced with a new battle system |
| `.gam` start and program links | Project document | This is game data, not editor settings |
| `.prg` source or inline hook text | Program or owning binding | LF normalization is declared; no RPGCode execution or rewriting of behavior |
| Namespaced plugin data | Relevant object's `extensions` subtree | Plugin-owned schema; unknown content retained but not authorized |

IDs start from normalized source paths for traceability **in this experiment**. They must be treated as minted identities: renaming a document does not mean recomputing its ID from the new filename. Placement/frame IDs retain original slot identity even when holes are omitted from the active list. Array order remains semantic; map key order does not.

The projection deliberately keeps residual legacy conditions and raw skill fields rather than pretending they already form a final native contract. The inventory classifier uses observed flags/prices; an all-zero NPC-like `.itm` may still participate in a script-driven inventory system. That cannot be decided from the file alone: the original model remains in compatibility material, not discarded. This is selection for research, **not a safe automatic migration classifier**.

## Demo: NPC presence, party member and inline hooks

Observed source relationships:

- `Boards/start.brd` and `Boards/out.brd` contain placed actors/triggers referring to `Item/man.itm`, `Item/oldman.itm` and programs.
- `Chrs/start.tem` is Frap's character record; decoded HP/maxHP are 100/100, level 1. Those stats move into a **party-member**, not into every scene representation.
- `Item/man.itm` and `Item/oldman.itm` have no observed use/equip/price/key-item capability. The forward projection does not manufacture two empty inventory documents for them.
- `Misc/start/start_s.anm` supplies an actual ordered clip. `Prg/man_wander.prg`, `Prg/man.prg`, `Prg/oldman.prg` supply external behavior evidence; actual inline trigger source is retained as well.

Representative concrete tree change (complete lists are in the JSON):

```text
BEFORE                                     AFTER (neutral JSON / same IDs in every notation)
Boards/start.brd                         -> scene/scene-boards-start-brd.json
Boards/out.brd                           -> scene/scene-boards-out-brd.json
Item/man.itm                             -> actor/actor-item-man-itm.json
                                         + presentation/presentation-item-man-itm.json
Item/oldman.itm                          -> actor/actor-item-oldman-itm.json
                                         + presentation/presentation-item-oldman-itm.json
Chrs/start.tem                           -> actor/actor-chrs-start-tem.json
                                         + party-member/party-member-chrs-start-tem.json
                                         + presentation/presentation-chrs-start-tem.json
Misc/start/start_s.anm                    -> clip/clip-misc-start-start-s-anm.json
Prg/man_wander.prg                        -> program/program-prg-man-wander-prg.json
```

The 20×11×2 start scene yields 22 tile rows and one actual placement; out is 20×15×2, 30 rows and one placement. The literal text rehearsal adds another real placement without a graphical editor. The small shareable miniature separately illustrates three placements of the same actor.

**Physical evidence:** board 2.4, character 2.8, items 2.7, clip 2.3, all binary. This cohort supplies modern vector-board/actor structure; it is not the sole historical variant.

## ChimeranEmpire: NPC/service network and inventory effects

`Museum.brd` has three nonempty placements, `Trogan 1.brd` has two. Both scenes use actual NPC files and associated dialog/service/warp programs. The selection includes `Give Apple.prg`, `Inn 3.prg`, museum-object programs and village programs rather than reducing the scene to a fabricated two-property example.

The decoded Apple has menu-use HP **10**, SMP **5**, and sell price **3**. Crystal Staff has an equip capability and equip-bonus array `[0, 0, 10, 0]`; its description says “Teaches Mage Sword.” That text is **not proof of a declarative skill-grant field**. The proposed `itemGrantsSkill` relation remains explicitly authored; this investigation does not infer implementation from flavor text.

```text
BEFORE                                     AFTER
Main/ChimeranEmpire.gam                  -> project/project-main-chimeranempire-gam.json
Boards/Museum.brd                        -> scene/scene-boards-museum-brd.json
Boards/Trogan 1.brd                      -> scene/scene-boards-trogan-1-brd.json
Item/Man.itm, Woman.itm, Man 2.itm        -> separate actor + presentation documents
Item/Apple.itm                           -> actor/actor-item-apple-itm.json
                                         + inventory/inventory-item-apple-itm.json
                                         + presentation/presentation-item-apple-itm.json
Item/Crystal Staff.itm                   -> actor + inventory + presentation
Chrs/Flane.tem                           -> actor + party-member + presentation
Misc/Bolt 1.anm                          -> clip/clip-misc-bolt-1-anm.json
SpcMove/Bolt 1.spc                       -> skill/skill-spcmove-bolt-1-spc.json
Prg/Give Apple.prg, Inn 3.prg             -> separate program documents
```

The project starts at `scene:boards/relic room start.brd` with `actor:chrs/ifrin.tem`. Those are **outside the selected two-scene sample**, not silently replaced with Museum/Flane. The projected project file therefore makes the partial scope visible; it does not prove a closed playable dependency graph.

**Physical evidence:** boards binary 2.2, character 2.4, items 2.3, project 2.2; clip is text 2.0. Normalized board vectors here were synthesized from older tile-type data, not authored as vector objects.

## Caoquest: older text layouts and a real six-placement scene

`house3.brd` is a 19×14×8 scene with six nonempty placements: the source actors include `cao2.itm`, `clerk.itm`, and several potions. `town.brd` is 19×20×8 with a gem placement. This is the common merge fixture: the six records, conditions and tile data are actual decoded game data, not six synthetic copies.

The item called “Potion” in `10smp.itm` has a menu SMP effect of **10**, buy price **10**, sell price **5**. The Cao party member has HP **200**, SMP **50**, level **1**. The separately selected older `start.tem` decodes with an empty name and zero stats; the experiment preserves those observations rather than filling them with invented friendly defaults.

```text
BEFORE                                     AFTER
Main/caoquest.gam                        -> project/project-main-caoquest-gam.json
Boards/house3.brd                        -> scene/scene-boards-house3-brd.json
Boards/town.brd                          -> scene/scene-boards-town-brd.json
Item/cao2.itm, clerk.itm, gem.itm         -> actor + presentation; ambiguous inventory use unresolved
Item/10smp.itm, 50hp.itm, 50smp.itm       -> actor + inventory + presentation
Item/goodpotion.itm                      -> actor + inventory + presentation
Chrs/cao.tem, Chrs/start.tem             -> separate actor + party-member + presentation per source
Misc/combo.anm                          -> clip/clip-misc-combo-anm.json
SpcMove/Earth.spc                        -> skill/skill-spcmove-earth-spc.json
Prg/warp3.prg and five selected warps    -> separate program documents
```

Its project start is `scene:boards/cao's house.brd`, outside this selected scene pair, with the selected Cao actor. Scene links and program references may point beyond the sample; no general dynamic RPGCode dependency resolver was invented.

**Physical evidence:** boards text 2.1; items text 2.1; `start.tem` text 2.2 while `cao.tem` is binary 2.4; clip/project/skill text 2.0. These facts establish older tile-based material despite the public board model's normalized minor 4.

## CrystalImmortality: substantial tiles and long programs

Payloads were recovered by reading nested ZIP members, verifying their hashes, **never running an installer**. `Castle3left.brd` has six placements; `city1.brd` has four and 20,000 tile cells. The sample includes the actual program-heavy menu/bar-fight material as well as scene-linked programs: **3,200 selected lines**, including `bar fight C.prg` (1,143 lines) and `mymenu.prg` (1,135 lines).

Dupcyk's decoded stats include HP **80**, SMP **25**, level **1**. `HP gain.itm` has menu-use capability, but its simple numeric HP/SMP fields are zero; its description says it increases maximum HP. The projection keeps its program/effect fields and does not invent a numerical `maxHp += 5` behavior from the description.

```text
BEFORE                                     AFTER
Main/Crystal.gam                         -> project/project-main-crystal-gam.json
Boards/Castle3left.brd                    -> scene/scene-boards-castle3left-brd.json
Boards/city1.brd                         -> scene/scene-boards-city1-brd.json
Item/train soldier1.itm, soldier2 etc.   -> separate actor + presentation documents
Item/HP gain.itm                         -> actor + inventory + presentation
Chrs/Dupcyk.tem                          -> actor + party-member + presentation
Misc/bolt1.anm                          -> clip/clip-misc-bolt1-anm.json
SpcMove/Magus.spc                        -> skill/skill-spcmove-magus-spc.json
Prg/bar fight C.prg                      -> program/program-prg-bar-fight-c-prg.json
Prg/mymenu.prg                           -> program/program-prg-mymenu-prg.json
```

The `.gam` starts at `scene:boards/port city 2.brd`, outside the selected scene pair. Its actor is the selected Dupcyk. Keeping those references intact exposes incomplete sampling instead of making a misleading runnable-project claim.

**Physical evidence:** boards binary 2.2, character 2.4, items 2.3, project 2.2, clip text 2.0. Tile-derived geometry is a conversion observation. No image content is transformed into opaque text blobs.

## What the ledger does and does not prove

[Source mappings](data/source-mappings.json) enumerate **every decoded top-level field for the 95 selected source files**, its proposed owner or `compatibility-only` status, physical header version and conversion/default qualification. Nested records copied as whole structures are not represented as an invented byte-offset-level reverse specification.

Examples:

- `sizeX/sizeY/sizeL` → scene dimensions; expanded `tileMatrix` → identified row cells; `lut` → unchanged lookup palette.
- `sprites` → nonempty placements with original slot IDs; position, activation/thread references and condition data preserved. Empty physical slots remain in the local full model.
- `programs` → nonempty triggers with original slot IDs and original region/condition values.
- `.tem stats/variableNames/specialMoves/equipment/progression` → party-member fields; movement/graphics/sounds → actor/presentation.
- `.itm` use/equip/prices → inventory only where the selected capability evidence warrants that projection; otherwise retained in compatibility evidence.
- `.anm frames/delay` → clip; original slot IDs retained; empty slots left in compatibility evidence.
- `.gam` start/program/plugin-name fields → project; legacy plugin names are **not** automatically portable plugin manifests.
- `magic`, versions, residue, unused field groups, tile-run encoding, old shading/lights/constants/layer titles not selected for the forward construction → compatibility-only. This is explicit non-adoption, not silent data deletion.

The public pre-vector converter normalizes model version, creates collision vectors and trigger cell regions, converts positions/timing/constants, and supplies documented defaults. Some old source-only fields are dropped **before** the normalized model exists. In particular, the [documented upgrade rules](../../../spec/formats/legacy/older-binary-versions.md) discuss registration, foreground/border and day/night fields. The ledger cannot recover those bytes semantically; the original read-only payload and hash remain the authority. It is not a lossless legacy archive format.

The real projection's binding classifier preserves known source-file references or inline source and marks the source-owner context as unresolved legacy context where the full runtime meaning is not established. The separate source-extraction experiment uses an explicit proposed binding ID and context and verifies those values remain unchanged. **Neither is a claim that inline/external execution, `Self`, stack or saved continuations are equivalent.**

## Shareable examples and local inspection

The ten [`keeper` examples](examples/keeper.yaml) are wholly authored miniatures: one actor, three placements, inventory/skill grant, actor-specific performance, ordered frames, geometry, a small readable tile grid, inline/external hooks and present/absent plugins. They are safe to share and were parsed/validated through all ten adapters. Their tiny grid **does not substitute for** the 20,000-cell actual scene.

For real populated documents, open for example:

```text
/private/tmp/tkr-1778-astra-experiments/projects/demo/notations/YAML/scene/scene-boards-start-brd.yaml
/private/tmp/tkr-1778-astra-experiments/projects/ChimeranEmpire/notations/KDL/inventory/inventory-item-apple-itm.kdl
/private/tmp/tkr-1778-astra-experiments/projects/Caoquest/notations/YAML/party-member/party-member-chrs-cao-tem.yaml
/private/tmp/tkr-1778-astra-experiments/projects/CrystalImmortality/notations/KDL/scene/scene-boards-city1-brd.kdl
```

## Key source files

- [Projection implementation and explicit source selection](../../../../tools/research/native-data-notations/astra/project.py)
- [Physical header versus normalized-model evidence](../../../../tools/research/native-data-notations/astra/provenance.py)
- [All selected paths and document counts](data/projection-summary.json)
- [Original consumed-payload SHA256s](data/consumed-hashes.json)
- [Prior boundary constructions](../../native-data-boundaries/candidate-constructions.md)
