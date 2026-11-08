# Source-to-projection mapping (Opus, #1778)

Part of the [Opus independent report](README.md). This is an **experimental** logical regrouping; it is not an approved schema. The rules are implemented in [`project.mjs`](../../../../tools/research/native-data-notations/opus/project.mjs), and the draft JSON Schema 2020-12 is [`native-model.schema.json`](../../../../tools/research/native-data-notations/opus/schemas/native-model.schema.json). Field semantics are cited from `docs/spec/formats/*.md`.

## Owners and why they are separate documents

| Projected owner (path) | From | Reason it is its own document |
|---|---|---|
| `project` | `.gam` | Boot, input, encounters and hooks share one lifecycle. Editor-only `languageFile`, machine paths and registration data are excluded. |
| `actors/<id>` | `.tem`, `.ene`, and `.itm` with world presence | **Presence** in a scene: clips, timing, collision/activation polygons, default behaviour. Capabilities are nested blocks: `character` (stats, progression, learnable skills, equipment slots), `combatant` (enemy stats, AI, rewards). |
| `items/<id>` | `.itm` with inventory semantics | Value, equip slots and bonuses, menu/battle use. A world pickup is an **actor that references** `item: <id>` (Chimeran: 40 items, 52 actors; no field is duplicated). |
| `skills/<id>` | `.spc` | Mechanics plus default effect presentation. *Who learns it* lives on the actor (`character.skills.learnable`). *How a specific actor performs it* is the **proposed** `perform` binding. |
| `effects/<id>` | `.ste` | Definition only; remaining duration is save state. |
| `clips/<path>` | `.anm` | Ordered frames with stable `f<n>` IDs. **Trailing empty capacity slots are dropped; interior empties are kept.** The stored slot count is kept in `compat`. |
| `tile-animations/<id>` | `.tan` | Tile frame cycle. |
| `environments/<id>` | `.bkg` | Battle presentation (image/music/sounds or the older tile composition). |
| `scenes/<id>/scene` | `.brd` | Extent, background, start, battle rules, edge links, enter hook, `regions` (vectors), `triggers` (programs), `placements` (sprites), threads, constants. |
| `scenes/<id>/tiles` | `.brd` LUT, tile matrix, shading | **A separate sibling document**: large, edited by different tools, and measured separately. Palette entries keep their legacy LUT `index` (identity-bearing). Layers are arrays of rows. Shading is stored as sparse non-zero runs. |
| `scripts/**.prg` | `Prg/` | Copied byte-for-byte in scratch. Bindings say `{inline: …}` or `{program: "scripts/…"}` explicitly. |
| `media/images`, `media/audio`, `tilesets/*.tst`, `fonts/` | `Bitmap/`, `Media/`, `Tiles/*.tst`, `Font/` | **Binary payloads stay binary** (linked into the projected tree, never re-encoded). |
| `compat.tk3` (inside each document) | Various | Core-owned compatibility data: source path, stored version, non-default legacy values with no forward owner, residue bytes (base64). |
| `extensions.<reverse-dns>` (inside each document) | None in the cohort | **Proposed** plugin-owned data. Core preserves it; a plugin schema validates it when installed. |

## Key field rules

| Legacy field (spec) | Projected path | Rule / conversion |
|---|---|---|
| board `sprites[].itemFile` (board.md f41) | `placements[].actor` | Folded legacy path to actor ID. The placement ID is `<actor>-<n>` (**synthesized**: legacy has no IDs). An empty slot is kept as `{id: empty-slot-n, emptySlot: true}`. |
| board `sprites[].x,y,layer` (f48) | `placements[].at` `[x, y, layer]` | Pixels, layer is 1-based. |
| board `sprites[].activationPrg` / `multitaskPrg` (f42–43) | `placements[].onActivate` / `whilePresent` | A Prg file exists → `{program}`. No file, punctuation present and no `.prg` suffix → `{inline}`. Otherwise an unresolved `{program}` is reported (board.md f26 rule plus the census screen). |
| board `sprites[].activate/initial*/final*/loading*` (f44–46) | `condition.when/then`, `loadIf` | Emitted only when the stored data activates them. |
| board `programs[]` (f25–38) | `triggers[]` | `activationType` bit flags → `onKey`/`repeatWhileInside`/`stopsPlayer`. `closed: 0` → `open: true`. `handle` unused (0 non-empty in the cohort). |
| board `vectors[]` (f17–24) | `regions[]` | type → `solid/under/stairs/waypoint/one-way/none`. A handle becomes the region ID (e.g. `wp_oldman`); otherwise `region-<n>` (**synthesized**). Stairs `attributes` → `targetLayer`. |
| board `lut` + `tileMatrix` (f6–7) | `tiles.palette[]` + `tiles.layers[].rows` | The matrix is reshaped layer → row → x (board.md cell order). `tileRuns` is not projected (same cells). |
| board `shadeLayers` (f8–9) | `tiles.shading[].runs[]` | Only non-zero runs, with 1-based `at` and `cells`. |
| item `equipable…keyItem`, prices, equip/menu/battle | `items/<id>` | The inventory test: any of equip/menu/battle/key/price/description. |
| item `boardUsable`, walk/idle animations, polygons, `activationProgram`, `multitaskProgram` | `actors/<id>` | The world test: boardUsable, placed on any board, or has a hook. Both tests true → two documents linked by `item`. |
| item `onEquipProgram == "None"` | `{program: "scripts/None"}` | **Kept and reported** as a broken reference (30 in Chimeran). The sentinel's engine meaning is not in the spec; not guessed. |
| character `hasSpecialMoves` (character.md f17: 0 = has moves) | `character.skills.enabled` | Inverted to a boolean. |
| character `specialMoves[201]` | `character.skills.learnable[]` | Non-empty slots only. The legacy `slot` index is kept. `requires` uses `{experience, level, variable}`. |
| character `variableNames` | `character.statVariables` | Kept: the stats live in these script variables (character.md "Stats live in script variables"). |
| gam unused TK3.1 options (day/night, cursor, joystick…) | `compat.tk3.unprojected` | **Copied only when non-default.** All were default across the 3 cohort `.gam` files. |

## Accounting result (whole cohort)

Every decoded field path was classified (`accounting.json` per game). **0 unaccounted.**

| Status | Field-path rows (4 games) |
|---|---:|
| mapped | 932 |
| compat (always copied) | 38 |
| compat-if-set (copied when non-default; includes non-empty residue) | 253 |
| not-projected, with reason (signature/version, `tileRuns`, reserved, binary pixels/fonts, editor-only or registration data, frameCount) | 224 |

Non-default values among *not-projected* fields are format signatures/versions (kept in provenance), `tileRuns`, `sprites[].reserved = -1`, legacy `sizeType` (spec: ignored), pixel/font payloads (kept binary), `languageFile`, `projectPath` and `registrationCode` (deliberately never copied).

## Synthesized vs. observed

- **Synthesized identities:** placement IDs `<actor>-<n>`, region IDs `region-<n>`, trigger IDs `trigger-<n>`, frame IDs `f<n>`, document IDs from slugged file names. They are stable for a given import order. A real importer would need a rule for order-insensitive identity.
- **Proposed (not in legacy data), used only in the representative fixtures:** `items/*.grants`, `character.skills.learnable[].perform`, and every `extensions` value.
- **Runtime defaults not synthesized:** polygons for items below minor 7 and characters below minor 8 are *absent*, not filled with the spec defaults. The default rule belongs to the runtime/import contract.
- **Real legacy idiom found for item-grants-skill:** Chimeran `Item/Crystal Staff.itm` ("Teaches Mage Sword") has `onEquip: Add Mage Sword.prg` (sets `MageSword!==2`). `Chrs/Icharus.tem` gates `mage-sword-1` on `MageSword! == 2`. The proposed explicit `grants` would replace a script/variable convention. The legacy semantics of the combined experience/level/variable requirement were not verified.

## Decode coverage notes (inputs, not projection defects)

- Every byte consumed hash-matches `1778-shared-inputs.json`: demo 75, Chimeran 665 (inventory 694 incl. duplicates/zero-byte), Caoquest 174, Crystal 1,559 extracted from the nested `zip.zip` into scratch with `bsdtar`. **0 mismatches.**
- Stored board variants, from the header bytes rather than file names:
  - Caoquest: **14 Toolkit 2 text boards** plus 2 binary 2.2.
  - Chimeran: 98 binary 2.2 plus 1 text board.
  - Crystal: 242 binary 2.2.
  - demo: 2.4.
  - Pre-vector boards are converted to the vector model by the core decoder; their regions are converter output, not stored vectors.
- Crystal `Chrs/Dupcyk.tem` (72 bytes, containing tile names), `Invisible.tem` (64) and `Pearl.tem` (5) leave residue after the minor-4 tile-name block. This extends the open question Q8 in [older-binary-versions.md](../../../spec/formats/legacy/older-binary-versions.md#character-before-minor-8). The residue is preserved as base64 in `compat`.
- Real broken references found by `check.mjs` on the JSON projection (corrected run, with full reference coverage, #1786; `results/projection-check-summary.jsonl`):
  - Crystal: 2,075, mostly tileset references to `rpgmakeralt7.tst` and others that are not in the capture (prior census: `no-path-candidate`), plus scenes including `None.brd`/`none.brd`, and other assets.
  - Chimeran: 37, including 30 `None` program sentinels.
  - Caoquest: 15, including 11 missing `background.JPG`.
  - demo: 0, plus 2 script-literal warnings.
