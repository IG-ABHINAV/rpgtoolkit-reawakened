# Board editor: flows for beginners

## Jobs

Authors do not start with “edit a `.brd`”. They say:

- “Make a village I can walk around.”
- “Put grass down, build a house, add a door, and make the pond block me.”
- “Make an upstairs and a cellar without learning what a layer is.”
- “Put stairs in the right place, and let the player walk behind the upstairs window.”
- “Make an isometric town whose diamonds paint and route correctly.”
- “Make a dungeon room with a locked door, torches, and a chest.”
- “Copy this house to the next street, then change only this one door.”
- “Save where the player starts so Play actually starts here.”
- “Export the board as an image to show a friend.”

The board editor must make the first job one guided path while retaining complete control over tile cells, shapes, triggers, objects, floors, lighting, links, and advanced values.

## Legacy flow and where it hurts

The legacy guide describes one canvas with separate settings (Scroll, Zoom, Tile, Vector, Program, Sprite, Image, Shading, Lighting), a current layer, a tool choice, and separate object panels. The following is an honest author flow, not a recommendation.

| Step | What happens | Problem: D = discoverability / S = safety |
|---|---|---|
| 1 | New Board opens a parameter dialog. The author chooses width, height, layer count, coordinate system, optional pixel coordinates, and background. | **D:** “Layer” and “pixel coordinates” are unexplained. Too many decisions precede seeing a board. |
| 2 | A new board starts with a matrix and several numbered layers. The current layer is usually the first one. | **D:** Numbers do not communicate Ground, Roof, or Upstairs. **S:** Painting the wrong layer can look correct until Play. |
| 3 | The author opens a tileset browser, chooses a tile, selects Tile + Draw, chooses a layer, and paints. | **D:** The tileset browser is a separate shell panel; mode and tool are independent choices. |
| 4 | Draw, Select, Flood, Erase, Rectangle, and Dropper are reused across settings, with some combinations disabled. | **D:** The tool matrix has controls that do nothing for the chosen setting. |
| 5 | Autotiling is enabled by a naming convention on the tileset. | **D/S:** There is no nearby explanation that the filename controls behaviour. |
| 6 | Collision is made by switching to Vector, selecting Draw, choosing a vector type in a right panel, and finishing a polygon with a context-dependent right click. | **D:** “Solid”, “Under”, “Stairs”, and “Waypoint” are technical labels. **S:** A vector can be on a different layer from the player. |
| 7 | Walk-behind uses an Under vector and optional flags for background, lower layers, and frame intersection. | **D:** The visual result is buried in options. **S:** A sprite can visibly pass through a wall or fail to walk behind it without an inline warning. |
| 8 | Stairs use a vector with a numeric destination layer. | **D:** A beginner must know the destination number and there is no paired upstairs/downstairs concept. |
| 9 | Programs use a polygon plus a program file or inline text, activation flags, layer, conditions, and run-once state. | **D:** A door is not a door; it is a program region and a separate sprite. **S:** Run-once and condition edits are easy to miss. |
| 10 | Sprites are placed with Sprite + Draw, then configured in a separate panel. Their reference point is bottom-centre, while images use top-left pixels. | **D:** The two placement conventions are invisible. **S:** A sprite can be visibly offset from where it was clicked. |
| 11 | The player start is a temporary Board command and click, stored in pixels and on the current layer. | **D:** It is easy to forget. **S:** A non-positive legacy start coordinate resolves to the format's default position; it does not mean “unset”. |
| 12 | Board Properties contains links, background, music, threads, dimensions, constants, titles, battles, saving, enter program, and ambient RGB. | **D:** Important settings are separated from the canvas; dimensions are deferred until leaving the page. **S:** Direct property edits can bypass normal undo. |
| 13 | Shading paints RGB offsets per tile; Lighting creates a fixed-node light and can convert it into shading. | **D:** “Shading” and “Lighting” sound like the same operation. **S:** Conversion destroys editable light geometry. |
| 14 | Copy and paste use a process-global board clipboard. Tiles and whole objects copy, but partial vector points and lights do not. | **D:** Scope and unsupported selections are not obvious. **S:** A cut or move can remove the source; the clipboard is not project data. |
| 15 | Resize is entered on Properties and applies when the tab is left, with no crop preview. | **S:** The author can lose tiles at an edge without seeing which cells will be cropped. |
| 16 | Isometric boards have Standard, Stacked, and Rotated coordinate options. Stacked disables some rectangle operations; Rotated has off-diamond cells ignored by fills. | **D:** Diamond geometry, staggered rows, and invalid cells are not taught. **S:** A conversion is one-way and can change tile indices. |
| 17 | World navigation is implicit through edge links in Properties. | **D:** There is no map of boards or visible destination arrows. |
| 18 | Export Image offers current screen or entire board. The distinction between editor overlays and board content is easy to miss. | **D:** Authors may export collision marks or omit sprites/shading unexpectedly. |
| 19 | F5 launches the engine using saved files and does not force a dirty board save. | **S:** “I changed it, why did Play not change?” is a silent failure. |
| 20 | Zoom, scroll, grid, layer visibility, and object visibility are spread across toolbars and shortcuts. | **D:** Camera controls are mixed with content modes. |

## Redesigned flow

### Screen: one board workspace

The workspace shell follows the shared docks: the left dock has **Project**, **Outline**, and **Assets** tabs; the centre is the canvas; **Properties** is on the right. The bottom palette tray is optional and contextual, not a second left palette. Canvas, outline, and inspector share selection; no modal sub-editor is needed for normal work.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Play from here   Save   Undo Redo   Village › Town Square   Problems (2)     │
├──────────────┬──────────────────────────────────────────────┬────────────────┤
│ PROJECT | OUTLINE | ASSETS │                                              │ PROPERTIES     │
│ Floors                       │              board canvas                    │ Nothing        │
│  Ground                      │     tiles + ghost brush + handles            │ Town Square    │
│   Walls                      │     player start and route overlays          │ [Play] [Start] │
│   Walk-behind                │                                              │ Floor: Ground  │
│   Things                     │                  minimap                     │ Tileset [Town] │
│  Upstairs                    │                                              │ Atmosphere ... │
│   ...                        │                                              │ Board Settings │
│  Cellar                      │                                              │ Resize...      │
│ Objects                      │                                              │                │
│  Doors                       │                                              │                │
│  People                      │                                              │                │
│  Stamps                      │                                              │                │
├──────────────┴──────────────────────────────────────────────┴────────────────┤
│ Tiles | Walls | Things | People/items | Stamps | Images | Atmosphere | Camera│
│ x 12 y 8  px 384,256  Ground  zoom 100%  grid: diamonds  snap: tile         │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Outline rules**

- The tree is `Floors` and named floor rows, not “Layer 1/2/3”. A floor row contains `Tiles`, `Walls`, `Walk-behind`, and placed things; this is an authoring grouping, not a claim that the native file has those separate arrays.
- New projects call the first floor **Ground**. New floors offer **Upstairs**, **Cellar**, **Roof**, or a custom title. Advanced users can reveal “technical layer 1” beside the friendly title.
- Every row has the same eye (show/hide), lock, solo, rename, and reorder behaviours. Hiding is visual only and never disables collision or triggers.
- Selecting an outline row selects its content and the corresponding canvas overlay. Selecting a canvas object selects and scrolls to its row.
- `Walls`, `Walk-behind`, and `Things` are meaning-based views. They do not create a second incompatible storage format.

**Inspector rules**

- A selected object gets a fixed section order: **Name, When, Then, Only if, Placement** where relevant. A wall gets **Name, Shape, Placement**; a floor gets **Name, Tiles, Visibility**.
- Empty values are grey placeholders, never the saved value “None”. Pickers show thumbnails, a search field, and “Create new…” where a destination can be made on the fly.
- Every applied change is a named `editor-model` command (for example, “Paint 24 grass cells”, “Move locked door”). Undo/redo and autosave cover canvas, inspector, settings, resize, and reordering.
- Problems appear next to the cause: a trigger on an unreachable floor, a route through a wall, a missing board link, or a start position in an invalid cell gets a canvas marker and a plain-language fix.

### New board and first paint

1. **New board** opens directly into a ready board using the project’s style and starter defaults. There is no decision-heavy New Board dialog. A compact “Board setup” card offers size, floor count, background, and a link to advanced options.
2. Style is chosen once per project with illustrated **Top-down** and **Isometric** choices. Imported boards retain their coordinate system; conversion is explicit, previewed, undoable, and never automatic.
3. The canvas starts with Ground selected, a useful size, the default tileset if available, a visible grid, and an empty-state card: “Paint Ground” and “Add a house.”
4. The left **Assets** tab provides searchable files and the optional bottom palette tray is organised by what the author places: `Tiles`, `Walls`, `Things that happen`, `People and items`, `Stamps`, `Images`, `Atmosphere`, and `Camera`. Selecting a category reveals only applicable tools.
5. A tile or stamp follows the pointer as a ghost. Click paints; drag paints; rectangle/fill/erase/pick live in the contextual bar. A brush remembers its tileset and can be searched by name.
6. A tile’s default collision metadata, if present, is shown as a small shield badge. Effective blocking is the union of tile masks and wall shapes; local per-cell Walkable or Force-solid overrides resolve exceptions without changing shared tile metadata.

### Floors, stairs, and second floors

“Floor” is the beginner word; **layer** remains visible in a tooltip and Advanced section because the native model and runtime are layer-based.

- **Add floor** asks “Where is it?” with cards `Upstairs`, `Cellar`, `Roof`, `Custom`, not a numeric layer. It creates a titled floor, copies no tiles by default, and opens a short explanation: “Things on a higher floor can draw over sprites below when they overlap.”
- The floor row has a `Move up/down` reorder command. Any stairs, triggers, walls, routes, and sprites whose floor changes are shown in a review list before applying.
- **Stairs** is a gallery item. Dropping it creates a stair shape on the current floor, asks for a destination floor, and offers “place the matching landing” on that floor. Both ends are named and linked; changing the destination updates both.
- The canvas draws a translucent floor badge and a dotted vertical connector for selected stairs. The inspector says “Go from Ground to Upstairs”, never “Stairs to layer 2”.
- A player-start marker includes its floor. A warning is immediate if the start floor has no walkable cell or if a door/trigger is on a floor that the player cannot reach.
- A cellar may be ordered below Ground. The design does not infer physical elevation from order; the title and connector communicate it.

### Walls and walk-behind

Walls and walk-behind areas share one shape tool with two author-facing meanings. Both can be made by tile painting or real shapes, and each is assigned to a floor.

**Wall tool:** paint tile-aligned wall cells, rectangle-fill, or draw a polygon. Tile painting contributes collision; erasing inherited solidity requires a local **Walkable override** for that cell. Shape mode permits vertices, with snap-to-tile-corners on by default and a visible “snap to tiles” toggle. Both tile walls and actual vector shapes are supported on assigned layers.
**Walk-behind tool:** paint the region whose floor content should be drawn over a sprite using tile regions, or draw actual vector shapes. Advanced options are collapsed: include background, include all floors below, and use sprite-frame intersection instead of collision-base intersection.
Wall and walk-behind overlays use a pattern plus a floor tint, not colour alone. Off-grid shapes show hatching in tile mode and cannot be accidentally overwritten; “Convert to tile-aligned shape” previews the result.
Walls, walk-behind regions and tiles are assigned to a layer. A wall on a higher floor is not silently treated as a Ground wall. The warning names both layers and offers “Move wall to player layer” or “Keep as designed”.
Auto-solid tiles and explicit Wall shapes both contribute to the blocked-area union. Per-cell Walkable and Force-solid overrides are local and undoable; erasing a painted wall does not erase inherited tile solidity unless a Walkable override is added.

**Boundary intelligence (owner direction, 2026-11-09).** Authors should not trace every wall by hand. **Click floor → wall the rest** (pick the floor tile or tiles; the boundary of that region becomes solid vectors), **flood from the start marker**, a **Walkable / Solid boundary brush** that re-traces affected vectors, **trace from tile roles** (`floor`, `wall`, `wall-cap`), and a **magic wand** on image-first boards. Outer room boundaries are emitted as open polylines and enclosed obstacles as closed polygons, because closed polygons block containment as well as entry (E-26); `wall-cap` cells become under polygons on 2D boards. Every gesture previews its vectors before commit and never replaces hand-drawn vectors unless selected. Algorithm, coordinates for 2D and both isometric layouts, and limits are in [flow 11 §7](11-tile-asset-and-board-architecture.md#7-boundary-intelligence).

### Isometric boards

The style card explains three coordinate presentations with pictures and a one-line promise:

| Presentation | What the author sees | Painting, walls, and routes |
|---|---|---|
| Top-down (standard) | Square cells | Normal tile brush and grid; shapes snap to square corners; routes use cell centres or pixel points. |
| Isometric stacked | 64×32 diamonds in staggered rows | The grid shows staggered diamonds; brush, wall tiles, shapes, and route points snap to visible diamond centres/corners. Rectangle fill is replaced by projected drag when the operation cannot be represented safely. |
| Isometric rotated | Rotated axes with a diamond-shaped valid region | The logical tile/shade stream is a square `(sizeX + sizeY) × (sizeX + sizeY)`, but corner cells outside the board diamond are invalid. They are hatched, never selectable, paintable, fillable, wallable, or routeable. |

Rules that make iso predictable:

- The status bar always reports logical cell `(x, y)`, pixel position, and whether the pointer is on a valid cell. A click on an invalid rotated cell is a no-op with “Outside board diamond” feedback.
- Fill, stamps, copy/paste, walls, walk-behind, and routes skip invalid cells and preview their clipped result before committing. No operation silently writes a corner.
- A route is drawn by clicking valid diamond cells. The route editor previews the actual path and marks a red dot at a solid, wrong-floor, or invalid cell. Pixel waypoints remain available in Advanced mode.
- The camera rotates with the board presentation only; it does not change the board’s logical axes. Movement labels say `north-east`/`south-west` when needed and show a small axis compass.
- Stacked-to-rotated conversion is an explicit command with a before/after split preview, a warning about changed logical indices, and one undo command. The source board remains recoverable through autosave/history.

### Things, doors, routes, and prefabs

The `Things that happen` gallery contains Door, Sign, Chest, Stairs, Pickup, and other trigger-bearing board Things. Chest and Pickup are placements that refer to Item definitions, not item kinds. Dropping a Door creates a sensible activation shape and opens a sentence builder: “When the player **steps on** this, **go to** [Board] at [spot].” Advanced trigger options include repeat while inside, trigger every N pixels, and stop player movement; these are explicit settings, not implied by the sentence.
A locked door adds an `Only if` clause (“only if `cellar_key` is 1”) and a Then branch for the locked response. The visual lock icon is a diagnosis aid, not a separate hidden flag.
A Person is placed in one gesture: choose a look, add a line, choose stand/wander/route, and place. Route points are visible on the canvas and reusable by a script block.
A **Stamp** is a visual brush that paints tile/shading artwork only; it has no game identity, door, trigger or object. A **Component** is the reusable group for artwork together with walls, walk-behind, doors, people, lighting or triggers, with a named source and placed instances. Choose **Edit source** (all instances) or **Detach this instance** (independent copy). Component availability depends on native data support and remains a proposal.
Copy/paste across boards preserves stable object IDs only when the destination is a linked Component; ordinary paste creates new IDs and rewrites internal references. Pasting a door with a destination offers to create or choose the board.

### Board properties split

Nothing selected is a **quick board panel**, not a dumping ground. It contains only high-frequency context: board name, current floor, tileset, visible/locked floor summary, player start (`Set here`), `Play from here`, a compact atmosphere preview, and `Resize…`. It also shows unresolved diagnostics and a link to **Board Settings**.

The dedicated searchable **Board Settings** page owns all durable board metadata and advanced choices, with no duplicate controls:

- **Connections:** north/south/east/west board or program links, with a mini world-view preview.
- **Audio and background:** background image, background colour, music, and image mode where supported.
- **Threads:** programs started when entering the board, with add/remove/open and persistence explanation.
- **Battles:** allowed, board skill, and battle background.
- **Atmosphere:** ambient RGB, shading layer target, and advanced light defaults.
- **Entry:** program run whenever the board is entered.
- **Constants:** named/value list with references and safe rename warnings.
- **Floor names:** titles and ordering, including technical layer numbers in Advanced.
- **Saving and compatibility:** disable saving, imported-format version, and explicit conversion actions.

The settings page uses the same command stack and validation as the canvas. A setting that affects the current preview shows its effect without requiring a tab change.

### Atmosphere mode: shading and lighting

Shading and dynamic lights are one beginner-facing **Atmosphere** mode, not two competing top-level modes. The mode has two tabs: `Paint shade` and `Place light`.

- `Paint shade` uses a soft brush, rectangle, fill, erase, and eyedropper. The inspector shows signed RGB offsets and a neutral reset. The default preview is unchanged until paint is applied.
- `Place light` offers a gentle spotlight, gradient, or clipped gradient with radius/axis handles, colour swatches, and a live preview. “Keep editable” is the default; “Bake into shading” is an explicit destructive-looking action with an undo entry.
- A board-level ambient slider is in the quick panel for preview, but its saved values live in Board Settings. Atmosphere is visibly applied to tiles, images, and sprites according to runtime rules; the legend says which objects are affected.
- Light and shade overlays can be hidden independently. Their handles and tint are never confused with walls or triggers.

### Resize, export, world view, and camera

**Resize** opens an inline sheet, not a delayed field:

```text
Resize board  24 × 18 tiles   →   32 × 24 tiles
Anchor:  [↖] [↑] [↗] [←] [•] [→] [↙] [↓] [↘]
Preview: [old cells] [new cells]  Cropped: 18 cells
                         [Cancel] [Apply resize]
```

The anchor decides which old edge stays fixed. The crop preview highlights discarded cells and lists affected objects, routes, and links. Apply is one undoable command; if an object would be cropped, the author can cancel or move it inward first.

**Export image** offers `Current view` or `Entire board`, PNG/JPEG/BMP where the host supports them, and checkboxes for tiles, images, sprites, shading, and atmosphere. Editor overlays are off by default; a separate “include overlays” option includes a legend. The editor uses the core raster path through `platform-services.export`, so the export matches the game’s draw order.

**World view** lays out boards as labelled frames. Directional links are arrows; missing targets are red; program links are dashed. Click opens a board, double-click an arrow edits its destination, and dragging a frame changes only the world-view layout—not board coordinates. A selected door/edge link highlights the corresponding destination.

**Camera controls** are always available under `Camera`: select, pan, zoom, frame selection, minimap, grid, and overlays. Recommended defaults are Space-drag to pan, wheel to scroll, Ctrl/Cmd-wheel to zoom around the pointer, `F` to frame selection, and `Home` to frame the board. Camera changes do not enter undo history. Touch uses one-finger pan and pinch zoom; keyboard focus remains available.

**Proposed shortcuts** are discoverable and rebindable: `V` select, `B` tiles, `W` walls, `T` Things, `P` people, `A` atmosphere, `Space` pan, `G` grid, normal platform edit shortcuts, `Delete` remove, `Esc` cancel, `Ctrl/Cmd+S` save. Match the shell's recommended contract: **F5 tests the current board; Shift+F5 plays from the game's start**. No hidden global active-board targeting.

## Scenarios walked

### (a) First village: ground, house, door, blocking pond

| Step | Author action | Result | Coverage |
|---|---|---|---|
| 1 | New project, choose Top-down, open the ready board | Ground is selected and the starter tileset is visible | Conditional on the starter library and template |
| 2 | Paint grass with the ghost brush and fill the board | Valid cells fill; undo says “Fill grass” | Covered |
| 3 | Choose a house Component and place it | Tiles, roof, wall shapes, walk-behind, and door instance preview together | Conditional on starter assets and native Component support |
| 4 | Drag the door to the wall opening | Door placement snaps and the trigger sentence opens | Covered |
| 5 | Choose destination `+ New board…` | New board is created; return-door option appears | Covered by earlier decision |
| 6 | Paint pond and mark its water tile solid | The tile badge and effective collision are visible | **HOLE:** auto-solid remains an open owner decision |
| 7 | Paint a bridge exception over the pond | Board per-cell Walkable override removes inherited solidity | Covered by proposed collision contract |
| 8 | Set player start on grass and click Play from here | Saves first, starts on this board and marker | Conditional on shared Play contract |
| 9 | Walk into pond and house door | Pond blocks; door activates; Problems stays clear | Covered |
| 10 | **HOLE:** starter art is absent or unlicensed | Empty palette prevents the “first village” job | **HOLE** |

### (b) Two-floor house: stairs and upstairs walk-behind window

| Step | Author action | Result | Coverage |
|---|---|---|---|
| 1 | Add floor and choose Upstairs | Named floor appears above Ground; technical layer is optional | Covered |
| 2 | Paint upstairs floor and walls | Canvas is tinted with the Upstairs badge | Covered |
| 3 | Drop Stairs at the ground landing | Destination picker offers Upstairs and a matching landing | Covered |
| 4 | Move the upstairs landing | Linked stairs update together or request a review | Covered |
| 5 | Place an upstairs window as a walk-behind shape | Window region previews which tiles draw over the sprite | Covered |
| 6 | Put the player start on Ground | Start marker includes floor and route preview can reach stairs | Covered |
| 7 | Walk upstairs and behind window | Stairs changes floor; higher content overlaps the sprite only where it intersects | Covered by engine spec |
| 8 | **HOLE:** a decorative roof should draw over both floors but not be walkable | Current floor assignment is insufficient for multi-floor canopy semantics | **HOLE** |
| 9 | **HOLE:** destination floor is deleted after stairs are made | Need safe delete/relink flow | **HOLE** |

### (c) Isometric town board

| Step | Author action | Result | Coverage |
|---|---|---|---|
| 1 | New project chooses Isometric and opens a board | Axis compass and diamond grid explain stacked/rotated choice | Covered |
| 2 | Choose Stacked and paint roads | Brush snaps to staggered diamond cells; ghost follows the cell | Covered |
| 3 | Place a house stamp | Stamp clips and previews to diamond cells | Covered |
| 4 | Draw a wall around the plaza | Shape points snap to diamond corners; floor tint identifies it | Covered |
| 5 | Draw a route through the plaza | Route points use valid diamond centres and red dots show blocked cells | Covered |
| 6 | Convert to Rotated | Split preview shows remapped cells; undo remains available | Covered |
| 7 | Click a hatched corner cell | No paint, wall, stamp, fill, or route is created; feedback explains why | Covered |
| 8 | Export entire board | Diamond draw order matches game output and overlays are optional | Covered |
| 9 | **HOLE:** an imported stamp contains pixel-offset objects on rotated cells | Need a deterministic transform/review for objects that are not cell-aligned | **HOLE** |

### (d) Dungeon: locked door, torches, and chest

| Step | Author action | Result | Coverage |
|---|---|---|---|
| 1 | Paint stone and draw a wall polygon | Wall is visible as a pattern and blocks movement on this floor | Covered |
| 2 | Place a locked Door | `Only if` sentence and locked response are visible in inspector | Covered |
| 3 | Add key condition and success action | Condition and Then blocks are ordered and diagnostics validate the variable | Covered by trigger design |
| 4 | Place a Chest | Chest has a ready activation shape; contents/response open in inspector | Covered by gallery design |
| 5 | Open Atmosphere and place torches | Lights show radius/colour handles and live preview | Covered |
| 6 | Paint dark shade in corridors | Shade is per cell and can be erased or undone | Covered |
| 7 | Play from dungeon start | Save-first run uses the selected board and floor | Covered |
| 8 | Walk behind a pillar | Walk-behind region promotes the intended tiles without collision | Covered |
| 9 | **HOLE:** torch light is expected to animate or flicker | Static light model has no authoring control for deterministic animation | **HOLE** |
| 10 | **HOLE:** locked-door variable is renamed elsewhere | Need project reference graph and safe rename across trigger sentences | **HOLE** |

## Holes found and fixes

1. **Starter content hole.** A first village needs art, music, and a hero. Ship only assets that pass G6 (CC0 or Bronze-or-better on the Blue Oak list), list each in `THIRD_PARTY_NOTICES`, and make starter content replaceable. The board editor should still work with an empty project.
2. **Auto-solid ownership hole.** Add tile metadata in the tile editor and show inherited solidity on the board. Require an explicit per-board override when a tile’s meaning differs. Owner decision remains required.
3. **Multi-floor canopy hole.** Add a named `Roof/Canopy` draw group that can cover selected floors while remaining non-colliding. Store it as an ordinary higher-floor image/tile group plus an explicit coverage relation in the native model; import legacy Under flags into that relation.
4. **Floor deletion hole.** Block deletion when stairs, objects, routes, or triggers refer to a floor. Offer relink, move all, or cancel with a review list. Never silently renumber references.
5. **Iso stamp/object hole.** Stamps store logical cell anchors and pixel offsets. On rotated placement, preview every transformed object and flag those that land outside valid cells; apply only after confirmation.
6. **Animated atmosphere hole.** Keep lights deterministic: support a later “flicker profile” as a tick-seeded atmosphere effect, not random per frame. Until specified, a torch can be a static light plus an animation object and the editor labels this limitation.
7. **Variable rename hole.** The project reference graph must index trigger conditions, generated scripts, constants, and hand-written RPGCode where the language server can identify references. Rename shows a diff before applying.
8. **Settings discoverability hole.** The quick panel must visibly say “More board settings…”, and the settings page must use search terms beginners try (“music”, “start”, “battle”, “floor name”) as aliases for technical fields.
9. **Saved Play hole.** Play and Play from here MUST save all dirty documents first, show a blocking save error, and only then start. This honours the decision that embedded unsaved Play is not in scope while removing the legacy stale-file trap.

## Data and native-format implications

- The editor document model needs a board identity, stable IDs for floors and placed objects, friendly floor titles, tile cells, wall and walk-behind geometry, stairs links, routes, triggers, sprites, images, atmosphere, links, settings, and residue for fields not understood by the current UI.
- AD-19 requires one DOM-free document model and serialisable command stack. Commands should include paint/fill/stamp, shape edits, object placement, floor reorder, atmosphere edits, settings edits, resize, copy/paste, and conversion. Selection and camera state remain view state.
- AD-18 requires readers to return models plus warnings and preserve unmodelled residue for unchanged round trips. Legacy `.brd` import should keep its coordinate type, LUT references, tile/shade streams, vectors, programs, items, images, threads, constants, titles, links, music, enter program, battle settings, ambient values, and pixel start fields.
The board spec says tile coordinates are 1-based, object/vector points are board pixels, and rotated boards use an effective square `(sizeX + sizeY) × (sizeX + sizeY)` (`docs/spec/formats/board.md`, “Coordinates”). Invalid corner cells are a consequence of this representation **[INFERENCE]**; the editor treats them as non-writable by proposal, not as a separately specified format rule.
Legacy boards with pixel-coordinate flag 4 retain those coordinates on import and remain editable in pixel units; no automatic tile conversion is implied. Pre-vector boards (minor versions 2–3) must remain importable/editable with their available legacy representation; vector upgrade is explicit and previewed, not silently performed. These paths remain design proposals pending import contract detail.
- Native board data should use stable IDs rather than legacy slot indices. Imported slot/index metadata can be retained for compatibility, but deleting a wall, trigger, or item must not silently change a script reference in the native project. Legacy-write is not promised (ADR 0005); importing and playing legacy boards is first-class.
- The native model must distinguish an editable light from baked shading. The legacy board format stores editable lights but the engine bakes them at load; a conversion command must be explicit and reversible in editor history.
- The renderer claim needs precision:
  1. **Do higher layers draw over sprites on lower layers? Yes, where overlapping.** The engine spec says each layer’s tiles are redrawn over sprites from lower layers before that layer’s sprites are drawn (`docs/spec/engine/main-loop-and-startup.md`, “Drawing a frame”). The movement spec states that higher-layer board content overlapping a sprite frame draws over it (`docs/spec/engine/movement-and-collision.md`, “Collision with the board”, E-30). The display spec independently requires correct compositing for both stacked and rotated isometric layouts (`docs/spec/engine/display-input-audio.md`, E-53).
  2. **Is it every higher-layer object? No.** The board format says the order is background, then each layer’s tiles, then that layer’s images, then sprites on that layer; sprite z-order is by y (`docs/spec/formats/board.md`, “Drawing order and effects”). The claim is about overlapping composited board content, not a blanket overlay of all objects.
  3. **What makes walk-behind different?** An Under region promotes enclosed tiles/images from the sprite’s layer, optionally all lower layers and/or the background, so those graphics draw over the sprite when its collision base (or selected frame) intersects (`docs/spec/engine/movement-and-collision.md`, E-30; `docs/spec/formats/board.md`, “Vectors”). It does not make the region solid. This is why the editor keeps Walls and Walk-behind as separate meanings.
- Export should call the core raster path through `platform-services`; AD-4 makes the core rasteriser the reference for image output. Hosts provide file writing, not their own draw-order interpretation. The editor UI remains host-agnostic under G2 and AD-20.
Board layer images have a dedicated Images entry in the Outline and palette: place or import an image, position it by its **top-left pixel anchor**, choose its layer, and set an optional transparent colour with preview. The legacy format includes image placement and transparency; parallax and stretch modes are exposed only where their runtime support is verified. Unsupported parallax/stretch behaviour is labelled unavailable rather than simulated or promised. Placeholder drawing for objects without graphics is a proposed editing aid. Pixel editor tools (replace colour, cut corner, skew, translucent overlay/layer tile, greyscale, wrap-scroll, save to a selected slot) and `.gph` single-tile import/conversion are reachable through the tile/art flow; unsupported operations are plainly identified.
This is a research-only UX proposal. The legacy guide is UX motivation, not normative implementation authority; promote any behavioural requirement through `docs/spec` or `docs/editor-features.md` before implementation.

## Challenges to earlier decisions

No binding decision is rejected. Two clarifications are necessary:

- “Style chosen once per project” must not erase an imported board’s coordinate system. Imported boards should retain their style until the author explicitly converts them; new boards inherit the project style.
- “Layers named by job” needs a technical escape hatch. Floors are the beginner label, while `layer` remains available in Advanced and in diagnostics so complete editing and native-format inspection remain possible.

## Open questions for the owner

1. **Auto-solid tiles:** Should tileset metadata automatically make pond, trunk, and wall tiles solid? **Recommended default: yes**, with visible inherited badges and an explicit board override for bridges and exceptions.
2. **Native board format trigger:** Which capability justifies a native format first: stable IDs/components, multi-floor coverage relations, or non-destructive atmosphere? **Recommended default: stable IDs plus components**, because prefabs and safe references are needed by the first-village flow.
3. **Floor semantics:** Should a stair destination always create a paired landing and should deleting a floor be blocked until all references are resolved? **Recommended default: paired landing offered by default; deletion blocked with relink/move/cancel review.**
4. **Atmosphere animation:** Are animated/flickering torches required in the first board release? **Recommended default: no; static deterministic lights first, with an explicit later flicker profile.**
5. **Canopy coverage:** Should roofs be allowed to cover multiple floors while remaining non-colliding? **Recommended default: yes, as a named non-colliding coverage group imported from Under semantics.**
6. **Iso conversion compatibility:** Must every stamp and pixel object be transformed automatically during stacked-to-rotated conversion? **Recommended default: transform cell-aligned content automatically, preview and require review for pixel-offset content.**
7. **Starter library:** Who supplies the starter village/dungeon assets and confirms their licence? **Recommended default: ship a small CC0 starter set, list it in `THIRD_PARTY_NOTICES`, and keep import usable without it.**
8. **Board quick panel:** Should ambient preview and player start be directly editable there while all durable metadata stays in Settings? **Recommended default: yes; quick panel edits are command-backed and link to the single source-of-truth Settings fields.**
9. **World-view layout persistence:** Is the world-view frame arrangement project data or a personal view preference? **Recommended default: project data when authored intentionally, with an uncommitted per-user auto-layout until the author saves the arrangement.**

## Sources

- `decisions.md`: owner-selected beginner/full-capability scope and tile/vector direction, alongside proposed Play, floors, world view and unresolved persistence choices. Do not treat every item there as binding.
- `rpgtoolkit/docs/editor-ux-proposals.md`, section 4.3 “Board editor (the flagship)”: modern map-editor direction, outline, direct manipulation, iso preview, stamps, export, and resizing.
- Legacy guide, `02-board-editor.md` sections “Purpose and mental model”, “Coordinate systems, layers, snapping, zoom”, “Vectors and program areas”, “Properties tab”, “Player start location”, “Clipboard and selection”, “Menus and shortcuts”, and “Workflows”.
- `docs/editor-features.md`, section 3 “Board editor (T-20 … T-35)”.
- `docs/spec/formats/board.md`, sections “Coordinates”, “Tile shading”, “Drawing order and effects”, “Vectors”, “Programs (triggers)”, “Threads, constants and settings”.
- `docs/spec/engine/movement-and-collision.md`, E-11, E-12, E-26, E-30, E-40–E-48, E-51.
- `docs/spec/engine/main-loop-and-startup.md`, E-02, E-10, E-12, E-52, and “Drawing a frame”.
- `docs/spec/engine/display-input-audio.md`, E-13, E-17, E-53, and “Ambient light”.
- `docs/guardrails.md`, G2, G5, G6, G7.
- `docs/adr/0004-script-ast-step-ir-and-plugins.md`, unified script lowering and deterministic event infrastructure.
- `docs/adr/0005-independent-product-v1-and-native-format.md`, sections “Decision” and “Open questions”.
- Architecture spine, AD-18 “Format models round-trip”, AD-19 “Documents”, AD-20 “platform-services”, and AD-4 “One reference rasteriser”.
