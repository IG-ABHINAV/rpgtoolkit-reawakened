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
| 1, 2 — pixel movement | each key press moves a smaller step, so sprites slide smoothly and can stop between tiles |

Movement is queued: the keyboard, the mouse, scripts (`Push`, `PlayerPath`, `ItemPath`…) and waypoint vectors add steps or targets to a sprite's queue. Diagonal moves need the main file's "allow diagonals" flag; with the keyboard, two keys 90° apart give a diagonal.

<a id="e-22"></a>
**E-22 Movement queue.** Each sprite has a FIFO of target points, and a movement command either **appends** to it or **clears it first** (`tkMV_CLEAR_QUEUE`). The sources are: direction strings (`"N,N,E"`, each step one move size); explicit pixel points (`ItemPath`/`PlayerPath`), walked in straight lines that **ignore board vectors** but still stop for sprites; path-finding; and a **waypoint vector** copied into the queue (`tkMV_WAYPOINT_PATH`) or **linked** (`tkMV_WAYPOINT_LINK`), where the sprite follows the vector one segment at a time, repeats for N cycles (0 = forever), sees live edits to the vector and resumes the path after a temporary detour.

<a id="e-23"></a>
**E-23 Move size.** *Tile movement:* each step is 32 px. *Pixel movement:* each step is a small, frame-rate-derived number of pixels, down to 1 px. Optional "pixel push" makes direction-string commands move a quarter tile (8 px) instead of a full tile.

<a id="e-24"></a>
**E-24 Keyboard movement.** Eight configurable direction bindings. Holding two orthogonal keys gives a diagonal where diagonals are allowed. Movement is relative to the board's axes, so on isometric boards "north" runs along the iso axis.

<a id="e-25"></a>
**E-25 Mouse movement.** Clicking the board path-finds the selected player to the clicked point; if the point is blocked by a sprite the player walks up to it. The path and the destination can be drawn. While a blocking script owns the key queue a click starts no path, a path under way pauses, and a button still held when the script ends walks towards the cursor again ([display-input-audio.md](display-input-audio.md#reawakened-click-movement-freeze)).

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
5. The step size of E-23 (32 px tile steps, small pixel-movement steps, 8 px pixel push) is unchanged; only the time per 4 px advance is ruled here.

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
**E-26 Collision — board.** The results of the test above are combined as flags: **solid** blocks the step; **sliding** applies in pixel movement (the table above); **stairs** changes the sprite's layer to the vector's destination layer when the base touches a stair vector; **open polylines** block crossing, and **closed polygons** block both entry and containment.

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

Conditional triggers fire only when their variable condition holds. The program to run may be a file or inline code. It runs to completion before the game continues.

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
**E-19 Board transitions.** `Send(board, x, y, layer)` loads a board, positions the player, re-aligns the camera, rebuilds the z-order, clears the path-finding caches, **deactivates any program the player arrives on top of** (so the destination does not fire immediately), switches the music and runs the enter program. Board threads of the old board are stopped; persistent threads survive.
<a id="reawakened-send-board"></a>
**Reawakened rule (OWNER; `send` timing, unverified default).** `send(board, x, y, [layer])` takes tile coordinates (one-based, as `put` does) and a one-based layer, where a layer below 1 means layer 1. The script cannot wait on a file, so the call records the request and parks the calling thread until the next tick; the engine then swaps the boards between ticks, freezing time while the board and its tiles load, and runs the board-entry rule of [main-loop-and-startup.md](main-loop-and-startup.md#reawakened-board-entry). The caller resumes at the start of the next tick on the new board, unless it was a `board` thread of the old board (it dies with the board). A second `send` posted in the same tick replaces the first. A board name that resolves to no asset is a located diagnostic and the request is dropped.

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
