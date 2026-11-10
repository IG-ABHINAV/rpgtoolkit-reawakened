# Tiles and art sources: flows for beginners

This area owns the first visual and audio materials an author needs: selecting a tile, making a village, importing art, repairing a seam, composing a house, and checking collision. It is deliberately one workspace rather than a collection of file-specific dialogs.

## Jobs

Authors say:

- “Give me a palette so I can make a village without drawing everything.”
- “Paint grass, paths, water and walls without learning which mode is active.”
- “Bring in this PNG sheet, even though its cells have a margin and the first row is offset.”
- “Fix this one tile while I can see the tiles around it.”
- “Make the water solid and let the board inherit that rule.”
- “Make a house once, then stamp it onto several boards.”
- “Make the water move, but keep the animation easy to preview and change.”
- “Move or merge tilesets without silently changing my map.”
- “Let me hear a sound or music loop before I attach it.”
- “Open my old project and do not turn tile number 12 into a different tile.”

The main promise is reducing repeated asset setup, not adding more controls. Authors can **make art** in the editor, import an existing sheet, or open an image in an external editor and bring it back; these are distinct routes. Keep original drawing/editable source available and integrate an external editor when preferred. Do not imply automatic art generation or a native region-animation format.

## Legacy flow and where it hurts

The legacy editor separates the browser, pixel editor, sheet grabber, tileset editor, animated-tile editor and tile-bitmap editor. The following is an honest path through those tools, based on the legacy functional guide.

| Step | What happens | Problem (D = discoverability, S = safety) |
|---|---|---|
| 1 | A new project may copy a default set of boards, character, programs, media, tiles and bitmaps. | The author cannot tell what is useful starter content or where each asset belongs (D). The copy operation and ignored filesystem errors make it unclear whether content was really created (S). |
| 2 | The tileset browser remembers one last set and draws a grid of tiles. It supplies the selected tile to the active board or other editor. | A small utility window is not obviously the main palette. Index labels do not explain what a tile is used for (D). A shared scratch selection means unsaved tile work should be saved before browsing (S). |
| 3 | On a board, the author chooses the tile setting, a separate draw/select/flood/erase tool, and a current layer. An auto-tiler toggle is also separate. | A tool × mode matrix has combinations that do nothing. Auto-tiling is a toggle with no explanation of the tileset's required variant order (D). Wrong layer or wrong tool can produce an apparently successful but invisible edit (S). |
| 4 | New tile opens as a transparent 32×32 canvas. The author chooses pencil, line, ellipse, rectangle, fill, eraser or colour capture from shared panels. | The useful context is absent: a tile is edited alone, and there is little indication of what its neighbours will do at seams (D). |
| 5 | A tile can be made isometric by converting the 32×32 source into a 64×32 diamond. The conversion warns that it is permanent; switching back does not recover the source. | The preview and source are confused. A beginner can destroy the only copy by treating isometric view as a reversible display option (S). |
| 6 | Shade, light source, blur, motion blur, texturise and translucentise are commands or dialogs. Some have a preview checkbox and Cancel. | Effects have inconsistent previews and surprising edge/transparency behaviour. There is only one tile undo snapshot, and redo is not dependable (S). |
| 7 | Image import in the tile editor takes the top-left portion of an image. | It is easy to import the wrong crop and there is no sheet layout workflow (D). Size and padding behaviour are not made clear (S). |
| 8 | The Tile Grabber loads an image, overlays a grid, supports a grid offset, transparent colour, ignore blanks, standard or isometric extraction, and batch insertion into a set. | The grabber is a second mental model and is hidden behind an image menu. “Batch 32”, “ignore edge” and “grid offset” do not describe the result in ordinary language (D). A mistaken batch can append many wrong tiles before the author notices (S). |
| 9 | The tileset editor converts single-tile files, appends or copies tiles, removes duplicates, and provides a two-pane editor for inserting, deleting, moving and reordering. Edits are made on working copies until OK. | Two editor generations and several tabs obscure the common job: curate a palette. Reordering is explicitly dangerous because boards, animations and bitmaps use numeric tile references (S). |
| 10 | Animated tiles store a sequence of tile references and one pause/speed value, selected through the browser. | Animation is a separate document, so the author has to know to create it instead of choosing “animate this tile”. Empty frame slots and a global timing value are not explained (D). A source tile change changes every animation using it (S). |
| 11 | A tile bitmap starts at 1×1, uses the browser to place tiles, and has a draw lock, eraser, resize fields and per-cell ambient shade. | A bitmap is visually close to a stamp but has a different name and editor. Resizing can discard cells, and there is no general undo stack (S). |
| 12 | The bitmap format stores tile references and tints in a rectangular grid; tile references are set filename plus index. | Reordering or deleting a source tile silently changes existing bitmaps and boards (S). The visible index is treated as identity even though it is only position (D). |
| 13 | Audio is selected through folder-aware file fields. A separate music/sound player utility can audition media. | The audition affordance is not beside the picker, so authors attach a file before knowing whether it is right (D). |

## Redesigned flow

### Screen 1: the shared palette and asset browser

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Village › Ground › Paint                         Search assets: [water ] │
├───────────────┬───────────────────────────────────────────────┬──────────┤
│ PALETTE        │ tileset: Starter Top-down ▾  [Import sheet]  │ INSPECTOR│
│ ▣ Town         │ [All][Ground][Walls][Water][Animated][Solid] │ Water 03 │
│ ▣ Starter iso  │ ▦▦ ▦▦ ▦▦ ▦▦ ▦▦                             │ [Edit]   │
│ ▣ My village   │ ▦▦ ▦▦ ▦▦ ▦▦ ▦▦   selected: Water 03          │ [Animate]│
│                 │                                               │ Solid ☑ │
│ ASSET BROWSER   │                                               │ Terrain  │
│ Thumbnails      │                                               │ water ▾  │
│ [tiles][images] │                                               │ Used in 3│
│ [audio][stamps] │                                               │ [Where]  │
└─────────────────┴───────────────────────────────────────────────┴──────────┘
```

- The board, tile bitmap/stamp and animated-tile views all open this same palette. The current editor supplies a contextual filter; a user can clear it and search the whole project.
- Every tile has a thumbnail, human name, set name, stable identity, and badges such as `solid`, `animated`, `iso`, `used in 3 places`, or `missing source`. Search covers names, tags and terrain. A thumbnail can be enlarged on hover and played if animated.
- Dragging a tile paints or places it. Clicking selects it without changing the document. Right-click or the inspector opens properties, pixel edit, animation, “make stamp”, “find uses”, duplicate and export.
- The browser has a visible “Open last palette” shortcut, but last-used state is convenience only. It never overwrites an unsaved document.
- Audio rows have play/stop, loop and volume controls beside the file name. A “Preview audio folder” command opens a simple playlist utility; it is the useful part of the legacy sound-player idea, not a separate required editor.

### Screen 2: paint and edit in context

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Tile: Water 03  [Undo] [Redo] [Save tile]       source 32×32  iso preview│
├─────────────┬───────────────────────────┬────────────────────────────────┤
│ TOOLS       │ 3×3 TILING PREVIEW        │ INSPECTOR                      │
│ Pencil      │ ┌────┬────┬────┐          │ Properties                     │
│ Line        │ │ 01 │ 02 │ 03 │          │ [✓] Solid (default collision)   │
│ Rectangle   │ ├────┼────┼────┤          │ Terrain [water ▾]               │
│ Fill        │ │ 04 │new │ 06 │          │ Autotile [none ▾]               │
│ Eraser      │ ├────┼────┼────┤          │ Animation [none ▾]              │
│ Eyedropper  │ │ 07 │ 08 │ 09 │          │ [Apply adjustment]              │
│ Select/move │ └────┴────┴────┘          │ [Create stamp]                  │
│ Symmetry    │                           │                                │
│             │ source canvas 200%        │                                │
│ Palette     │ checkerboard + pixel grid │ iso projection (live)           │
│ DOS preset  │                           │                                │
└─────────────┴───────────────────────────┴────────────────────────────────┘
```

Interaction rules:

1. Every pixel operation is an `editor-model` command. Dragging pencil strokes groups one stroke into one undo step; fill, transform, import and adjustment each get a named step. Undo/redo follows host history and includes property changes.
2. The 3×3 preview uses the selected tile's neighbours from the active tileset or board. A toggle chooses “tileset neighbours” or “board neighbours”. The centre tile remains editable; seams update live while drawing.
3. A sheet-first pixel workspace lets an author draw and edit multiple adjacent tiles in one shared canvas, with tile boundaries and per-tile selection visible. Cross-boundary strokes remain continuous; applying common transforms to selected tiles is one operation. This reduces repeated opening, copying and setup without automating the artwork.
4. The standard 32×32 source remains authoritative. The isometric diamond is a non-destructive projection. “Create iso source” is an explicit conversion that makes a new tile and keeps the source; an iso-native canvas is available for `.iso` work.
5. Effects are adjustments: choose shade, light, blur, texture or translucency, see before/after and numeric controls, then Apply or Cancel. Apply is one undoable command; merely previewing does not change source pixels. Effects unsupported in the current projection are identified rather than silently disabled.
6. Colour transparency is an explicit swatch or eyedropper selection. Imported alpha stays alpha; a chosen transparent colour is converted only after a preview says how many pixels will change.
7. The canvas shows standard pixels, iso cells, neighbouring tiles and board-scale preview in separately labelled panes. No view toggle destroys source pixels.

### Screen 3: one sheet-import flow

```text
Import art › 1 Source      2 Grid                 3 Review       4 Add to set
[PNG preview]              Cell width [32] height [32]          ┌─┬─┬─┬─┐
File: town.png             Margin X [4] Y [8]                  │✓│✓│ │✓│
                           Gap X [2] Y [2]                     ├─┼─┼─┼─┤
                           [Auto-detect grid]                  │✓│ │✓│✓│
                           [Standard ▾]                        └─┴─┴─┴─┘
                           Columns [derived] Rows [derived]     12 tiles
                           [Back] [Review]
```

Auto-detect proposes cell width/height, margin X/Y, and gap X/Y from repeated edges, then shows guides; columns and rows are derived and may be adjusted. The author can edit each number; no guess is committed without review.
Standard, 16-pixel legacy, and isometric diamond are named choices. Iso review shows the diamond mask and which partial cells will be skipped or padded.
“Skip empty” reports the count and defines empty as fully transparent (or equal to the chosen transparent colour). It never removes a visually meaningful near-empty tile.
The transparent-colour eyedropper supports “none”, alpha, or a selected RGB key. A before/after mask and pixel count prevent accidental background deletion.
Review allows deselecting individual cells, naming the set, assigning tags/terrain, and setting the default collision policy. The next step is job-specific: add tiles to a set, or assign directions/stances for a character sheet. Import creates a draft and can be undone as one operation.
Dragging an image from the OS opens this same flow. A folder-aware picker accepts an outside file and copies it into the project's image/tiles source folder before the import is committed. The original is never modified.

### Screen 4: safe tileset curation

A set opens as a searchable grid with multi-select, drag reorder, duplicate, delete, merge and “move to another set”. A merge preview shows:

```text
Town (42 tiles) + Imported town (18 tiles)
12 exact duplicates will be skipped     6 name collisions will be renamed
Board references: 87     Animation references: 4     Stamp references: 3
[Keep both] [Skip exact duplicates] [Choose per duplicate] [Cancel] [Confirm]
```

- All edits occur in a draft document. Close, Cancel, or switching sets cannot alter the saved source. Confirm creates one command with a summary and an undo entry.
- Exact duplicates compare decoded pixels, transparency and projection; no “looks similar” removal is automatic. The author can choose which stable tile identity to retain.
Reorder changes presentation order only in the proposed native model. Every board, animation and stamp reference follows the stable tile ID. There is no automatic legacy export workflow; whether legacy writing/export will exist is undecided. Imported legacy ordering is retained as provenance and legacy readers remain supported.
- A duplicate operation asks “same tile” (one stable tile, two tags) or “new copy” (a new identity whose pixels may diverge).
- Merge can combine standard sets only, iso sets only, or produce an explicit conversion draft. It must not silently rotate standard tiles into iso tiles.

### Workflow: create a reusable tileset, then build many boards

**Owner requirement:** tilesets remain reusable assets. Sheet-first drawing makes authoring easier; it must not bake the board into a single picture or turn every placement into an independent pixel copy. The following lifecycle is a proposed design.

1. **Assets > New tileset.** Name it, for example **Village Kit**, choose/import a source sheet and confirm the cell grid. A ready project default avoids asking beginners to choose cell dimensions repeatedly; changing scale/projection remains explicit.
2. **Make the vocabulary.** Draw grass, path, wall, roof, water and other pieces on the sheet. Work across cell boundaries while drawing, then select individual cells or multi-cell regions as reusable entries. Growing the sheet adds workspace; it does not renumber existing tile identities.
3. **Organise for use.** Give entries readable names/tags and groups: Ground, Buildings, Water, Decorations. Keep palette order independent of reference identity. Optional collision/terrain metadata is visible and belongs to the tile definition, subject to the open model decision.
4. **Add reusable assemblies.** Select roof sections, a doorway or a tree to make a visual Stamp. A resizable wall/roof brush may have named ends, repeatable middle and corner pieces; this is a proposed authoring tool, not a claim that every arbitrary selection is safely stretchable. Behaviour-bearing groups remain Components, a separate concept.
5. **Make animation once.** Select water frames > Make animated tile; the resulting **Water** entry has a moving thumbnail, source frames and timing. Every board placement refers to that definition instead of duplicating the animation setup. Multi-cell animation channels need the timing contract in flow 10.
6. **Use on any board.** In the palette, choose **Village Kit** and paint its entries or stamps. A board may use more than one compatible set. It records references and placements, not a fresh copy of each tile's pixels. See used-by links back to boards, stamps and animations.
7. **Revise deliberately.** Edit Water once and preview the boards/animations affected; references follow the same definition. **Make unique here** creates a new definition and relinks only the explicitly selected cells/stamp. Palette reordering must not alter existing boards.
8. **Reuse outside this project.** **Export tileset / asset pack** includes editable source artwork, tile definitions, relevant animations/timing, terrain/collision rules when supported, visual stamps and scene props selected for export, and attribution/licence records. **Owner decision (2026-11-09):** new native formats use `.tkr<something>` extensions in **YAML** (such as `.tkrpack` for scene asset/stamp packs and `.tkrtile` for procedural/isometric tile recipes), and these packs are **editor-only** for now (`editor-model` / `editor-ui`). Pasting or baking from a pack emits standard runtime board primitives (layer images, `.tst`/`.iso`/`.tbm` assets, and translated `solid`/`under` vectors) so `@tk-reawakened/core` needs no runtime reader for the pack itself.

**Importing a pack:** show contents, cell size/projection, dependencies, rights information and unsupported metadata before Add. Default recommendation: install a **project-local copy**, with identity mapping so an incoming duplicate does not accidentally replace an unrelated local tile. Offer explicit Reuse existing / Import separately / Review replacement choices. Do not depend on the original download or a path outside the project.

**Library updates are a separate operation.** Local copies do not silently update every game when the original pack changes. If a managed shared library is added, pin a version per project and offer an update diff, affected-reference preview and recovery checkpoint. Deleting a used tile requires replace/relink/cancel review. The transaction and pack schema remain Conditional; do not imply a registry or update service already exists.

#### What the original Super Mario Bros. teaches us

These are historical structure facts, **not** a reconstruction of Nintendo's editor UI:

- NES background graphics use small tiles; a 16×16-pixel area contains 2×2 hardware tiles. NESdev identifies this as the size of a Super Mario Bros. question block, and 32 pixels as the width of a pipe ([attribute reference](https://www.nesdev.org/wiki/PPU_attribute_tables)). The larger reusable block assembled from smaller tiles is commonly called a **metatile**.
- Level reuse went beyond individual squares. NESdev describes Super Mario Bros. object-based level encoding with repeated-size objects, vertical-column templates and repeating backgrounds ([level reference](https://www.nesdev.org/wiki/Level_compression)).
- The transferable idea is a hierarchy of **small artwork pieces → meaningful reusable blocks/assemblies → level placements**. The NES sizes and cartridge compression constraints are not requirements for TKR.
- Whether a placed block is solid, breakable or contains a reward is gameplay data/behaviour, not inferred solely from its pixels. For TKR, keep decorative tiles/stamps distinct from Things with triggers.

#### Reuse walkthroughs and failure checks

| Job | Proposed flow | Design check / remaining dependency |
|---|---|---|
| Make an artist's kit before a level exists | New tileset > draw/import > name entries > preview test board | Tileset authoring is independent of any board; temporary preview is not an unwanted saved level |
| Use the kit in Village and Inn | Select the same kit in each board's palette | Shared definitions, separate placements; stable identity model required |
| Animate every pond | Make Water once, paint it on both boards, change timing once | One definition; phase behaviour is separately specified, not guessed |
| Give the Inn a unique roof colour | Make unique for selected roof entries/stamp, then recolour | Village must remain unchanged; scope preview before relinking |
| Reuse the kit in a new game | Export pack > New project > Add tileset pack > review > paint | Include source/animation dependencies; format and rights validation still open |
| A newer library version changes collision | Explicit update preview, inspect affected boards, keep or apply | No silent gameplay changes; multi-document update/recovery contract required |
| Rearrange the source sheet | Review region mappings; preserve logical tile identity | Moving source pixels cannot silently reinterpret a stable ID's source rectangle |
| Export only a static PNG | Export image with a warning about omitted metadata | A PNG alone does not preserve animation, collision, terrain rules or stamps |


### Screen 5: animated tiles, stamps and auto-tiling

**Animate a tile:** select one or more sheet frames and choose **Make animated tile**; choose the playback speed and preview before creating it. **Animate** opens a timeline docked along the bottom of the workspace, not a separate editor. Duplicate a frame to preserve the original, then edit the duplicate or its pixel delta; onion-skin and tiled-loop previews help inspect changes. A board-context preview shows the animation where it is used. Legacy `.tan` import preserves frame order and global speed; no native region-animation format or legacy export is promised.
**Animate a region:** select a sequence of adjacent frames (for example, a waterfall) and make an animation from that region, keeping the editable sheet source. Synchronized channels may be proposed for coordinated parts; no native region/channel format is established. When channel synchronization is unsupported, keep the frames independently editable and explain the limitation.
**Stamp:** select a rectangular tile region, including per-cell shade, and choose “Save as stamp”. A stamp is a reusable visual brush made of tile references plus arrangement/tint. Placing it writes board references, not new copies of the artwork. It has no game identity, trigger, door or object; linked behaviour groups are Components. Rotate/flip only where supported, with preview.
**Component:** a distinct reusable group of artwork plus board objects/behaviour. Promotion and linked instances depend on native data support and remain a proposal; see `flows/01-board-editor.md`.
A legacy tile bitmap imports as a visual stamp, preserving its tile references and tints. It can be promoted later; it is not silently treated as a component.
**Auto-tiler:** create a rule set in the tileset inspector, choose the terrain(s), and fill a labelled variant template. Rules use the eight neighbours: corner variants count only when both adjacent edges are filled. Painting with the rule set previews all affected cells before commit and re-evaluates neighbours after each paint. Missing variants produce a visible warning and a safe fallback, never an empty tile.
The pixel workspace exposes replace colour, cut corner, skew, translucent overlay/layer tile, greyscale, wrap-scroll, and save into a selected slot. Unsupported host or format operations are marked unavailable rather than silently omitted or emulated. Objects without graphics can use a clearly marked editor placeholder, not exported artwork. A `.gph` file can be imported as a single tile, reviewed and converted into a native tile while retaining source provenance. No `.gph` export or general legacy-write workflow is promised; legacy writing remains undecided.

### Per-tile solid and wall policy (recommendation)

**Recommendation: yes, ship auto-solid in the first beginner flow, but never infer it silently from pixels.** On import or in the tile inspector, an author can mark a tile `Solid`; the starter library marks obvious water, cliffs, trunks and walls. The default is `Walkable` unless the author or licensed starter metadata says otherwise.

The collision contract is:

- A solid tile contributes a tile-aligned wall on its board layer. It is a default, inherited collision, visible as the same hatched wall overlay used by manually drawn walls.
- Explicit wall shapes are additive: the final blocked area is the union of auto-solid tile masks and shape walls. This makes a hand-drawn wall safe to add over a tile without unexpectedly removing another obstacle.
- To make a doorway or hole in a solid tile, the author adds a clearly labelled **Walkable override** at that board cell. The override is local, visible and undoable; it does not edit the tileset for every use. A **Force solid** override is available for special cases. This is safer than making shape order or selection order decide collision.
- In top-down boards, a solid tile uses the tile cell (or its optional per-tile collision shape). In stacked and rotated iso boards, it uses the logical diamond cell, not invalid corner pixels. Shape walls remain board-coordinate geometry and overlay the projected tile mask. Stairs and floor changes remain explicit board objects; a solid floor tile cannot itself create a staircase.
- Collision preview explains the source: `auto-solid`, `shape wall`, `walkable override`, or `force solid`. Selecting a blocked cell opens the responsible tile and wall.

The first version should offer `Walkable`, `Solid`, and optional `Custom shape`; terrain and autotile tags are separate properties. “Solid” must not imply “wall art” or “water”; it is collision only.

## Scenarios walked

### (a) Beginner with no art makes a village using only the starter library

| Step | Flow | Result / coverage |
|---|---|---|
| 1 | New project uses the shared starter catalog and chooses Top-down or Isometric template. | Conditional: board, hero, palette and start depend on the starter pack |
| 2 | Palette opens with Town, Nature, Water, Walls and Stamps filters. | Covered: no file extensions or empty project tree are required |
| 3 | Beginner paints grass with a ghost brush, then path and water. | Covered: contextual tile tools and previews make the result visible before click |
| 4 | Water is tagged Solid and shows collision hatch. | Conditional on the open auto-solid decision and starter metadata |
| 5 | Beginner places the House visual Stamp; a Component may add a door. | Conditional on starter assets and proposed native Component support |
| 6 | Beginner places a hero and NPC using catalog assets. | Conditional on starter content; person details belong to Database |
| 7 | Beginner auditions a door sound and town music, then attaches them. | Covered: audition is next to the picker |
| 8 | Beginner presses Play from here. | Conditional on shared save-first Play contract |
| 9 | **HOLE:** exact starter assets and notices await approval. | Catalog is a recommendation, not a shipping commitment |

### (b) Hobbyist imports a 3rd-party PNG with odd spacing and marks water solid

| Step | Flow | Result / coverage |
|---|---|---|
| 1 | Drag `coast.png` from the OS into the Tilesets area. | Covered: folder-aware import copies it into the project and opens the wizard |
| 2 | Auto-detect proposes 32×32 cells, margin (4,8), gap (2,2). | Covered: guides and editable values make the odd layout explicit |
| 3 | Hobbyist chooses standard grid, picks white as transparent, enables skip-empty. | Covered: before/after mask and count expose the consequence |
| 4 | Review deselects a decorative partial edge cell and imports to `Coast`. | Covered: draft set and one undoable import |
| 5 | Filter `water`, select three tiles, set Terrain = water and Solid = on. | Covered: per-tile metadata; property changes are undoable |
| 6 | **HOLE:** imported-art redistribution rights are unknown. | Editor makes no license or redistribution assumption about imported assets |
| 7 | Paint water and inspect the board wall overlay. | Covered: inherited collision plus source-labelled overlay |

### (c) A tile needs a small seam fix while viewing neighbours

| Step | Flow | Result / coverage |
|---|---|---|
| 1 | On the board, select a tile and choose **Edit pixels in context**. | Covered: opens the sheet-first pixel workspace with board neighbours and current board-scale preview. |
| 2 | Inspect the tile's use count and choose shared edit, duplicate for this use, or cancel. | Covered: scope is explicit before pixels change; shared edits affect all references. |
| 3 | Draw across adjacent tile boundaries; pick a matching neighbour colour. | Covered: common canvas keeps seams visible without repeated tile setup. |
| 4 | Preview the looped tile and iso projection, then undo once. | Covered: projection is non-destructive; stroke is one history command. |
| 5 | Redo, apply a small shade adjustment, save. | Covered: adjustment preview and commit are separate undoable commands. |
| 6 | Scope before editing. | Covered: use count and Edit shared / Duplicate for this use / Cancel make the blast radius explicit. |

### (d) A legacy project is opened

| Step | Flow | Result / coverage |
|---|---|---|
| 1 | Importer scans `Tiles`, boards, animations and bitmaps and builds a reference graph. | Covered in design: references retain original set and index during import |
| 2 | Each tile receives a stable native ID; its `legacyIndex` and source path remain migration metadata. | Covered: index remains evidence, not ongoing identity |
| 3 | Browser displays “legacy tileset — compatibility order” and flags missing references. | Covered: warnings are near the asset and in Problems |
| 4 | Board, `.tan` and `.tbm` references are remapped; bitmap padding cells are preserved. | Covered by tile-format model; **[INFERENCE]** exact migration UI requires design |
| 5 | Author reorders tiles and checks references. | Conditional on native data; no new automatic legacy export workflow is promised |
| 6 | Author asks to export a legacy set. | **HOLE:** legacy write/export is undecided; no automatic workflow is proposed |
| 7 | **HOLE:** scripts or external files may contain undiscoverable raw tile strings. | Report uncertain matches and keep original source/index mapping visible |
## Holes found and fixes

1. **Starter catalog and rights.** The starter catalog is a proposal pending exact sources, permissions and notices. Imported files carry no assumed license or redistribution rights.
2. **Shared-tile edits have a blast radius.** “Used in N places” and “duplicate for this use” must be shown before a shared tile is changed. This is especially important for animated tiles and components.
3. **Auto-solid can over-block a map.** Keep imported tiles Walkable unless metadata is explicitly supplied; show overlays and local overrides. Never use image-recognition guesses as collision truth.
4. **Auto-tiler setup can still be hard.** Start from a labelled template, show a missing-variant warning, and offer a single “paint terrain” mode. Experts can edit the full rule table.
5. **Legacy references can hide outside the known graph.** Preserve source path/index metadata, scan scripts and opaque strings where possible, and show an “unverified reference” warning instead of pretending a reorder is safe.
6. **Iso source and board projection can diverge.** Every iso preview labels whether it is a projection of a standard tile or an iso-native tile, and conversion always creates a recoverable copy.
7. **Stamps and Components are distinct.** Stamp is visual artwork only; Component groups artwork and board objects/behaviour, subject to native-data support.
8. **Audio formats and rights remain unresolved.** Audition does not imply redistribution rights; actual bundled sources, formats and notices need approval.

## Data and native-format implications

### Native tile model

The native project model should be able to represent at least:

```text
Tileset {
  id, name, projection: topDown | iso, tiles: [Tile], autoTileRules[], provenance
}
Tile {
  id, legacyIndex?, name, pixels/assetSource, transparentMode,
  collision: walkable | solid | customShape,
  collisionShape?, terrain?, animationId?, tags[], provenance
}
```

A board tile cell stores `tileId` plus any cell-level tint and an optional collision override. A stamp stores a rectangular list of tile IDs and tints. A component adds a stable source ID, instance ID and referenced board objects. A native animation stores stable tile IDs and timing; an imported legacy animation keeps its original speed and empty frames as migration residue.

The legacy `.tst` and `.iso` formats hold pixel blocks, not stable IDs, collision metadata or terrain rules; `.tan` holds frame references and one speed, and `.tbm` holds tile references and tint, including the documented extra row/column. **Owner decision (2026-11-09):** any new TK Reawakened authoring formats use a `.tkr<something>` extension and are written in **YAML** (for example `.tkrtile` and `.tkrpack`), living in the editor layer (`editor-model` / `editor-ui`) for now rather than the runtime engine. When an author paints or pastes a `.tkrpack` scene asset (a cropped prop, an isometric archway, or a full pre-rendered room backdrop) onto a board, the editor lowers it into the board's existing image, tile, and `solid`/`under` vector records. Legacy bitmap stamps and simple animated tiles remain directly usable. Legacy writing remains undecided; any later lossy export would need an explicit preview.

Legacy index migration must be deterministic: preserve `sourceSet`, `legacyIndex` and the original reference string, then rewrite board/animation/bitmap links to the generated stable ID. Do not use list order as identity after import. If an asset is missing, retain an unresolved reference with a diagnostic instead of substituting tile 1.

The document model follows AD-18/19: warnings/residue, serialisable commands and host-owned save/backup/revert. `editor-ui` may use DOM/canvas for views; the **editor-model** is DOM-free. Filesystem access stays behind platform-services. Draft confirmation and cross-file recovery must be defined before claiming a whole source-to-generated change is one atomic undo/save.

### Starter library and licences

One shared **starter catalog** is the source for project templates and the asset browser. It includes top-down and isometric tiles, hero, two villagers, merchant, enemy look and battle stances, battle backgrounds, UI art, fonts, and audio. Catalog ownership and exact asset selection remain proposals; templates reference this same catalog rather than define separate inventories.

Recommended contents:
- Top-down and isometric tiles, including walkable ground, water, cliffs, walls, roofs, doors, stairs, and a small visual house Stamp.
- People: hero, two villagers, merchant, and enemy look, with minimum directional animation; include enemy battle stances.
- Battle backgrounds, UI art, and fonts sufficient for the Starter village and Battle demo templates.
- Audio catalog: **12 named entries** — UI move, select, confirm, cancel; door, pickup, step, water; battle cue; town, night, and battle music loops. Every row has audition; actual source and notices are not approved.
- Starter project: default board, hero, sample village, door, sign, and example Component only if supported.

These are recommendations, not approved bundled assets. No imported asset is assumed licensed, redistributable, or suitable for shipping. Do not promise bundled files until sources, permissions, exact notices, formats, and G6 checks are approved. FluidR3_GM is permitted as the documented MIT-licensed default SoundFont, with its notice shipped; this does not confer rights on user imports.

Users add assets by drag-and-drop or a folder-aware picker. The picker copies an outside file into the appropriate project folder and preserves subfolders. The asset browser indexes thumbnails for tiles, stamps, images, characters and animations; audio gets waveform/name metadata plus play/stop/loop. Unsupported formats and copy failures are shown at the import cause. Importing makes no license or redistribution claim.

## Challenges to earlier decisions

The earlier decisions are compatible with this design. Auto-solid remains an open owner decision, not resolved by this recommendation. The Stamp/Component distinction follows `flows/01-board-editor.md`: Stamp is visual artwork; Component groups artwork and behaviour and depends on native data support. Native-format order and legacy writing remain undecided; legacy readers remain first-class, with no automatic legacy export workflow.

## Open questions for the owner

1. **Which starter assets ship?** One shared catalog is proposed, including battle backgrounds, UI art, fonts and the enumerated audio list. Exact files, suppliers, permissions and notices remain unresolved.
2. **Should imported tiles default Walkable or ask immediately?** Recommendation: Walkable, with an obvious collision step; no pixel-based collision guessing.
3. **What native data format and write scope will be approved?** Undecided. Legacy write/export is not promised and there is no automatic legacy export workflow.
4. **Should native animations permit per-frame timing?** Recommendation: yes, while imported legacy timing remains recoverable.
5. **How should a Component instance be detached?** Recommendation: “Detach this instance”, preserving a snapshot, if native Components are approved.
6. **Are tile collision shapes needed in the first release?** Recommendation: support Walkable, Solid and a rectangle/diamond custom preset first; arbitrary polygons depend on shared wall tooling.
7. **Which audio formats are guaranteed in every host?** Recommendation: WAV and OGG for shipped assets, subject to host capability; actual choices remain unresolved.

This is research-only UX guidance, not normative implementation authority. Legacy-guide material is UX motivation only; promote behavioural requirements through `docs/spec` or `docs/editor-features.md` before implementation.
## Sources

- `decisions.md` in this research folder: binding beginner/safety direction, starter-library hole, auto-solid open question, components and stable-identity direction.
- Legacy guide, `03-tile-editors.md`, sections “Tile Editor”, “Tile Grabber”, “Tileset Browser”, “Tileset Editor”, “Animated Tile Editor” and “Tile Bitmap Editor”.
- Legacy guide, `01-environment-and-main-file.md`, sections “New Project”, “Project tree” and “Tileset Browser”.
- Legacy guide, `06-animation-and-battle-assets.md`, sections “Animation editor” and frame sound selection.
- `docs/editor-features.md`, T-04/T-05, T-24–T-25, T-36–T-39, T-60–T-64, T-80 and cross-cutting editor behaviours.
- `docs/spec/formats/tiles.md`, sections “Tileset”, “Animated tile”, “Tile bitmap” and “Editing model”.
- `docs/spec/formats/README.md`, sections “Tile references”, “Paths inside files” and “Images”.
- `docs/guardrails.md`, G6 and G7.
- `docs/adr/0004-script-ast-step-ir-and-plugins.md`, accepted host/core boundary principles where asset requests cross hosts.
- `docs/adr/0005-independent-product-v1-and-native-format.md`, especially native format and legacy-import consequences.
- Architecture spine, AD-18 format-model round trips, AD-19 document/undo model and AD-20 platform-services boundary.
