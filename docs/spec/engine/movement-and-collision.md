# Movement, collision, activation and board changes

Players and board items are both "sprites". This page describes how they move, what stops them, how programs and items are triggered, how the player moves between boards, and path-finding.

## Positions

<a id="e-20"></a>
**E-20 Sprite kinds.** **Players** (party members; only the *selected* one is shown and controlled) and **items** (NPCs, props, pickups placed on the board or created by script). Both have directional walk and idle animations, battle stances, custom stances, a **collision base** polygon and an **activation base** polygon, a speed (seconds per step) and an idle delay.

<a id="e-11"></a>
**E-11 Coordinate systems.** 2D top-down, isometric-stacked and isometric-rotated, each optionally "pixel absolute". All run-time positions are **pixels**; the tile↔pixel conversion is in [../formats/board.md](../formats/board.md#coordinates). Script coordinates are interpreted through the board's pixel-absolute setting; vector and program points are always pixels.

- Sprite positions are **board pixels** (fractional values allowed). The reference point is the **bottom-centre** of the sprite's tile: pixel (16, 31) within a 32×32 tile on normal boards, the tile centre on isometric boards.
- Each sprite has a **collision polygon** and an **activation polygon**, relative to its reference point ([../formats/character.md](../formats/character.md#defaults-and-fall-backs)).
- Each sprite is on one layer.

**Reawakened rule (OWNER; presentation alpha).** `alpha` is presentation-only interpolation of the camera and optional prior sprite positions. It is never stored in simulation state and is excluded from state and draw-list hashes.

## Movement modes

| Main-file `pixelMovement` | Behaviour |
|---|---|
| 0 — tile movement | each move is a full 32-pixel step to the next tile |
| 1, 2 — pixel movement | each key press steps 4 px, so sprites can stop between tiles and the two modes walk alike; the mode governs the size of *scripted* pushes |

Movement is queued: the keyboard, the mouse, scripts (`Push`, `PlayerPath`, `ItemPath`…) and waypoint vectors add steps or targets to a sprite's queue. Diagonal moves need the main file's "allow diagonals" flag; with the keyboard, two keys 90° apart give a diagonal.

<a id="e-22"></a>
**E-22 Movement queue.** Each sprite has a FIFO of target points, and a movement command either **appends** to it or **clears it first** (`tkMV_CLEAR_QUEUE`). The sources are: direction strings (`"N,N,E"`, each step one move size); explicit pixel points (`ItemPath`/`PlayerPath`), walked in straight lines that **ignore board vectors** but still stop for sprites; path-finding; and a **waypoint vector** copied into the queue (`tkMV_WAYPOINT_PATH`) or **linked** (`tkMV_WAYPOINT_LINK`), where the sprite follows the vector one segment at a time, repeats for N cycles (0 = forever), sees live edits to the vector and resumes the path after a temporary detour.

<a id="e-23"></a>
**E-23 Move size.** *Tile movement:* each step is 32 px. *Pixel movement:* each step is **4 px**, the same in modes 1 and 2 (R-62; the original derived 1–4 px from the measured frame rate, E-136). Scripted direction strings still move a whole tile, or a quarter tile (8 px) when the main file selects pixel pushes. What one step does with that size is in [Walking a step](#walking-a-step) (E-134 to E-136).

**Implementation gap ([#1283](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1283)).** The current script movement implementation does not yet apply the main-file setting to direction pushes; its push vectors are fixed at 32 px. The mode-dependent scripted push size above describes the intended behavior, not completed implementation.

<a id="reawakened-party-steps"></a>
**Reawakened rule — party steps (OWNER; issue #1231).** The party's step counter is `party.steps`, the legacy layout's field 24 — "steps taken, in tiles" ([../formats/save-game.md](../formats/save-game.md#layout-minor-4)) — and it is the "total step count" E-87 exposes to scripts as `party.steps` ([rpgcode-language.md](rpgcode-language.md#e-87)). It counts **completed travel by the input-selected player** — the sprite the input layer drives, `sprites.selectedPlayer` (the sprite `activeplayer` and `selectPlayer` set, and the only sprite the keyboard and pointer move) — whoever queued the move: the keyboard (E-24), the pointer (E-25), a script or path (`Push`, `PlayerPath`, `ItemPath`, E-22), path-finding, or a waypoint vector. The party section's own `party.selected` is the party's roster selection and is **not** consulted: a script that selects another party member without moving the sprite selection keeps the counter with the sprite that walks, and a sprite that is not the input-selected one never contributes. Items never contribute. The count does not depend on the movement mode (E-23) or the main file's pixel settings.

1. **Distance of one move.** A move contributes when it *completes*: the sprite reaches its queue target, passes it, or finishes a wall slide (E-26, R-54). Its contribution is the straight-line distance from the move's start position to its final position, `sqrt(dx² + dy²)`, where `dx` and `dy` are the integer deltas in 1/256-pixel units (board pixels × 256, exact), rounded half-up to a whole 1/256 pixel by integer arithmetic; `Math.sqrt` is on the G3 allowlist and is the only floating-point operation. It counts **distance travelled**, not tiles crossed: a 32-pixel tile move along an axis contributes exactly 32 px, and a 32 × 32 diagonal contributes 32 × √2 ≈ 45.25 px. A move still in progress contributes nothing until it completes, so a per-advance (4 px) count never applies.
2. **A step is 32 pixels.** The contribution is added to the party's saved **remainder**, `party.stepRemainder`, an integer 0–8191 in the same 1/256 units. Every whole 32 pixels (`32 × 256 = 8192` units) in that sum increments `steps` by one, and the excess stays in the remainder for later moves. The remainder is never cleared at a move, tile, tick, board, movement-mode or selected-player boundary, so eight 4-pixel pixel steps complete exactly one step (E-23, R-62), while seven of them leave 7168 units that the eighth completes.
3. **What never counts.** Only completed moves contribute, so a move that never completes adds nothing: a blocked move, a move that a path diversion or a queue clear replaces before it finishes, and a zero-length move (E-27, E-22). A blocked move adds nothing at all — not even the partial advance it made before it was blocked — whether the block is a solid vector, a board edge with no link, a sprite, or a slide whose both candidates are blocked (E-26, E-27, E-28). Placement is not travel: `send` placements, board-edge arrivals and `put` (E-19, R-53) never enter the count.
4. **Saved, and restored exactly.** `steps` and the remainder are both part of the version-3 party section ([../formats/save-game.md](../formats/save-game.md#reawakened-canonical-party-inventory-and-menu-state)), so a save written between two moves restores both, and the moves after a Load complete the same total as an uninterrupted run. The interruption-recovery ledger projects and restores the same pair, so a recovered game keeps the sub-tile accumulation. A version-2 party migrates with its `steps` intact and a zero remainder; an in-progress move is ordinary `sprites` state, so a move that straddles the save is counted once, on completion, by the restored run.

Evidence: E-23 (step sizes), E-87 (the step count is exposed and saved), R-50 (fixed tick), R-54 (wall sliding), save field 24 (steps are whole tiles). **Rejected alternative:** counting per 4-pixel advance, which counts travel that never becomes a completed move and needs its own rounding rule; counting tiles with `max(abs(dx), abs(dy))`, which makes a diagonal tile cheaper than walking its two legs; and any threshold on the completed distance — the exploratory implementation that opened issue #1231 in this branch counted a move only at 16 px or more, which silently dropped every 8-pixel pixel-push advance. Before that exploratory commit the counter simply never advanced, so `main` had no counting rule at all.

<a id="reawakened-movement-events"></a>
**Reawakened rule — movement event vocabulary (OWNER; approved 2026-11-03; issue #1235).** In plain terms: while a sprite moves, the engine reports what happened as a small set of named events. These events are internal to the engine for v1; scripts and packages do not receive them. Scripts see movement through the step count ([party steps](#reawakened-party-steps)) and the existing movement commands. The events exist so the engine and its tests can check movement exactly.

Technically, and deterministically: each event carries the tick it fired on, and events within a tick are returned in the order the engine processes them, which follows the total order of [R-50](#r-50-ratifications). The vocabulary is:

| Event | Fields | Fires when |
|---|---|---|
| `step-complete` | `actor`, `distance`, `partyDistance256` | once for each move that completes without being blocked (see [party steps](#reawakened-party-steps) for the counted distance) |
| `movement-complete` | `actor`, `blocked` | once, when the sprite's queue drains: no queued move remains and no waypoint is active. `blocked` is `true` when the move that drained the queue was blocked. |
| `blocked` | `actor`, `vector`, `blocked` (always `true`) | a step is stopped by a board vector, board edge or solid cell |
| `sprite-collision` | `actor`, `winner`, `loser`, `blocker` | two sprites bump ([R-51](#r-51)) |
| `diversion` | `actor`, `blocker`, `via` | a path-following sprite walks around a blocker ([R-51](#r-51) item 3) |
| `waiting-for-blocker` | `actor`, `blocker` | a sprite waits for a blocker to move |
| `path-stopped` | `actor`, `blocker` | a sprite gives up on its path after a blocker |
| `edge-exit` | `actor`, `direction` | a sprite leaves the board by an edge link |
| `under-enter` / `under-leave` | `actor`, `vector` | a sprite starts or stops overlapping an under-vector |
| `layer-change` | `actor`, `from`, `to`, `vector` | a sprite changes layer on a layer vector |
| `thaw` | `actor` | a frozen sprite ([R-51](#r-51) item 2) returns to waiting |

Rules for the two completion events, which are the ones most often misread:

1. **`movement-complete` is a queue event, not a per-move event.** A completed move that still has queued moves or an active waypoint emits no `movement-complete`. This holds for every completion path, including a wall slide ([E-26](#e-26)): a slide that completes with moves still queued emits `step-complete` and no `movement-complete`. A slide that completes the queue emits `step-complete`, then `movement-complete` with `blocked: false`.
2. **`step-complete` is a per-move event.** It fires once for each successful completed move, whether or not the queue drains, and never for a blocked move.
3. A blocked move that drains the queue emits `blocked`, then `movement-complete` with `blocked: true`, and no `step-complete`.

Rejected alternative: emit `movement-complete` after every completed move, so a listener can read "a slide finished" directly. That makes the event mean two things, and a queued sprite would report completion between each step of a path. Rejected alternative: expose the events to scripts and packages now. That would make their order and fields a public contract before the engine has had a second consumer; it can be proposed later as its own ruling.

The current implementation ([`packages/core/src/sprites/movement.ts`](../../../packages/core/src/sprites/movement.ts)) and the movement oracle fixtures (`packages/core/test/fixtures/movement/`) already follow this vocabulary, including the slide row above. This ruling ratifies that behaviour; it does not change it.

<a id="e-24"></a>
**E-24 Keyboard movement.** Eight configurable direction bindings. Holding two orthogonal keys gives a diagonal where diagonals are allowed. Movement is relative to the board's axes, so on isometric boards "north" runs along the iso axis.

<a id="e-25"></a>
**E-25 Mouse movement.** Clicking the board path-finds the selected player to the clicked point; if the point is blocked by a sprite the player walks up to it. The path and the destination can be drawn. While a blocking script owns the key queue a click starts no path, a path under way pauses, and a button still held when the script ends walks towards the cursor again ([display-input-audio.md](display-input-audio.md#reawakened-click-movement-freeze)).

## Walking a step

What happens between a direction key being down and the sprite standing at its next position. Both movement modes share everything here except where the entries say otherwise; the difference is the size of one step (E-23) and therefore how often a boundary is tested.

<a id="e-133"></a>
**E-133 Input is sampled only while idle.** The selected player's direction bindings are read **once per update, and only while it has nothing left to do**. A press **discards whatever steps are still queued for that sprite** and enqueues one step in the pressed direction; the sprite is then busy until that step ends. Presses during a step are not buffered, accumulated or remembered, so holding a key produces one step per completed step rather than a continuous input axis, and pressing a key can cut short movement a script queued. Where diagonals are allowed, two orthogonal bindings held together give the diagonal between them (E-24); the diagonal step moves the full step size along **each** axis, so it covers about 1.41 steps of distance.

**Implementation gap ([#1286](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1286)).** The current input phase accepts a direction only when the movement queue and waypoint are empty; it does not clear a queued script path on a key press. The intended preemption rule and script input ownership need reconciliation.

<a id="e-134"></a>
**E-134 One step: direction, target, facing.** A step fixes one of eight direction vectors on the board's own axes and a target at `position + direction × move size`, then advances only along that vector, one small increment at a time, until the target is reached or passed, at which point the position is set **exactly** to the target so no rounding accumulates over a long walk. A queued point (a script point, a path node, a waypoint segment) instead sets the direction to the normalised vector towards that point — larger axis component 1 — so such a step may be part-tile in one axis. **Facing**, and therefore the walk animation, is the octant of the direction vector: the angle from the board's x axis rounded to the nearest 45°. On isometric boards the vertical component counts double when that angle is taken (equivalently, the direction table halves it), which is what maps the board's diagonals onto the eight facings.

Consequences of E-133 and E-134, in both modes: a step is uninterruptible once started in the sense that the direction cannot be changed mid-step; the sprite's movement per update is a constant increment (4 px per speed interval, R-50), never a jump to the target; and the sprite's walk animation switches to the octant of the step it is actually taking, not of the key that started the queue.

<a id="e-135"></a>
**E-135 Tile movement: one boundary test per step.** In tile movement the target is the next whole tile (64 px in x on isometric boards), and the board's vectors are tested **once, when the step begins** — the collision base is placed at the target and compared with every vector on the sprite's layer (E-26). Nothing is re-tested while the sprite walks there. Therefore:

- A passable step always ends exactly one move size from where it began; positions stay on the move grid for the whole game, so a script and the keyboard always agree on where tiles begin and end.
- A blocked step moves the sprite **not at all**: it stays on its tile, the attempt ends in the same update it was made (at most one walk-animation frame is shown), and the sprite returns to idle. There is no partial move towards the blocked tile.
- A boundary that covers only part of a tile — a triangle, a free-hand polygon, a passage line — still blocks the **whole** tile step, because the base at the target overlaps it and tile movement does not slide.
- A vector, sprite or closing door that becomes blocking **after** the step began does not stop the sprite: it finishes the tile. Only queued-point and path steps re-test sprites per pixel, and stair vectors are re-read per pixel on those steps.

**Implementation gap ([#1281](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1281)).** The current movement phase tests intermediate 4 px advances instead of testing the tile destination once. A blocked move can therefore stop between tile centers, and a boundary added during a move can interrupt it. Linked board-edge behavior and saved in-flight steps must be preserved when this is corrected.

<a id="e-136"></a>
**E-136 Pixel movement: one boundary test per short step, with sliding.** In pixel movement one step is a few pixels (E-23), and each step re-samples input, so a held key produces a chain of short steps. The sprite is therefore tested against the board's vectors every few pixels: it respects boundaries continuously, may stand **between** grid lines, may stop part-way into a tile, and the base is free to slip through gaps narrower than a tile. Every pixel-movement step is also tested with wall sliding (E-26, R-54):

- The blocking edge gives one direction vector; if the step direction is glancing rather than head-on, the step is turned 45° and retested with sliding disabled for that retest.
- The turn it tries first is chosen from the geometry, not fixed: the sign of the cross product between the hit edge and the movement vector says which side of the step the edge lies on, and the step turns the other way. If that turn is still blocked it tries the opposite one, and only if both are blocked does the step stay blocked. When both are free it keeps the first one it tried. **R-54 supersedes this choice:** exactly one slide per step, and where both candidate directions are free the lower eight-way facing index wins; R-54 item 5 rules which way the sprite is drawn facing during the slide.
- A step that slides still ends where its new target is; the position is always set exactly to that target.

Because the step is short, pixel movement is sensitive to the **step granularity** as well as to the speed: the original derives the granularity from the measured frame rate (4 px divided by the number of frames per speed interval, at least 1 px). The distance covered per second is the same at any frame rate, but a higher frame rate means smaller steps and therefore finer boundary sampling.

**Step granularity and the main-file mode — legacy fact.** The original's **keyboard** step in pixel movement is derived from the frame rate as above and does **not** depend on which pixel-movement value the main file stores. That value selects only the size of a *script* direction push: a whole tile (32 px) or a quarter tile (8 px) ([../formats/main-file.md](../formats/main-file.md#layout), field 48). So in the original, the two pixel modes differ in how scripts push, not in how the player walks.

<a id="r-62"></a>
<!-- OWNER: R-62 -->
**R-62 Pixel step size (OWNER; ruled 2026-11-04; Reawakened rule).** In plain terms: one direction press moves a whole tile in tile movement and four pixels in either pixel mode, so the game feels the same whatever machine runs it. Technically, and deterministically:

1. A direction step's length is **32 px** when `pixelMovement = 0` and **4 px** when it is `1` or `2`. `4` is the same 4 px that R-50 advances per cadence interval, so in pixel movement every step is exactly one advance and no advance is ever shortened.
2. The two pixel modes walk alike; the main-file value governs the size of **scripted** direction pushes only (E-23), which the original already did.
3. This fixes the step length only. The cadence of advances stays R-50's, and the movement phase sizes a direction step this way (`packages/core/src/sprites/movement.ts:500-508`).

**Implementation gap ([#1282](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1282)).** The current diagonal pixel step reaches the 4-by-4 target over two advances, not one: its first advance is approximately 2.828 px on each axis. The target size is implemented, but the one-advance timing and collision sampling above are not.

Evidence: E-23, E-136's legacy fact (the original's keyboard step is frame-rate derived and mode-independent), and R-50's 4 px advance. **Rejected alternatives:** 8 px for mode 1 and 1 px for mode 2 (echoes the scripted push sizes, but invents a difference the original does not have between the modes and makes a pixel-mode step take several advances or a fraction of one), and 1 px for both (finest sampling, but four times the movement phases and no counterpart in the original's step range at ordinary frame rates). Consumers: entries 5.2, 5.4.

<a id="e-137"></a>
**E-137 Where the boundaries come from.** Boundaries are always polygons, never tiles. A board in the current layout stores them explicitly ([../formats/board.md](../formats/board.md#vector-layout-minor-4-and-later)): a point list of any shape, closed or open, on any layer, with a type (solid, under, stairs, waypoint, deprecated unidirectional), an attributes word (a stair's destination layer, an under vector's promotion flags), a closed flag and an optional name used by waypoint scripts. A **pre-vector** board (minors 2 and 3) has no polygons; its per-cell collision types are turned into polygons when it is loaded or saved ([../formats/legacy/older-binary-versions.md](../formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector)). Boards in the current layout are **not** rebuilt from tiles at load: what the file stores is what is tested. Because the same polygon test serves every shape, a boundary can be a rectangle, a triangle, half a cell, a passage line or a free-hand outline, and tile movement and pixel movement differ only in how often it is consulted (E-135, E-136).

<a id="e-138"></a>
**E-138 The board edge is part of the step — selected player only.** The selected player's step target is also compared with the board's pixel extent: if any part of the collision base would fall outside, then with **no link** on that edge the step is blocked exactly as if a solid vector were there (the edge result is combined with the vector result, so a link never clears a solid), and with a **link** the edge contributes nothing to the test and the step completes — the board change then happens after the tick's movement update (E-28, and R-53 for where the player arrives). Other players and items are not tested against the board's edges at all; keeping them on the board is the path-finder's job.

**Implementation gap ([#1281](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1281)).** The current movement phase checks the board edge on each intermediate advance and requests a transition as soon as the base crosses it, rather than completing a linked step first. Its edge check also runs before the vector check and applies to every player, not just the selected one. The behavior above is not yet implemented.

## Speed

- A sprite's `speed` (seconds, from its character or item file) is converted to milliseconds. While moving, it advances **4 pixels per `speed`**, so one 32-pixel tile takes `8 × speed` (0.4 s at the default 0.05 s).
- The main file's **game speed** (−4..+4) makes every sprite faster or slower: the time per 4-pixel advance becomes `speed − 100 ms × gameSpeed`, never less than one frame.
- The original engine implements this by counting frames at the measured frame rate ([main-loop-and-startup.md](main-loop-and-startup.md#timing)); the formula above is the time-based equivalent.
- Idle and custom stance animations play at their own `delay`.

<a id="r-50"></a>
<!-- OWNER: R-50 -->
**R-50 Sprite speed and game speed (OWNER; ruled 2026-10-18; Reawakened rule).** In plain terms: a sprite's `speed` says how long it takes to walk 4 pixels, and the game speed makes every sprite quicker or slower by 100 ms per step of the setting, so a game plays the same on any machine. Technically, and deterministically:

1. `speedMs = floor(speed × 1000 + 0.5)` (an integer, from the character or item file). `gameSpeed` is the main-file value clamped to −4..+4; positive is faster.
2. `intervalMs = max(oneTickMs, speedMs − 100 × gameSpeed)` where `oneTickMs` is one 60 Hz tick (1000/60 ms). A `speed` of 0 or less gives `speedMs <= 0` and therefore exactly one tick per advance.
3. `ticksPerAdvance = max(1, floor((intervalMs × 60 + 500) / 1000))` using integer arithmetic only. This is `core/time`'s round-half-up seconds-to-ticks rule applied to `intervalMs / 1000`; at the default 0.05 s and game speed 0 it is 3 ticks, so one 32 px tile takes 8 advances = 24 ticks.
4. A moving sprite advances **4 px** every `ticksPerAdvance` ticks, in the `movement` phase, never more than the distance left to the step target (the last advance is shorter). The first advance happens on the tick the move starts. No wall-clock time, frame rate or measured rate is ever read.
5. The step size of E-23 (32 px tile steps, 4 px pixel steps per R-62, 8 px pixel push) is unchanged; only the time per 4 px advance is ruled here.

Evidence: this page's Speed section (4 px per `speed`, `speed − 100 ms × gameSpeed`, never less than one frame); AD-2 (fixed 60 Hz tick) and `core/time` `secondsToTicks`; the discovery reconciliation row R-50 and F-16 in `movement-readiness.md`. **Rejected alternative:** the legacy inventory's "±10 % per step" (E-04) multiplier, because the explicit formula already has units, is easy to make integer-exact, and removes frame-rate dependence. A frame-counting implementation (the original's measured frame rate) is also rejected for the same reason. Consumers: entries 5.2 (oracle), 5.3, 5.4.

## Sprite states

| State | Meaning | Leaves when |
|---|---|---|
| waiting | just stopped | a move is queued → moving; `idleTime` passes and an idle animation exists → idling; a script plays a stance → stance |
| idling | playing the idle animation | a move is queued |
| moving | walking towards the current step target | the target is reached or passed → done; blocked by something solid → done; teleported → done |
| done | step finished | next queued step → moving; otherwise → waiting |
| stance | playing a named custom animation once | the animation ends |
| frozen | lost a sprite-sprite collision | **2 seconds** pass → waiting |

<a id="e-21"></a>
**E-21 Facing & animation state.** 8-way facing. While moving, the walk animation for the current facing advances by elapsed time; after `idleTime` seconds without moving the idle animation for that facing loops. A **custom stance** plays once (or is held at its last frame until movement resumes) and can pause the calling thread until it finishes. A sprite can be **frozen** for a time.

## Collision with the board

Before each step the sprite's collision polygon, placed at the target, is tested against every vector on the sprite's layer:

| Vector type | Effect |
|---|---|
| solid | blocks the step. In pixel movement, a glancing hit (angle ≥ 45°, or ≥ 27° on isometric boards) turns the step one direction left or right so the sprite slides along walls. |
| stairs | the sprite moves to the layer given by the vector's attributes |
| under | no collision; the sprite is drawn beneath that layer's tiles while inside it |
| waypoint | no collision; only used as a path |

Moving off a board edge is blocked unless that edge has a link.

<a id="e-26"></a>
**E-26 Collision — board.** The results of the test above are combined as flags: **solid** blocks the step; **sliding** applies in pixel movement (the table above); **stairs** changes the sprite's layer to the vector's destination layer when the base touches a stair vector; **open polylines** block crossing, and **closed polygons** block both entry and containment. The shapes tested come from the file, not from the tile grid (E-137), and the test runs once per step in tile movement but per short step in pixel movement (E-135, E-136).

<a id="e-30"></a>
**E-30 Occlusion ("under").** For a sprite on layer L, board content on higher layers that overlaps the sprite's frame is drawn **over** it. **Under vectors** promote the board graphics they enclose — on layer L, optionally all layers below, optionally the background image — so those draw over the sprite. The trigger is the sprite's collision base intersecting the vector, or, with the frame-intersect option, its image frame doing so. Overlapping under vectors do not stack translucency.

<a id="r-54"></a>
<!-- OWNER: R-54 -->
**R-54 Wall sliding threshold (OWNER; ruled 2026-10-18; Reawakened rule).** In plain terms: when a walking sprite brushes along a wall at a shallow angle it slides along the wall instead of stopping; head-on it stops. Technically, and deterministically (pixel movement only; tile movement never slides):

1. For the solid edge hit, let `m` be the step's movement vector and `e` the edge's direction vector. Both are converted to integers (board pixels × 256, rounded half-up) before any comparison. The hit is *glancing* when the angle from the edge's normal is **≥ 45°** (the angle between `m` and the edge line is at most 45°): `|cross(m, e)| <= |dot(m, e)|` (inclusive).
2. On an isometric board the threshold is **≥ 27°** from the normal (the angle to the edge line is at most 63°); compare with the fixed rational `tan 63° ≈ 1.96261`: `|cross(m, e)| × 100000 <= |dot(m, e)| × 196261`. Never evaluate trigonometric functions, floating-point `atan` or `**`.
3. A glancing hit turns the step one of the eight directions left (counter-clockwise) or right (clockwise). Each candidate is tested against the board like a normal step; of the candidates that are free, take the one with the lowest 8-way facing index (N = 0, NE = 1, E = 2, SE = 3, S = 4, SW = 5, W = 6, NW = 7). If none is free the step is blocked. Exactly one slide is tried per step.
4. A non-glancing hit (below the threshold) blocks the step.
5. **Facing (OWNER; ruled 2026-10-18).** The slide step shows the sprite facing the slide direction for that tick only. The sprite's facing for its movement is the direction it is *trying* to go, so when the next step is blocked it faces the original step direction again (for example `SE` after an `S` slide). Rejected alternative: keep the slide direction as the facing, which would turn a player who is pressing into a wall away from it.

Evidence: this page's Collision with the board section (angle ≥ 45°, ≥ 27° isometric) and E-26; AD-13 (no engine-dependent maths) and AD-25 (total order). **Rejected alternative:** the legacy inventory's "less than about 45°" wording, which is exclusive and approximate and gives different answers at the boundary. Consumers: entries 5.2, 5.4.

## Collision between sprites

Sprites' collision polygons are compared. When two collide, one freezes for 2 seconds. Who loses: a stationary sprite loses to a moving one; otherwise the user-controlled player wins; otherwise the faster sprite wins; otherwise the one later in drawing order wins.

**Drawing order (z-order):** a sprite is drawn behind another when it is higher on the screen. **Compatibility note:** after any move the original engine re-inserts the moving sprite at the end of the drawing list (a bug), so the most recently moved sprite tends to be drawn on top until the order is recomputed.

<a id="e-27"></a>
**E-27 Collision — sprites.** All sprites are solid to each other through their collision bases. While following a path, a blocked sprite tries a **diversion** — a local path-find around the blocker and back onto its path — and can also **wait** for the blocker to move; if neither works it stops.

<a id="e-29"></a>
**E-29 Z-ordering.** **Reawakened rule (OWNER; R-55).** Render sprites by the total key `(layer, screen-space y of the sprite reference point after projection, drawId)`. `drawId` is one stable integer: players precede items, and each category is ordered by its index. On isometric boards the y component is projected screen-space reference-point y, not raw board y. Re-inserting a moving sprite never changes this key.

<a id="r-51"></a>
<!-- OWNER: R-51 -->
**R-51 Sprite collision versus path diversion (OWNER; ruled 2026-10-18; Reawakened rule).** In plain terms: when two sprites bump, one of them stops for two seconds; a sprite that is walking a path first tries to step around the other before giving up. The two behaviours are layered, and the work is split: **entry 5.4 owns direct collision (items 1 and 2)** and **entry 5.5 owns path diversion (items 3 and 4)**.

1. *Detection.* In the `movement` phase, in ascending `drawId` order (players before items, then index), a sprite's step is tested against every other sprite on the same layer by collision polygon; a hit blocks the step and the sprite does not move on that tick.
2. *Direct collision result.* The loser is chosen by this order: a stationary sprite loses to a moving one; otherwise the user-controlled player wins; otherwise the faster sprite wins (smaller `ticksPerAdvance`); otherwise the sprite with the larger `drawId` loses. The loser enters **frozen for 120 ticks** (2 s at 60 Hz) with its position unchanged and its queue untouched; it then returns to waiting. The winner's step is blocked for that tick only.
3. *Diversion (path-following actors only).* An actor following a path (pathfinding, waypoint vector or `ItemPath`/`PlayerPath` points; not a direction-string or keyboard step) that is blocked by a sprite makes **one** deterministic local diversion attempt per blocked step: it runs the pathfinder of entry 5.5, in the active mode, on the same layer, with the blocker's collision base as an obstacle and the cap of 1000 node expansions, to reach the next point on its original path. If a route is found it is queued ahead of the remaining path and the collision is not applied.
4. *Fallbacks.* With no route, the actor **waits**, re-testing the same step each tick for at most 120 ticks; if the blocker clears it continues. If the wait expires the actor **stops**: its queue is cleared and the direct-collision result of item 2 applies (frozen for 120 ticks if it loses, otherwise it simply stops).

Evidence: this page's Collision between sprites section (loser order, 2 s freeze) and Sprite states (frozen); E-27 (diversion, wait, stop); the discovery reconciliation row R-51; AD-25. **Rejected alternative:** choosing only one source (freeze only, or diversion only), because that silently discards a documented behaviour of the other. Consumers: entries 5.2 (`collision-sprite-blocking`), 5.4, 5.5. Items 2 to 4 beyond the cited text (120-tick wait, one attempt per step, queue-ahead) are an unverified default recorded under the owner's approval of the rule as written.

## Activation: programs and items

After the player finishes a step (and when the activation key is pressed):

1. **Items** are checked first. Among the items whose activation polygon overlaps the player, the one most directly in front of the player wins, then the nearest.
2. **Board programs** are checked next; if several match, the last one in board order wins.

A trigger fires according to its activation type ([../formats/board.md](../formats/board.md#programs-triggers)):

| Type | Fires |
|---|---|
| step | once when the player enters the area |
| key press | when the activation key is pressed while the player is inside |
| repeat | again every `distanceRepeat` pixels of movement inside the area |
| + stop movement | additionally clears the player's queued movement |

Conditional triggers fire only when their variable condition holds. The program to run may be a file or inline code. It runs to completion before the game continues. A file program that names nothing in `Prg` is one located `program.missing` diagnostic (`rpgcode-functions.md:136`; Reawakened makes board programs the same as every other caller there): no thread runs, the trigger *counts as run* so a step-on region does not repeat its report until the player leaves, and a key-press region reports once per activation-key press, and the game carries on.

<a id="e-40"></a>
**E-40 Board program region, step-on.** Fires once when the player's collision base enters the region on the same layer; it re-arms on leaving.

<a id="e-41"></a>
**E-41 Board program region, key-press.** The player is inside the region and presses the activation key.
<a id="reawakened-gone-trigger-suppression"></a>
**Reawakened rule (OWNER; `gone`).** `gone()` suppresses only the currently running board trigger instance by writing the `triggers` section. The source program remains on the board, sprites and unrelated threads are unchanged, and the suppression lasts until the active board is left. Normal trigger reload on board leave clears the marker.

<a id="e-42"></a>
**E-42 Board program region, repeat.** Fires again every `distanceRepeat` px walked inside the region; the counter resets on leaving.

<a id="e-43"></a>
**E-43 Item activation.** The player's collision base intersects the item's *activation base* while the player is moving (step-on) or the key is pressed (key-press). The item turns to face the player and the player's queue is cleared; `source` = item and `target` = player during the program. When several items qualify, the one most directly in front and then nearest wins, and items take precedence over regions.

<a id="e-44"></a>
**E-44 Conditional activation.** Both regions and items can require `variable == value` before firing and set `variable = value` after the program ends; "run once" is built from this.

<a id="e-45"></a>
**E-45 Item loading condition.** When the board loads, an item is hidden unless `variable == value`; it can still be shown later by script.

The other fixed hooks are the random battle, the custom battle program, the game-over program, the character level-up program, the item equip / remove / use programs, the special-move program, the status-effect per-round program, the enemy custom-AI program, the enemy defeat and run-away programs, and the start-up program. A region whose flag says "stops movement" clears the player's queue before running (needed for mouse movement), and movement that happens *inside* a program never fires other triggers.

**Random battles** are tested after activation, at most once per tile moved, on boards that allow battles ([plugins-and-battle.md](plugins-and-battle.md#random-encounters)).

**Reawakened rule.** The trigger points above may be implemented on an internal event bus, but the observable firing rules must hold exactly: once-per-entry, distance re-arm, precedence, layer matching, and the condition-before / set-after pair of conditional activation.

<a id="r-52"></a>
<!-- OWNER: R-52 -->
**R-52 Activation precedence (OWNER; ruled 2026-10-18; Reawakened rule).** In plain terms: when more than one thing could run, the nearest thing in front of the player runs first, items before board programs, and a program whose condition is not met is simply skipped. Technically, and deterministically, after a player step finishes or the activation key is pressed:

1. *Filter.* Keep only candidates on the player's layer whose activation type matches the event (step, key press or repeat) and whose polygon overlaps; then apply each candidate's condition (`variable == value`, E-44). A failed condition removes the candidate and **does not consume** the event: the next candidate is considered.
2. *Items before regions.* Qualifying items are chosen before any region. Among items: the one most directly in front of the player wins, then the nearest, then the lowest compacted runtime item index (never a raw file slot). "In front" is the larger `dot(facingVector, itemReference − playerReference)` where `facingVector` has integer components in {−1, 0, 1}; "nearest" is the smaller squared distance between reference points, all in integer fixed-point pixels.
3. *Regions.* If no item qualifies, among qualifying board programs the **last in stored board order** wins.
4. *Set-after.* The winner's `set variable = value` is applied only after its program has completed successfully; a program aborted by an unhandled error does not set it, and a failed condition never sets anything.
5. Movement that happens inside a running trigger never fires other triggers, and the board-program rules E-40 to E-45 otherwise hold.

Evidence: this page's Activation section ("last one in board order wins"), E-43, E-44 and the Reawakened rule above; AD-25; the discovery reconciliation row R-52. **Rejected alternative:** an unfiltered pick (choose a winner first, then test its condition), which lets a failed condition block a valid lower-ranked trigger; and treating items and regions as one pool. Consumers: entries 5.2 (`triggers-precedence`), 5.8.

## Moving between boards

When the player steps off an edge that has a link:

- A link ending in `.prg` runs that program instead.
- Otherwise the linked board is loaded, the player is placed against the opposite edge (keeping its position along the edge, inferred), and the spot is checked; if it is blocked the move fails.
- On success the new board replaces the current one: non-persistent threads of the old board stop, the new board's threads start, its items are placed, the view scrolls to the player, the board music changes if different, and the board's `enterPrg` runs.

Scripts can also move the player with `Send(board, x, y, layer)`.

<a id="e-19"></a>
**E-19 Board transitions.** `Send(board, x, y, layer)` loads a board, positions the player, re-aligns the camera, rebuilds the z-order, clears the path-finding caches, **deactivates any program the player arrives on top of** (so the destination does not fire immediately; Reawakened rule: the deactivated program re-arms the moment the player's collision base leaves that program's own area, the same once-per-entry rule as E-40, so a region or item under a destination fires again on a later step or activation key and suppression never outlives the overlap), switches the music and runs the enter program. Board threads of the old board are stopped; persistent threads survive.
<a id="reawakened-send-board"></a>
**Reawakened rule (OWNER; `send` position unit and timing; unit established from the shipped 3.1 demo, #1246; timing an unverified default).** `send(board, x, y, [layer])` names a position in the **destination board's own coordinate mode** ([../formats/board.md](../formats/board.md#coordinates)): board pixels when that board's `coordType` sets the "Use pixel coordinates" flag 4, and one-based tile coordinates (as `put` does) otherwise. `layer` is one-based, where a layer below 1 means layer 1. The script cannot wait on a file, so the call records the request and parks the calling thread until the next tick; the engine then swaps the boards between ticks, freezing time while the board and its tiles load, and runs the board-entry rule of [main-loop-and-startup.md](main-loop-and-startup.md#reawakened-board-entry). The caller resumes at the start of the next tick on the new board, unless it was a `board` thread of the old board (it dies with the board). A second `send` posted in the same tick replaces the first. A board name that resolves to no asset is a located diagnostic and the request is dropped.

**Evidence (#1246).** The shipped 3.1 demo's two boards both set `coordType` 4. `Boards/start.brd` (20×11) carries the program `send("out.brd", 112, 192, 1)`, and `Boards/out.brd` (20×15) carries `send("start.brd", 306, 306, 1)` back, with its own door region at x 83–140, y 148–170. Pixel (112, 192) is the spot just below that region on the destination, and pixel (306, 306) lies inside `start.brd`'s door region (x 283–327, y 305–322); as tile coordinates both targets are outside their boards, so only the pixel reading makes the demo's door work. The same fetched corpus has minor-4 `coordType` 0 boards whose editor-generated warp programs (`#send("town2.brd", 15, 19, 0)` in `Caoquest`) fit their destination boards as one-based tiles, and pre-vector boards store tile-coordinate positions by definition ([../formats/legacy/older-binary-versions.md](../formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector)); that is why the unit follows the destination board rather than the game or the call. **Rejected alternative:** one unit for every board — reading every target as tiles puts a flag-4 destination's arrival thousands of pixels off the board (the player vanishes, #1246), and reading every target as pixels would move those tile-unit warp arrivals to the boards' corners.

<a id="e-28"></a>
**E-28 Board edges.** If the selected player's base would leave the board: with **no link** the edge is solid; a **board link** test-loads that board and computes the arrival point on the opposite edge, refusing when the arrival point is off that board or solid; a **program link** runs the program. NPCs are not limited by edges unless they are path-finding.

<a id="e-47"></a>
**E-47 Board entry.** The board's threads start, then the enter program runs, on every arrival.

<a id="e-48"></a>
**E-48 Edge link to a program.** The player walks off an edge whose link is a `.prg`.

<a id="r-53"></a>
<!-- OWNER: R-53 -->
**R-53 Board-edge arrival alignment (OWNER; ruled 2026-10-18; Reawakened rule).** In plain terms: walking off one board edge puts you on the opposite edge of the next board at the same spot along the edge, with no snapping to a grid; if that spot is blocked you stay where you were. Technically, and deterministically:

1. Keep the player's continuous pixel coordinate along the edge (y when leaving east or west, x when leaving north or south). The coordinate across the edge is the opposite edge's innermost value at which the collision base lies entirely inside the new board. Coordinates are board pixels and are never rounded to an 8 or 32 px grid.
2. Clamp the along-edge coordinate to the range in which the collision base lies inside the new board.
3. Test the collision base at that point against the new board's solid vectors on the arrival layer. If it is blocked, or no valid range exists, the **arrival is rejected**: the move fails, the source board, the player's position and its queue's remaining state are unchanged, and no thread is stopped or started.
4. On success the existing E-19 and E-47 board-entry rules apply unchanged.

Evidence: this page's Moving between boards section ("keeping its position along the edge, inferred") and E-28; the discovery reconciliation row R-53. **Rejected alternative:** the legacy inventory's "aligned to an 8 px or 32 px grid" snap, which is not in the more specific movement page and would invent a position. Consumers: entries 5.2 (`edges-board-link-program`), 5.9.

## Path-finding

Used for mouse movement and the script commands `PlayerPath` / `ItemPath`. Modes (main file `pfHeuristic`):

| Mode | Search |
|---|---|
| 1 axial | A\* over a 32-pixel grid, 4 directions, Manhattan cost |
| 2 diagonal | A\* over a 32-pixel grid, 8 directions, octile cost |
| 3 vector | A\* over a visibility graph: the corners of obstacles grown by the sprite's collision size, straight-line cost |

The search gives up after 1000 node expansions. A grid cell is blocked if the sprite's collision polygon swept between cell centres would hit a solid vector. If the goal itself is blocked, the goal moves to the nearest free point.

<a id="e-34"></a>
**E-34 Path-finding.** The shortest path on the current layer around board vectors and sprite bases, with three heuristics — the main file's default, and selectable per call:

* **axial:** N/S/E/W only, tile-centre nodes;
* **diagonal:** 8-way, tile-centre nodes;
* **vector:** any angle, through the vertices of inflated obstacles (visibility-graph style).

If the target is unreachable, get as close as possible. Results are cached per board and invalidated on a board change or a vector edit.

## Movement and trigger ratifications (Epic 5 entry 5.1)

<a id="r-50-ratifications"></a>
<!-- OWNER: R-50-ratifications -->
**Ratified with R-50 to R-54 (OWNER; approved 2026-10-18; Reawakened rules).** In plain terms: these are the small shared rules that the movement and trigger entries rely on so nothing is left to each builder's guess.

- **Fixed tick.** All movement, freezes, waits and repeat distances run on the fixed 60 Hz tick (AD-2). Durations are converted with the integer rounding of R-50; no host clock, `Date`, frame rate or `Math.random` is read (G3).
- **Total order.** Every iteration that can change an outcome (sprites, candidates, vectors, path nodes) uses an explicit total order (AD-25): sprites by ascending `drawId`, board vectors and programs by stored board order, items by compacted runtime index, path ties by node coordinate then insertion index.
- **Actor geometry and fall-backs.** Collision and activation polygons, and missing-animation fall-backs, are the ruled defaults of [../formats/character.md](../formats/character.md#defaults-and-fall-backs) (collision rectangle (−15, −15) to (15, 0), activation rectangle (−24, −24) to (24, 8), diamonds on isometric boards; a missing diagonal uses the nearest horizontal direction; a missing idle animation uses the walk animation).
- **Condition before, set after.** A conditional trigger tests its condition first (R-52 item 1) and sets its variable only after the program completes (R-52 item 4).
- **Key claims.** Key waits, `get`, `clearBuffer` and the gamepad actions of E-112 share the one claim-by-input-sequence-number protocol of Epic 4 (entries 4.1 and 4.19): sequence numbers stay monotonic, a wait stores the sequence at park, and the input owner prunes claimed keys.
- **VM budget boundary.** The numeric per-tick VM step budget remains an Epic 3 (rpgcode-vm) provider contract. Epic 5 specifies only what is visible to movement: a blocking program that exhausts the budget is preempted at a tick boundary and resumes on the next tick, and movement and trigger phases still run each tick. Entry 5.12 verifies this and may open a docs-first amendment if the number must change.
- **Deferred to other epics (not ruled here).** Battle behaviour beyond the random-battle trigger handoff and fighter handoff (battle epic), menu and save/load behaviour (menu/save), board music and sound effects (audio), runner or host specifics (runners), and editor, language-server, debugger or other tooling (tooling). Epic 5 emits plain data and effect records only; the presentation of cursors, buttons and overlays remains Epic 4.

## Scrolling

The view scrolls to keep the player near the centre. It does not scroll past the board edges; boards smaller than the screen are not scrolled.

<a id="e-51"></a>
**E-51 Camera.** **Reawakened rule (OWNER).** Follow the selected player by default. Deadzone and smoothing default to zero. Use `center-if-small` for scenes smaller than the viewport; otherwise clamp to scene bounds. `positionAt(alpha)` interpolates only for presentation.

**Reawakened rule (OWNER; camera built-ins and shared shake).** `cameraPanTo(x, y, duration, easing)`, `cameraFollow(entityId)`, `cameraReset()` and `cameraShake(duration, amplitude)` are Reawakened additions. Durations are seconds converted with `durationTicks = ceil(seconds × 60)`, with a minimum of one tick for positive values. `cameraShake` is non-blocking; `duration` is seconds and `amplitude` is logical-viewport pixels. The shared `shake(amplitude, ticks)` primitive cycles `(−a,−a)`, `(a,−a)`, `(−a,a)`, `(a,a)` per tick, never draws randomness and never stacks: a new shake replaces the active one. `earthquake` uses this same primitive and its blocking sequence is defined at [rpgcode-functions.md#reawakened-earthquake](rpgcode-functions.md#reawakened-earthquake). Non-finite arguments are errors, negatives clamp to zero, and zero is a no-op for cameraShake. Easing is one of `linear`, `smoothstep`, `easeIn`, `easeOut` and `easeInOut`, represented as plain JSON names and evaluated with deterministic fixed-point/injected-tick arithmetic.

## Player statistics and levels

A character's stats are script variables named in its file ([../formats/character.md](../formats/character.md)). Experience gained in battle can trigger a level-up, which raises the level-up stats by percentages or fixed points and runs the level-up program. R-16 records that the original engine used `experienceIncrease` three different ways; the rebuild's single rule is specified below.

<a id="e-78"></a>
**E-78 Levelling.** Experience thresholds are **exponential** (each gap grows by a percentage) or **linear** (each gap grows by a fixed amount), up to a maximum level. On level-up: the level-up program runs; max HP, DP, FP and max SMP rise by percent (exponential, ignoring equipment bonuses) or by points (linear); current HP and SMP are **not** refilled; and "*name* gained a level" is shown. Special moves unlock by minimum experience, minimum level, or `variable == value`.

**Reawakened rule (OWNER; R-16 resolved by Jensen in Epic 20.1 on 2026-10-19).** The rebuild uses the threshold recurrence ruled by [progression-and-levels.md](progression-and-levels.md#threshold-and-level-up-behavior): percentage mode adds `truncate(oldRequirement * experienceIncrease / 100)`; fixed mode adds `experienceIncrease`. Level-up growth and program order follow that progression contract, and battle outcomes award experience through it ([BAT-8](battle.md#bat-8)). [Epic 20.1's owner decision](../../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-actors/epic-actors.md#data-stats-and-saves) resolves R-16 and establishes that Epic 7 inherits the default equation.

<a id="e-85"></a>
**E-85 Party management.** The party is an ordered roster of at most five distinct live `party` actor ids; actor records own all member stats and progression state (see [actors](actors.md)). The party owner alone changes roster membership, order, and selected member. Adding, removing, restoring, selecting, or swapping party members MUST NOT copy actor stats into script globals or party state. The selected member is identified by stable actor id and is the visible, controlled player; an empty party has no selected member. Adding the first member selects it; later additions preserve selection. Removing the selected member selects the member now at its former index, or the last remaining member if needed; removing the final member selects none. Reordering preserves selection by actor id. `playerhandle[0..4]` and the player position virtuals expose roster-indexed compatibility views, not a second state store. `newplyr`/`newplayer` change the main player's graphics; they do not change roster identity or order. `removeplayer` removes a member from the active roster for the documented old-player/restore behavior; `destroyplayer` permanently removes it from the party; `restoreplayer` restores a player previously on the team. Owner ruling: `callplayerswap(...)` remains the catalogue's existing unimplemented/no-op form; position swaps are party-owner/menu actions, not a newly specified RPGCode function. Roster actions validate the complete proposed state before commit; refused actions leave the party and actors unchanged. A roster event is queued exactly once after a successful committed membership/order/selection change and not for a refusal or no-op (see EMIT-13).
