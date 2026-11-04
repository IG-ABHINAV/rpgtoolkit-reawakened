# Older binary versions

The 3.x binary formats grew by appending fields and bumping the minor version. Readers of current files must still accept these older minors. Most are small differences, already marked "Present when" in the current format pages; this page collects them and documents the two layouts that differ substantially (pre-vector boards and pre-3.0 characters and items).

## Summary

| Format | Current minor | Older minors still readable | Where the differences are documented |
|---|---|---|---|
| Main file | 9 | 1-8 | "Present when" column of [../main-file.md](../main-file.md#layout); history below |
| Board | 4 | 2, 3 | [below](#board-minor-2-and-3-pre-vector) |
| Character | 8 | 5-7 (engine and editor); < 5 (editor only, converted) | [below](#character-before-minor-8) |
| Item | 7 | 3-6 (both); < 3 and < 4 converted | [below](#item-before-minor-7) |
| Enemy | 1 | — (no version branches) | |
| Animation | 3 | — (only minor 3 is accepted) | |
| Fight background, status effect, special move | 3 / 2 / 2 | — (no version branches) | |
| Saved game | 4 | 0-3 (Toolkit 3.0) | [below](#saved-game-before-minor-4) |

## Main file minor history

| Minor | Adds |
|---|---|
| 1-2 | Toolkit 2.x binary main file: plugins as numbered `tkplug<i>.dll` flags; extra unused fields (see the main-file table) |
| 3 | plugin names (menu, battle, command plugins), cursor sounds, joystick, colour depth |
| 4 | game speed, pixel movement |
| 5 | a mouse-cursor on/off flag |
| 6 | full mouse cursor (image, hot spot, transparent colour) |
| 7 | custom resolution |
| 8 | FPS in title bar; game speed stored with the +128 bias (older files are re-biased on load) |
| 9 | path-finding mode, debug vectors, movement controls and keys |

When the original editor opens a minor ≤ 2 main file it copies the shared `Plugin\` folder's files into the project's `Plugin\` folder.

## Board minor 2 and 3 (pre-vector)

Read only (the 3.x editor upgrades and re-saves as minor 4). Fields after the version:

| # | Field | Type | Notes |
|---|---|---|---|
| 1 | registered, registration code | short, string | ignored |
| 2 | sizeX, sizeY, sizeL | short × 3 | |
| 3 | startX, startY, startL | short × 3 | **tile** coordinates |
| 4 | bDisableSaving | short | |
| 5 | LUT UB, LUT entries | short, strings | as the [current layout](../board.md#vector-layout-minor-4-and-later) |
| 6 | tile stream | | Order as the [current layout](../board.md#vector-layout-minor-4-and-later). A literal cell is `index, r, g, b` (4 shorts) then `tiletype` (byte). A run is `−count`, then `index, r, g, b` (shorts) and `tiletype` (byte). |
| 7 | background image | string | **the original engine loses this name** (a bug); the editor keeps it |
| 8 | foreground image, border image | 2 × string | ignored |
| 9 | bkgColor, border colour | colour, colour | border colour ignored |
| 10 | ambient effect | short | 0 none, 1 mist (+75 all), 2 dark (−75 all), 3 water (+75 blue); > 3 → 0 |
| 11 | links N, S, E, W | 4 × string | |
| 12 | battleSkill, battleBackground, bAllowBattles | short, string, short | |
| 13 | day/night: flag, night battles, night skill, night background | short, short, short, string | ignored |
| 14 | constants × 11 | short | become decimal strings |
| 15 | bkgMusic | string | |
| 16 | layer titles × 9 | string | fixed 9, not sizeL |
| 17 | program UB | short | |
| 18 | × program | | file (string; empty entries dropped), x, y, layer (shorts, tile coords), graphic (string), activate (short), initialVar, finalVar, initialValue, finalValue (strings — note the order), activationType (short; the engine adds the "stop movement" flag) |
| 19 | enterPrg, (unused) | string, string | |
| 20 | item UB | short | |
| 21 | × item | | file (string), x, y, layer (shorts, **tile** coords), activate (short), initialVar, finalVar, initialValue, finalValue (strings), activationType (short), prgActivate, prgMultitask (strings). `loadingVar/Value` are copied from `initialVar/Value`. |
| 22 | thread UB | **int** | minor 3 only |
| 23 | × thread | string | minor 3 only |
| 24 | coordType | **byte** | minor 3 (the engine); the editor also reads it for minor 2 |

**Overlong final runs.** When a tile run exceeds the remaining cells, fill only the remaining grid cells and continue reading the following fields. The 3.1.0 editor and engine silently discarded the excess repetitions. Reawakened also reports a warning so a damaged board can be noticed; the warning is not legacy behavior. This pre-vector rule differs from the vector-layout rule that retains extra cells. Evidence: [owner-relayed extraction round 13](../../../provenance/facts-round-13.md).

**Minor-2 `coordType` — Reawakened rule (R-04).** For a minor-3 file the byte is read as written. For a **minor-2** file the byte is absent from the layout, and the two original programs disagree (the engine never reads it and keeps the previous board's value; the editor reads a byte). Our reader follows the editor: **when exactly one byte remains after the sprite list, that byte is `coordType`; otherwise `coordType` is 0 (2D)**. *Evidence:* a corpus sweep found 616 boards ending exactly there and 12 ending with one `0x00` byte (value 0, i.e. 2D); the docs/spec-authored `board_minor2.brd` example has no trailing byte, which is why the rule is "read it only when exactly one byte remains" rather than "always read it". The reader is `packages/core/src/formats/board/pre-vector-reader.ts:696-711`.

**Upgrade rules applied on load.** A pre-vector board converts to the [vector model](../board.md#vector-layout-minor-4-and-later) (minor 4), keeping the source's `coordType`, by these rules:

- **Grid.** The tile matrix is always `sizeX × sizeY` cells per layer, in z, y, x order (z outer, then y, then x), and the converted shade layer covers the same `sizeX × sizeY` cells. Minors 2-3 have no `(sizeX + sizeY)²` effective grid of the kind the vector layout gives iso-rotated boards, and `coordType` is the *last* field, so a reader reads `sizeX × sizeY` cells per layer before it can know the coordinate style. **Size limits** apply as in the [vector layout](../board.md#size-limits), measured on this layout's own cells: a negative `sizeX`, `sizeY` or `sizeL` is invalid and a reader reports it, and a reader refuses a board whose matrix would hold more than 4,194,304 cells (`sizeX × sizeY × sizeL`, no rotated-grid factor), reporting a located error before it allocates. The guard is `packages/core/src/formats/board/pre-vector-reader.ts:714-720`.
- **Cell polygon.** On a 2D board a cell's polygon is the closed rectangle `((x−1)·32, (y−1)·32)`–`(x·32, y·32)`; on an iso-stacked board it is the closed 64×32 diamond centred on the tile.
- **Tile types → vectors.** Old per-cell tile types: 0 normal, 1 solid, 2 under, 3 north-south passage, 4 east-west passage, 11-18 stairs to layer 1-8. For each layer, cells of one type merge into geometry:
  - `0` (Normal): no vector.
  - `1` (Solid): one closed solid polygon per merged block of solid cells.
  - `2` (Under): one closed under polygon per merged block, with `attributes = 1` (include the board background image).
  - `3`/`4` (passages): two **open** (`closed = 0`) solid polylines per tile along its blocking edges — a north-south passage blocks its west and east edges, an east-west passage its north and south edges. Passages are split into per-tile edges (see **Merge** for why that is equivalent).
  - `11…18` (Stairs 1…8): one closed stairs polygon per merged block, with `attributes = tileType − 10` (the destination layer 1…8).
  - **Compatibility note (original).** The original merges *any* non-zero value, so a cell of type `5…10` also produces a polygon whose type is that raw value — and because the vector types are flags, `5` (solid + the deprecated unidirectional flag) behaves as solid. **Reawakened rule:** a cell type other than `1`, `2`, `3`, `4` and `11…18` emits **no** vector and is not reported, because those values are not defined tile types and inventing a flag interpretation is a guess. No board in the fetched corpus uses one.
- **Merge — Reawakened rule ([#1280](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1280)).** On a 2D board, merge cells into greedy rectangles per layer, without reusing a consumed cell. The original also grows down and right, but whether it excludes already-consumed cells during growth has not been established; exact legacy decomposition and corner behavior remain unknown.

  1. Scan cells **column by column** (`x` ascending; within a column `y` ascending) and take the first cell that is not `0` and not yet consumed.
  2. Grow **down** that column while the next cell is unconsumed and has the same type.
  3. Grow **right** one whole column at a time while every cell of the current row span in the next column is unconsumed and has that type.
  4. That rectangle — spanning `((x−1)·32, (y−1)·32)`–`(xEnd·32, yEnd·32)`, points stored top-left, bottom-left, bottom-right, top-right — becomes one closed polygon, and all of its cells are consumed. The current converter stores the rectangle in the opposite order. Its geometry covers the same area, but the current movement code can choose a different blocking edge at a corner when the point order changes, changing whether a step slides or blocks ([#1284](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1284)). Parity of the resulting corner behavior with the original is not established.

  A 2×2 block of solid cells is **one** polygon, while an L made of a three-cell column with one cell to its right at the top becomes two: the 1×3 column and the single cell. For the reverse L `01 / 11 / 11`, the first rectangle covers the lower 2×2 block and the second covers only the upper-right cell: growth stops at the consumed cells. The rectangles partition the covered cells without overlap; scan order fixes the seams. A per-row rule can produce a different decomposition. This is a deterministic Reawakened choice, not a claim of cell-for-cell legacy parity.
  - **Passages under this rule.** The original merges passages like any other type and then emits a line on every boundary of the merged block, so a merged run produces the same set of lines as per-tile edges (the interior boundary appears twice). Splitting them per tile is therefore equivalent, and is what the converter does.
  - **Iso-stacked boards.** The original maps the stacked cells into the rotated grid first and merges rectangles **there**, so a merged block becomes one four-sided parallelogram (a single cell is a diamond). **Unknown:** no iso-stacked pre-vector board exists in the corpus, so this path is unverified; the converter currently emits one diamond per tile on such boards, which covers the same area with more seams.
- **Program trigger regions.** Each program slot at tile `(x, y)` becomes a closed (`closed = −1`) polygon around that cell — the cell rectangle on a 2D board, the cell diamond on an iso-stacked board. Every converted program's `activationType` gets `4` (stop the player's movement) OR-ed in, because old programs always stop movement. The pre-vector record has no distance field, so `repeatDistance` is **0** and bit 2 of `activationType` (2, "repeat every `repeatDistance` px while inside") is passed through unchanged — a legacy file that set it repeats on every step (0 px). <!-- OWNER: chose to keep bit 2 with repeatDistance 0 over masking the bit off, because masking silently discards a behaviour the file asked for; 0 px can only mean "every step" here. -->
- **Empty slots — Reawakened rule (R-05).** Every program and sprite slot is converted, empty ones included, so indices stay stable. An **empty program slot** carries no region: its point list is empty (`points upper bound = −1`) and `closed = 0`. An **empty sprite slot** carries position `(0, 0)` and its stored layer, and nothing is drawn. Neither invents a region around tile `(0, 0)`. <!-- OWNER: chose an empty point list / the origin over a region around tile (0,0), because the file gives an empty slot no position and (0,0) is off-board. --> At run time the converter compacts: program indices are kept on minor 4 and compacted on minors 2-3, and item indices are always compacted ([../board.md](../board.md#items-placed-on-the-board-sprites)).
- **Shading — Reawakened rule (R-02).** The per-cell RGB of every layer produce one shade layer (index 0), and the value is the tint of the **highest** layer whose tile has a non-zero tint — **not** the sum of every layer's tint. A board whose cells are all unshaded has no shade layer. The clamp stays a render-time concern ([../tiles.md](../tiles.md#shading)). <!-- OWNER: chose unclamped sums over clamping to ±255 at conversion, because each stored shade is already in range and clamping is a render-time concern of §4.5. — **WITHDRAWN 2026-10-15 by owner ruling R-02.** The unclamped-sum rule that entry 2.15 recorded is withdrawn in favour of this page's "highest layer whose tile has a non-zero tint" rule, which is also what `docs/spec`'s own conversion specifies. The code `buildShadeLayers` (`packages/core/src/formats/board/pre-vector-convert.ts:281-332`) follows in entry 2.24. -->
- **Positions — Reawakened rule (R-07, per axis).** The start and every sprite position convert from tiles to pixels through the [coordinate rules](../board.md#coordinates), with the stated base point (`+16, +31` on 2D; the tile centre on iso stacked). The start falls back **per axis**: `startX ≤ 0 → 64`, `startY ≤ 0 → 64`, `startL ≤ 0 → 1`. The start is the only field with a fallback; a sprite or program at a non-positive tile converts with no special case. The converter is `packages/core/src/formats/board/pre-vector-convert.ts:456-459`.
- **Dropped fields.** The registration pair (`short`, `string`), the foreground image, the border image, the border colour, the day/night fields and the reserved trailing string have no vector-layout field and are dropped. The ambient preset maps to additive ambience: `0` → none, `1` → `(+75,+75,+75)`, `2` → `(−75,−75,−75)`, `3` → `(0,0,+75)`; any other value becomes none and is reported as a warning.
- **Background image — legacy fact (R-03).** A pre-vector board's background image becomes the vector board's `backgroundImage` with `backgroundDrawType = 1` (**parallax**), confirmed by the logic of both original programs (engine and editor), not an invention. The field row above notes that the legacy engine loses this name (a bug) while the editor keeps it.
- **Numeric constants and layer titles.** The eleven `short` constants become the eleven `constants` entries as their **decimal strings**, in order (`constant[0]`…`constant[10]`). The nine stored layer titles fill `layerTitles[0…sizeL]`: index `i` takes stored title `i` while `i ≤ sizeL` and `i < 9`; a stored title beyond `sizeL` and any index above 8 are dropped, and a missing index is an empty string.
- **No default vector bases — Reawakened rule.** This conversion generates **no** collision or activation base; the board model has no base field, because a sprite's bases come from its own `.itm`/`.tem`. The "standard default bases" of a pre-vector-era item are the [character/item defaults](../character.md#defaults-and-fall-backs), produced when that actor file is read, not by this conversion. <!-- OWNER: withdrew the old "pre-vector items receive standard default vector bases" sentence rather than have the board conversion synthesise a base, because the board model has no base field; the defaults belong to the actor file. --> The converter is `packages/core/src/formats/board/pre-vector-convert.ts:368`.
- **Iso-rotated boards are refused — Reawakened rule.** A pre-vector board whose `coordType` is `2` (or `6`, which is `2` plus the pixel-absolute flag `4`) is **refused** with a located error: neither spec pins a mapping from the `sizeX × sizeY` matrix onto the vector layout's `(sizeX + sizeY)²` rotated grid, and the program-region rule above names only the 2D rectangle and the iso-stacked diamond. `coordType` `0`, `4`, `1` and `5` convert, and the pixel-absolute flag `4` is passed through unchanged. <!-- OWNER: chose to refuse iso-rotated pre-vector boards over guessing a rotated mapping, because neither §4.8 nor §4.2 pins one. --> The refusal is `packages/core/src/formats/board/pre-vector-convert.ts:489-491`.
- **Variable names:** a trailing `!` or `$` on a legacy variable name is stripped.

**Evidence (legacy fact).** The fetched sample corpus holds no minor-2/3 board (all example `.brd` files are minor 4), so the rules above are pinned by synthetic fixtures and by the TK2-era archive corpus: 144 binary minor-2 boards read and convert cleanly. That corpus has no minor-3 board and no isometric board, so the minor-3-only fields (`threads`, `coordType`) and every iso rule rest on the layout tables rather than an observed file, and the iso-rotated refusal stands.


## Character before minor 8

| Minor | Difference from the current layout |
|---|---|
| 7 | no collision or activation polygons (defaults apply, see [../character.md](../character.md#defaults-and-fall-backs)) |
| 6 | also no idle time and speed (defaults 3.0 s and 0.05 s) |
| 5 | also no idle animations |
| 3 | the level-up experience field is **one byte** instead of an `int` — the name "level type" the older docs gave it is misleading; it is the experience needed for the first level-up (only reachable through the editor's conversion) |
| < 5 | Toolkit 2 binary layout, below. **The original engine refuses these**; the editor converts them. |

**Minor < 5 layout.** Identical to the current layout up to and including `levelSm`, then:

| Field | Type |
|---|---|
| swipe, defend, special-move, death sounds | 4 × string |
| levelUpProgram | string |
| levelUpType, sizeType | byte, byte |
| walking tiles: 16 frames × (upper, lower) | 32 × string |
| battle tiles: for frame *x* = 0..3, for *y* = 0..1, for *z* = 0..1: fight, defend, special, death | 64 × string |
| battle rest: 2 × 2 | 4 × string |
| custom: 10 × (upper, lower) | 20 × string |

Nothing follows. The tile names are tile references; conversion turns them into tile bitmaps and animations ([conversion.md](conversion.md#characters)).

**Residual bytes after the tile names (Q8, open question).** The reader always reads the 120 names regardless of the `sizeType` byte's value, and neither program reads anything after them. **14 of the 16** binary minor-3/4 files in the corpus close exactly; FinalDestiny's `Bill.tem` (minor 4) leaves 13 bytes and FinalDestiny's `start.tem` (minor 3) leaves 96. The `sizeType` byte reads `99` on Caoquest's `red.tem` where its neighbour reads `1`. The extra bytes are harmless and their origin is unknown; whether the name block has a different length for some writers is not settled by the corpus.

## Item before minor 7

| Minor | Difference from the current layout |
|---|---|
| 6 | no collision or activation polygons (defaults apply) |
| 5 | the rest animation (field 23) is moved to the south idle animation on load (applies to minors 4 and 5) |
| 4 | also no idle animations, speed or idle time (defaults 0.05 s and 3.0 s) |
| < 4 | **Toolkit 2 binary layout:** instead of fields 22-29 of the current layout (walk animations … custom stances), 16 walking frames × (upper, lower) tile names, then 2 rest tile names (34 strings). Both programs convert these ([conversion.md](conversion.md#items)); the original engine does it **on every load**. |
| < 3 | additionally, prices and all stat changes (fields 8, 12, 14, 16) are shorts instead of ints |

## Saved game before minor 4

Saved games from Toolkit 3.0 (minors 0-3) differ from the current layout ([../save-game.md](../save-game.md)) as follows:

- always 5 party slots; character paths stored with their folder (the folder is stripped on load);
- the board name stored with its folder;
- party positions in **tile** coordinates, and no active flag or path state;
- no board-item section;
- each thread stores a position (ignored) instead of item-thread information, a sleep time in **seconds**, and instead of the program state a list of local variable "heaps" (ignored on load);
- minor 0 has no object list; minors 0-1 have no game-speed offset.

**Compatibility note:** the original engine's reader for the legacy local-variable heaps reuses one loop counter for two nested loops, so any save with more than one heap, or a non-empty heap, misparses (inferred). Running scripts cannot be restored from these files in any case.

