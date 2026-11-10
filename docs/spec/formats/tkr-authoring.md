# TK Reawakened Authoring Formats (`.tkrscn`, `.tkrtile`, `.tkrpack`)

This specification defines the normative structure of TK Reawakened's native YAML authoring documents ([ADR 0019](../../adr/0019-tkr-authoring-formats.md)).

These files are created and maintained in the authoring workspace (`editor-model` / `editor-ui`) and **compile/lower** deterministically into legacy runtime targets (`.brd`, `.tst`, `.iso`, `.tbm`, `.tan`) so the `@tk-reawakened/core` runtime engine can play them without requiring immediate changes to its runtime format decoders.

---

## 1. Shared Conventions

1. **Format & Encoding:** Valid YAML 1.2 in UTF-8.
2. **Deterministic Serialization:**
   - Keys are serialized in the canonical schema order defined below.
   - Indentation is strictly 2 spaces; tabs are prohibited.
   - YAML anchors (`&`), aliases (`*`), and custom tags (`!`) are prohibited to guarantee straightforward JSON-equivalence and safe parsing.
3. **Identifiers:**
   - `id` values are URL/slug-friendly kebab-case strings (`^[a-z0-9]+(-[a-z0-9]+)*$`) unique within their document scope.
4. **Coordinate Units:**
   - All spatial points, rectangles, and dimensions use exact integers (logical pixels or tile grid steps). Floating-point coordinates are invalid.
   - Coordinate layouts use `2d`, `iso-stacked`, or `iso-rotated` matching [docs/spec/formats/board.md](board.md#coordinates).

---

## 2. Scene Document (`.tkrscn`)

A `.tkrscn` file is the source of truth for one board/scene. It supersedes `.brd` during authoring. When saved, the editor builds the paired `.brd` file (plus auxiliary stamps/tiles if needed).

```yaml
schema: tkr-scn/1.0
id: town-square
name: Town Square
projection: 2d       # 2d | iso-stacked | iso-rotated
grid:
  width: 32          # width in tiles
  height: 24         # height in tiles
  tileWidth: 32      # pixels (e.g. 32 for 2d, 64 for iso)
  tileHeight: 32     # pixels (e.g. 32 for 2d, 32 for iso)

atmosphere:
  ambient: [0, 0, 0] # signed [-255..255] RGB offset
  music: Media/town_theme.ogg
  background:
    image: Bitmap/sky_cloud_backdrop.png
    type: normal     # normal (0) | parallax (1) | stretch (2)
    color: [120, 160, 240]

start:
  floor: ground
  x: 512             # board pixels
  y: 384
  layer: 1

floors:
  - id: ground
    title: Ground Floor
    layer: 1
    tiles:
      format: rle    # run-length encoded LUT references: [[count, "ref"], ...]
      runs:
        - [256, "Tiles/village.tst1"]
        - [16, "Tiles/village.tst4"]
    images:
      - id: fountain-backdrop
        source: Bitmap/fountain.png
        x: 320
        y: 240
        transparent: [255, 0, 255]
    boundarySources: # boundary intelligence metadata
      walkableTiles: ["Tiles/village.tst1"]
      autoWallCaps: true
    vectors:
      - id: north-wall
        label: North Wall Boundary
        type: solid  # solid (1) | under (2) | stairs (8) | waypoint (16)
        closed: false
        points:
          - [0, 64]
          - [1024, 64]
      - id: fountain-canopy
        label: Fountain Arch Overhang
        type: under
        attributes: 7 # bit 1: bg, bit 2: lower layers, bit 4: frame intersect
        closed: true
        points:
          - [320, 200]
          - [384, 200]
          - [384, 240]
          - [320, 240]

things:
  - id: chest-village-gold
    kind: chest
    placement: { floor: ground, x: 256, y: 192 }
    fromAsset: medieval-iso-kit:wooden-chest # provenance reference
    contents:
      item: gold
      quantity: 50
    condition: { variable: "chest_opened", value: "0" }
    onOpen:
      setVariable: { variable: "chest_opened", value: "1" }

placedPacks:
  - instanceId: archway-1
    assetId: medieval-iso-kit:stone-archway
    floor: ground
    x: 480
    y: 288
```

---

## 3. Tile Recipe Document (`.tkrtile`)

A `.tkrtile` manages a cohesive tileset palette, including source sheets, non-destructive transformations, procedural 3-plane isometric blocks, and autotile transition sets.

```yaml
schema: tkr-tile/1.0
id: village-tileset
name: Village Master Tileset
projection: 2d       # 2d | iso-stacked | iso-rotated
cellSize: [32, 32]

sources:
  - id: village-sheet
    file: Bitmap/village_tiles_source.png
    grid:
      width: 32
      height: 32
      marginX: 0
      marginY: 0
      gapX: 0
      gapY: 0
    transparent: { mode: alpha } # alpha | colorKey: [r, g, b]

tiles:
  - id: grass-main
    name: Meadow Grass
    source: village-sheet
    cell: [0, 0]
    role: floor      # floor | wall | wall-cap | decorative
    collision: walkable

  - id: stone-wall-base
    name: Rough Stone Wall
    source: village-sheet
    cell: [1, 0]
    role: wall
    collision: solid

  - id: wood-counter-diagonal
    name: Angled Counter Corner
    source: village-sheet
    cell: [2, 0]
    kitbash:
      - op: cutCorner
        diagonal: north-west
        clearHalf: true

# 3-Plane Isometric Block & Wall Synthesizer (Pikuma 2:1 dimetric projection)
isoBlocks:
  - id: stone-cube
    name: Stone Isometric Cube
    heightPixels: 32
    faces:
      top:   { source: village-sheet, cell: [3, 0], tint: [0, 0, 0] }
      left:  { source: village-sheet, cell: [4, 0], tint: [-24, -24, -24] }
      right: { source: village-sheet, cell: [4, 0], tint: [-56, -56, -56] }
    collision: solid
    wallCapUnder: true

# Procedural Tilesetter-style 8-neighbour autotiling
autotiles:
  - id: water-edge
    name: Water Coast Autotile
    mode: blob-47
    base:   { source: village-sheet, cell: [5, 0] }
    border: { source: village-sheet, cell: [6, 0] }
    innerCorner: { source: village-sheet, cell: [7, 0] }
    exportOrder: t25-canonical

outputBinding:
  target: Tiles/village_auto.tst
  detail: 1
```

---

## 4. Scene Asset & Stamp Pack Document (`.tkrpack`)

A `.tkrpack` groups reusable art assets (props, architectural stamps, whole-room pre-rendered backdrops) along with their ground anchors, collision footprints, and walk-behind overhangs.

```yaml
schema: tkr-pack/1.0
id: medieval-iso-kit
name: Medieval Isometric Props & Architecture
projection: iso-rotated
grid:
  tileWidth: 64
  tileHeight: 32

sources:
  props-atlas:
    file: Bitmap/medieval_props.png
    transparent: { mode: alpha }

assets:
  - id: stone-archway
    name: Stone Archway
    category: Architecture
    kind: stamp      # stamp | prop | backdrop
    anchor:
      x: 64
      y: 96
      snap: iso-diamond-center
    visuals:
      - source: props-atlas
        rect: [0, 0, 128, 112] # [x, y, w, h]
        layerOffset: 0
    vectors:
      - label: Left Pillar
        type: solid
        closed: true
        points:
          - [-48, -8]
          - [-32, 0]
          - [-16, -8]
          - [-32, -16]
      - label: Right Pillar
        type: solid
        closed: true
        points:
          - [16, 8]
          - [32, 16]
          - [48, 8]
          - [32, 0]
      - label: Walk-Under Lintel
        type: under
        attributes: 7 # covers background + lower layers + frame intersection
        closed: true
        points:
          - [-48, -80]
          - [48, -32]
          - [48, -16]
          - [-48, -64]

  - id: wooden-chest
    name: Wooden Chest
    category: Furniture
    kind: prop
    anchor:
      x: 16
      y: 28
      snap: bottom-center
    visuals:
      - source: props-atlas
        rect: [128, 0, 32, 32]
    vectors:
      - label: Chest Footprint
        type: solid
        closed: true
        points:
          - [-14, -10]
          - [14, -10]
          - [14, 0]
          - [-14, 0]
```

---

## 5. Lowering / Build Contract

When the editor saves a `.tkrscn` or builds for test-running:
1. **Tiles & LUT Generation:** Referenced tiles and generated autotile variants compile into local `.tst` / `.iso` files or into the `.brd` tile LUT ([docs/spec/formats/board.md](board.md#dimensions-and-tiles)).
2. **Placed Pack Expansion (`PlaceSceneAsset`):**
   - Each placed stamp or prop in `placedPacks` expands its `visuals` into either `WorldImage` entries in the board's image array or `WorldTile` cells on the corresponding layer.
   - Its relative `vectors` are translated by `(x, y)` and inserted into the board's vector array.
3. **Boundary Synthesis:** If `boundarySources` is active, the contour tracer executes and emits simplified `WorldVector` solid polylines (open outer loops, closed obstacle holes) and under polygons.
4. **Target Persistence:** The compiled output is saved as a legacy binary `.brd` (minor 4 vector layout) that runtime runners read without modification.
