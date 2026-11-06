# Tiles: tilesets, single tiles, animated tiles, tile bitmaps

Tiles are 32×32-pixel images. Boards, animations and tile bitmaps refer to them with [tile references](README.md#tile-references) such as `default.tst12`. Most tiles live in **tilesets** (`.tst`, many tiles in one file). Isometric tiles live in `.iso` tilesets. Older single-tile files (`.gph`) still load. Two container formats build on tiles: **animated tiles** (`.tan`) and **tile bitmaps** (`.tbm`).

## Tileset (`.tst`) and isometric tileset (`.iso`)

Binary, no text header. All tiles in a set have the same size and colour depth.

### Header (6 bytes)

| Offset | Field | Type | Values |
|---|---|---|---|
| 0 | version | unsigned short | 20 for `.tst`, 30 for `.iso`. Other values: the tiles are not decoded. |
| 2 | tileCount | unsigned short | number of tiles *N* (the editor treats it as signed, so at most 32767) |
| 4 | detail | unsigned short | size and depth code, below; `.iso` files always use 150 |

### Tile data

Tile *n* (1-based) starts at byte `6 + (n − 1) × tileBytes`. There is no padding and nothing after the last tile; file size = `6 + N × tileBytes`.

| detail | Tile size | Bytes per pixel | tileBytes | Pixel value | Transparent |
|---|---|---|---|---|---|
| 1 | 32×32 | 3 | 3072 | R, G, B bytes (in that order) | the colour (0, 1, 2) |
| 2 | 16×16 | 3 | 768 | R, G, B; drawn doubled to 32×32 | (0, 1, 2) |
| 3 | 32×32 | 1 | 1024 | index into the 256-colour [DOS palette](#dos-palette) | 255 |
| 4 | 16×16 | 1 | 256 | DOS palette index; doubled | 255 |
| 5 | 32×32 | 1 | 1024 | DOS palette index; only the **first sixteen** entries (0…15) are used — the EGA set | 255 |
| 6 | 16×16 | 1 | 256 | DOS palette index; only the **first sixteen** entries (0…15) are used, and the tile is drawn doubled | 255 |
| 150 | isometric | 3 | 3072 | R, G, B, poured into the diamond (below) | (0, 1, 2) |

**Pixel order is column-major:** x is the outer loop and y the inner loop. The first three bytes are pixel (0,0), the next three are (0,1), and so on down the first column. Reading the data as row-major gives transposed tiles. The 3.x editor only writes detail 1 (and 2 from its 16×16 batch importer) and detail 150.

### Isometric tiles

An `.iso` tile has the same 1024 pixels as a detail-1 tile, but they are drawn into a **64×32 diamond**. The diamond is the set of cells (X, Y), X = 0..63, Y = 0..31, where row Y contains columns `31 − 2k` through `32 + 2k`, with `k = Y` for Y ≤ 15 and `k = 31 − Y` for Y ≥ 16. Row widths are 2, 6, 10 … 62, 62 … 10, 6, 2, which is exactly 1024 cells.

The *i*-th pixel of the tile, in file order, goes into the *i*-th diamond cell when the diamond is scanned **X outer (0..63), Y inner (0..31)**. Cells outside the diamond are transparent. Neither program stores the mask; both regenerate it, so a reader must use exactly this shape.

Ordinary `.tst` tiles placed on isometric boards are instead rotated and squashed into the same 64×32 diamond at draw time.

<a id="reawakened-iso2d-projection"></a>
**Reawakened rule (OWNER; non-parity 2D-on-iso projection).** Project an ordinary 32×32 source tile to the 64×32 diamond with a fixed nearest-neighbour affine map. Use integer floor/round rules beside the compositor formula and make pixels outside the exact diamond mask transparent. The resulting draw command sets `blit.iso2d: true`. This is a Reawakened default, not a legacy-parity claim. **Deferred decision (round 7, Q11):** the owner-relayed answer is that the legacy conversion averages pairs of source pixels and that its opaque diamond is 62 pixels wide; this rule is unchanged for now (entry 4.18 builds on it), and adopting either is a separate owner decision.

### Shading
Board shading and ambient light add a signed (r, g, b) to every non-transparent pixel, clamped to 0..255. **Reawakened rule (OWNER; R-15).** When the blit's full pre-summed tint is non-zero, replace pure white with `(245,245,245)` and pure black with `(10,10,10)` before adding shade and ambient values; clamp exactly once after the complete sum. With zero tint, preserve source white and black exactly. This render-time rule applies to tiles and tile-built sprites.

### Editing model

Tiles are addressed by index, so deleting or reordering tiles in a set changes what every board using `set.tstN` shows. The editor patches tilesets in place (it rewrites the header count and appends or overwrites tile blocks).

## Single tile (`.gph`)

A text file, one value per line (CRLF). The editor writes numbers the VB6 way, with a leading space for non-negative numbers and a trailing space (` 2 `, `-1 `); readers must trim whitespace.

| Line | Content |
|---|---|
| 1 | `RPGTLKIT TILE` (compared case-insensitively) |
| 2 | major (2) — ignored by the engine |
| 3 | minor (0) — ignored |
| 4 | detail: 1, 3 or 5 = 32×32; 2, 4 or 6 = 16×16 |
| 5 | compression: 0 or 1 |
| 6… | **compression 0:** one value per pixel, column-major. **compression 1** (what the editor writes): repeated pairs of lines `count`, `value`, run-length over the same column-major order; runs continue from one column into the next. |

Pixel values: `-1` = transparent; for detail 1 and 2 a colour in COLORREF form (`R + 256·G + 65536·B`); for detail 3 and 5 a DOS palette index. **Compatibility note:** for detail 4 and 6 the original engine uses the value as a COLORREF without a palette lookup, while the editor treats it as a palette index; the editor never writes these details.

**Version 1 tiles** (Toolkit 1, no header line) are described in [legacy/text-formats.md](legacy/text-formats.md#single-tile-version-1-toolkit-1).

## Animated tile (`.tan`)

| # | Field | Type | Meaning |
|---|---|---|---|
| 1 | header | string | `RPGTLKIT TILEANIM` |
| 2 | major, minor | short, short | 2, 0; ignored by the engine |
| 3 | speed | int | the editor's slider value 1..200; the frame delay is `1000 / speed` milliseconds (200 → 5 ms, 1 → 1 s). 0 is invalid (division by zero in the original engine). |
| 4 | frameCount | int | **exact count** (not an upper bound) |
| 5 | × frameCount frame | string | tile reference; may be empty |

The editor writes frames up to and including the last non-empty one, so empty frames in the middle are kept as empty strings.

## Tile bitmap (`.tbm`)

A rectangular picture made of tiles, each with its own tint. Used for multi-tile sprite frames, mouse cursors, battle backgrounds and anything else that wants a large image built from tiles. Tile bitmaps live in `Bitmap\` and can be used wherever an image file is accepted.

| # | Field | Type | Meaning |
|---|---|---|---|
| 1 | header | string | `TK3 TILEBITMAP` |
| 2 | major, minor | short, short | 3, 0; ignored |
| 3 | width | short | in tiles (the editor allows 1..40) |
| 4 | height | short | in tiles |
| 5 | cells × (width + 1) × (height + 1) | | **x outer (0..width), y inner (0..height)** — one more column and one more row than the visible size |
| 5a | tile | string | tile reference, or empty |
| 5b | r, g, b | short × 3 | tint added to the tile |

Only cells 0..width−1 × 0..height−1 are drawn, always as a normal (non-isometric) grid. The extra row and column must still be written and read.

**Reawakened rule (picture composition).** Wherever a tile bitmap is used as one picture — a `bitmap` argument, a board image, a battle background ([battle-data.md](battle-data.md#fight-background-bkg)) — its pixels are the drawn cells laid out as that plain grid: the picture is `width · 32 × height · 32` pixels, the size the conversion writes for the same tile grid ([legacy/conversion.md](legacy/conversion.md)), and cell (x, y) starts at pixel (x · 32, y · 32). A cell's tile is drawn from that corner at its own size — a tileset tile is the 32×32 tile of [tile data](#tile-data) (a 16×16 detail drawn doubled, so it fills its cell), while a 16×16 single tile (`.gph`) fills the top-left quarter of its cell and the rest of the cell stays transparent — and a later cell paints over an earlier one where they meet. Each cell's `r, g, b` is added to every non-transparent pixel of that cell under the [shading](#shading) rule, so a tile bitmap shows the same pixels as its cells do on a board. A picture the engine decodes once and caches — a battle background, for one — shows an animated-tile cell's first frame.

**Reawakened rule (picture shading stages).** A composed picture is then an image like any other, and its stages stay separate: the cell shade is part of the picture's own pixels, so a transparent colour tested by whatever blits the picture is tested **after** that shade, and the blit's own shading and ambient tint (the world stage, [shading](#shading)) come **after** the transparent colour. A cell shade therefore never protects a pixel from its picture's transparent colour, and it never changes the colour a key excludes: a cell whose tile is `(220,30,30)` and whose shade is `(10,0,0)` is `(230,30,30)` when the picture's transparent colour is tested, so a picture keyed on `(230,30,30)` loses that pixel and one keyed on `(220,30,30)` keeps it.

**Reawakened rule (the picture is the unit).** Whatever uses a tile bitmap draws the composed picture, never its cells separately. Composition is what makes a later cell's overlap erase the earlier cell when the picture's transparent colour keys the later cell out, and what clips every tile — a 64×32 isometric tile included — to the picture's `width · 32 × height · 32` bounds. A sprite frame that names a `.tbm` ([animation.md](animation.md)) is no exception: it is one picture blit, keyed and tinted as above. A picture whose cells are all empty is still a picture of its grid size, and every pixel of it is transparent — not missing art and not an error.

## DOS palette

Detail 3-6 tiles and `.gph` detail 3/5 values index a fixed 256-colour palette that both programs hard-code. It resembles the VGA default palette (16 CGA-style colours using 168 as full intensity, then greys and colour ramps), but its values are not exactly the standard ones. The full table is in [dos-palette.json](dos-palette.json) as `[R, G, B]` triples. Only very old tilesets use it; no shipped sample does.

**Palette source of truth — Reawakened rule (OWNER; R-01).** The table in [dos-palette.json](dos-palette.json) is normative: a reader must ship exactly it, rather than build a palette from the public VGA default. Details **5 and 6** use only the first sixteen entries; details 3 and 4 use all 256.

## Reader status

The `.tst`/`.iso` tileset reader and writer exist (`packages/core/src/formats/tileset/`), the tile-bitmap (`.tbm`) reader and writer exist (`packages/core/src/formats/tile-bitmap/`), and the animated-tile (`.tan`) and single-tile (`.gph` v2) readers exist (`packages/core/src/formats/tile-animation/` and `packages/core/src/formats/single-tile/`).
## Examples

- [../examples/listings/village.tst.txt](../examples/listings/village.tst.txt) and [../examples/renders/village_tst.png](../examples/renders/village_tst.png) — a detail-1 tileset drawn for the examples
- [../examples/listings/grass.iso.txt](../examples/listings/grass.iso.txt) and [../examples/renders/grass_iso.png](../examples/renders/grass_iso.png) — one isometric tile poured into the diamond
- [../examples/files/flower.gph](../examples/files/flower.gph) — a run-length single tile
- [../examples/listings/water.tan.txt](../examples/listings/water.tan.txt), [../examples/listings/house.tbm.txt](../examples/listings/house.tbm.txt)
