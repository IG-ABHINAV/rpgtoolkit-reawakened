# ADR 0018 — The core composes a program's starting frame; there is no host capture request

* **Status:** Accepted in part (owner, 2026-11-02): core supplies the starting frame without a host capture request, and Reawakened matches the Toolkit 3.1 presentation model for now (Option A, section 11). This compatibility ruling does not preclude later changes. Implementation details, cursor handling where evidence is uncertain, and save/replay representation remain open. Not yet implemented.
* **Date:** 2026-11-02
* **Amends:** [docs/spec/engine/main-loop-and-startup.md](../spec/engine/main-loop-and-startup.md#reawakened-starting-frame-capture) (replaces the deferred host-capture rule with the core-composed one); reuses the surface-hash projection ruling in [docs/spec/formats/save-game.md](../spec/formats/save-game.md#state-hash-surface-projection) (2026-11-02)
* **Context documents:** [docs/spec/engine/runners.md](../spec/engine/runners.md#surface-read-and-state-hash), [docs/spec/formats/save-game.md](../spec/formats/save-game.md#state-hash-request-projection), AD-1 (engine API), AD-3 (draw commands), AD-5 (host requests), AD-14 (input events), AD-27 (`engine.surfacePixels`)
* **Tickets:** [#1067](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1067) (this design)
* **Supersedes:** the `captureFrame` / `frame.captured` host request-and-reply design recorded on branch `design/1067-program-starting-frame-capture` in PR [#1162](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/1162) as "ADR 0017 — Program starting-frame capture seam". That number belongs to [ADR 0017](0017-input-actions-devices-and-accessibility.md) (input actions), which is already accepted; nothing here reuses it.

## Summary

In plain terms:

1. **A program starts on a copy of the last frame the screen showed.** Toolkit 3.1 copies the display and never redraws first; the program then draws over that copy, and whatever it clears stays clear. The copy is the whole picture at logical resolution: the board, thread animations and the render-now overlay as they were, and — when the copy comes from a previous program in the same frame — that program's message window as well. It has no transparency.
2. **The core makes that copy, without a host pixel request.** Script-visible pixels come from deterministic core composition, not host GPU readback.
3. **No host capture request or reply.** This rules out the superseded request/reply seam, not every possible save or replay representation.
4. **Save, restore and hashing need a design.** Existing surface 0 and -1 hash exclusions remain in force; whether a retained prior frame can always be rebuilt from saved state, or needs additional saved data, is unresolved.
5. **The target replaces prior program drawing with the starting image.** The representation and exact implementation are proposals, not separately approved choices.
6. **This engine does not have that model yet.** It has no program surface of its own: it composes the live board under a program and the live overlay and animations over it every frame, and no command redraws the board into a program surface. That single gap is #1171, #1172, #1182, #1183 and #1186 (section 3), and the copy rules here seed the surface that gap is missing.

**Status of these items.** The owner adopted compatibility with the 3.1 presentation model for now and the core-only direction; item 6 describes a measured implementation gap. The source-read evidence and its uncertainty remain distinct from that decision. The design details in sections 2, 5 and 7 remain proposals where not already covered by an existing ruling.

## Context

Toolkit 3.1 starts an outermost program with an image copied from what is on the display. Every answer below about what that copy contains, and when a fresh board is drawn into it, comes from the TK engineer's source reads relayed by the owner and recorded in [#1045](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1045) and #1067. **They are source reads, not runtime observations: the engineer did not run the game to confirm them.** Where the engineer gave a certainty label, that label is kept here.

The rebuild has neither that copy nor the surface it belongs to. On `origin/main` a program starts with an empty script-screen layer, the live board is composed beneath it and the live overlay and thread animations above it on every frame, and the composition is only refreshed at the end of `advance`; no command redraws the board into a program surface. Section 3 states the model and measures the gap. The spec recorded the gap in the paragraph and the rule that this ADR replaces, and the audit #1170 found the visible symptoms that will disappear when the copy is correct (#1171, #1172).

The earlier design on this branch proposed a blocking `captureFrame` request and a `frame.captured` reply carrying RGBA bytes. Investigation for #1067 (report: `/tmp/frame-source-report.md`, on `origin/main` `0ddb39b9`) found that the seam is unnecessary and identified problems with that particular draft:

* **The host's pixels are not a function of ticks.** `runner-web` — and `runner-desktop` and `runner-mobile`, which reuse its live session — composes the frame after each `advance` with `alpha` = the wall-clock fraction of the next tick (`runner-web/app/main.ts:348`, `runner-desktop/app/player-live.ts:108`). On a 120 Hz display half the animation frames run `advance(0)` and re-present the same state at a different `alpha`; a stepped sprite is drawn at an interpolated position. A readback therefore returns a frame that varies with refresh rate, with when the host last happened to call `advance`, and with tick batching.
* **The draft's null/live and replay rules were inconsistent.** `getpixel`, `canvasgetscreen` and `savescreen` can put pixel-dependent values into hashed variables, script canvases (`cnvX`) and screen slots. A headless `null` fallback and an interactive live-frame reply can therefore produce different state hashes. Unrecorded host pixels can also vary with presentation timing for the same input log. A host seam is not inherently incompatible with G3: a design that records replies as inputs and deterministically replays the same replies could reproduce them, provided its cross-runner and restore contracts are defined. The superseded draft did not resolve its null-versus-live inconsistency that way.
* **It asked the host to do what the core does better.** Both the reference rasteriser in `core/raster` and the WebGL2 replayer are bound to agree on a draw list (exactly on colour keys, tint and blend choice; within one unit per channel on translucent and additive arithmetic, [runners.md#webgl2-agreement](../spec/engine/runners.md#webgl2-agreement)), and the measured agreement on a real demo frame is exact (worst channel 0). The difference between the two was never the rasteriser; it was which draw list was composed.

The owner accepted that finding on 2026-11-02: **core supplies the starting frame from its own deterministic composition; no host request.**

## Evidence: what the engineer's answers say

The toolkits' behaviour, in the engineer's words, labelled as the engineer labelled it.

| # | Answer | Label |
|---|---|---|
| W1 | The program's starting image is whatever was last presented. It is never redrawn first. Full resolution. Opaque RGB, no alpha. | Certain (earlier answers; the engineer labelled only the items below otherwise) |
| W2 | A fresh launch's screen before the start-up program is opaque black; program-test mode starts on opaque black. | Certain (fresh launch, from the source read); program-test mode as recorded in #1045 |
| W3 | Every outermost program start copies; nested (`executeProgram`) and thread (`thread()`) starts do not. | Certain |
| W4 | No frame is drawn between two programs that start in the same frame. The second copies the first's final screen, **including the message window's pixels** — ending a program only clears the window's visible flag. | Certain |
| W5 | Exceptions, where a fresh board is drawn first and therefore becomes the copy: an item trigger; an edge onto a board; closing the menu. | Certain |
| W6 | Same-frame program pairs: several run-time keys held at once; a step-on program then a custom-fight program; an activation-key program, then a step-on program during click-walking. | From source |
| W7 | The overlay and thread animations are **not** drawn continuously while a program runs. A program shows only its own surface with the message window on top of it. | Certain |
| W8 | Commands that redraw the board into the program's surface bake in the board, the thread animations and the overlay as a one-time snapshot, **erasing what the program had drawn**: `send`, `Load`, `forceRedraw`, `setAmbientLevel` (which calls `forceRedraw`), `layerPut`, `putPlayer` / `erasePlayer` / `destroyPlayer`, `putItem` / `eraseItem`, setting the player's or an item's direction, the `menu` command after the menu closes, and every frame of blocking movement (`playerStep`, `itemStep`, `push`, `pushItem`, `wander`, the path commands, the end of a `multiRun` block) and of custom stances (`playerStance`, `itemStance`, `posture`). | Certain |
| W9 | Turning the render-now overlay on or off redraws nothing. Drawing into the overlay canvas is not seen until the next board redraw. | Certain |
| W10 | The OS mouse pointer is usually not in the copy. The engine's own hand pointer is in it only if it was on screen at that moment; for the menu this is the engineer's guess. | Certain (OS pointer); Guess (hand pointer in the menu) |
| W11 | In full-screen mode ambient light is applied as a gamma ramp on presentation, so the copy is untinted. In windowed mode, or when no gamma ramp is used, the tint is built into the tile and sprite pixels, so the copy includes it. | From source |
| W12 | **Load inside a program:** the owner-relayed engineer account places the player as for `send` before drawing the loaded board into the program surface; the window flag and text stay unchanged, board music starts, the enter program runs nested and the caller continues. A [#1177 comment](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1177#issuecomment-6579294362) attributes redraw-before-placement to an owner ruling; its underlying direct owner wording has not been independently located. Clarification is needed. | P2 board redraw: certain; #1177 H nested entry and caller continuation: source-read, not run-confirmed; first-board skip: certain. Other details retain the engineer's given labels. |
| W13 | Boot: the start-up program is the first outermost program; the first board loads without drawing, so the board's enter program copies the start-up program's last presented frame and the first ordinary frame corrects it. | Source read (board load without a draw: certain) |
| W14 | An edge link to a `.prg` does not load a board, so the program it runs copies the frame that was on the display. | Source read |

Consequences for the composition, which are the ones this ADR rules:

* W7 and W8 mean the legacy program surface is a **frozen** image. The board underneath a program does not animate, and the overlay does not update. A program that wants the board again must call a redraw command, and that call throws away what the program drew (W8).
* W4 means "the last presented frame" can be a **program's own final screen**, window included, and not only a free-roam board frame.
* W5 and W13 and W14 decide which of the two it is at each kind of start.
* W9 and W11 describe overlay timing and tint. W10 does **not** establish unconditional cursor exclusion: the system pointer is usually absent, and the engine hand may be present; the menu case is a guess. Cursor policy remains open.
* W12 is the one command whose behaviour is fully specified for the copy: it redraws the loaded board into the program's surface and nests the enter program, so nothing is copied and the calling program keeps running over the restored board.

## Decision

### 1. The core composes the copy; nothing crosses the host boundary

The core supplies script-visible starting pixels through deterministic composition and does not request a host framebuffer or pixel readback. A retained draw list and surface snapshots, or a baked frame, are possible designs, not an approved storage choice.

The rejected `captureFrame` / `frame.captured` request-and-reply design is not part of this decision. Whether additional save or replay data is needed is a separate unresolved question.

### 2. Rules R0–R5 (proposed implementation of the accepted direction)

R0–R5 describe a candidate implementation and evidence-backed behaviours of the accepted compatibility model. The behaviour in section 3 is ruled for now; choices such as tick-end commits, storage, exact alpha and cursor treatment are not separately approved. Resolve uncertain evidence and save/restore before implementation.

**R0 — Initial state.** A fresh launch starts opaque black; program-test mode starts black (W2). Whether `reset()` recreates or retains the screen is unverified; reset-to-black is a separate proposal, not a ruling.

**R1 — Candidate tick-end commits.** Commit free-roam frames after tick work, with deterministic presentation inputs. A `.prg` edge link copies the previously presented frame (W14); do not substitute a newly loaded board. An edge onto a board is different: draw and commit the destination board before its enter program copies it (W5, R3b). The boot chain and same-frame starts follow R3. Exact commit mechanics and interpolation remain proposed, subject to the movement-lag tests.

**R2 — The copy is opaque.** The copy is rasterised over a black base, so its alpha channel is 255 everywhere. A program that clears a part of its surface reveals black, as the legacy copy does, not the live board.

**R3 — A program's final screen can be the copy.** When an outermost program ends and another program starts **in the same frame** (W4), the second copies the first's final screen: that program's surface plus its message window pixels as they stood when it ended. The engine commits that final screen as the presented frame at the moment the outermost program ends, before the window's visible flag is hidden. Ending a program hides the window and keeps its text (already ruled in [main-loop-and-startup.md#reawakened-script-surface-lifecycle](../spec/engine/main-loop-and-startup.md#reawakened-script-surface-lifecycle)); it does not redraw anything.

**R3a — Where the boot chain is the same frame.** The start-up program's end and the first board's enter program start with no frame between them (W13), so the enter program copies the start-up program's final screen, window included, over the black frame of R0. This is the case [#1171](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1171) records.

**R3b — Where a fresh board is drawn first.** An item trigger, an edge onto a board, and closing the menu draw the new board before the program starts (W5), so those programs copy the **board** frame, not the previous program's screen. Everything else is R3.

**R4 — Load redraws, it does not take a new starting copy.** The loaded board replaces the program surface; the window's visible flag and text remain unchanged and the enter program runs nested. The calling program continues as separately ruled in [#1177](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1177). How save-state restoration preserves the required history is open.

**R5 — Start replaces the layer.** At every outermost program start the engine rasterises the presented frame and **replaces** the script-screen layer with it (`replaceSurface` on the reserved layer), after the existing reset of the message window and text layer. The script-screen layer is this engine's program surface: the reserved persistent surface a script draws to when it names no canvas. Nested program and thread starts do nothing. Replacing, not compositing over, is what makes a finished program's drawing disappear ([#1172](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1172)) and what makes the program's surface destructive, as the legacy copy is.

### 3. Toolkit 3.1's presentation model, and the gap between it and this engine

**The model (Toolkit 3.1; engineer answers P1, P2 and P5, all labelled certain).** The program surface is a surface in its own right, not a layer over a board that keeps being drawn:

* **Free roam.** The engine composes the live board every frame: board, sprites, thread animations, the render-now overlay.
* **While a program runs.** The frame is the program surface, then the message window on top of it. The live board is **not** composed beneath it, the thread animations are not drawn, and the render-now overlay is not drawn live: what the overlay holds at that moment is what the last board redraw baked into the surface.
* **Board redraws.** Only the P2 commands redraw the board, the sprites, the thread animations and the overlay **into** the program surface from scratch, erasing what the program had drawn, and then present the message window over them: `send`, `Load`, `forceRedraw`, `setAmbientLevel` (which calls `forceRedraw` after applying the tint), `layerPut`, `putPlayer` / `erasePlayer` / `destroyPlayer`, `putItem` / `eraseItem`, setting a player's or an item's direction, `menu` after the menu closes, every frame of blocking movement (`playerStep`, `itemStep`, `push`, `pushItem`, `wander`, the path commands, the end of a `multiRun` block) and custom stances (`playerStance`, `itemStance`, `posture`).
* **The end of a program.** Ending it clears only the window's visible flag; nothing is drawn, so the window's pixels and the program's last screen stay on the display until the next draw — and stay through an interval in which nothing draws, as during a board load.

**The gap in this engine (measured on `origin/main` `94d5a00e`; audit of #1170).** There is no program surface distinct from the live board:

* `currentDrawList` composes the live board under the program on every frame and appends the render-now overlay (`engine.ts:3065`) and the thread-animation blits (`engine.ts:3068`) on **every** frame, outside the gate that restricts the script layer and the window to a running program (`engine.ts:3062-3063`, `:3070-3072`). A program that never touches the overlay still shows it, and shows animations running, over its own drawing: [#1183](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1183).
* No P2 command redraws into a program surface. `forceRedraw`, `putPlayer`, `erasePlayer`, `putItem` and `eraseItem` are catalogue stubs that validate their arguments and record nothing (`packages/core/src/script/catalogue-stubs.ts`); `layerPut`, `destroyPlayer`, `playerStep`, `itemStep`, `pushItem`, `playerStance`, `itemStance` and `posture` have no behaviour; `menu()` is accepted and ignored; `setAmbientLevel` writes the ambient immediately and lets the next composed frame pick it up (`packages/core/src/script/packs/world.ts`); `send` loads the board but leaves the program's drawing composed. Issue [#1182](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1182).
* The render-now toggle and drawing into the canvas take effect on the next composed frame instead of at a board redraw ([#1184](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1184)); an ambient assignment takes effect at once instead of after a redraw ([#1185](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1185)); a finished program's window pixels vanish on the next composed frame instead of remaining on the display until something redraws ([#1186](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1186)).

**One missing model, five facets.** #1171, #1172, #1182, #1183 and #1186 are facets of the missing program-surface model. A starting copy alone does not fix the live board and overlay being composed around it.

**Compatibility ruling.** The owner chose Option A: match the 3.1 model in section 3 for now. Future changes remain possible. The precise implementation of the copy and uncertain cursor behaviour remain open.

### 4. What the copy contains

**Included:** the board with tint baked into its pixels (W11), thread animations and the render-now overlay **as a snapshot** at their last redraw (W7, W9); a previous program's surface and message-window pixels when R3 applies (W4).

**Excluded, as a proposal pending the owner:** the engine's and the system's cursor. The evidence (W10) says the system pointer is usually not in the copy and the engine's hand pointer is in it only if it was on screen, with the menu case a guess; taking the copy without the cursor blit — whatever `mouseCursor` or a cursor map says at that moment — is the simpler rule this ADR proposes, not a fact from the source read. A full-screen gamma ramp is a presentation effect and never part of the copy; the core's ambient shading is in the board pixels (W11).

**Overlay snapshot.** A free-roam frame includes the enabled overlay and thread animations; the copy retains that snapshot. Under the adopted model, neither is composed live over a running program; they enter its surface on a board redraw. Current engine composition still does this live (`engine.ts:3065`, `:3068`): [#1183](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1183) tracks the gap.

### 5. Determinism, hash, save and restore

**Determinism.** G3 requires the same game data, seed and input log to yield identical script-visible pixels across runners and batching. Core composition avoids host readback, but proving this requires a concrete retention and restoration design and tests; tick history is not necessarily derivable from a current-state snapshot.

**Hash.** The existing [surface projection ruling](../spec/formats/save-game.md#state-hash-surface-projection) excludes presented surface 0 and script-screen layer -1. It does not automatically decide the treatment of a new retained prior frame. Script-visible reads can affect hashed state, so the new representation must be assessed against G3 and save/restore, not assumed safe because a cache is hash-neutral.

**Goldens.** A frame in which an outermost program is on screen gains the copy: the start-up program's frame becomes opaque black plus its drawing and window instead of a 99 %-transparent frame, and every program frame gains its layer blit. Free-roam board frames are unchanged (measured on the demo fixture during the #1067 investigation: its tick-120 board frame is already fully opaque, while the start-up program's frame is about 99 % transparent). Re-recording is a deliberate G5 change and must be explained in the PR that implements this ADR.

**Save, restore and replay — unresolved.** A prior presented image may reflect history not reconstructible from the current state, including a finished program's window pixels while a board load is pending or a mid-tick pause. A design must prove uninterrupted and restored continuations agree when scripts read the next starting frame, or explicitly preserve the necessary information under an approved save/hash contract. The existing surface exclusions do not establish that no schema change or replay data is needed. `Load`'s board-redraw behaviour and the separate #1177 thread-restoration questions are not a substitute for this proof.

### 6. Consequences for the guard-rails

* **G1:** The core-only direction introduces no host wait; a concrete saveable VM and frame-retention design still needs verification.
* **G2:** Core must not read a display or host framebuffer.
* **G3:** Deterministic script-visible pixels and continuation across restore must be demonstrated; section 5 records the unresolved history problem.
* **G4:** Runners replay draw lists; the core reference rasteriser is available for script-visible pixels.
* **G5:** Any changed program-frame goldens require a deliberate, explained re-record.
* **G6, G7 unchanged.**

### 7. Six design questions: evidence and remaining choices

The owner adopted the 3.1 presentation model for now, not every engineering proposal below. Rows describing certain 3.1 behaviour follow that compatibility target; cursor exclusion, detailed alpha representation and save/replay mechanics remain open where not independently ruled.

| # | Question | Proposed answer |
|---|---|---|
| 1 | Scope of programs that capture | Every outermost program start: start-up program, board enter program, item activation, step-on trigger, edge link to a `.prg`, run-time key program, menu-choice program, battle handoff, recovery resume. Nested programs and threads do not copy (W3). |
| 2 | Overlay and cursor inclusion | Overlay and thread animations are included as the snapshot they were (W7, W9); tint is included in board pixels (W11). Unconditional cursor exclusion is proposed, not ruled: W10 reports the hand may be present and labels the menu case a guess. |
| 3 | Null fallback colour | Opaque black (`a=255`, `rgb=0`), for the initial frame and in program-test mode (W2). |
| 4 | Premultiplied alpha | Moot: the copy is opaque, so there is no alpha to interpret. |
| 5 | Saved-game capture replay | Load redraws the board without a new outermost starting copy (W12, #1177). How prior-frame history survives save/restore and replay remains open (§5). |
| 6 | Program-test mode | Opaque black, and no board and no prior frame are read (W2). |

### 8. Candidate implementation plan

Design only; no code is part of this ADR. The sequence and touch list are proposals, not owner-approved implementation decisions. Any delivery must preserve the accepted compatibility behaviour and resolve the save/replay questions in section 5.

**Order.** Three landings, in this order, with the ordering argument stated because it is not the obvious one:

1. **The program surface and its seed, together.** Create the real program surface, seed it from the prior core-composed frame, and gate the live board, thread animations and overlay while a program runs. Shipping the gate without a seed would leave partial-drawing programs with the wrong background. Determine retention, cursor policy and save/restore first; implementation order is a proposal, not an owner ruling.
2. **The P2 redraw commands.** `forceRedraw`, `setAmbientLevel`, `layerPut`, `putPlayer` / `erasePlayer` / `destroyPlayer`, `putItem` / `eraseItem`, the direction setters, `menu` after it closes, the blocking-movement frames and the custom stances, each redrawing board, sprites, thread animations and overlay into the program surface from scratch: [#1182](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1182). `menu()` itself and the command's own screen are separate work.
3. **The remaining P-facets.** The render-now toggle and `cnvRenderNow` drawing taking effect at the next board redraw ([#1184](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1184)), and the ambient assignment going through a redraw instead of tinting the next composed frame ([#1185](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1185)). Both are small and independent of the copy.

**Touch list.**

1. **Engine:** design and implement core-owned frame retention, program-surface composition, start and end transitions and board redraws. Cursor handling remains open.
2. **Triggers:** ensure every applicable outermost start is handled; nested programs and threads do not take a new copy.
3. **Raster:** use deterministic core pixels for script-visible reads.
4. **Save, hash and replay:** settle and prove the retention representation and required contract changes before implementation; no no-schema-change assumption is approved.
5. **Docs first, in their own commit (G7 rule 4).** This ADR; the spec rule and the paragraphs it replaces; the lifecycle table rows; the note in [runners.md](../spec/engine/runners.md#surface-read-and-state-hash) that the starting copy is core-composed.

### 9. Test matrix

Each row names the perturbation that must make it fail. Ordinary unit tests stay under one second (AGENTS: tests stay fast); deterministic behaviour is asserted at representative ticks, not replayed tick by tick.

| # | What it proves | Perturbation that must fail it |
|---|---|---|
| T1 | Free-roam copy excludes the finished program's text and message window, and includes the board and the render-now overlay. Program A draws text and opens a window, ends; one free-roam tick; program B reads pixels through `getpixel`. | Compose the copy with a program treated as active. |
| T2 | One-movement-increment lag: a step-on program copies the frame from before the step it responded to. | Capture at program start instead of at tick end, or compose the copy at alpha 0. |
| T3 | Batching independence: the same inputs as N `advance(1)` calls and as one `advance(N)` leave program B's copy and every state hash identical. | Commit the presented frame at the end of `advance` instead of at each tick end. |
| T4 | An edge link to a `.prg` copies the old board's frame; an edge onto a board that draws before its enter program copies that fresh board frame (W5, W14). | Substitute the destination frame for the `.prg` link or the old frame for the fresh-board case. |
| T5 | R3a boot chain: a start-up program draws text and a window; the first board's enter program copies that final screen over opaque black, matching #1171's expectation. | Let R1 overwrite the R3 commit with the board-less frame. |
| T6 | R0: with no start-up program the first board's enter program copies opaque black, every pixel `a=255`. | Skip the black base of R2. |
| T7 | R3 versus R3b: two programs in one frame copy the first's final screen; an item trigger after a free-roam tick copies the board, not the previous program's screen. | Treat every start as R3, or every start as R3b. |
| T8 | Nested `executeProgram` and `thread()` leave the script-screen layer's revision unchanged. | Seed the layer in the thread-start path. |
| T9 | R4: a Load renders the loaded board into the program's surface and does not carry the pre-load frame; the loaded board's enter program makes no copy; the window's flag and text are unchanged. | Reuse the pre-load presented frame after a Load. |
| T10 | Snapshot/restore at tick boundaries and at history-sensitive transitions yields the same next script-visible starting pixels and continuation as an uninterrupted run, under the resolved save contract. | Drop the retained history needed by a same-frame successor or loading interval. |
| T11 | Existing 0/-1 surface hash exclusions hold; script-visible reads and any new retained state obey the ultimately approved hash contract deterministically. | Perturb the chosen hash projection or substitute different restored pixels. |
| T12 | Golden: program frames re-recorded with the reason stated; Node and Bun replays agree. | — |
| T13 | Cost structure: a multi-tick batch with no program start, script drawing, board redraw or other surface-changing event avoids redundant surface writes; no wall-clock assertion. | Repeatedly rewrite unchanged surfaces. |
| T14 | The live overlay is absent over a running program. Cursor-copy assertions depend on the unresolved cursor policy. | Compose the live overlay above a program's surface. |
| T15 | **Depends on landing 2 of section 8 (#1182).** A P2 redraw command (`forceRedraw` as the representative) erases what the program drew and bakes in the board, thread animations and overlay as a one-time snapshot; a later tick does not re-compose the live overlay over the program. | Draw the redraw as a composite layer instead of a replacement. |
| T16 | **Depends on #1183.** The live overlay is not composed over a program's surface (Toolkit 3.1 behaviour, W7). | Compose the enabled overlay while a program runs, as `engine.ts:3065-3068` does today. |
| T17 | **Depends on landing 1.** A running program's frame is its surface then the window: no live board beneath, no thread animation, no live overlay. A program that only calls `wait()` shows the copy, not the board. | Recompose the live board or the live overlay around the surface. |
| T18 | **Depends on landing 1 (#1186).** A program ends with its window open: the window's pixels stay on the display until something redraws, instead of vanishing on the next composed frame. | Hide the window and recompose on the frame the program ends. |
| T19 | **Depends on landing 3 (#1184).** `rendernow(true)`, `rendernow(false)` and drawing into `cnvRenderNow` take effect at the next board redraw, not on the next composed frame. | Re-read the canvas every composed frame. |
| T20 | **Depends on landing 3 (#1185).** An ambient assignment takes effect through a redraw, not by tinting the next composed frame; the program's drawing survives the redraw only as the P2 rule says. | Apply the new ambient to the next composed frame, as `script/packs/world.ts` does today. |

### 10. What this design does not decide

* Where and how the presented frame is retained, and how save, restore, replay and hashing preserve observable behaviour. Either a retained draw list or a baked image needs a determinism and history proof; the single-run demo measurements in the feasibility report do not settle that choice.
* The implementation ordering of W8's redraw commands. The owner has adopted their presentation model for now; the exact delivery sequence is not ruled.
* The exact pixel difference between core's movement increment and the legacy engine's. The copy's one-increment lag is reproduced in principle; its size in pixels is a movement-model question.

### 11. Owner decision: Option A, compatibility for now

On 2026-11-02 the owner chose **Option A**: match Toolkit 3.1's presentation model described in section 3 for now. This does not preclude changing the behaviour going forward. A running program displays its program surface with the message window on top, not a live board, thread animations or render-now overlay; board redraw commands and Load replace the surface with a board snapshot. A completed screen remains until a draw replaces it.

Option B, keeping the current live-board and live-overlay composition as a deliberate difference, was considered and not chosen. The ruling does not decide the copy's storage, save/replay schema, or unconditional cursor exclusion. The engineer's source-read labels and menu-pointer guess remain as recorded in the evidence table.

## Relation to open issues

#1171, #1172, #1182, #1183 and #1186 are facets of the missing program-surface model adopted in section 11. The implementation remains outstanding.

* **[#1067](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1067)** — this design is its answer. The ticket's "Proof of fix" mentions an interactive runner supplying the prior pixels; under this ADR no runner supplies pixels, so the proof becomes the core tests in section 8 plus the golden re-record.
* **[#1171](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1171)** — the empty frame between the start-up program's end and the first board. R3a commits the start-up program's final screen as the presented frame, so that interval presents the title rather than an empty draw list.
* **[#1172](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1172)** — a finished program's script-screen pixels composed into later programs. R5 replaces the layer at every outermost start, which is the replacement #1172 asks for.
* **[#1177](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1177)** — the owner ruled start-program Load continues the caller and invokes the loaded enter program nested; [save-game.md](../spec/formats/save-game.md#reawakened-full-engine-save-and-load) records that exception, the conflicting attributed ordering accounts and their provenance, and open saved-thread, VM, tick and UI treatment.
* **[#1182](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1182)** — no P2 command redraws into a program surface and `forceRedraw` is a stub. Landing 2 of section 8.
* **[#1183](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1183)** — the overlay and thread animations compose during a running program. Landing 1 of section 8; the required behaviour is in section 4.
* **[#1184](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1184)** — the render-now toggle and `cnvRenderNow` drawing take effect on the next frame, not at a board redraw. Landing 3.
* **[#1185](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1185)** — an ambient assignment changes the composed frame at once. Landing 3.
* **[#1186](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1186)** — a finished program's window pixels vanish on the next composed frame. Landing 1.
* **[#1045](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1045)** — the engineer's answers this ADR builds on, and the lifecycle rule it extends.
* **[#1048](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1048)** — the hash projection and read-only accessor this ADR reuses.
