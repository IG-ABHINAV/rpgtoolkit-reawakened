# Board (`.brd`)

A board is one map: a stack of tile layers, per-tile colour shading, light sources, polygon "vectors" for collision and other effects, program triggers, items placed on the map, layer images and per-board settings. Boards live in `Boards\` (sub-folders allowed).

Header text: `RPGTLKIT BOARD`. Newest minor: **4** (the "vector" layout introduced in 3.1.0). Minors 2 and 3 are the older "pre-vector" layout, which readers must still accept and upgrade.

## Version dispatch

1. The byte at offset 14 must be `00` (otherwise it is a Toolkit 2 text board, which the 3.x engine rejects with "Please save this board in the editor").
2. Header text must be `RPGTLKIT BOARD`.
3. Read `major` (short) and `minor` (short):
   - minor 0 or 1 → rejected ("Please save … in the editor").
   - minor 2 or 3 → [pre-vector layout](legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector).
   - **any other value, including 5+ and negative** → [vector layout](#vector-layout-minor-4-and-later). A future minor is read as minor 4 without warning.
   - The original editor also refuses `major ≠ 2`; the engine ignores `major`.

**A future minor — Reawakened rule (ADD-1).** A `minor` above the newest (5 and up) is read as the vector layout without a warning, so a file written by a later editor still loads rather than being refused as an unlisted value. The landed reader does this (`packages/core/src/formats/board/reader.ts:188-207`).

## Coordinates

- **Tile coordinates** are 1-based: x = 1..width, y = 1..height, layer = 1..sizeL.
- **Pixel coordinates** are board pixels from the top-left of the board, (0,0). One tile is 32×32 pixels on normal boards.
- **`coordType`**: `0` normal grid, `1` isometric "stacked" (older staggered-column method), `2` isometric "rotated" (axes rotated 60°/30°), optionally combined with the flag `4`. Flag 4 is the editor's **"Use pixel coordinates"** option (a checkbox in the New Board dialog, and a one-way menu command on an existing board). It marks the board as using absolute pixel coordinates rather than tile coordinates for the positions that scripts and the editor display. The sample boards use `0` and `4`; both are normal grids. **Established for `send` (#1246):** a [`send`](../engine/movement-and-collision.md#reawakened-send-board) target on a flag-4 board is a board-pixel position, and on a board without the flag it stays a one-based tile coordinate — the shipped 3.1 demo's door programs only make sense that way. Other script-visible positions remain as their own pages rule them.
- **Effective grid.** For isometric-rotated boards the tile and shade streams cover a square `(sizeX + sizeY) × (sizeX + sizeY)` grid; otherwise `sizeX × sizeY`. The stored `sizeX`/`sizeY` remain the logical size.

**Tile-to-pixel conversion (legacy fact).** Tile indices are 1-based. The tile's bounding-cell top-left, then a base point, gives the stored pixel position:

| System | x | y | base point |
|---|---|---|---|
| 2D | `(x−1)·32` | `(y−1)·32` | `+16, +31` (bottom-centre of the tile) |
| iso stacked | `64x − (y odd ? 32 : 64)` | `16y − 16` | `+0, +0` (tile centre) |
| iso rotated | `(x − y + sizeX)·32` | `(x + y − sizeX)·16 − 16` | `+0, +0` |

The inverse snaps to the nearest 32×16 diamond centre; for 2D, `tx = floor(px/32) + 1` and `ty = floor(py/32) + 1` after subtracting the base point, and for iso-rotated `ty = floor((py+16)/32) − floor(px/64) + sizeX` and `tx = floor(px/32) + ty − sizeX`. **Reawakened rule (proposed, pending owner review):** for iso-stacked, "nearest" is measured by the diamond's own metric `|dx| + 2·|dy|` between the pixel and each candidate centre (the two rows `floor(py/16) + 1` and `floor(py/16) + 2`, each with its nearest column), and an exact tie keeps the upper row. The **stacked → rotated** upgrade (a one-way editor command) maps `xr = xs + floor((ys − 1)/2)` and `yr = floor(ys/2) + 1 − xs + sizeX`, and puts every tile on the same pixel as before. Movement directions are an 8-way enum: E = 1, SE = 2, S = 3, SW = 4, W = 5, NW = 6, N = 7, NE = 8 (0 = idle).

## Vector layout (minor 4 and later)

### Dimensions and tiles

| # | Field | Type | Meaning |
|---|---|---|---|
| 1 | sizeX | short | width in tiles (≥ 1) |
| 2 | sizeY | short | height in tiles |
| 3 | sizeL | short | number of layers |
| 4 | coordType | short | see Coordinates |
| 5 | LUT UB | short | upper bound of the tile look-up table (LUT) |
| 6 | LUT × (UB+1) | string | [tile reference](README.md#tile-references) for each LUT index. **Index 0 is always empty (= no tile).** The editor writes unused entries as empty strings and only trims unused entries from the end, so indices are stable. Entries ending in `.tan` are animated tiles. |
| 7 | tile stream | shorts | One LUT index per cell, run-length encoded. Cell order: **layer outermost (1..sizeL), then y (1..h), then x fastest (1..w)**. A value ≥ 0 is one cell with that LUT index. A negative value `−c` is followed by one short `idx` and means *c* consecutive cells of `idx`. Runs may cross rows and layers. The stream has no terminator: it ends when `w × h × sizeL` cells have been produced (the original engine also stops if a run overshoots the end). |

### Size limits

**Reawakened rule (R-25).** A negative `sizeX`, `sizeY` or `sizeL` is invalid and a reader reports it. A reader also refuses a board whose tile matrix would hold more than **4,194,304 cells** (the effective grid times `sizeL`) — a located error before it allocates anything. *Reason:* the limit is not part of the format but an implementation guard, because a run marker fills up to 32,768 cells with four bytes, so without it a file of a few kilobytes could make a reader reserve gigabytes. Real boards are about a hundred times smaller. A writer refuses a board the reader would refuse. The guard is in `packages/core/src/formats/board/reader.ts:188-207` and `:219-243`.

**LUT absence and empty slots.** When `lutUpperBound ≥ 0` the table has that many + 1 entries and **index 0 is always the empty "no tile" entry**; `-1` means the board has **no table at all**, and then there is no index 0. Inside an existing table, unused slots may be empty, and an empty slot is not the same as the table being absent, because it keeps later indices stable. A cell whose LUT entry is a `.tan` file is an animated tile, expanded at load time into one LUT slot per frame.

**Run markers.** The index after a run marker **must be `≥ 0`**: a run marker whose cell index is itself a marker is invalid (runs do not nest) and a reader reports it rather than reading a second run. A run that carries the traversal past the layer or the last layer is read in full, its extra cells kept and a **warning** reported, so an over-long run still round-trips; the same holds for a shade layer whose records cover more cells than the grid.

### Tile shading

Per-tile RGB tint, used for shadows and colour effects.

| # | Field | Type | Meaning |
|---|---|---|---|
| 8 | shade UB | short | number of shading layers − 1. The editor always writes 0 (one shading layer); readers must accept more. |
| 9 | × (UB+1) shading layer | | |
| 9a | layer | **int** | the top board layer the shading is cast onto |
| 9b | cells | groups of 4 shorts | `count, r, g, b`, covering the effective grid with y outermost and x fastest (no layers). `count` ≤ 1 is one cell; `count` > 1 is a run of that many cells (runs wrap rows). r, g, b are added to the tile colour, range −255..255. The group always starts with `count`, because r, g, b can be negative. |

**Shading arithmetic — legacy fact, with Reawakened R-15 scope (OWNER).** Shades and ambient values are signed additive RGB offsets in the range −255..+255. A drawn tile pixel's colour is `clamp(src + shadeLayer + boardAmbient + globalAmbient, 0, 255)` per channel; transparent pixels are left alone. Before this sum, replace pure white with `(245,245,245)` and pure black with `(10,10,10)` **only when the blit's full pre-summed tint is non-zero**; zero-tint art retains exact source colours. Clamp once after the complete sum. Shading applies to board tiles and tile-built sprites, and the ambient level also applies to images and sprite frames.

### Lights

Light sources are editable objects. The engine bakes them into shading layer 0 at load time and does not keep them. **Reawakened rule (OWNER; light falloff; round-7 facts adopted and kept).** Ellipse falloff is a normalized elliptical radius with linear endpoint falloff (`1` at centre, `0` at the radius), and the ellipse boundary is excluded: only pixels strictly inside the ellipse are lit (adopted from the owner-relayed legacy fact). Gradient falloff is a clamped projection along its two nodes; clipped gradient uses the same projection only inside its polygon/clip shape. Interpolate the two stored colours in fixed-point integer steps and clamp the shade once; the clamp is kept as a deliberate Reawakened departure, because the legacy lighting does not clamp. The stored light layer is ignored. See [display-input-audio.md#reawakened-light-and-raster-arithmetic](../engine/display-input-audio.md#reawakened-light-and-raster-arithmetic).

| # | Field | Type | Meaning |
|---|---|---|---|
| 10 | light UB | short | −1 = none |
| 11 | × (UB+1): layer | int | layer the light belongs to; ignored at runtime, which paints shading layer 0 |
| 12 | type | int | 0 ellipse (3 nodes: centre and two radii points), 1 gradient (2 nodes), 2 gradient clipped to the shape |
| 13 | nodes UB | short | |
| 14 | × (UB+1) node | int x, int y | board pixels |
| 15 | colours UB | short | the editor always writes 1 (two colours) |
| 16 | × (UB+1) colour | short r, g, b | −255..255; colour 0 = edge / gradient start, colour 1 = centre / gradient end |

### Board pixel dimensions

| coordType | width | height |
|---|---|---|
| 2D | `32·sizeX` | `32·sizeY` |
| iso stacked | `64·sizeX − 32` | `16·sizeY − 16` |
| iso rotated | `64·sizeX − 32` | `32·sizeY` |

### Drawing order and effects

* **Layer order:** background colour, then background image, then layer 1 tiles, then layer 1 images, then layer 2, and so on. Within a layer, images draw over tiles; sprites draw on their own layer, z-ordered by y.
* **Animated tiles** cycle at their own frame rate; the first frame stands in for the tile when static.

* **Sprite order (OWNER; R-55):** render by `(layer, projected screen-space y of the sprite reference point, drawId)`. `drawId` is stable, with players before items and each category ordered by index; moving a sprite never changes its key. On isometric boards use projected reference-point y, not raw board y.
* **Under-vector redraw (OWNER; A-8):** flags 1, 2 and 4 mean respectively background, all lower layers and frame-intersection trigger. For each affected row, compute polygon intersections and redraw contiguous covered spans of promoted tile/image content over the sprite, without a new draw command or alpha clip.
* **Isometric tile order (Reawakened rule; proposed, pending owner review):** within one layer, paint tiles in painter order, which is ascending projected tile-centre `(y, x)`. For the stacked layout that is row by row (`y` then `x`). For the rotated layout it is diagonal by diagonal (`x + y` constant, `x` rising), over the whole `(sizeX + sizeY)` square. A tile's 64×32 diamond is placed with its centre on the tile's stored pixel position (`x − 32`, `y − 16` from the table above); an `.iso` tile is copied 1:1 and an ordinary tile is projected with `iso2d`. Shade and tint are read from the stored-grid cell, never from the pixel position. A sprite on an isometric board keeps its position in board pixels (E-11), so its sort key needs no further projection, and a tile-built sprite takes the shade of the tile under each of its cells' centres (the inverse above). Under-vector redraw of promoted *tiles* is defined for ordinary boards only, because overlapping diamonds make "which tile owns this pixel" undefined; background spans (flag 1) apply on every layout.
* **Parallax image** (type 1) scrolls so the image's extent matches the board's extent relative to the screen, `scroll = (imageSize − screenSize) / (boardPixelSize − screenSize)` per axis; an image exactly the board's pixel size is drawn as normal. **Stretch image** (type 2) is scaled to the board's pixel size.
* **"Run once" programs** are not a separate flag: the editor writes a unique GUID name into both `initialVar` and `finalVar`, sets `initialValue = ""` and `finalValue = "_guid"`, and the behaviour falls out of the conditional-activation rule.

### Vectors

Polygons or polylines that give a layer its collision and special areas.

| # | Field | Type | Meaning |
|---|---|---|---|
| 17 | vector UB | short | −1 = none |
| 18 | × (UB+1): points UB | short | a stored vector has at least 2 points |
| 19 | × (UB+1) point | int x, int y | board pixels |
| 20 | attributes | short | for stairs: the target layer. For "under": flags 1 = also covers the board background, 2 = covers all layers below, 4 = draw over sprites that intersect the frame. Otherwise 0. |
| 21 | closed | short | non-zero = closed polygon; 0 = open polyline |
| 22 | layer | short | |
| 23 | type | short | 0 none, 1 **solid** (blocks movement), 2 **under** (sprites inside it are drawn under the layer's tiles), 4 unidirectional (deprecated, not offered by the editor), 8 **stairs** (moves the sprite to layer `attributes`), 16 **waypoint** (a path that items can follow) |
| 24 | handle | string | optional name; scripts refer to waypoint vectors by it |

### Programs (triggers)

| # | Field | Type | Meaning |
|---|---|---|---|
| 25 | program UB | short | −1 = none |
| 26 | × (UB+1): file | string | program in `Prg\`, **or inline RPGCode text** if no such file exists. An empty name keeps its slot (index preserved). |
| 27 | graphic | string | associated graphic; no 3.1.0 editor UI sets it |
| 28 | initialVar | string | condition variable (see Conditional activation) |
| 29 | initialValue | string | |
| 30 | finalVar | string | variable set after the program runs |
| 31 | finalValue | string | |
| 32 | activate | short | 0 always active, 1 conditional |
| 33 | activationType | short | flags: 0 step on, 1 key press (activation key), 2 repeat while inside, 4 stop the player's movement |
| 34 | distanceRepeat | short | pixels the player must move inside the area between repeats |
| 35 | layer | short | |
| 36 | points UB | short | activation polygon |
| 37 | × (UB+1) point | int x, int y | board pixels |
| 38 | closed | short | |
| 39 | (reserved) | string | ignored |

**"Run once"** programs are stored by the editor as `initialVar = finalVar = <a unique hex name>`, `initialValue = ""`, `finalValue = "_guid"`, so the variable is set after the first run and the condition fails afterwards.

### Items placed on the board ("sprites")

| # | Field | Type | Meaning |
|---|---|---|---|
| 40 | item UB | short | −1 = none |
| 41 | × (UB+1): file | string | `.itm` file in `Item\` |
| 42 | prgActivate | string | program run when the player activates the item |
| 43 | prgMultitask | string | program run continuously as a thread while the item is on the board |
| 44 | initialVar, initialValue, finalVar, finalValue | 4 × string | as for programs |
| 45 | loadingVar, loadingValue | 2 × string | the item is placed only if global `loadingVar` equals `loadingValue` |
| 46 | activate | short | 0 always, 1 conditional |
| 47 | activationType | short | 0 step, 1 key press, 2 repeat |
| 48 | x, y, layer | short × 3 | **pixel** position of the item's reference point (bottom-centre of a 2-D sprite), and layer |
| 49 | (reserved) | short | the editor writes −1; ignored |

**R-06 item numbering (OWNER).** The reader preserves every stored item slot, including empty file names, so the raw board model round-trips and retains stable storage indices. Runtime hydration compacts empty item slots into consecutive script-visible item numbers. The pre-vector converter may compact both programs and items as part of its documented upgrade; it must not be confused with the raw reader's preservation.

### Layer images

| # | Field | Type | Meaning |
|---|---|---|---|
| 50 | image UB | short | −1 = none |
| 51 | × (UB+1): file | string | image in `Bitmap\` (any common format) |
| 52 | x, y | int, int | board pixels of the top-left corner |
| 53 | layer | short | |
| 54 | type | short | 0 normal, 1 parallax, 2 stretch. The 3.1.0 editor only writes 0. If the image is exactly the board's pixel size the engine draws it as normal. |
| 55 | transpColor | colour | transparent colour |
| 56 | (reserved) | short | the editor writes 100; ignored |

Width and height come from the image itself.

### Threads, constants and settings

| # | Field | Type | Meaning |
|---|---|---|---|
| 57 | thread UB | short | The editor always writes at least 0 (an empty list is one empty string) |
| 58 | × (UB+1) thread | string | program file in `Prg\` **or inline code**, started as a background script when the board becomes active (empty entries ignored) |
| 59 | constant UB | short | the editor always writes at least 0 |
| 60 | × (UB+1) constant | string | board constants, readable from scripts as `constant[0..10]` |
| 61 | layer titles × (sizeL + 1) | string | index 0..sizeL; index 0 unused; readable as `boardtitle[1..8]` |
| 62 | links × 4 | string | neighbouring board (or a `.prg` to run) for the **N, S, E, W** edges; empty = edge blocks |
| 63 | background image | string | image drawn behind layer 1 |
| 64 | background image type | int | as field 54; the image is created only if the name is non-empty |
| 65 | bkgColor | colour | board background colour |
| 66 | bkgMusic | string | file in `Media\`, played on entry |
| 67 | enterPrg | string | program run every time the board is entered |
| 68 | battleBackground | string | `.bkg` used for battles on this board |
| 69 | battleSkill | short | skill level for random battles |
| 70 | bAllowBattles | short | non-zero = random battles allowed |
| 71 | bDisableSaving | short | non-zero = saving disabled |
| 72 | ambient r, g, b | short × 3 | whole-board tint, −255..255 |
| 73 | startX | short | player start, **pixels**; ≤ 0 → 64 |
| 74 | startY | short | ≤ 0 → 64 |
| 75 | startL | short | start layer; ≤ 0 → 1 |

The file ends after field 75.

### Conditional activation

A conditional program or item runs only when global variable `initialVar` equals `initialValue`; after it runs, `finalVar` is set to `finalValue`. Variable names may still carry the 2.x type sigils `!` (number) and `$` (string); readers of pre-vector boards strip them.

### Animated tiles

When a LUT entry is a `.tan` file, the engine expands it at load time: each frame's tile gets its own LUT slot and the cells show frame 0, then cycle at the animation's rate.

## Older versions

Minor 2 and 3 boards use the older "pre-vector" layout (per-tile collision types instead of vectors, tile coordinates instead of pixels). It and its upgrade rules are in [legacy/older-binary-versions.md](legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector). Toolkit 2 text boards are covered in [legacy/text-formats.md](legacy/text-formats.md#board-toolkit-2-text).

## Example

[../examples/listings/board.brd.txt](../examples/listings/board.brd.txt) is a complete annotated board built by the example generator: two layers, runs in the tile stream, one shading layer, a light, solid, stairs and waypoint vectors, a program, an item, an image, links and settings. [../examples/renders/board.png](../examples/renders/board.png) shows it rendered from the parsed data.
