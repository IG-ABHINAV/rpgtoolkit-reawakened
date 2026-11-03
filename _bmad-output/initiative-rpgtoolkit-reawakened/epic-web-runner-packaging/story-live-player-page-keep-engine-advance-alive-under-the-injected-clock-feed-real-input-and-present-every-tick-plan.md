---
title: 'Live player page: keep engine.advance() alive under the injected clock, feed real input, and present every tick'
type: feature
ticket: 16
created: '2026-11-01'
status: in-progress
baseline_revision: '58abc1966540f18bd541914608a0f74331f11780'
route: full
route_source: auto
risk: high
review: quick
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The browser and desktop players currently render a scripted closing-suite frame rather than a visible, interactive session.

**Approach:** Run one persistent core engine under host-side fixed-tick pacing, forward real input and blob replies, and replay its draw list into an attached canvas. Prove demo rendering, movement, existing tick-120 hashes, and desktop presentation with real runs.

## Boundaries & Constraints

**Always:** Use the injected core clock and existing engine, input, rendering and host-blob contracts. Keep presentation alpha out of simulation state and hashes. Follow G1–G7 and do not consult legacy source. The parity test uses the closing plan's exact input and no extra bindings; the separate interactive test uses real input and expects state and frame changes.

**Never:** Modify `packages/core` except to fix the documented E-52 sprite-compositor and E-02 initial-player defects or use an existing seam; stop and report if any further new core seam or missing spec sentence is needed. Do not duplicate core sprite projection in a runner or fake player presence. If any closing golden moves, stop and report it before proceeding; never re-record goldens to make a test pass. Claim mobile acceptance only after its wrapper exists and an emulator/device run succeeds.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Expected behavior |
|---|---|---|
| Boot | Demo package, assets pending | Match each request with a reply; display a real canvas when the board is ready. |
| Keyboard and pointer | Key edges and pointer events | Deliver correctly ordered core records; `wait` claims a key once and movement affects the player's position. |
| Focus | Focus lost and regained | Stop simulation while unfocused; continue delivering focus events so it resumes. |
| Save | Core requests a blob | Host persists or loads under `saves/<gameId>/…` and returns the matching request ID or failure. |
| Presentation | Vary alpha | Forward alpha only to drawing; unchanged inputs give unchanged state and draw hashes. |

</frozen-after-approval>

## Code Map

- `packages/runner-web/app/main.ts` and `app/index.html`: currently a one-shot tracer on an attached fixed-size canvas; replace its player path with a live session while preserving the tracer contract used by browser tests.
- `packages/runner-web/src/index.ts`: asset providers, `runScriptedFrame` and WebGL replay; reuse these rather than reimplement rendering. The live engine needs current mutable surface pixels.
- `packages/runner-harness/src/closing.ts`: private boot setup and closing input schedule; `runClosingFrames` creates a temporary engine and cannot itself serve as a persistent player. `golden/closing/plan.json` schedules ENTER at ticks 30, 60 and 90; `golden/regression/closing.json` holds the expected tick-120 hashes.
- `packages/core/src/ports/engine.ts`, `engine/engine.ts`, `input/{input,registration}.ts`, `sprites/{movement,runtime}.ts`: existing `advance(ticks, inputs, maxTicks)`, registrations, one-time key claims and sprite presentation. `advance` returns a report, not a state; the host supplies whole ticks. It must still deliver focus-gained while paused.
- `packages/core/src/ports/{input,requests}.ts` and `script/builtins/files.ts`: input records and blob request/reply IDs. Blob paths include a game ID.
- `packages/runner-desktop/app/{player.ts,player.html}`, `src/{main,preload}.ts`, `tools/desktop/build.mjs`: desktop uses a separate one-shot page and host IPC keyed by area/game/path. Integrate the shared session there rather than leaving the window on the detached measurement canvas.
- `tools/browser/tests/{tracer,package}.spec.ts`, `packages/runner-web/test/runner-web.test.ts`, `tools/desktop/measure.mjs`: existing real-browser, hash and desktop verification paths.
- `docs/playing-the-desktop-player.md` and `CHANGELOG.md`: update actual delivered behavior and remaining limits.

## Tasks & Acceptance

**Execution:**
- [x] Fix the E-52 defect in `packages/core/src/engine/engine.ts` so the pure compositor receives the authoritative `state.sprites` view, not a separately owned sprite runtime. Prove the closing hashes remain unchanged immediately; stop if they move.
- [x] Fix the E-02 step-6 initial-player defect: acquire and parse the real `initChar` and create the actual player in core before startup and board entry, using the existing contract. Keep presence truthful. The implementation landed in `672ec7dd`; after the director-authorized closing-baseline re-record (`79c4ffdd`), the expected state-hash change is recorded below. This re-record is for the required E-02 state transition, not to make a parity test pass.
- [x] Implement one persistent live engine and deterministic whole-tick host pacing, boot/asset and blob request handling, focus handling, disposal and presentation on the shared web runner path.
- [x] Connect real keyboard and pointer events to the existing input phase and single-claim protocol; map coordinates into canvas space. Register the existing input/movement owners and use core-owned sprite presentation.
- [x] Integrate that live path with the desktop page and existing host blob boundary; size and attach the visible canvas. Preserve desktop measurement and browser tracer evidence.
- [x] Add the distinct parity and interaction tests below, plus key-claim, alpha, focus and real host save/load checks.
- [x] Update the desktop guide and changelog only to describe demonstrated behavior.

**Acceptance criteria:**
- Given the demo, when the live page runs, then a document-attached canvas sized for the board contains nonblank board pixels.
- **Interaction test:** Given a separate interactive session with movement bindings, when a real movement key is pressed, then a measured player-position fact and the rendered frame both change relative to that session's first frame. A waiting script receives its key exactly once. Do not compare this run to the closing golden.
- **Parity test:** Given a live session configured exactly like the closing harness, without extra bindings or input/movement owners, when the closing-plan ENTER pairs are delivered at ticks 30, 60 and 90 and the session reaches tick 120, then its state hash matches the current committed demo closing baseline `91172695de52cfd6` and its draw hash remains `9a40be8a0b5ca816`, without further golden changes or substituting the one-shot tracer.
- Given the desktop package, when `pnpm desktop:measure` and a visible launch are run, then measurement succeeds and the actual window displays the board.
- Given the same state and inputs, when presentation alpha changes, then state and draw hashes are unchanged.

## Resolved evidence and E-52 defect

### Parity inputs and key claims

The closing harness creates its own engine with seed 3, 640×480, `maxTicks` 600, all three drawing include flags, the supplied assets and bundled fonts/cursors, and startup/effect doubles; it supplies neither input bindings nor input/movement phase owners (`golden/closing/plan.json:1-16`; `packages/runner-harness/src/closing.ts:162-214,263-285`). The default audio-phase observer does not add movement. The doubles track player presence and position but **do not draw sprites** (`closing.ts:1-9,162-175`), so golden parity proves that configuration, not visible moving sprites.

After capturing each checkpoint at tick 30, 60 and 90, the harness queues a down then up record at the same tick: `{kind: \"key\", name: \"ENTER\", code: \"Enter\", char: null, down: true/false}`; the next `advance` processes those records before the tick increments (`closing.ts:328-344`; `packages/core/src/engine/engine.ts:2971-3002`). Boot starts with `advance(0)`; asset/video replies carry the matching request ID and `report.tickAfter`, and loading is serviced without charging unrun ticks (`closing.ts:293-325,332-333`). Capture at 120 calls `drawList(0, INCLUDE)` and hashes it (`closing.ts:245-259`). A persistent live page can reproduce this configuration; parity remains a test to run, not an observed result for an unbuilt page.

Without bindings, a nonrepeat keydown enters the raw key queue, so `wait` uses the core's claim protocol (`packages/core/src/input/input.ts:20-42,120-133`; `packages/core/src/engine/engine.ts:2703-2728`). A separately constructed interactive engine may configure directions and register the existing input and movement owners. Its nonempty bindings are hashed state and unmapped keydowns are dropped (`input.ts:46-60,120-133`; `packages/core/src/save/hash.ts:213-216`); therefore it is not the parity configuration, and its arbitrary-key behavior must not be assumed correct merely because movement works.

### E-52 defect: authoritative sprite section feeds the compositor

`inputPhaseRegistration` and `movementPhaseRegistration` update `state.sprites`; `spriteDraws(section)` already projects actor positions and visuals (`packages/core/src/input/registration.ts:50-77`; `packages/core/src/sprites/movement.ts:513-537`; `packages/core/src/sprites/runtime.ts:263-283`). But `Engine.drawList` reads `init.spriteRuntime?.draws()` or static `presentation.sprites`, not `state.sprites` (`packages/core/src/engine/engine.ts:2827-2829`). An independently created `SpriteRuntime` owns a separate section by default (`sprites/runtime.ts:286-315`), and ordinary movement does not synchronize it. The existing static sprite input is expressly temporary until the section feeds the compositor (`engine.ts:191-194`). A runner can technically observe phase state, but a runner-side projection or mirror is not a documented presentation seam and would duplicate core ownership.

**Owner direction, 2026-11-01:** This is an engine defect against the existing E-52 compositor-input rule, not a new ruling. `docs/spec/engine/main-loop-and-startup.md#e-52` already says: “`composeBoard` consumes a read-only world view containing run-time board edits, sprites, the current tick and `alpha` ... `Engine.drawList`, `viewBrd`, the editor canvas and image export call this same pure compositor; it does not read mutable engine state directly.” Fix `Engine.drawList` to derive its sprite view from authoritative game-state sprites and feed the same pure compositor, without a second sprite store deciding what is drawn. Preserve the closing configuration and both exact tick-120 hashes; if a golden moves, stop and report it. Do not amend E-52 or move core projection into the runner.

### Mobile follow-up

At baseline `packages/runner-mobile` is absent and [#940](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/940) is open, not merged. After the live page lands, #940 is the immediate follow-up: build the wrapper if still absent, then prove its acceptance on the emulator/device; do not claim it already passed.

## Implementation Notes

- Before E-02, fixing E-52 by projecting the authoritative `state.sprites` through `spriteDraws` for the existing pure compositor (with static scene sprite inputs remaining additional inputs) and adding focused engine regression coverage was followed by an immediate `pnpm closing` result of `8/8 games match their then-current baselines` across batching 600/30/7.
- Parity investigation: with closing doubles, matching init options, and the closing harness's tick-30 screen capture, the live parity test passed both pinned hashes. Removing only the no-op trigger applier yielded a different state hash and `triggers.deactivateAt` changed from null to `{x:213,y:146,layer:1}`; removing only the no-op audio applier also yielded a different state hash and changed audio/request state. Without the tick-30 screen read, the screen surface revision and bitmap differed starting at tick 60 and the resulting hash differed. These tests isolate distinct differences; they do not establish interactive play. The parity driver currently batches 30 ticks per call and is not yet proof of presentation on every real animation frame.
- Historical pre-E-02 interaction investigation: the real browser test reported a null player position and stalled at tick 77 after ENTER/title navigation. The investigation traced the missing `createplayer` effect described below. The E-02 implementation is committed as `672ec7dd`.
- Post-E-02 interaction and desktop evidence: `pnpm browser:test` passes the live-player movement, empty-`startupPrg` boot and focus pause/resume tests; `pnpm desktop:input` proves a trusted right-arrow key event moves the player one 32-pixel step in the Electron window (demo: `213, 146` → `245, 146`; authored probe: `208, 191` → `240, 191`). A macOS `pnpm desktop:run --package /tmp/tkr-authored-1018.dVCVR0/tiny-example.tpk` showed the package's own village board after Enter, with the status reporting a player position. The pre-E-02 `pnpm desktop:run` had shown only the title screen; the post-E-02 visible launch is recorded here.

### Finding — E-02 initial-player creation defect (resolved in `672ec7dd`)

The original finding was a defect against approved `docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence` step 6: boot posted `sprites.createplayer(initChar)` (`packages/core/src/engine/engine.ts:2104-2109`), but the default sprite effect owner (`engine.ts:477-508`) delegated to `applySpriteEffect`, which had no `createplayer` handler (`packages/core/src/script/packs/movement.ts:294-353`). A separate `SpriteRuntime` needed a board to create a player (`packages/core/src/sprites/runtime.ts:335-339,357-360`), while E-02 requires player creation before startup and board entry. The approved correction acquires and parses the real character and creates the player in core before board entry; it landed in `672ec7dd`.

### E-02 implementation and current closing baseline

The distribution-package manifest's `index` stores every game-file **path**, not file bytes or parsed assets (`docs/spec/formats/packaging-and-paths.md:98-106`). Even though boot prefetches fonts and programs, those paths do not provide the actual `initChar` bytes needed by E-02 step 6. Core must request and parse the character through the existing host asset-request contract before startup and board entry; this is a required data read, not an optional prefetch hint.

The normal asset request advances `nextRequestId` and carries that ID through its host reply (`packages/core/src/engine/engine.ts:1041-1045`). The engine section saves `nextRequestId` and pending request IDs (`engine.ts:1345-1349`), so request/reply IDs remain distinct across save/restore. `hashGameState` hashes the complete game state apart from its documented exclusions (`packages/core/src/save/hash.ts:202-216`); therefore the saved request sequence is hash-visible, and adding this required request changes the deterministic state hash. Hash-neutral prefetch hints use a separate counter precisely because they need no reply (`engine.ts:340-344`); the E-02 asset request is not such a hint.

The implementation is commit `672ec7dd`. The re-record in `79c4ffdd` was director-authorized because the distribution-package manifest's `index` stores paths, not file bytes, so boot must request the actual `initChar` bytes through the existing host asset contract. That request advances the deterministic `nextRequestId`, which `hashGameState` includes; therefore the state hash must change. The review confirmed only tick-120 `stateHash` values moved — draw hashes, pixel bytes and command counts stayed byte-identical. `demo`'s current tick-120 state hash is `91172695de52cfd6`; its draw hash remains `9a40be8a0b5ca816`. Tick-120 state hashes changed for five games: `demo`, `Basic`, `Caoquest`, `ChimeranEmpire` and `FinalDestiny`. The other three—`School2Demo`, `LittleMan` and `BusDriver`—were unchanged.

The parity and screen-read comparisons above and below are pre-E-02 observations. Their recorded demo state hash is retained as history and superseded by the current baseline. Post-E-02 interaction and desktop passes are recorded in the bullet above and in Verification below.

### Finding — proposed ruling: screen-surface reads and state hashes

**Observed:** In the controlled closing-parity comparison, omitting the title-frame screen read at tick 30 left screen surface 0 at revision 2 instead of 3, with different bitmap bytes from tick 60 onward; the tick-120 state hash differed from the previously recorded closing state hash. Performing the same screen read as the closing harness restored both golden hashes. `Engine.surfacePixels(0, rev)` calls `refreshFrame()` (`packages/core/src/engine/engine.ts:2888-2900,3041-3043`), which may `replaceSurface` in the saved surfaces section; `hashGameState` includes surface bitmap and revision (`packages/core/src/save/hash.ts:184-197,213-220`). Thus a host screen-surface read can affect a later state hash; the observation does not establish that every presentation call does so.

**Proposed ruling, owner decision pending:** Amend `docs/spec/engine/main-loop-and-startup.md#reawakened-presentation-alpha` and the E-52/E-57 screen/compositor contract on that same page to state whether a host screen read is presentation-only or a simulation-visible update, including its hash and save implications. Account separately for script-visible `savescreen`, `getpixel` and `canvasgetscreen` semantics in `docs/spec/engine/rpgcode-functions.md#e-56`. Consider both keeping a deterministic simulation-owned screen refresh schedule and separating host presentation reads from script-visible screen state; do not decide, amend the spec, change `refreshFrame` or alter goldens under this story. This is a finding, not evidence that the existing closing golden can be weakened.

### Live player implementation

- Live player implemented. `packages/runner-web/src/live-session.ts` owns one persistent engine; the browser page (`app/main.ts`) and desktop page (`app/player-live.ts`) each set up the session, attach the canvas and run a frame loop that accumulates elapsed time and calls `advance(wholeTicks)` — R-56's rule, with the leftover fraction passed only to `draw(alpha)` as presentation. No `Date`/`performance.now` reaches core.
- The interactive path is descriptor-driven and needs no closing plan. The runner reads the package's sibling `<package>.tpk.json`, validates its file name, size and SHA-256 against the package, derives the canonical identity from the package's sorted files (see the identity defect below), and takes the main asset from the package's own manifest. The closing plan and its stand-ins are reachable only through the parity/measurement routes: `?parity`/`?tracer` on the web page, and the separate `player-measure.html` entry that `desktop:measure` launches and `--report` implies. A normal `pnpm desktop:run --package …` loads only the interactive page.
- The frame is the game's own: the runner reads the resolution from the packaged main file (640×480, 800×600, 1024×768 or the custom `resX`×`resY`) and gives that to the engine as its logical viewport. The page presents it at the largest whole-number scale that fits and centres it, which is AD-33's pixel-perfect letterbox. A board larger than the frame scrolls — the camera follows the player and clamps to the board's edges — and a smaller one is centred; neither is a scaling decision.
- Keyboard and pointer events are recorded with the session's tick and delivered as core input records; focus loss and gain are forwarded so the engine's own pause/resume rule applies.
- Saves go through the existing `LiveBlobHost` seam: the session strips the `<gameId>/` prefix core puts on blob paths and calls the host with `(area, gameId, relativePath)`. Desktop writes files under Electron's user data directory; the browser page writes `localStorage`. Both use the same canonical key, but the stores are physically separate — see the portability gap below.
- Presence during boot no longer reads a phase-captured state snapshot. An interactive session constructs a real `SpriteRuntime`, passes it to the engine, and answers the startup presence check from `hasPlayer()`. E-02's `createplayer` is dispatched synchronously into that runtime before the check, so a package with a valid `initChar` and an empty `startupPrg` now reaches its board; a package whose character is absent or undecodable still reports `startup.no-player` because nothing is created.

### Finding — the viewport was fixed at 640×480 instead of the game's own resolution (fixed here)

The spec gives the frame to the game and the scaling to the runner. `docs/spec/engine/main-loop-and-startup.md:59` lists "Create the window and graphics device: **resolution from the main file** (640×480, 800×600, 1024×768 or custom)" and line 74 says steps 4 and 5 "belong to the runner … **The core does nothing for them**". `docs/spec/engine/runners.md:53-56` is explicit that "the core emits a draw list for the logical viewport; a runner maps it to the physical display in one of the two modes AD-33 allows — integer-scaled pixel-perfect letterbox, or responsive expand-viewport — chosen by the player, never by the game state". AD-33 exists precisely to prevent "fixed-resolution CRT lock-in (640×480)".

The live session did the opposite on both counts: every packaged game got a hard-coded 640×480 engine viewport, and the canvas was sized from `state.world.board` — a game-state value — while the physical upscale was a fractional CSS stretch with a hard-coded 4:3 aspect ratio.

What changed: the interactive session reads the main file's resolution and passes it to the engine; the canvas is the logical frame; the page fits it at the largest whole-number scale that fits and centres it, removing the fractional stretch; board size now only decides what the camera does, exactly as E-51 and E-53 prescribe (clamp to scene bounds when larger, `center-if-small` when smaller). The parity and measurement routes keep the closing plan's dimensions, so no golden or measurement value moved.

Still a limit, stated rather than hidden: the Electron window is a fixed 960×720 frame. A frame larger than 960×720 is shown at `1×` in that window, so it is centred and clipped; it does not shrink to fit. Smaller frames are centred with a black surround. The window is not sized to the game.

### Correction — the first E-52 regression test never drew a sprite

The `Engine.drawList` test added with the E-52 fix called `engine.drawList()` with no include argument, and the default include sets `sprites: false`; it therefore asserted on an empty sprite list and could not pass. It is replaced by a test in `engine-boot.test.ts` that boots a game with a real character, passes `{ sprites: true }`, and checks three things: the player's fallback square is drawn from `state.sprites`, the static scene sprite is still drawn alongside it, and making the player walk moves the drawn sprite. The E-52 fix itself was independently evidenced by the unchanged closing draw hashes.

### Fixture fallout from E-02 (fixed, not suppressed)

E-02 now reads the declared `initChar`, so fixtures that named a character but shipped one byte of placeholder data reported `asset.invalid`, and fixtures that place their own player through `createInitialPlayer` ended up with two players — the encounter-walking double then moved the wrong one. Both are fixture defects, not engine defects: affected boot fixtures now carry a decodable character written by `writeCharacter`, and the battle fixtures that build their own player name no initial character. One reset test now selects the actor it seeded by behaviour instead of by array position.

### Finding — package identity defect (fixed here)

`tools/make-package` wrote `gameId = deriveGameId(mainBytes, title)`, and the runner's descriptor validation derived the same way. That contradicts AD-17: a package's game identity is `derivePackageIdentity(sorted files)` — the file set, not the title — and `deriveGameId` then folds the main file's bytes into that identity (`docs/spec/formats/save-game.md:25-35`). A title-based key is internally consistent but non-conforming, so its saves land where no conforming runner would look, and renaming a package would silently orphan them.

The builder now derives `gameIdentity` from the distribution files and writes `gameId = deriveGameId(mainBytes, gameIdentity)`; the descriptor shape is unchanged and the title no longer affects identity. The runner validates the descriptor against the same two derivations. Tests cover title independence, identity stability for an identical rebuild, and a changed non-main file changing the identity. `demo`'s descriptor moved from `bbc5e32e2515bd5c` to `52955b27322ae9d8`; its tick-120 state and draw hashes did not move, because the identity is a save key, not simulation state.

### Finding — save portability gap (open, owner decision)

Saves are durable on the host that wrote them, under the canonical game key. They do not move between hosts: the browser page stores blobs in its origin's `localStorage`, the desktop player stores files under Electron's user data directory, and no code bridges the two. `tools/desktop/measure.mjs`'s save probe reads back its own synthetic blob through the same host, so it is not cross-runner evidence.

Closing that gap is a product decision, not a defect fix: it needs either an export/import path for save files or one blob service shared behind the AD-17 boundary, and the desktop measurement's claim should be narrowed either way. Tracked as [#1021](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1021); not built here.

## Plan Change Log

## Review Triage Log

## Verification (this change)

- `pnpm closing` → `8/8 games match their baselines`, batching 600/30/7 identical.
- `pnpm golden` and `pnpm golden:bun` → 20 vector rows, 24 golden comparisons, 27 script programs, 12 scene goldens exact, 9 audio-cue sets stable.
- `pnpm typecheck` → clean, including every package's `typecheck:tests`.
- `pnpm lint` → clean.
- `pnpm test` → 2656 tests, 2656 pass.
- `pnpm make-package:test` → 11/11, including the canonical-identity cases.
- `pnpm browser:test` → 11/11, including the parity test at state `91172695de52cfd6` / draw `9a40be8a0b5ca816`, the interactive movement test (a held ArrowRight moves the player one 32-pixel step and changes the frame), the empty-`startupPrg` boot regression, and focus pause/resume.
- `pnpm desktop:build && pnpm desktop:measure --out tools/desktop/measurements/macos.json` → state `91172695de52cfd6`, draw `9a40be8a0b5ca816`, frame worst 0.
- `pnpm desktop:run --package /tmp/tkr-authored-1018.dVCVR0/tiny-example.tpk` → a temporary package built from `docs/spec/examples/game` (no legacy download, not committed) showed its own village board after Enter, with the status reporting a player position.

## Gap record (2026-11-03 audit; open work, no status change)

The web leg of acceptance is provable from the merged battery at main:
`tools/browser/tests/live-player.spec.ts` boots demo to the board on a visible canvas and moves the
player under a held key; `tools/browser/tests/live-parity.spec.ts` pins the
live page's tick-120 parity against `golden/regression/closing.json`; `mobile.spec.ts`,
`storage.spec.ts` and `package.spec.ts` cover the wrapper, per-host durable saves and the
no-start-up-program package; and the trigger phase is live since PR #1218 (merged 3fa7f68d).
Remaining gap precisely: no committed evidence shows the desktop shell running the shared live loop
interactively on an authored non-demo package (macOS measurement is demo-only; desktop evidence is
tap/hold probes), and the acceptance asks for an authored non-demo package rendering its own board in
the desktop player, with saves staying per-host (= #1021's round trip for hosts). Implementation gap:
one interactive desktop run recording hashes and a screenshot; nothing about the web page itself is
missing.
