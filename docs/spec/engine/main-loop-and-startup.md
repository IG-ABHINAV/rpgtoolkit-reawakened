# Start-up, main loop and timing

The original engine is a single-threaded Windows program. It loads the main file, starts its subsystems, runs the start-up program, shows the first board and then loops forever: handle one window message, run one frame of game logic. This page describes that observable behaviour.

## Legacy subsystems

The original engine's responsibilities, named here so the rest of this spec can be organised by them. They are described as responsibilities, not as code.

| Subsystem | Responsibility |
|---|---|
| Loader / asset resolver | Folder and package lookup, case-insensitive paths, version-tolerant readers, legacy upgrades (pre-vector boards → vectors, old items → generated animations) |
| World model | The current board (tiles, vectors, programs, images, lights), the party, board items, global variables |
| Movement & collision | Per-sprite movement queues, vector intersection, sliding, stairs, board edges, path-finding, z-ordering |
| Trigger/event system | Deciding when programs run: step-on and key-press regions, item activation, board entry, edge links, run-time keys, random battles, level-up, equip, death |
| Script runtime (RPGCode) | Parser, interpreter, cooperative threads, global and local variables, objects, error handlers, ~280 built-ins |
| Renderer | Layered tile and image compositing with a scroll cache, sprites, under-vector occlusion, translucency, shading and ambient light, overlays, message window, transitions |
| Audio/video | Looping background music, one-shot effects, volume, full-screen video |
| Input | Keyboard (named keys, scan codes), mouse (click-to-move, cursor maps), joystick |
| Battle system | Charge-bar ("active-time") battles, status effects, enemy AI, rewards; the UI lived in a plugin |
| Menu system | Party / items / equip / abilities / save / load / quit; the UI lived in a plugin |
| Persistence | Saving and restoring the entire game state, including running threads |
| Plugin host | Native extensions for script functions, menu and battle |

## Command line

The engine runs with the Toolkit folder as its working directory (`Main\` and `Saved\` are relative to it). Arguments are split on single spaces, so file names with spaces cannot be passed.

| Invocation | Behaviour |
|---|---|
| (an executable with an appended PAK) | run the embedded game ([../formats/packaging-and-paths.md](../formats/packaging-and-paths.md#standalone-exe)) |
| `engine <file.gam>` | run `Main\<file.gam>` |
| `engine <file.gam> <program.prg>` | **program test mode**: load the main file, replace the start-up program with `<program.prg>`, start with no board, run, then exit. Used by the editor's "Run program". |
| `engine` with `main.gam` in the working directory | run it |
| `engine` otherwise | show an Open dialog for `*.gam` / `*.tpk`. A `.tpk` is run as a PAK. |

The editor's "Test game" runs `engine <file.gam>` without saving open editors first.

<a id="e-130"></a>
**E-130 Folder play.** A game is played from the main file plus the project folder, read in place ([../formats/packaging-and-paths.md](../formats/packaging-and-paths.md)).

<a id="e-131"></a>
**E-131 Single-file package.** The other distribution forms are the legacy `.tpk` ZIP and the standalone EXE (the engine with a ZIP appended), both handled by the same invocation as a folder ([../formats/packaging-and-paths.md](../formats/packaging-and-paths.md#standalone-exe)).

**Reawakened rule.** The rebuild needs its own equivalents of both and must **import** the legacy ones. Our single-file form is the *distribution package*: a `.tpk`-compatible ZIP carrying `manifest.json { schema, main, index }`, so a runner boots from `main` and builds its asset index from `index` without listing the archive, and a loose folder and a package load to the same files ([../formats/packaging-and-paths.md](../formats/packaging-and-paths.md)).

> **Open conflict R-60 — editor and test-game behaviour.** the legacy feature inventory says this inventory covers the *engine runtime only* and that the authoring tools are in `editor-features.md`; this page, `docs/spec/engine/main-loop-and-startup.md:32` and `:131`, documents two editor-facing behaviours anyway: the `engine <file.gam> <program.prg>` **program test mode** the editor's "Run program" uses, and the per-resolution frame-rate estimate the engine saves between runs. Owner epics: **editor-foundation** and **editor-assets-p0**. Landed code: none. The owners settle whether these belong in an engine page at inception; this page rules nothing.

## Start-up sequence

<a id="e-01"></a>
**E-01 Game discovery.** The game comes from an explicit main file, a `main.gam` beside the executable, a package (`.tpk` ZIP or an EXE with an appended ZIP) or a picker — the invocations in the table above. A **program test mode** runs one `.prg` against a main file without loading a board (the editor's *Run program*).

<a id="e-02"></a>
**E-02 Start-up sequence.** In order:

1. Create `Saved\`. Decide which main file to run (table above) and load it.
2. Install every `*.ttf` font in the project's `Font\` folder for the duration of the run.
3. Load plugins ([plugins-and-battle.md](plugins-and-battle.md)): RPGCode command plugins, the menu plugin and the battle plugin, all from `Plugin\`.
4. Create the window and graphics device: resolution from the main file (640×480, 800×600, 1024×768 or custom), full screen or windowed, colour depth 16/24/32 bits. If the requested mode fails, lower depths are tried and full screen falls back to windowed.
5. Set tile or pixel movement and the game speed from the main file. Seed the frame-rate estimate (see Timing).
6. Create the first player from `initChar` and make the player variables available to scripts.
7. Run the start-up program **to completion** (it may show messages, ask questions, change variables, add players or even load a board).
8. If no player exists at this point the game stops with "an initial character must be defined".
9. Load `initBoard` (skipped if the start-up program loaded a saved game with `Load()`, which is how title screens offer "continue"), place the player at the board's start position, start the board's background music and run the board's `enterPrg`.
10. Enter the main loop.
<a id="reawakened-startup-ports"></a>
**Reawakened rule (OWNER; startup ports).** Startup calls data-only ports rather than host APIs: `InitialPlayerPort.createFromInitChar(initChar: AssetKey): PlayerId` creates the first player at step 6; `PlayerPresencePort.hasPlayer(): boolean` performs the step-8 no-player check and emits the specified diagnostic; and `SavedGamePort.load(path: SavePath): LoadResult` owns the step-9 saved-game branch. A successful load skips `initBoard`; a miss or failure returns to the ordinary `initBoard` path according to its result. `Load()` and `dirSav` remain menu-and-save responsibilities.
<a id="reawakened-boot-sequence"></a>
**Reawakened rule (OWNER; boot sequence, unverified default).** The core runs E-02 as data, driven by `advance`, with every file arriving as an AD-14 asset reply (time stays frozen while a reply is outstanding). Boot starts from the main file the runner names. The core then does these steps in order:

1. **Step 1** is the host's: `Saved\` is the `saves` blob area, and the main file is the first asset requested. A game-folder root takes its `projectPath` from the main file; a package root ignores it.
2. **Step 2** requests every `*.ttf` under the project's `Font\` folder, in index order, and installs each that passes the font licence gate into the run's font set; a rejected font is a located diagnostic and is skipped.
3. **Step 3** builds the plugin manifest: the engine default manifest plus one appended entry for each package name in the main file's [TKR package-list extension](../formats/main-file.md#tkr-package-list-extension), in the stored order (the plugin manifest is the one shared list of PKG-1). A name no definition resolves is a located `plugin.unresolved` diagnostic. The legacy plugin rows of the main file ([main file](../formats/main-file.md#layout) rows 23, 24 and 38b) are then mapped in memory to stock packages: `tk3menu.dll` to `stock_menu`, `tk3fight.dll` to `stock_battle`. The mapping reads the menu row, the battle row and then the command-plugin slots, and compares the file name's last path segment under the format's ASCII-only name fold. A mapped package the package list already names adds no second entry, so one legacy row and one explicit name for the same package are one manifest entry. Any other legacy name has no mapping: it is data the engine keeps, and it is reported once as a located `plugin.legacy-unmapped` diagnostic at the main file while boot continues. The mapping changes no stored byte of the main file.
4. **Steps 4 and 5** belong to the runner (window, resolution) and to movement-triggers (tile or pixel movement, game speed). The core does nothing for them.
5. **Program sources** under `Prg\` are requested together with the fonts, because the script runtime resolves `run`, `thread`, includes, board programs and the enter program synchronously from the files already fetched.
6. **Step 6** posts one `sprites` effect `createplayer(initChar)` with the resolved `Chrs` asset key (no effect when `initChar` is empty). A registered `sprites` owner applies it; until one registers, the record waits in the bounded pending queue. This effect is `InitialPlayerPort.createFromInitChar`'s contract.
7. **Step 7** starts the start-up program as the one `blocking` thread and runs ordinary ticks, with no board loaded, until that thread has finished. Other threads and input run as in any tick.
8. **Step 8** asks `PlayerPresencePort.hasPlayer()`. When it is false the engine stops and reports the diagnostic `startup.no-player` ("an initial character must be defined").
9. Before ordinary saved-game loading, a launch supplied with a host-selected validated recovery candidate restores its durable ledger and loads that ledger's board; once prepared, the board is presented paused until explicit Resume. Without a recovery candidate, `SavedGamePort.restored()` retains its existing branch: when true no board is loaded and the saved state supplies the board, threads and music; otherwise `initBoard` is loaded and entered at the board's start position as in the board-entry rule below.

**Interruption recovery (OWNER; approved, implementation tracked by #779).** This is distinct from the ordinary saved-game branch above. Normal startup may run temporary-board threads; after startup they stop before the saved board is prepared. Recovery restores the validated ledger before saved-board conditions and preparation, and returns the recovered board paused. `Engine.recoveryStatus()` exposes the lifecycle; `Engine.resumeRecovery()` starts saved-board threads and the entry program only after explicit Resume. See [interruption recovery](interruption-recovery.md) for host prompt, asset compatibility and failure rules.

<a id="reawakened-board-entry"></a>
**Reawakened rule (OWNER; board entry, unverified default).** Every arrival on a board, at boot or by `send`, runs these steps in order: the old board's `board` threads are killed (not at boot), the board is installed, the player is placed (`sprites` effect `placeplayer(x, y, layer, unit)`, `unit` `"pixel"` at boot from the board start and `"tile"` for `send`), the camera is re-aligned with no smoothing on the player (or on the destination when no player position is available), the program under the player is deactivated (`triggers` effect `deactivateat(x, y, layer, unit)`), the board music is posted as an `audio` effect (E-16; no record when the board names no music or the same file as the one already ruled playing), the board's threads start in board order, and the enter program runs. The enter program is the one `blocking` thread when none is live, and a `board` thread when the arrival comes from a program that is itself the blocking thread (AD-26 allows one blocking thread).

### Board loading and layers

<a id="e-10"></a>
**E-10 Board loading.** Any supported board version is read and converted to the vector model ([../formats/board.md](../formats/board.md#version-dispatch)). Loading the active board creates its run-time objects: the items whose *loading condition* holds, image surfaces, under-vector occlusion surfaces and the board's threads. A board opened only for a test — checking whether a linked board can accept the player — is loaded without side effects.

<a id="e-12"></a>
**E-12 Layers.** Any number of tile layers (1-based), each of which may also hold free-placed images. A background colour and an optional background image (normal, parallax or stretched) sit below layer 1. A sprite lives on exactly one layer and interacts only with the vectors, programs and items on that layer ([../formats/board.md](../formats/board.md#dimensions-and-tiles)).

### Saved games

<a id="e-120"></a>
**E-120 Save.** The save holds the whole state: globals, redirects, party and stats, inventory, equipment, gold, message-window and font settings, play time, steps, the current board, every party member's position, layer and waypoint link, **all items on the current board** (position, active flag, activation data, waypoint link), the threads (file, persistence, owner, sleep and serialised interpreter state), the movement mode, objects and the game-speed offset. Saves go in the per-game saved-games folder ([../formats/save-game.md](../formats/save-game.md)).

<a id="e-121"></a>
**E-121 Load.** Restore exactly, including the board with its *live* item list (not the board file's original list) and the running threads at their saved positions ([../formats/save-game.md](../formats/save-game.md#program-state-inside-each-thread-field-46)).

<a id="e-122"></a>
**E-122 Legacy save compatibility** (optional but desirable): read 3.1.0 `.sav` files ([../formats/save-game.md](../formats/save-game.md)).

## Main loop

<a id="e-03"></a>
**E-03 Main loop (one frame).** The game state is one of **Idle** (accepting player input), **Moving** (sprites moving), **Paused** (the window lost focus) or **Quit**.

Each pass of the loop:

1. Handle **one** pending Windows message, if any (keyboard, mouse, focus changes, repaint, quit).
2. Run **one frame of game logic**, depending on the game state:

| State | Frame |
|---|---|
| **Idle** (the player is not moving) | read input: activation key, menu key, run-time keys, movement keys, mouse; then do everything in *Moving* |
| **Moving** | (a) advance every background script thread by a budget of instructions; (b) move every sprite one step; (c) if the player crossed a board edge, handle the board link, otherwise test programs, items and random battles at the player's position; (d) draw the frame |
| **Paused** (window inactive) | sleep 100 ms |

The world keeps animating while waiting for input: the idle state falls through into the moving state.

There is **no frame-rate cap** in the original engine: the loop runs as fast as the machine allows. A 120 fps cap was defined but disabled.

<a id="reawakened-phases"></a>
### Reawakened phases

**Reawakened rule (OWNER; Epic 20, entry 20.1; Jensen, 2026-10-19).** The engine runs these phases once per fixed 60 Hz tick, in order: `input`, `waits`, `threads`, `events`, `movement`, `edges`, `triggers`, `animation`, `audio`, `time`. Modules register only with named phases, and rank orders registrations within each phase. There is no core `battle` phase ([BAT-1](battle.md#bat-1), [ACT-10](actors.md#act-10)).

Random-encounter evaluation belongs to `triggers`, after a completed whole-tile step and activation checks. A drawn encounter hands its enemies to the `stock_battle` package; a custom encounter (the main file names a fight program) draws nothing and runs that program, which names its own enemies ([BAT-9](battle.md#bat-9)). Battle systems run through RPGCode package programs and ordinary VM threads; the saveable `battle` section does not add a core phase.

**Reawakened rule (OWNER; battle return audio; Jensen, 2026-10-26).** The battle lifecycle queues `battleEnded` from `threads` only after outcome handling completes. The existing `events` phase delivers it before later phases; the engine re-exposes the active board and emits `boardReturned` with that board's key in the same event phase. This is a return to the still-active board, not a board transition or an `entered` event. The board/audio owner reads `bkgMusic` directly from the active board and posts `music.play` (source `board`, including a null request for a silent board) before the later `audio` phase. No new phase is added, and no lookup by `battle.boardKey` occurs.

<!-- OWNER: Jensen, 2026-10-19; Epic 20, entry 20.1 phase-pipeline ruling. Source: _bmad-output/initiative-rpgtoolkit-reawakened/epic-actors/epic-actors.md and architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md (AD-26). -->

### Blocking programs

Programs started by triggers (board programs, item activation, the start-up program, menu choices) run **to completion inside the frame that started them**. While one runs the rest of the world is frozen, but the window stays responsive because the program loop handles a window message after every instruction. Background threads ([rpgcode-language.md](rpgcode-language.md#threads)) are different: they get a slice of instructions per frame and do not freeze the world.

The original engine's concurrency model has **one logical thread of game state**: everything is single-threaded and cooperative. A program started by a trigger takes exclusive control (above), while the threads spawned by the board, by an item's multitask program and by `Thread()` run alongside the main loop and are given a time-slice measured in **execution units** (statements) each frame; a thread can sleep, wake, and pause until a sprite finishes moving. The original engine's blocking primitives (`wait()`, `delay()`, a blocking movement) keep the window responsive by pumping input and redrawing while they block.

> **Open conflict R-32 — blocking inside a thread.** The blocking-primitives sentence above is the legacy feature inventory: "Blocking primitives inside a program … pump input and redraw while blocking." This page and `docs/spec/engine/rpgcode-language.md:171` say that threads do not pump window messages, so a blocking command inside a thread freezes the whole game and only the redraw continues. Owner epic: **rpgcode-vm** (entry 3.27, which ruled it); recorded here as a pointer only, and this page rules nothing.

<a id="e-33"></a>
**E-33 Thread–movement coupling.** Movement started from a **thread** runs concurrently, or pauses that thread until the movement ends (`tkMV_PAUSE_THREAD`). Movement started from a **blocking program** runs to completion before the program continues, **unless** it is inside `multiRun { … }`, which collects several sprites' movements and runs them together ([rpgcode-language.md](rpgcode-language.md#threads)).

<a id="e-96"></a>
**E-96 Script-driven UI loop.** Scripts can build entire custom screens — title menus, custom battle systems, HUDs — from canvases, cursor maps, key and mouse polling and `renderNow`. The engine must allow a blocking script to own the frame for as long as it likes while still presenting frames and reading input ([rpgcode-language.md](rpgcode-language.md#execution)).

**Reawakened rule.** Both blocking and threaded programs must run on a runtime with no OS threads, such as a browser, so the script runtime is a **resumable interpreter** — a step machine, continuation or coroutine equivalent — rather than one native thread per program. The step machine's states and the per-thread budget are specified in [rpgcode-language.md](rpgcode-language.md#execution) (G1 in [../../guardrails.md](../../guardrails.md)).

## Timing

<a id="e-04"></a>
**E-04 Timing.** The frame rate is uncapped up to about 120 fps. The engine keeps a running **frames-per-millisecond** estimate and converts every sprite's "seconds per step" into a **frame count per move**, so movement speed is time-based. A global **game speed** offset (−4…+4, ±10 % per step) adjusts it, and the last measured average frame time per resolution is saved so the first frames start from a sensible estimate.

Movement speed is **tied to the measured frame rate**, not to wall-clock time:

- The engine measures the average frame time over recent frames (only frames shorter than 256 ms count).
- Sprite speeds are given in seconds per step in the data files and converted to "frames per step" using the measured rate (see [movement-and-collision.md](movement-and-collision.md#speed)).
- The frame-rate estimate is saved on exit and used to seed the next run, separately for 640, 800 and 1024 resolutions and for windowed / full-screen (stored in the per-user registry under the RPG Toolkit settings). Program test mode does not save it.
- Script threads get `(fps − 60) × 10` instructions per frame, at least 10. **Compatibility note:** in the original engine this subtraction is unsigned, so below 60 fps it wraps to a huge number and threads effectively run without limit each frame.

A modern engine should use a fixed time step and convert the stored speeds to time directly; the result is equivalent at the frame rates the original ran at.

**Reawakened rule (OWNER; R-56).** The rebuild advances simulation at a fixed 60 Hz tick. Runners convert elapsed time into whole ticks; there is no observable frame-rate cap in simulation, and presentation may interpolate between completed ticks. Stored seconds-per-step values convert through the fixed tick length, never a measured frame rate. The old frame-count quirks (unsigned budget wrap, saved per-resolution estimate and uncapped loop) are not simulation inputs.

<a id="reawakened-breakpoint-cursor"></a>
**Reawakened rule (OWNER; breakpoint cursor).** While breakpoints are installed, the engine executes `stepThread` with a budget of one instruction and stores a plain-data open-tick cursor containing the ready-thread-list snapshot, current thread and steps used. A breakpoint returns `paused { thread, frame, line }`. `continue` finishes that open tick before later ticks; `step` executes exactly one instruction and pauses again. A snapshot at the stop resumes to the uninterrupted state and draw-list hash. `ticksRun` counts completed simulation ticks only: a breakpoint before the open tick completes reports zero for that call, and the resume call reports one when it completes. Debug hooks read state and never write it.

<a id="reawakened-presentation-alpha"></a>
**Reawakened rule (OWNER; presentation alpha).** A draw-list `alpha` is presentation-only interpolation of the camera and, when available, prior sprite positions. It is never stored in simulation state and is excluded from state and draw hashes.

> **Open conflict R-56 — the frame-loop cap.** The legacy feature inventory (E-04) says the frame rate is "uncapped up to about 120 fps"; the fixed-tick rule above makes that difference unobservable to simulation. The owner ruling is recorded by the fixed-tick rule; this page no longer leaves the simulation timing open.

## Drawing a frame

1. Clear to the board's background colour; draw the board background image.
2. Draw the tile layers from a pre-flattened cache covering twice the screen size, so scrolling within it is cheap.
3. For each layer, bottom to top: redraw that layer's tiles over sprites from lower layers, then draw the sprites on this layer in z-order, then draw "under" vectors' tiles over sprites that stand inside them.
4. Draw running script animations, then the script overlay canvas, then present.

Ambient light (board ambient colour plus script changes) is applied as a gamma ramp in full-screen mode and by re-tinting tiles in windowed mode.

<a id="e-52"></a>
**E-52 Board compositing.** The full order is: background colour → background image (normal, stretched, or parallax with a computed scroll factor) → for each layer: tiles (shaded), then that layer's images (with colour-key transparency) → the sprites on that layer in z-order → higher-layer content that overlaps a sprite → under-vector promotions → animations → the overlay. The original engine kept a **scroll cache**: a pre-rendered region larger than the screen, re-rendered only when the camera left it or after a forced redraw, with animated tiles patched into it each frame.

**Reawakened rule (OWNER; compositor inputs).** `composeBoard` consumes a read-only world view containing run-time board edits, sprites, the current tick and `alpha`, plus a view containing the camera, viewport size and include flags. `Engine.drawList`, `viewBrd`, the editor canvas and image export call this same pure compositor; it does not read mutable engine state directly.

**Reawakened rule (OWNER; under-vector spans).** Under-vector flags 1, 2 and 4 mean respectively background, all lower layers and frame-intersection trigger. For each affected row, the compositor computes polygon intersections and redraws contiguous covered spans of the promoted tile/image content over the sprite, without a new draw command or alpha clip.

**Reawakened rule (OWNER; audio effect handoff).** Board music and per-frame `.anm` sounds are posted as `audio` effects through `postEffect`. The audio-synth owner registers the applier and creates `AudioCue` records later; board rendering does not own `GameState.audio` or `cueId`.

<a id="e-57"></a>
**E-57 Render-now overlay.** A script-owned canvas, composited over the game every frame while it is enabled — the mechanism behind script-drawn HUDs and custom screens ([rpgcode-language.md](rpgcode-language.md#virtual-variables)).

**Reawakened rule (entry 7.11 corrects a gap; the placement follows the E-57 line above).** *In plain terms:* once a script calls `rendernow(true)`, whatever it draws on the canvas `cnvRenderNow` shows on screen above the board, the sprites and the animations, and below the message window and screen text; clear pixels let the game show through. *Precisely:* the composed frame appends one 1:1 blit of the enabled canvas at (0, 0) after the board, effects and animations and before pinned animations ([`pinnedanimation`](rpgcode-functions.md#reawakened-pinnedanimation)), the debug overlays, the text layer, the message window and the cursor; a canvas that is switched off or no longer live adds nothing. *Lifecycle:* `cnvRenderNow` is one reserved canvas with its own on/off flag. `rendernow(true)` creates the canvas (cleared, screen-sized) the first time, or again if the script killed it, and turns drawing on; on an existing canvas it only turns drawing on and leaves its pixels. `rendernow(false)` only turns drawing off: the canvas, its handle and its pixels persist, and a later `rendernow(true)` shows it as it was. `cnvRenderNow` reads the canvas's handle once it exists (0 before) whether or not it is drawn, and `rendernowenabled()` ([rpgcode-functions.md](rpgcode-functions.md)) reads the flag. The saved surfaces section records the flag next to the handle; a save written before the flag existed means "on" when it names a handle. Handle 0 is the screen, never a canvas. The blit references the canvas's revision, so the draw-list hash changes with every edit of the canvas.

<a id="reawakened-script-surface-lifecycle"></a>
### RPGCode screen surface and message-window lifecycle

**Reawakened rule (OWNER, 2026-11-01; #1045).** The RPGCode screen surface — the script text layer (`text`, `pixeltext`, `print`) and the message window (`mwin` / `mbox` / `show`) — has the lifecycle below. *In plain terms:* the old title or menu text must not stay on screen over the board once the program that drew it has ended, and a message window the program left open must not either; but while the program that opened a window is still running, a board change (`send`) does not close it. *Source and certainty:* every row comes from the TK engineer's answers recorded in GitHub issue #1045. **They are a source read, not a runtime observation: the engineer did not run the game to confirm any of them.** The engineer labelled only the fresh-launch black screen ("certain from source, not run-confirmed") and the reset path ("unverified"); no other row carries a stronger label than *source-read*, and this page does not add one.

| Transition | Message window | Script text layer and surface | Label |
|---|---|---|---|
| Outermost program start (a program that is not nested in another) | Hide, and reset the stored text and line position | The program's starting image replaces the surface (Inference; see the last paragraph) | Source-read (window); Inference (surface) |
| Outermost program end, by `end()` or by running off the last line | Hide, **without** resetting the stored text or line position | The surface is not cleared; it is simply not shown outside a program | Source-read |
| Nested program (`executeProgram`) start or end | Neither hides nor resets | Unchanged | Source-read |
| Thread (`thread`, board and item threads) start or end | Neither hides nor resets (threads do not trigger this cleanup) | Unchanged | Source-read |
| Scripted `send` to another board while the program runs | Unchanged: a window left open stays visible on the new board | Unchanged | Source-read |
| Any other board load | Unchanged; a board load resets neither layer | Unchanged | Source-read |
| Edge link to a `.prg` | The link does not load a board (Source-read); the program it runs is a new outermost program (Inference), so the first row applies | As the first row | Source-read ("does not load a board"); Inference ("new outermost program") |
| `rendernow(true)` … `rendernow(false)` | Unchanged | The render-now canvas stays visible through program ends and board changes until switched off | Source-read |

*What is drawn outside a program.* Outside a program the ordinary game loop rebuilds the board each frame and draws neither the surface nor the message window, so the text of a finished program is gone from the screen the moment its outermost program ends, without the engine clearing anything. The message window's text and line position are kept in state while it is hidden and are reset by the next outermost program start; the surface keeps nothing across programs, because each outermost program starts from a copy of the display (below) and empties the text layer (**Inference**). Modal UI (`ui.modal`) is cleared at outermost program start and end, and is composed only while a program is active (**Inference**). The enabled `rendernow` canvas is the one thing that keeps composing outside a program. When the engine generates a UI message outside any running program (such as the random encounter "No enemies of skill level N found." message), the engine resets stale message text and posts the message; an explicitly open message window with text (`ui.message.visible && text !== ""`) is composed and visible on the board. When an arrival comes from a scripted `send` whose sender then ends while the destination board's enter program is still running, that enter program is promoted to the blocking thread (or treated as an active program presenting UI), keeping its window and text layer composed while it runs or waits for input, and hiding the window when it finishes.

*Boot.* The start-up program is the first outermost program; after it finishes the message window is hidden, and the first board then loads without drawing, so its enter program starts from the start-up program's last presented frame and the first ordinary frame corrects it. The screen before start-up is solid black on a fresh launch with only the built-in plugins (**certain from the source read, not run-confirmed**). The built-in menu plugin reads the transparent colour and creates one blank menu-sized image at load and draws nothing until the menu opens; the built-in battle plugin reads the screen size and transparent colour and creates five small blank portrait images and draws nothing (**source-read**; neither plugin nor the loader changed between 3.1.0 and the final source). **Named exception — custom plugins.** A custom plugin in the main file's plugin list runs its start-up code before the menu and battle plugins, including plugins the engine later discards, and it can draw; a start that is not black because of this is plugin behaviour, not engine behaviour, and the rebuild does not model it. An invalid plugin produces a blocking load-error dialog that is closed before start-up, so it should not reach the starting image (**source-read, untested**). In windowed mode the starting image is taken from the desktop area, and traces left by a slow repaint are the engineer's **guess**. Whether `reset()` recreates the screen or retains it is **unverified**.

*The program's starting image and what this change does about it.* The legacy engine starts an outermost program with an image copied from what is on the display. The rebuild's core cannot read a host display, so that copy has to come to it as host-supplied presentation input — black in headless runs, the presented frame in interactive runners — and building that input is **deferred to #1067**. **Until #1067 lands this implementation approximates it:** the starting image is black in headless and golden runs (the engine has no frame to copy), the script text layer starts empty so that nothing a previous program drew can reappear (**Inference**), and the board is composed beneath it as always. A game that fully redraws what it needs in each program is unaffected; a game that relies on the frame left on the display by the previous program differs from the original until #1067 lands.

## Shutdown and reset

- **Exit** (window closed, or script `windows()` / its alias `dos()`): plugins are shut down first, then threads, graphics, audio and fonts; the frame-rate estimate is saved and any PAK temporary folder is deleted.
- **Reset plugin identity.** Reset reuses the manifest-resolved plugin list from the active boot (or the explicitly supplied resolved list for a scene); it MUST NOT fall back to the default manifest after a package manifest has been resolved. Package behaviour callbacks and startup programs therefore see the same package set after reset as at boot.
- Closing the window while a blocking program or plugin is running exits immediately from inside it.

<a id="e-06"></a>
**E-06 Shutdown & reset.** `reset()` — also used after a lost battle with no game-over program — clears globals, redirects, plugins and threads and then reruns the start-up sequence. Quit tears down plugins first, then everything else.
<a id="reawakened-reset-sections"></a>
**Reawakened rule (OWNER; reset write set).** An author can restart the documented startup path with `reset()`; the command clears the following sections, then reruns startup at E-02 step 3. It does not write `rng` or `time`.

| Section | Reset action |
|---|---|
| `engine` | Enter reset/startup control state, clear pending lifecycle and quit state, then install plugins and run startup. |
| `world` | Drop active board/runtime objects and reload the main-file project/board during startup. |
| `sprites` | Clear players/items and recreate the first player from `initChar`; startup additions then apply. |
| `party`, `inventory` | Clear to new-game defaults; startup/menu may add members, stats and items. |
| `triggers` | Clear armed, repeat and gone state and rebuild it with the board. |
| `vm` | Clear globals, redirects, running threads and plugin command state; run startup anew. |
| `battle`, `menu` | Close active battle/menu and discard transient screens. |
| `ui` | Hide/clear mwin/msgBox, cursor maps and buttons; restore project/default font and colour settings. |
| `camera` | Reset follow target and transform to AD-33 defaults; board startup selects the first player. |
| `events` | Drop every listener and queued event and any delivery in progress with the `vm` section they refer to; the listener table starts empty ([EMIT-15](rpgcode-modules-and-objects.md#emit-15)). |
| `fx` | Cancel fades, wipes, zoom, animations and pending screen effects. |
| `audio` | Stop one-shot effects and clear board-music ownership; startup/board entry emits new board music. |
| `surfaces` | Clear script canvases and screen captures; no old pixels persist. |
| `input` | Drop queued/held transient input and pointer/button state before startup. |
| `rng` | Preserve seed/state; reset does not create a new engine seed. |
| `time` | Preserve elapsed tick/play-time counters. |

`gone()` writes only `triggers`: it marks the current board program's trigger instance suppressed until the active board is left. Leaving the board clears that suppression during normal trigger reload. It does not delete the source program, change sprites or end unrelated threads. `quitGame()` posts one `quit` request; `dos()` and `windows()` are legacy aliases, and host window/session behaviour is outside core.

## Reawakened architecture

**Reawakened rule.** The rebuild decomposes the behaviour this page describes into a **runner** (the platform layer: window/canvas, input devices, audio out, file and package access, clock, save) and a **core** that holds the format readers, world model, movement and collision, triggers, the script VM, the battle and menu rules, the render *list* builder and the save/load model. The seam is thin and data-only:

```
┌─────────────────────────── Runner (platform layer) ───────────────────────────┐
│ window/canvas · input devices · audio out · file/package access · clock · save │
└───────────────▲───────────────────────────────▲───────────────────────────────┘
                │ thin, data-only interface     │
┌───────────────┴─────────────── Game Core ─────┴───────────────────────────────┐
│ format readers · world model · movement/collision · triggers · script VM ·    │
│ battle & menu rules · render *list* builder (not pixels) · save/load model    │
└───────────────────────────────────────────────────────────────────────────────┘
```

The core is **deterministic given its inputs** — the time tick, input events and the RNG seed — and produces **draw commands and audio commands**, not pixels or sound. That keeps the runners swappable (browser, desktop, mobile, headless test) and is what makes a recorded play-through replayable (G2 and G4 in [../../guardrails.md](../../guardrails.md); [ADR 0001](../../adr/0001-typescript-core.md)).
