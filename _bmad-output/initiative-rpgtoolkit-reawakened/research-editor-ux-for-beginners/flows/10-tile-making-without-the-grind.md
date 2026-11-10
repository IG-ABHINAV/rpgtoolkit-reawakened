# Tile-making without the grind

**Owner feedback:** “I still seeing making tiles possibly tedious ... animated tiles even more so ... the old editor was garbage.” This changes the emphasis: importing existing art is not enough. **Making and changing art must also be a short, coherent workflow.** This is proposed UX research, not an implemented editor or an approved data format.

## The job, not the file

“I want a roof,” “I want this grass to join up,” “I want the water to move,” and “I want a waterfall” are the jobs. Making a tile file, making a tile animation file, connecting frames, and painting tiles are storage steps the editor should do for the author.

The legacy inventory describes a single-tile pixel editor, a separate grabber, tileset management, a separate animated-tile editor and a tile-bitmap composition editor (T-36–T-39, T-62). That is too many hand-offs for an author making one visual thing. The proposal unifies their interactions without discarding their capabilities.

## Three entry points, one workspace

| What the author has | Entry | Next useful action |
|---|---|---|
| Nothing yet | Assets > New artwork > Tile sheet | Draw at a comfortable scale across a visible cell grid |
| A PNG or other supported source | Drop into Assets > Use as tiles | Confirm the shared grid preview; draw or select regions immediately |
| A board already under construction | Double-click a painted tile > Edit artwork | Edit it surrounded by neighbouring board cells, then return to painting |

Source artwork remains reachable. “Edit externally” opens the source where the host supports it; otherwise download source and reimport. External changes show a before/after review rather than overwriting dirty in-editor art. A source import does not grant permission to redistribute its artwork.

**Reusable tilesets remain first-class.** This sheet is an artwork source for named tile definitions, not a flattened painting of a board. Boards reference those definitions; visual Stamps arrange them, and animated entries reference frames/timing once. Author a kit before a board exists, reuse it on many boards, and explicitly export/import it into another project. The complete [tileset lifecycle and pack workflow](03-tiles-and-art-sources.md#workflow-create-a-reusable-tileset-then-build-many-boards) covers shared edits, unique copies and versioned updates.

## Screen: sheet-first, with an optional timeline

```text
Artwork / Village sheet                         Undo  Redo   Scope: Shared tile
┌────────────────────┬──────────────────────────────────────┬──────────────────┐
│ Project / Assets   │ Pencil  Erase  Fill  Select  Pick      │ Properties       │
│                    │                                      │ Selection        │
│ Village sheet      │   draw the WHOLE roof across cells   │ 4 × 3 cells      │
│ Water loop         │   ┌────┬────┬────┬────┐               │ [Make brush]     │
│                    │   │    roof artwork   │               │ [Animate]        │
│                    │   ├────┼────┼────┼────┤               │ Collision…       │
│                    │   │    roof artwork   │               │ Used in 8 boards │
│                    │   └────┴────┴────┴────┘               │ [Make unique]    │
│                    │                                      │                  │
│                    │ Context: Village / 1:1 / Tiled 3×3    │ Colour / Palette │
├────────────────────┴──────────────────────────────────────┴──────────────────┤
│ Timeline (only when animating)  [1] [2] [3] [4]    + Duplicate   Play   Speed  │
│ Loop preview on board  /  onion skin  /  compare first and last              │
└─────────────────────────────────────────────────────────────────────────────┘
```

The grid divides storage, not the artist's stroke. A continuous stroke, fill or selection may cross multiple cells of the source sheet. Filling across cells has an explicit “Selection / Cell / Connected artwork” scope so adjacent art is not accidentally flooded.

## Flow A: draw a house without opening twenty tile editors

1. Create a sheet, or choose a free region of an existing one. Choose cell size once; show its relationship to the board grid.
2. Drag a 4×3-cell selection and choose **Draw in this region**. The view zooms to the region, with the rest dimmed. A selection boundary prevents accidental edits outside it.
3. Draw roof and walls across cell boundaries. Mirror a selected roof half; duplicate window pixels; choose colours from the project palette. Every stroke or transform is undoable.
4. Choose **Make brush**. Paint the whole arrangement on a board, with a ghost preview and a visible anchor. This makes an artwork **Stamp**, not a behaviour-bearing Component.
5. Add a door, collision and walk-behind on the board; **Save as Component** only when linked, reusable behaviour is wanted. A Stamp must not secretly acquire scripts.

No individual tile names, per-tile saves or intermediate bitmap setup are required. Tile identity must remain stable when the sheet arrangement changes; the persistence decision is a dependency, not already solved.

**Tradeoff:** this removes repetitive editor setup, not the creative work of drawing an attractive house. Starter artwork, templates and external tools are alternate paths, not substitutes for a complete pixel editor.

## Flow B: fix a seam where it actually occurs

1. On the board, select the bad join > **Edit artwork in context**.
2. The selected source cell is editable; real neighbours remain visible and locked. A second **Repeat 3×3** view reveals whether the tile repeats cleanly beyond this particular board arrangement.
3. The scope strip says **Shared tile — used in 8 boards**. Editing shared art is the default only after the author understands that scope; **Make unique here** duplicates the relevant source reference before changes.
4. Paint across a wrapped edge using an explicit **Wrap drawing** tool. Crossing the right edge continues on the left of the same source tile. It does not change neighbour tiles unless a multi-cell source region is selected.
5. Preview changed instances in their board context, then return to board editing. Do not ask for a new filename after every small fix.

**Failure avoided:** casually repainting one doorstep must not silently change every doorstep in the game. A unique copy preserves the other boards.

## Flow C: animate water from existing frames

1. Select four frame regions on a source sheet (a drag sequence or a grid strip).
2. Choose **Make animated tile**. Preview the inferred frame order and shared grid. Guesses are never silently accepted.
3. Scrub the frames or play the loop. Adjust **Speed** with a live preview; expose frames/second alongside the plain control, and show duration for the whole loop.
4. Name it **Water** once. It appears as a moving thumbnail in the palette; paint with it immediately.

The editor creates and maintains frame references. The author does not make four separate animation assets, type frame names or copy files into folders manually.

Legacy animated tiles (`.tan`) reference tiles with one frames-per-second value (`docs/spec/formats/tiles.md`). A simple uniform-speed loop fits that model. Do not confuse this with `.anm` sprite animation, whose legacy field is one frame delay; reuse the **timeline interaction**, not assume identical storage.

## Flow D: draw the animation yourself

1. Select a tile or multi-cell region > **Animate**. The timeline opens below the same artwork canvas, initially with one frame.
2. **Duplicate frame**. The new frame starts identical; alter only the ripple, flame tip or other pixels that move.
3. Onion skin shows the previous/next frame. A locked background/reference layer prevents repainting unchanged parts, where the authoring model supports layers.
4. Duplicate again, or select frames and reverse their order for a back-and-forth loop. Copy, paste, insert and delete use the same shortcuts as other selections.
5. Inspect **First ↔ Last** to catch a visible jump. Preview in the board or as repeating water while drawing. Playback never adds undo entries.
6. Paint the animated tile with the same brush used for static tiles. Speed and frame edits update its instances, with the same shared-scope warning as other art.

**Useful helpers, not magic art:** offset selected pixels by one pixel with wrapping; shift a colour ramp through a selected palette range; mirror/rotate the selection; copy a frame range. Each helper previews its changes and produces editable frames. None promises to infer water motion from an arbitrary picture.

## Flow E: one waterfall, not twelve unsynchronised animated tiles

1. Select the whole waterfall region (for example 2×3 cells) and choose **Animate region**.
2. Each timeline frame is the full 2×3-cell artwork. Drawing and selections cross cells normally.
3. Paint/place that region as one animated Stamp with a clear anchor; partial placement and erasing must explicitly show whether the action removes one cell or the whole stamp.
4. Individual painted cells refer to channels within one region animation and share one clock/phase. They do not run separate independent loops by accident.
5. In an **Advanced > Timing** section, choose **Synchronised across placements** or **Independent placements**. Defaults are explicit; editing data does not reset the game clock unpredictably.

**Dependency:** the legacy per-tile frame lists may express some uniform-speed synchronised results, but an editable source-region relationship and independent placement phases are extra authoring/runtime contracts. Verify `.tan` timing against the deterministic animation model before promising either export or phase control. This is **Conditional**, not a reason to make beginners hand-maintain twelve animations.

## Flow F: an autotile without memorising a variant sheet

1. Pick the semantic operation **Paint terrain** for grass, water or path. The palette shows the terrain name rather than fifty nearly identical corners.
2. For authors making terrain art, a **Terrain setup** workspace offers a **Tilesetter-style procedural generator**: supply a **Base fill** and an **Edge/border** (plus an optional **Cliff face** for elevated isometric terrain), and the editor deterministically synthesises the 47 eight-neighbour blob variants and previews each role in a live sandbox board right beside the controls.
3. Dynamic source linking keeps the generated variants connected to the source cells in the editor's `.tkrtile` YAML recipe: tweaking the base grass hue or edge pixels regenerates all 47 tiles immediately. Authors can also drag custom cells onto individual roles or paint non-destructive delta overrides on specific corners.
4. **Copy or mirror suggested edge** and **kitbash helpers** (layering a prop onto a base tile, cutting diagonal corners, palette-ramp swaps) preview the actual pixels before commit.
5. Preserve imported variant ordering for compatibility; the display grouping is not the stored index order.

Legacy T-25 describes eight-neighbour blob rules and a fixed variant order. A user-drawn sheet cannot be identified as a correct rule set merely because it contains a particular number of cells.

## Flow G: taking command of the isometric tile world (3-plane projection & tall-iso decomposition)

1. **Draw flat (orthographic) → project to isometric live:** An author can draw or kitbash a $32\times 32$ square texture with straight horizontal/vertical lines while seeing the live $64\times 32$ 2:1 dimetric diamond projection (`isoSourceOffset`) and a $3\times 3$ isometric board preview update in real time. An optional isometric polish layer stores pixel overrides on top of the projected diamond without destroying the flat source.
2. **3-Plane Isometric Block & Wall Builder (Pikuma 2:1 projection):** To build walls, cubes, pillars or raised cliffs without hand-pixeling diagonal 2:1 staircases, the author assigns flat $32\times 32$ textures to the **Top**, **Left (SW)** and **Right (SE)** faces of an isometric block, picks a block height and deterministic per-face shading (for example Top `0`, Left `-24`, Right `-56` under R-15 tint rules), and previews the composite 3D isometric block immediately.
3. **Tall-Iso Diamond Decomposer:** Because legacy `.iso` tilesets only hold $64\times 32$ diamonds, any tall isometric block ($64\times 64$, $64\times 96$, or an imported isometric building/tree sheet) can be automatically sliced across the staggered $64\times 32$ diamond lattice into `.iso` tile slots plus a ready-to-paint multi-tile stamp or `.tkrpack` scene asset (complete with its ground anchor, `solid` base diamond and `under` occlusion polygon).
4. **Direct Scene Images & `.tkrpack` YAML Stamp Packs (Editor-only):** When slicing into $64\times 32$ diamonds is unnecessary (such as pre-rendered isometric rooms, large bridges or irregular props), the author lasso/crops the PNG in the **Asset & Tileset Viewer**, marks its ground anchor, `solid` footprint and `under` walk-behind mask once, and saves it to a `.tkrpack` YAML file. Pasting from the Asset Viewer into a board emits standard board layer images and translated `solid`/`under` vectors directly—requiring zero runtime engine changes.

## Adversarial walkthrough results

| Scenario | Where a naive modernisation still fails | Proposed fix | Status |
|---|---|---|---|
| New roof | One canvas per tile still fragments drawing | Sheet-first, multi-cell drawing and brush creation | Designed |
| Shared doorstep | In-context edit changes all houses unexpectedly | Scope strip, references and Make unique here | Conditional on references/IDs |
| Water sheet | Import order puts frame 4 before frame 2 | Visible ordered frame strip before commit | Designed |
| New water art | User redraws static pixels for every frame | Duplicate frame, onion skin, locked references | Designed; layered source persistence open |
| Waterfall | Adjacent cells animate with different phases | One region animation with channel mapping | Conditional on timing/data contract |
| Odd-sized source | “Auto detect” guesses a wrong grid | Shared grid preview and manual cell/margin/gap control | Designed |
| New terrain | Fifty blank variant boxes are still a chore | Role previews, reuse transforms, test arrangements | Designed; still requires art |
| Imported legacy animation | Changing a speed slider silently changes saved timing semantics | Show exact imported timing and proposed conversion preview | Designed; format decision open |
| Editor crash | Multi-cell source file and references recover to different versions | Recovery checkpoint of related documents, no partial generation | Conditional on multi-document transaction |
| External art changed | Reload overwrites unsaved pixels | Before/after/conflict choice; preserve both versions | Designed |

## What the editor should do automatically

- Maintain the relation between source sheet, static tiles, animation frames and board references.
- Provide meaningful default names from the selection; ask once when an asset needs a public name, not for every generated fragment.
- Keep generated fragments grouped and reveal **Source / Generated / Used by** from a single selected asset. Never infer ownership from filenames alone.
- Avoid one asset file per intermediate step when the chosen format can represent one source and references.
- Offer **Make brush**, **Animate**, **Make unique here** and **Edit source** directly from the relevant selection; all reachable by keyboard and discoverable by menus as well as shortcuts.
- Preview before destructive changes, maintain undo and recover source plus generated data together.

## What still needs proof

1. A beginner can draw across a source grid without confusing it with the map grid. Test the names **Artwork** and **Board** with first-time users.
2. A 4-frame water loop actually takes fewer deliberate setup actions than the old separate-editor chain. The target is the four steps in Flow C; measure real completion and mistakes, not just button counts.
3. Region timing is compatible with core replay/save/restore. No animation timer belongs in unsaveable gameplay state.
4. Source image layers, frame regions and stable tile IDs have a chosen persistence model; the UI must not silently bake away editable source.
5. Editing one source used by many boards is understandable before applying the change. A warning after the repaint is too late.

## Relationship to the other studies

- [Tiles and art sources](03-tiles-and-art-sources.md): canonical asset catalog, collision metadata, import grid and palette.
- [Animation and looks](05-animation-and-looks.md): shared timeline gestures, transparency, directional assignment and preview.
- [Board editor](01-board-editor.md): layer-aware grid/vector tools and placement.
- [Project shell](07-project-shell-and-sharing.md): recovery, external changes, source ownership and host differences.

## Sources

- `docs/editor-features.md`: T-25, T-36–T-39, T-52, T-60–T-62.
- `docs/spec/formats/tiles.md`, `animation.md`; architecture AD-19 (documents/recovery), AD-29 (shared board composition); guardrails G3/G4.
- Jensen's feedback quoted above; earlier art-import walkthroughs are design inputs, not observed usability results.
