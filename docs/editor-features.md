# RPG Toolkit 3 — Authoring Toolset: Feature Inventory

> **Purpose.** This describes what the legacy editor (RPG Toolkit 3.1.0's "Toolkit" application) let authors do, in **feature terms**, so a rebuild can offer equivalent workflows. It describes no code and assumes no UI technology. The files each tool produces are in [spec/formats/](spec/formats/README.md). The runtime behaviour they configure is in [spec/engine/](spec/engine/).
>
> IDs (**T-xx**) are referenced by [architecture-options.md](architecture-options.md).

---

## 1. Workspace & project management (T-01 … T-09)

**T-01 Multi-document workspace.** One window holds many editors as tabs. Several files of the same type can be open at once. Only one **project** (game) is open at a time. The title bar shows the editor type, file and project.

**T-02 Docked side panels.**
* **Left:** tools for the active editor.
* **Right:** project file tree, a "new editor" launcher, a **tileset browser** that lists the tiles of the last-opened tileset and feeds the active editor (or opens a tile editor when nothing else is active), and, when the board editor is active, the **board object inspector**.
* The panels can be shown, hidden and resized.

**T-03 Project file tree.** Lists everything under the project folder. Double-click opens a file in the right editor, or in the OS default application for non-Toolkit files. Context menu: open, rename, delete, refresh, collapse all, and "select into board editor" (load an animated tile as the board brush).

**T-04 New project wizard.** Name the game. Create the main file and the standard folder tree. Optionally copy a starter kit (default tiles, character, start/system programs, menu and battle plugins, music pack).

**T-05 Reserved folders & relative paths.** Each asset type has a folder ([paths inside files](spec/formats/README.md#paths-inside-files)). Pickers save links relative to that folder, including subfolders. Choosing a file from **outside** the project copies it into the right folder automatically.

**T-06 Save / save as / save all / close.** Unsaved-change tracking per editor.

**T-07 Test run.** Launch the current game in the engine from any editor. Programs can be test-run on their own (T-41).

**T-08 Preferences.** Editor background image, splash screen and tip-of-the-day toggles, UI language (only English shipped), syntax colours, board-editor colours and behaviour.

**T-09 Onboarding & help.** Tip of the day, a 9-step tutorial, the HTML user manual, an RPGCode quick reference, and a "what's new" page.

---

## 2. Main file (game settings) editor (T-10 … T-14)

**T-10 Project settings.** Game title, project folder, joystick on/off, cursor move/select/cancel sounds, keyboard and/or mouse movement, diagonal movement, and **per-direction key bindings** for all 8 directions (captured as physical keys).

**T-11 Startup.** Initial board, initial character, start program, game-over program, run-time program and its key, **extended run-time keys** (a table of up to 50 key → program pairs), menu key, activation key, movement style (tile or pixel, plus pixel-push), game-speed slider (−4…+4), mouse cursor (default, none, or custom image or tile with hot spot and transparent colour), and default pathfinding heuristic (axial, diagonal, vector).

**T-12 Fighting.** Enable or disable battles globally. The random-encounter **enemy pool** (enemy file + skill level per row). Encounter type (random 1-in-N, or planned every N steps). Optional custom battle program instead of the built-in system.

**T-13 Graphics.** Colour depth, windowed or full-screen, resolution (presets or custom), FPS in title bar, debug drawing of board vectors, sprite vectors, the player's path and destination (with colours).

**T-14 Plugins.** Add or remove extension plugins (with a description shown on add). Choose the menu plugin and the battle plugin.

---

## 3. Board editor (T-20 … T-35)

The most important tool. A board is edited on a zoomable, scrollable canvas, with an object inspector and a properties page.

**T-20 New board dialog.** Start blank or from an existing board as a template. Choose the coordinate system (2D, iso stacked, iso rotated, with or without pixel coordinates). Set width and height in tiles (pixel size shown), layer count and background image. Remembers last settings and can be skipped.

**T-21 Canvas navigation.** Scroll tool, mouse-wheel scrolling (middle click toggles axis), a zoom tool, Ctrl+wheel zoom (fixed zoom steps), grid toggle.

**T-22 Layer control.** A current-layer selector. A visible-layers list (B = background image). "Show only current" and "show all" shortcuts. The current layer cannot be hidden.

**T-23 Object modes.** One mode is active at a time, with keyboard shortcuts: **Tiles, Vectors, Programs, Sprites, Images, Shading, Lighting** (plus Scroll and Zoom). Each mode reuses a common tool set:

| Tool | Tiles / Shading | Vectors / Programs | Sprites / Images / Lights |
|---|---|---|---|
| **Draw** | paint the current tile/shade; a tile bitmap stamps its whole grid | click to add points; right-click closes; Ctrl+right-click leaves open; Shift snaps to axis/diagonal; Ctrl inverts grid snapping; Alt+click deletes a nearby point, splits a nearby segment, or resumes drawing | click to create a default object |
| **Select** | grid-aligned rectangle; drag moves (cut/paste), Ctrl+drag copies | click selects the nearest vector; drag-box selects points; drag moves them; Del deletes points; Z subdivides segments; X resumes drawing from an end point | click selects; drag moves (grid-snapped in tile coordinates) |
| **Flood** | bounded flood fill (recursive mode available for very old OS quirks) | — | — |
| **Erase** | erase tile/shade | — | — |
| **Rectangle** | hollow, or filled with Ctrl (not in iso-stacked) | creates a closed rectangle (rotated for iso) | — |
| **Dropper** | pick tile/shade from the board | — | — |

"Near" means within about 16 px.

**T-24 Selected brush.** Pick a tile from a `.tst`, `.iso`, `.tan` (animated) or `.tbm` (stamp). A pop-up tileset browser opens with **L**.

**T-25 Auto-tiler.** With an *auto-tile tileset* loaded and auto-tiling switched on, painting picks each tile automatically from its 8 neighbours. Corners only count when both adjacent edges are filled (standard "blob" rules), giving about 50 variants laid out in a fixed order in the auto-tile set. Neighbouring tiles re-evaluate when you paint. A rebuild must reproduce the variant ordering to stay compatible with community auto-tile sets. Rebuild that ordering from sample sets, not from the legacy table.

**T-26 Object inspector (right panel, one tab per type).**
* **Vectors:** list by index and editable **handle**. Type (solid, under, stairs, waypoint). Closed flag. Under-vector options (include background, all layers below, frame intersect). Layer. Stairs target layer. Re-order the slot index. Editable point table. Show/hide. Delete.
* **Programs:** list by index and file/inline code. Program **file or one line of inline RPGCode**, with browse and open buttons. Layer. Step-on or key-press. "Trigger every N px". "Stops movement". **Run once**. Run-if `var == value`. Then set `var = value`. Point table.
* **Sprites:** item file with browse and open. Location (tile or pixel, bottom-centre anchor). Slot index. Override activation program. Override multitask program. Step-on or key-press. **Show when board loads if** `var == value`. Run-if and then-set conditions.
* **Images:** file. Top-left pixel location. Layer. Transparent colour picked by clicking the image on the canvas.
* **Lighting:** cast-onto layer. A light list with type (elliptic spotlight, gradient, clipped gradient). Per-node colours. **Convert to shading** (bake). Delete. Current-shade RGB (−255…+255) with a grey slider and a zero button.

**T-27 Board properties page.** Directional links N/S/E/W (board or program). Background image, colour and music. **Board threads** list (add, remove, open). Dimensions (read-only; coordinate system shown). **Board constants** list and **layer titles**. Battle settings (enable, skill level, background). Disable saving. Enter program. Board ambient RGB.

**T-28 Clipboard & undo.** Multi-level undo/redo of the main operations. Copy, cut and paste of tile/shade regions and of whole vectors, programs, sprites and images (not partial point sets or lights). Select all.

**T-29 Player start location.** Click to set it (snaps in tile coordinates). It is drawn as a cross with a layer label, either on the initial board only or on every board (a preference). "Set as initial board" writes the current board into the main file.

**T-30 Coordinate upgrades.** One-way conversions **iso-stacked → iso-rotated** and **tile → pixel coordinates**. All tiles and objects are moved correctly. Script literals are not changed.

**T-31 Legacy board upgrade.** Opening a pre-vector board converts tile types into vectors, tile programs into program regions, per-tile RGB into a shading layer, and positions into pixels.

**T-32 Export image.** The current view (as displayed) or the **entire board**, without editor overlays and with optional sprites, images and shading, saved as PNG, JPEG or BMP.

**T-33 Board editor preferences.** Object colours, "revert to Draw after flood", show vector point indices, recursive flood, show the new-board dialog, start-location display rule.

**T-34 Vector display.** Each vector type has its own colour: solid white, under green, stairs blue, program yellow, waypoint pink. The selected object is highlighted (thick outline or bounding box). Each type can be shown or hidden.

**T-35 Sprite/image placeholders.** Objects with no graphic draw as 32×32 placeholder squares. Items with graphics show their south-facing rest frame.

---

## 4. Tile tools (T-36 … T-39)

**T-36 Tile editor (pixel art).** An enlarged 32×32 editing grid with a transparency checkerboard and optional grid. Tools: pencil, eyedropper, flood fill, eraser, line, ellipse (outline or filled), rectangle (outline or filled), replace colour. Palette bank, an RGB colour picker, a **16-colour DOS palette**, and a transparent-colour swatch. Previews of the tile at 1:1 and **as an isometric projection**. Wrap-scroll the pixels N/S/E/W. **Isometric mode** permanently converts a 2D tile to an iso diamond.
* Edit operations: single undo, clear, rotate 90/180/270, flip, mirror, **cut corner** (blank half the tile along a diagonal), **skew** (45°, wrapping or broken).
* Image operations: import an image (ICO, BMP, WMF and other images), **layer tile** (overlay another tile, optionally translucent at N %), shade tile (uniform RGB offset), greyscale.
* Effects: blur, motion blur, **light source** (pick blocker pixels plus an angle and length to cast hard shadows), texturise (random lightness dither), translucentise (pixel-pattern pseudo-transparency).
* Save: to a new or existing tileset (append), or **into a specific slot** (overwrite).

**T-37 Tile grabber (image → tiles).** Load an image and overlay a 32×32 (or isometric) grid. Click or drag to select tiles. Right-click moves the grid origin. There is a vertical half-tile grid offset (useful for iso). Pick a transparent colour from the image. Options: ignore blank tiles, ignore partial edge tiles (iso), grid and selection colours. **Batch grab** the selection or the whole image into a tileset at 32×32, isometric, or legacy 16×16 (which is pixel-doubled when used). Edge tiles are padded with transparency.

**T-38 Tileset editor.**
* Single-tile conversion: add `.gph` files to a set by wildcard; view a set tile by tile; export a tile to `.gph`; remove duplicates.
* **Advanced mode:** two tilesets side by side (`.tst ↔ .tst`, `.tst → .iso`, `.iso ↔ .iso`). Insert a tile from the other set, delete, insert blank, move up/down, drag to reorder, set the display width. Edits are made on copies until OK.
* A warning that reordering breaks existing references.

**T-39 Animated tile editor.** Build a `.tan` from a sequence of tiles and set its frames per second. Preview playback.

---

## 5. Script tools (T-40 … T-46)

**T-40 Program editor.** A text editor for `.prg` with **live syntax colouring** (configurable colours and styles per token class). A **bookmark bar** lists comments, functions and labels for quick navigation. **Call tips** show the signature of the function being typed. **Quick reference** lists every built-in with its syntax and description, and inserts on double-click. A configurable header template for new programs. "Notepad mode" (distraction-free window).

**T-41 Test run with fixtures.** Run the current program in the engine. **Test preferences** supply a font, font size, message-window graphic, a set of party members and a board, so the program can run without the rest of the game.

**T-42 Indent wizard.** Re-indent code by brace depth (indent width configurable).

**T-43 RPGCode Update Wizard.** Converts pre-3.1 programs project-wide, file by file with per-file opt-out: quote unquoted string arguments and map keys; change `=` to `==` in comparisons; strip `!`/`$` sigils; modernise comment styles.

**T-44 Cleanup wizards.** *Auto-command wizard*: remove legacy `#` prefixes and wrap loose dialogue lines in message-window calls. *Cleanup wizard*: run all cleanups on every program in the project. Both claim to preserve behaviour.

**T-45 Visual event builder.** An alternative, form-based way to write a program. Pick commands from categories (Text, Display, Player, Fight, Control, Items, Variable manipulation, Input, Info; about 160 command templates). Fill typed parameters (file pickers that know the right folder, numbers, strings). Insert or delete lines. **Build to RPGCode**. A small visual screen-layout canvas comes with it. This was a lesser-used tool. Include it if the rebuild targets beginners.

**T-46 Capitalisation / formatting helpers.** Normalise built-in names to canonical case.

---

## 6. Character, item and enemy editors (T-50 … T-58)

**T-50 Character editor — Stats.** Name. Starting experience, HP and max HP, DP, FP, SMP and max SMP, level.
* **Advanced:** rename the script variables bound to each stat (defaults are derived from the character's name).
* **Profile picture:** image, tile or tile bitmap, shown at 64×64 in the menu and battle.

**T-51 Character — Special moves.** Category name (e.g. "Spells"). A list of up to 200 moves. Each has an unlock rule: minimum experience, minimum level, or `variable == value`.

**T-52 Sprite graphics editor (shared by characters and items).**
* A stance list: 8 directional walk animations, 8 idle animations, battle stances (Attack, Defend, Special Move, Die, Rest; characters only), and **custom stances** (create, name, delete).
* Pick an `.anm` or animated GIF per stance. An animated preview.
* An **assignment wizard**: from a file-name template such as `hero_*.anm`, fill all directions automatically.
* A **vector base editor**: preview the stance with an origin crosshair at the bottom-centre. Edit the **collision** and **activation** polygons with draw and move-point tools and an editable point table. Default shapes are a small or large rectangle, or a diamond for iso. Import bases from another sprite. Only one pair per sprite.
* **Speed** (seconds per step) and **idle delay** (seconds).

**T-53 Character — Equipment.** Which body slots exist for this character, and names for up to 10 accessory slots.

**T-54 Character — Levels.** Experience for the first level-up. Growth per level (% for exponential or points for linear). Max level. HP, DP, FP and SMP growth per level. Level-up program.

**T-55 Item editor.** Name/handle and description. **Equipable** (slots, accessory name, stat bonuses while equipped, equip and remove programs, battle animation). **Menu-usable** (+HP, +SMP, program). **Board-usable** (multitask program while on the board, activation program when picked up or talked to). **Battle-usable** (+HP, +SMP, program). Buy and sell prices. Key item. Usable by all characters or a list of up to 50. Graphics via T-52.

**T-56 Enemy editor.** Name. HP, SMP, FP, DP. Can-run flag with a run-away program. Critical chance on and by the enemy. **Graphics** (Rest, Attack, Defend, Special, Die, plus custom stances). **Special moves** with weaknesses and strengths. **Tactics**: AI level (low, medium, high, very high) or a custom AI program. **Rewards**: experience, gold, defeat program. "Add enemy to game" jumps to the main file's encounter pool.

**T-57 Special move editor.** Name. Damage (FP). Target SMP drain. User SMP cost. Program. Status effect. Animation. Battle-usable and/or menu-usable. Description.

**T-58 Status effect editor.** Name. Duration in rounds. Speed up, slow down, disable. HP and SMP change per round (negative heals). Program per round.

---

## 7. Graphics composition editors (T-60 … T-64)

**T-60 Animation editor.** Frame strip navigation (previous, next, append, insert, delete) and playback. Per-frame image (picture, tile or tile bitmap), **per-frame transparent colour** picked from the frame, per-frame sound. Global frame delay (text field and slider). Size from presets, manual entry, or the image's own size.

**T-61 Animation wizard.** (a) From image files: multi-select, alphabetical order, insert at a position. (b) From tiles: set the frame count, then compose each frame on a 4×4 tile grid from the tileset browser. Multi-tile frames generate `.tbm` files from a name template. After the wizard, the animation size is set from frame 1 and the transparency from frame 1's top-left pixel.

**T-62 Tile bitmap editor.** Set width and height in tiles. Draw and erase tiles from the tileset. **Per-tile shading** (RGB −255…+255 with hue picker and lightness slider). Grid and redraw.

**T-63 Background (battle) editor.** Image (picture or tile bitmap), battle music, four menu sounds (move, choose, ready, can't-do).

**T-64 Skin editor.** Legacy UI skin: window graphic and button graphic.

---

## 8. Build & distribution tools (T-70 … T-74)

**T-70 Make package.** Package the game as one **distribution package** ([packaging and paths](spec/formats/packaging-and-paths.md#distribution-package-this-projects-own)) plus its **install descriptor**, with an output path: the project folder at the archive root, with `manifest.json { schema, main, index }` naming the main file and the game files. The package is what a player installs and opens; it carries no copy of the engine. The legacy self-running EXE is an **import** format only — we read one and never write one ([packaging and paths](spec/formats/packaging-and-paths.md#standalone-exe)).

**T-71 Pak file compiler.** Package the game as a single `.tpk` archive that an installed player opens. A rebuild's build step writes the same archive as its **distribution package** — a `.tpk`-compatible ZIP with `manifest.json { schema, main, index }` at the archive root ([packaging and paths](spec/formats/packaging-and-paths.md#distribution-package-this-projects-own)) — so the build is one step for the `.tpk` and the package.

**T-72 Create setup.** A ZIP containing the game files plus a simple installer and uninstaller.

**T-73 File-system upgrade.** Migrate a 2.x project layout (flat folders) into the 3.x project-folder structure.

**T-74 Third-party distribution guidance.** Which files the engine needs at runtime. For a **distribution package** that list is the manifest's `index` (`manifest.json { schema, main, index }`, [packaging and paths](spec/formats/packaging-and-paths.md#distribution-package-this-projects-own)): every game file except the manifest, each once, so a consumer builds the resolver's index without walking the archive.

---

## 9. Bundled utilities (T-80 … T-82)

**T-80 The Bard.** A stand-alone music and sound player for auditioning game audio.

**T-81 Built-in web browser.** Opened the Toolkit homepage and forums. This is obsolete; a rebuild should drop it.

**T-82 Registration and file association.** Associates Toolkit extensions with the editor and engine. A rebuild should do this per platform.

---

## 10. Cross-cutting editor behaviours worth keeping

* **Folder-aware pickers** everywhere: every file field knows its asset folder, accepts subfolders, and copies outside files in.
* **"Open the linked file" buttons** next to every file field.
* **Inline RPGCode** is accepted wherever a program file is expected.
* **Live previews:** animations, iso projection of tiles, and sprite vectors over frames.
* **Shared tileset browser** acting as a palette for the board, tile bitmap and animation editors.
* **Coordinate-system awareness** in every placement tool (grid snapping, iso rotation of rectangles, pixel-absolute toggle).
* **Non-destructive editing** of tilesets until confirmed. **Multi-level undo** on boards.

## 11. Parity priority for a rebuild

| Priority | Tools |
|---|---|
| **P0** (cannot author a game without) | Workspace + file tree, Main file editor, Board editor (tiles, layers, vectors, programs, sprites, images, properties), Program editor with test-run, Character, Item, Animation, Tile bitmap editors, packaging (T-70 equivalent) |
| **P1** | Tile editor, Tile grabber, Tileset editor, Enemy, Special move, Status effect, Background editors, lighting/shading, auto-tiler, undo/clipboard, export image, legacy upgrade wizards |
| **P2** | Visual event builder, skin editor, Bard-style audio preview, setup builder, tutorials |
