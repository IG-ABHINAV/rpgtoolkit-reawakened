# Display, input and audio

What the player sees and hears and how input reaches the game. These are the behaviours a replacement needs to match; how the original did it (DirectDraw 7, DirectInput 8, Audiere) is not prescribed.

## Window and display

| Setting (main file) | Behaviour |
|---|---|
| `mainResolution` | 0 = 640×480, 1 = 800×600, 2 = 1024×768, other = `resX` × `resY` |
| `extendToFullScreen` | 1 = exclusive full screen; 0 = a fixed-size window centred on the desktop |
| `colorDepth` | 16, 24 or 32 bits; lower depths are tried if the mode fails, and full screen falls back to windowed |
| `bFpsInTitleBar` | shows "title  N vectors, F FPS" in the window title |

The window title is the game title. Tiles are 32×32 pixels and are drawn at 1:1 scale (no zoom).

<a id="e-05"></a>
**E-05 FPS display and debug overlays.** An optional frames-per-second readout in the title bar, and debug overlays for board vectors, sprite vectors, the player's queued path and the destination marker, in colours from the main file.

<a id="e-13"></a>
**E-13 Tiles.** 32×32 tiles on normal boards and 64×32 diamonds on isometric boards, from tilesets, single-tile files, or **animated tiles** that cycle at their own fps; animated tiles can be switched off globally (`AnimatedTiles()`). 2D tiles on iso boards are projected ([../formats/tiles.md](../formats/tiles.md)).

<a id="e-50"></a>
**E-50 Screen.** Windowed or full screen at 640×480, 800×600, 1024×768 or a custom resolution; the colour depth applies only to full screen.

<a id="e-53"></a>
**E-53 Isometric drawing.** Diamond tiles are composited with masks, and the draw order is correct for both the staggered and the rotated layouts ([../formats/tiles.md](../formats/tiles.md#isometric-tiles)). The order is the painter order of [board.md](../formats/board.md#drawing-order-and-effects) (isometric tile order), and the camera clamps to the isometric board's own pixel size ([board.md](../formats/board.md#board-pixel-dimensions)). With no tracked sprite the camera centres on the board's start position, which is stored in pixels ([board.md](../formats/board.md#vector-layout-minor-4-and-later), `startX`/`startY`) and so needs no tile conversion on any layout; the start is the same point the player is placed at on boot ([main-loop-and-startup.md](main-loop-and-startup.md#reawakened-board-entry)).

<a id="reawakened-iso2d-projection"></a>
**Reawakened rule (OWNER; non-parity 2D-on-iso projection).** An ordinary 32×32 source tile is projected to a 64×32 diamond by a fixed nearest-neighbour affine map. Source coordinates use integer floor/round rules defined by the compositor, and pixels outside the exact diamond mask are transparent; the resulting `blit` sets `iso2d: true`. This is a Reawakened rule, not a legacy-parity claim. **Deferred decision (round 7, Q11):** the owner-relayed answer is that the legacy conversion averages pairs of source pixels instead of choosing the nearest pixel, and that its opaque diamond is 62 pixels wide. This rule is deliberately unchanged because the rule is non-parity and entry 4.18 is building on it; whether to adopt averaging and the 62-pixel diamond is a separate decision for the owner.

**Reawakened rule (OWNER; projected sprite y).** For isometric sprite ordering, use the projected screen-space y of the sprite reference point, never raw board y.

**Reawakened rule (OWNER; integer projection convention).** For destination diamond coordinates `(X,Y)` in the inclusive 64×32 raster, reject cells outside the exact mask described by [tiles.md](../formats/tiles.md#isometric-tiles), map accepted cells to source-square coordinates with the fixed affine map, and choose the nearest source pixel with integer half-up rounding. No floating-point edge test is permitted.

**Transparency:** images and canvases use magenta `(255, 0, 255)` as the transparent colour; tiles use the tileset's own transparent value ([../formats/tiles.md](../formats/tiles.md)); animation frames and layer images carry their own transparent colour.

**Layer images** of type parallax scroll at a different rate from the board; stretch images are scaled to the board size (only boards from tools other than the 3.1 editor use these).

**Ambient light** tints the whole screen (board ambient colour plus script changes).

<a id="e-17"></a>
**E-17 Lighting.** Three parts. A **tile shading layer**: an additive per-tile RGB shade cast onto all tiles at or below a chosen layer. **Lights**: elliptical spotlight, linear gradient and clipped gradient, rasterised into the shading once at load and static. **Board ambient RGB**, added to a **global ambient level** scripts can change (`SetAmbientLevel()`), which affects tiles, images, the background and sprite frames and triggers a full redraw when it changes.

<a id="reawakened-light-and-raster-arithmetic"></a>
**Reawakened rule (OWNER; raster arithmetic).** Raster primitives use integer arithmetic. The ellipse light uses a midpoint ellipse over its inclusive integer bounding box: plot four-way symmetric points, update the integer decision term in the two standard regions, treat zero width or height as a point or line, and fill each produced scanline strictly between its paired extrema, because the ellipse boundary itself is not lit (see the light-falloff rule below; the extrema pixels are the boundary). Tie decisions are fixed integer decisions; no trigonometry or floating-point edge test is used.

**Reawakened rule (OWNER; light falloff; adopts and keeps owner-relayed round-7 facts).** Lights are baked into shading layer 0 at load, and the stored light layer is ignored; the round-7 answer agrees with this and with the gradient direction rule below. Ellipse falloff uses normalized elliptical radius with linear endpoint falloff (`1` at centre, `0` at the radius). A gradient uses clamped projection along its two nodes; a clipped gradient uses that projection only inside its polygon/clip shape. The two stored colours are interpolated in fixed-point integer steps. **Boundary (adopted from legacy):** the ellipse boundary is excluded, so only pixels strictly inside the ellipse (normalized elliptical radius below 1) are lit. **Clamping (kept Reawakened rule, not adopted from legacy):** the legacy lighting does not clamp the result, but the Reawakened rule keeps its single clamp of the resulting shade, for determinism and safety; the clamp is a deliberate departure from legacy. Implementation status: the built shading code and the `S-LIGHT-ELLIPSE` oracle scene were produced before the boundary rule and still include the boundary; a follow-up ticket brings both into line under G5 (see ticket 4.34 of the board-rendering epic).

**Mouse cursor:** `TK DEFAULT` = the built-in arrow; otherwise an image from `Bitmap\` with the given hot spot and transparent colour.

<a id="e-61"></a>
**E-61 Mouse cursor.** Default, none, or a custom image with a hot spot and a transparent colour. `MouseCursor("TK DEFAULT")` restores the default.

**Debug drawing** (main file `drawVectors`): outlines of board vectors, sprite polygons, paths and destinations, drawn over the game.

## Input

| Input | Effect |
|---|---|
| Movement keys (main file, scan codes for 8 directions; default arrow keys) | when no blocking script owns the key queue, queue a step in that direction when the player is idle; while the key remains held, queue another step each time the player becomes idle again, at the normal movement cadence; two keys 90° apart give a diagonal if allowed |
| Activation key (main file `key`, the demo uses space) | test programs and items in front of / under the player |
| Menu key (main file `menuKey`, Enter in new projects) | open the menu plugin |
| Run-time keys (main file) | run their programs |
| Mouse (if enabled in `movementControls`) | holding the left button path-finds the player towards the pointer, except while a blocking script owns the key queue: a click then starts no path, a path under way takes no new step, and the button's hold resumes walking when the script ends ([click rule](#reawakened-click-movement-freeze)) |
| Any key while a script waits | delivered to `Wait()` / `Get()` through a key queue |

Gameplay input, keys and mouse alike, is read only while the player is idle and no blocking script owns the key queue; during a blocking script keys go to the script's key queue instead. A direction still held after the block ends acts on the next idle input phase; a tap completed during the block is lost for movement but remains in the key queue; a click made during the block is lost for movement too, a click path already under way pauses, and a button still held when the block ends walks towards the cursor on the next idle input phase ([click rule](#reawakened-click-movement-freeze)). Losing window focus pauses the game and releases every held keyboard key and mouse button ([rule 4](#reawakened-held-direction-movement) below, [click rule](#reawakened-click-movement-freeze)); regaining it resumes.

<a id="reawakened-held-direction-movement"></a>
**Reawakened rule (OWNER; held direction movement; amended 2026-11-02, issue #1123).** In plain terms: if you keep a direction key held, the player keeps walking in that direction, one step at a time, at the same speed as if you had tapped the key repeatedly, except while a blocking script owns the key queue. Technically, and deterministically:

1. The input phase reads the current held direction state (`state.input.actions`) as well as any new press edges.
2. When the selected player is idle (`canAcceptDirection`), no blocking thread owns the key queue, and a direction is held, one direction move is enqueued in that tick. A direction press during a block also enqueues no movement.
3. The move uses the same step size and speed rules as a tapped key; the next step is enqueued on the first tick the player becomes idle again while the key stays held and no blocking thread owns the key queue. A direction still held when the block ends acts on the next idle input phase. A tap completed during the block is lost for movement but remains in the key queue.
4. **Focus loss releases held keyboard keys (owner direction, Jensen, 2026-11-02, issue #1120; corrects the earlier wording of this rule).** In plain terms: if you alt-tab away while holding a direction key, the game forgets you were holding it; when you come back, the player stays still until you press the key again. Technically: a host delivers a key-up only to the focused window, so a key released while the window is unfocused is never reported, and no runner sends anything but a `focus` record on blur ([runners.md](runners.md#input)). Core therefore does not carry held keyboard state across a blur. Applying a `focus` record with state `lost` is, for every held keyboard key, the same state change as that key's key-up: the raw held flag (`state.input.held`), the keyboard half of each action (`keyboardActions`), the action state (`actions`) and the direction order (`directionOrder`) all drop it, and it queues no press edge. The step already in progress still finishes (it is not queued input), and, as before, no new step is enqueued while focus is lost, because no tick runs (E-03). Order is the host's order: key records queued at the current tick before the `focus` record are applied before it (so a key pressed in the blur's own frame is released too, and its entry in the script key queue is kept), while records after it wait for the resumed tick as before. A key the player is still holding when focus returns does nothing until it is pressed again: a host auto-repeat (`repeat`) of a key core does not hold is not a press and marks nothing held. Held state derived from a connected gamepad is device state, not keyboard state: it follows the device's reported mask and its connect and disconnect records, and a focus record does not change it. Nothing is added to the saved input section or its hash: only the values of existing fields differ, and only after a `focus` record of state `lost`. **Rejected alternatives:** carrying held keys across the blur and relying on each runner to synthesise key-ups, which three runners do not do, so one missed key-up makes the player walk by itself after refocus; and dropping the stale held keys on `focus.gained` instead, which would leave the held state wrong for any reader of it while the window is unfocused.

Evidence: this page's Input table ("queue a step ... when the player is idle"); E-24 and E-110; the deterministic fixed-tick rule in [main-loop-and-startup.md](main-loop-and-startup.md#reawakened-phases) (R-56). **Rejected alternative:** relying on the host OS key-repeat events, which makes movement cadence depend on the host's repeat delay and rate and differs between runners (violating G3).

**Owner ruling (Jensen, 2026-11-02; issue #1123):** “Freeze input while a script is blocked.” This covers `wait()`, `Get()`, message windows, prompts, menus, battle and the script error box while a thread owns the key queue. The queue continues to receive keys, and `wait()` discards its backlog before waiting so only a new key counts.

**Engineer evidence [source-read, not run-confirmed]:** “Any program running: walk/activation/menu keys Not checked; key queue yes once per instruction; threads frozen... The next idle frame checks held keys. A key still held acts immediately. Taps made during the program are lost for movement but stay in the queue.” **Engineer [inference]:** auto-repeat key-downs would end a wait almost immediately; this inference is not an owner ruling.

<a id="reawakened-click-movement-freeze"></a>
**Reawakened rule (OWNER; click movement freezes with the keys; ruled 2026-11-02, issue #1169; evidence updated by the engineer's final 3.1.0 read).** In plain terms: while a script is waiting (for a key, a message window, a prompt, a menu, a battle or the script error box), clicking the board does not walk the player, and a walk a click had already started stops after the step the player is in the middle of and waits. When the script ends the walk carries on, unless the script cleared it, and if you are still holding the mouse button the player walks towards the cursor again at once. Technically, and deterministically:

1. *Same rule, same test.* "A blocking script owns the key queue" is the one test the held-direction rule uses: a blocking program is alive, or any thread holds a global wait. A click is gameplay input exactly as a direction key is, so the sentence "Gameplay input is read only while … no blocking script owns the key queue" covers it as written.
2. *A click during a block starts no path.* The click is still recorded in the pointer state for scripts and plugins; it is not queued for later and is not replayed when the block ends, so it is lost for movement as a tap is. A click on an on-screen button slot is not a movement click: it still appends its entry to the key queue, which is the script's.
3. *A path under way pauses; it is not cancelled.* Moves that a click or the held button queued are marked as coming from the pointer. In every movement phase while a script owns the key queue, a pointer-marked move at the head of the queue does not start, so no new step begins; the step already in progress finishes, as it does for a held key and for a focus loss, and the actor stands as waiting, not walking, while paused. The rest of the route stays in the queue and continues when the block ends. A diversion around a blocking sprite inherits the mark. Moves a script issued (`PlayerStep`, `PlayerPath`, waypoints, an item's own thread) carry no mark and are never paused, so a script that waits for its own movement still sees it finish.
4. *The route a program clears stays cleared.* A step-on or key program with the *stops movement* flag, and any item program, discard the player's queued route when they start ([movement-and-collision.md](movement-and-collision.md)); a board program without the flag leaves it. The core already does this, and this rule adds nothing to it: a paused route survives a program without the flag and is gone after a program with it. One difference stays as it is: the core lets the step in progress finish when it clears the route, while the engineer says 3.1 sets the target to the current pixel position.
5. *A held button re-paths.* The left button is read as "currently held" on the idle input phase (no script owns the key queue and the player has no route): while it is held and not over an on-screen button slot, a path towards the cursor is queued. So a button still held when a block ends walks the player towards the cursor on the next idle input phase, even after a program cleared the route. A button released during the block does not. The read adds no state: it uses the pointer position and buttons the input section already stores.
6. *Focus loss releases the held button.* Its button-up is never reported to an unfocused window, so a stale held button would walk the player towards the cursor after refocus by itself, the same failure as a held key ([rule 4](#reawakened-held-direction-movement)). Applying a `focus` record of state `lost` sets the stored pointer buttons to 0; position and nothing else changes.
7. *Saved state.* The mark is an optional field on queued and in-progress sprite moves, present only while a pointer route exists; the pointer buttons are an existing field whose value differs after a blur. No section, schema version or field is added to the input section; a game with no click in flight hashes as before.

**Owner ruling (Jensen, 2026-11-02; issue #1169):** "Make it consistent — freeze clicks too. Pointer-click path movement must obey the same rule as keys: while any thread owns the key queue (wait, Get, prompt, message window, menu, battle, error box) a click starts no path and an in-progress path takes no new step; the spec sentence 'Gameplay input is read only while … no blocking script owns the key queue' then stands as written."

**Engineer evidence (TK engineer, Toolkit 3.1.0 final revision, relayed 2026-11-02; [source-read, not run-confirmed]).** This replaces an earlier note that the 3.1 table was silent on clicks.

- "A click made while a program runs is recorded for scripts and plugins, but it doesn't move the player." [from source]
- "If the button is still held when the program ends, walking resumes towards the cursor on the next frame. That would happen even after an item or stops-movement program had cleared the path." [from source]
- The left button is polled as "currently held" during idle frames; while held, a new path to the cursor is computed every frame and replaces the old one. [certain, for the polling]
- While a program runs the world freezes and a click path does not advance. [certain]
- A board program without *stops movement* leaves the path in place, and the player carries on along it on the next frame; an item, or a board program with *stops movement*, discards the path (the player's target is set to the current pixel position). [certain]
- A direction key pressed during click-walking clears the path and starts a keyboard step. [certain] **Not implemented here** (see issue #1180).

**What the rule implements and what it does not.** Rules 2, 3, 4 and 5 follow the evidence above; the ruling decides that clicks are frozen too. *Held-button polling is narrower than 3.1's:* 3.1 recomputes the path every frame while the button is held; the core queues one only when the player has no route, because recomputing from a half-finished step would move the path's nodes off the tile grid [inference: from the path-finder's tile-centre nodes, not a measured fixture]. A click path under way is therefore replaced by a new click, not recomputed every frame. *Out of scope, recorded elsewhere:* the engineer's findings that click-walking runs the step-on and random-encounter checks every frame against the next waypoint and counts a whole step each time, and that a direction key during click-walking clears the path, are not modelled; they are issue #1180. The script error box does not exist in core as a state that can own input (issue #1179); the rule covers it when it does.

<a id="e-49"></a>
**E-49 Global keys.** The menu key opens the menu ([plugins-and-battle.md](plugins-and-battle.md#menu-plugin)); the run-time keys (up to 51 of them) run the programs they name, with a short debounce after the menu closes.

<a id="e-110"></a>
**E-110 Keyboard.** Named keys are returned to scripts (`Wait()` returns e.g. `"ENTER"`, `"LEFT"`, `"A"`); movement uses the configured scan codes; the menu, activation and run-time keys are character-coded. The buffered key queue can be cleared.

**Reawakened rule (entry 7.11 corrects a gap).** `Get()` and `ClearBuffer()` claim keys while a thread runs. A claimed key is removed from the queue at the start of the next tick's waits phase, before that phase rebuilds the claim list for waiting threads, so a key `Get()` returned is never returned again and `ClearBuffer()` empties what was buffered.

<a id="reawakened-key-name"></a>
**Reawakened rule (OWNER; the legacy key name is derived by `core`; ruled 2026-11-01).** In plain terms: every key press that reaches a script is named the way Toolkit 3.1 named it, whatever keyboard, layout or host it came from.

The runner reports a key as `{ code, char, vk, down, repeat? }` and never names it. **`core` derives the name**; a `name` field that a host or runner nonetheless supplies is ignored, never read, so a browser, a desktop shell and a mobile WebView cannot disagree:

| The key | Name the queue holds |
|---|---|
| Enter, Escape, the four arrows | `ENTER`, `ESC`, `LEFT`, `RIGHT`, `UP`, `DOWN` |
| Space | `" "` (one space; 3.0 said `SPACE`, 3.1 does not) |
| any key that produces a character | that character, as typed (`char`) |
| any key that produces no character | the character whose code is `vk`, which is 3.1's virtual-key fallback: F1 is `P` (112), PgUp is `!` (33), Delete is `.` (46) |

`vk` is an integer or `null`: the host's virtual-key number, which a browser supplies from the key event and a native host from its own key code. The collisions are kept: `%`, `&`, `'` and `(` have codes 37–40, so **shifted 7, 8, ' and 9 return `LEFT`, `UP`, `RIGHT` and `DOWN`**, exactly as 3.1 did. A key-down appends one entry, **including a host auto-repeat**, so a held key keeps filling the queue; a key-up appends nothing. A key with no character and a `null` `vk` appends nothing and reports one `input.key-name` diagnostic, because 3.1 had no such key.

3.1's rule that `Wait()` **clears the queue before blocking** is kept in effect by the park-sequence rule above: a wait parks at the current sequence number and only sees keys at or after it, so keys pressed earlier are discarded for that waiter without a queue write. `Get()` claims from the same sequence and therefore still sees them.

<a id="e-111"></a>
**E-111 Mouse.** Click (blocking or polling) and move coordinates for scripts, click-to-move, cursor maps and on-screen buttons.

<a id="e-112"></a>
**E-112 Joystick/gamepad.** An optional joystick, mapped to movement and confirm/cancel. The legacy engine records no other joystick behaviour, so the contract below is a **Reawakened addition**; the E-112 anchor is kept so citations to the id still resolve.

<a id="reawakened-gamepad-contract"></a>
<!-- OWNER: E-112 -->
**Reawakened rule (OWNER; E-112 gamepad contract; ruled 2026-10-18, buttons amended 2026-11-01).** In plain terms: a game controller can walk the player and press confirm or cancel exactly like the keyboard does, and a controller that is unplugged is ignored. Technically, and deterministically:

1. *Normalized event.* The host reports `{ kind: "gamepad", device, connected, axes: { x, y }, buttons }` as plain data. `device` is an integer 0..3 (other values are ignored); `axes.x` and `axes.y` are integers in −1000..1000 (right and down positive); `buttons` is a **physical** bitmask on the [W3C Standard Gamepad](https://w3c.github.io/gamepad/#remapping) layout — bit `n` is button `n` (0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 8 Back, 9 Start, 12–15 d-pad up/down/left/right, 16 guide). The host reports which control was physically pressed and never decides what it means; meaning comes from the binding table ([ACT-3](#act-3)). No host or browser controller API, object or float enters `core`; the host does the normalizing.
2. *Dead-zone.* An axis value with absolute value below 250 counts as 0 (strict less-than; 250 itself is active). An active axis resolves to the corresponding stick control (`pad:axis0-`, `pad:axis0+`, `pad:axis1-`, `pad:axis1+`), which the binding table maps like any button; the default bindings make that the matching direction.
3. *Project bindings.* Controls resolve to actions through the same binding table as the keyboard ([ACT-3](#act-3)), including a game's own actions ([ACT-2](#act-2)); a controller input adds nothing the bindings do not name. Diagonals follow the keyboard rule (two directions 90° apart, only where diagonals are allowed).
4. *Same held/edge state.* A resolved action updates the same held set as a keyboard key: a press edge on a tick appends one key-queue entry with the next monotonic input sequence number whose name is the action's compatibility name (`up`, `down`, `left`, `right`, `confirm`, `cancel`, `menu`) and sets the action held; a release edge clears it; a held control produces no repeat entries. Edges are computed per device from the previous event for that device; simultaneous edges are processed in ascending device, then ascending control order (`pad:<n>` by index, then stick directions).
5. *Disconnect.* An event with `connected: false` releases everything that device held and is otherwise ignored; events for a device that has never reported `connected: true` are ignored. Connected devices are merged: an action is held while any connected device holds it.
6. *Buttons and cursor map.* On-screen button slots are a separate concern (entry 5.6 defines the slot data `{ id, x, y, w, h, action, enabled }`); the controller never moves the pointer.

Evidence: the legacy inventory's single line (joystick mapped to movement and confirm/cancel); `docs/spec/formats/main-file.md` `useJoystick`; the `GamepadInput` port in `packages/core/src/ports/input.ts` and AD-14 (event name fixed, payload deferred to this epic); the shared key-claim protocol (Epic 4, entries 4.1 and 4.19). **Rejected alternative:** exposing the browser or native controller API (or float analogue values and per-device bindings) to `core`, which would break G2/G3 and make replays host-dependent. The dead-zone value 250 and the device range 0..3 remain the defaults ruled on 2026-10-18 and are still unverified against hardware; the **button layout is no longer an action bitmask** — it is the W3C standard index space, because a host that has already collapsed buttons to actions cannot report which physical button was pressed, and so nothing could be rebound ([ADR 0017](../../adr/0017-input-actions-devices-and-accessibility.md)). Remapping is no longer deferred: it is [ACT-5](#act-5). Still deferred: haptics, analogue speed and multiplayer assignment. Consumers: entries 5.2 (`input-replay-button-slots`), 5.6.

<a id="e-113"></a>
**E-113 Focus handling.** The game pauses when the window loses focus. Core also releases held keyboard keys on focus loss ([held direction movement](#reawakened-held-direction-movement), rule 4).

<a id="act-1"></a>
**ACT-1 The action vocabulary (OWNER; ruled 2026-11-01).** In plain terms: a game asks "is *confirm* held?" rather than "is Enter held?". Which physical key, mouse button or controller button produces *confirm* is configuration, and the player can change it.

Technically, the engine owns a fixed set of seven actions: `up`, `down`, `left`, `right`, `confirm`, `cancel`, `menu`. Gameplay — the board, the movement rules, the menu, dialogs, the shop, the battle UI and the system options — reads **actions only**; no surface reads a key name, a key code or a controller button directly. `confirm` is the action the legacy activation key performs and `menu` is the action the legacy menu key performs, so the engine set is a rename of behaviour the engine already had, not a new capability. The engine set may not be removed or renamed by a game. **The action space beyond it is open**: a game registers its own actions ([ACT-2](#act-2)), and a registered action is as bindable, as remappable and as visible to options as an engine action.

**Everything the legacy layer reads keeps working** ([E-110](#e-110)): a key-down still enters the key queue under its legacy name, and a `wait()` parked in a script still resumes on it. Actions are derived beside the queue; deriving an action never consumes a queue entry and never changes a sequence number.

<a id="act-2"></a>
**ACT-2 Game actions: a designer can add as many as the game needs (OWNER; ruled 2026-11-01).** In plain terms: a spell-and-skill game can define "fireball", "heal", "dash" and a hundred more as first-class actions, each with its own icon and label, each bindable by the player, each usable from a script and from a spell bar — without the engine knowing what any of them mean.

A game registers an action through the package or script that owns it, as plain data:

```
RegisteredAction = {
  name:      string,                  // "game.fireball"; the identity, stable forever
  label:     string,                  // non-empty; shown in options and on the surface
  icon:      AssetKey | null,         // the asset the spell bar draws; null draws the label
  group:     string | null,           // "Spells", "Skills"; options groups by it
  controls:  readonly ControlId[],    // the designer's default bindings (ACT-3)
  locked:    boolean,                 // the game fixes this action (ACT-6)
  hidden:    boolean,                 // registered for scripts only; never offered in options
}
```

Rules:

1. **Namespace.** A registered name MUST start with `game.` and then match `[a-z][a-z0-9]*` segments joined by dots (`game.fireball`, `game.skill.backstab`). The prefix keeps the engine set collision-free forever; a name that does not start with it is rejected with a located refusal.
2. **Label and icon are presentation, the name is identity.** Renaming an action is a new action: a save that bound the old name keeps the binding as inert data (rule 6). Changing a label or an icon never touches a save.
3. **Ordering is registration order**, and registration order is startup order: packages in resolved manifest order, then each package's startup program, then runtime registrations in the order they execute. The order is part of the action table and therefore of the state hash; it is never derived from a map's iteration order (G3).
4. **Scale is a design constraint, not a limit.** A registry holds at least 512 actions. Binding resolution builds one `control → actions` index whenever the effective table changes and looks up only the controls an event actually names, so per-input cost does not grow with the size of the registry. Registration itself is a startup cost, charged once.
5. **A shortcut is data, not behaviour.** Registering an action adds an action, a default binding and a row in options; it never runs game logic, never touches the board and never overwrites an engine action.
6. **Inert is not an error.** A binding, a save or a surface slot naming an action that is not registered keeps its data, holds nothing and produces one located `input.unknown-action` diagnostic per boot. If the action is registered later in the same boot it takes effect; a game update that removes an action therefore cannot brick a save ([ACT-7](#act-7)).
7. **Extensible shape.** `RegisteredAction` is versioned and forward-compatible: an unknown field is preserved as data and ignored by a reader that does not know it, so a future capability (a cooldown source, a narration string, a default surface slot) is added without a format break.

<a id="act-3"></a>
**ACT-3 The binding table (OWNER; ruled 2026-11-01).** A binding names an action and the **controls** that produce it, as plain data:

Two layers, and they are different shapes on purpose ([ACT-6](#act-6)):

```
GameBindings = {                       // .gam block, or a registration's defaults
  version: 3,
  actions: { [action: string]: {
    controls: readonly ControlId[],    // ordered; first bound control wins on a tie
    locked: boolean,                   // true: the game fixes this action (ACT-6)
  } },
}

PlayerOverrides = {                    // the save's input section
  version: 1,
  actions: { [action: string]: {
    added:   readonly ControlId[],     // controls the player put on this action
    removed: readonly ControlId[],     // game-default controls the player took off
  } },
}

// effective controls = (game controls − removed) + added, deduplicated in that order
```

**Removal is explicit and addition never deletes.** A player who adds `KeyZ` to `confirm` keeps `Enter`, so a 3.1 script that polls `ENTER` still receives it; a control leaves an action only when the player removes that exact game default. That is what makes remapping safe for a ported game whose scripts read raw key names ([A11Y-16](accessibility.md#a11y-16)).

**Which numbers are which (clarification, reconciliation tracked on #1127).** Three version numbers sit near the binding table and are not the same thing: the `TRKINP` block's `u8` schema number (`1` in this version, [main-file.md](../formats/main-file.md#tkr-input-extension)), the save's `input` section schema (2 today; [ADR 0017](../../adr/0017-input-actions-devices-and-accessibility.md) moves it to 3 with the core action layer, #1099), and the `version` fields inside the two shapes above. These shapes do not yet say which of those referents each `version` names, so neither number is, on this page, stated to version the `TRKINP` block or the save section.

A `ControlId` is one of three canonical ASCII strings:

| Form | Meaning | Example |
|---|---|---|
| `key:<code>` | a physical key, named by the DOM `KeyboardEvent.code` value: layout-independent, and every host can produce it | `key:Enter`, `key:ArrowUp`, `key:KeyW`, `key:NumpadEnter`, `key:F1`, `key:Digit1` |
| `pad:<n>` | button `n` in the W3C Standard Gamepad layout, 0–16 | `pad:0` (A), `pad:9` (Start), `pad:12` (d-pad up) |
| `pad:axis<0\|1><-\|+>` | a stick direction after the E-112 dead-zone: axis 0 is x, axis 1 is y | `pad:axis0-` (stick left) |

`core` compares control ids as strings and never parses a host identifier ([ADR 0017](../../adr/0017-input-actions-devices-and-accessibility.md) decision 4). The pointer is deliberately not a control: it acts by hit-testing on the surface under it, so it needs no binding and cannot be mis-bound. An action may have zero controls (explicitly unbound); an action with zero controls is never held, and a surface that needs it says so through `a11y.character-shortcut` or its own validation ([A11Y-4](accessibility.md#a11y-4)).

<a id="act-4"></a>
**ACT-4 From a device event to an action (OWNER; ruled 2026-11-01).** Each incoming event is normalised to controls, then resolved to actions, inside the tick that consumes it:

| Event | Controls it can produce |
|---|---|
| `key { code, char, vk, down, repeat? }` | `key:<code>`; the legacy name is used for the queue, the code for the action |
| `pointer { x, y, buttons }` | none — the pointer drives the surface cursor and its own actions |
| `gamepad { device, connected, axes, buttons }` | `pad:<n>` for each changed bit, `pad:axis…` for each axis that crosses the dead-zone |

Rules: the **same** `key` event appends its legacy queue entry and updates its action's held set, in that order, so a script and a surface see one event and not two — **one key press appends exactly one queue entry, the derived key name of [E-110: key names](#reawakened-key-name)**, never also the action's compatibility name; a host auto-repeat (`repeat: true`) never produces a new action press edge, and appends exactly its one derived-name entry like any other key-down ([E-110: key names](#reawakened-key-name)), never also the action's compatibility name; a press edge that comes from a gamepad (or from a pointer on a button slot) appends the action's compatibility entry as [E-112](#reawakened-gamepad-contract) rule 4 describes, so `wait()` can still be satisfied by a controller; a control bound to two actions holds both, and the order they resolve in is the action table's order, which is the engine set first (in the order `up`, `down`, `left`, `right`, `confirm`, `cancel`, `menu`) and then registered names in registration order.

<a id="act-5"></a>
**ACT-5 Controllers are on by default (OWNER; ruled 2026-11-01).** A standard-layout controller works in a new game with no configuration: the game file's controller flag defaults to **enabled** when the game file does not say otherwise, and the default bindings are:

| Action | Keyboard default | Controller default |
|---|---|---|
| `up` | `ArrowUp` | `pad:12`, `pad:axis1-` |
| `down` | `ArrowDown` | `pad:13`, `pad:axis1+` |
| `left` | `ArrowLeft` | `pad:14`, `pad:axis0-` |
| `right` | `ArrowRight` | `pad:15`, `pad:axis0+` |
| `confirm` | `Enter`, `Space` | `pad:0` |
| `cancel` | `Escape` | `pad:1` |
| `menu` | `Enter` (the legacy menu key) | `pad:9` |

A game may disable the controller in its own file, and a player may disable it in options; a disabled controller's events are ignored entirely, including its disconnect. Devices 0–3 merge as [E-112](#reawakened-gamepad-contract) rule 5 already rules. A game action gets no controller default unless its registration names one; a spell bar on a controller is the designer's choice, not the engine's.

<a id="act-6"></a>
**ACT-6 Remapping, override and locking (OWNER; ruled 2026-11-01).** Two layers, one effective table:

1. **Game defaults** live in the game file for the engine set and in the registration for a game action ([TKR input extension](../formats/main-file.md#tkr-input-extension)). Absent, the defaults above and the legacy rows' meanings apply, so an untouched 3.1 game behaves exactly as it did.
2. **Player overrides** are `{ added, removed }` per action ([ACT-3](#act-3)) in the save's `input` section. At boot they are folded into one effective table; the effective table is the state that is snapshotted, restored and hashed.
3. **Adding is the default action of remapping; removing is a separate, explicit one.** The options screen's ordinary remap adds a control to the action. Removing a game default is its own action, is shown as such, and is the only way a control stops producing an action. This keeps a ported game working when a player rebinds: an engine action moved to another key does not take the old key away from a script that reads it.
4. An override may not change an action's `locked` flag: a locked action is fixed by the game and stays fixed after a restore.
5. Rebinding rejects a **duplicate within the engine's own set** with a located refusal that names the conflicting action, so two actions cannot accidentally share a control through the options screen. A game's own defaults, a game action's registration and a script's `rebindAction` may still bind a control twice; the resolution order of [ACT-4](#act-4) then applies, exactly as the legacy movement rows behave when one scan code is bound to two directions.
6. `resetBindings()` discards every override and returns to the game defaults; there is always a way back that a player can reach from the options screen.
7. The options screen is reachable from the title screen, from the running game and from the pause menu, works with all three devices, lists game actions by `group` with paging on `left`/`right` (the stock item list's rule), and is itself covered by [A11Y-2](accessibility.md#a11y-2), [A11Y-4](accessibility.md#a11y-4) and [A11Y-13](accessibility.md#a11y-13).

<a id="act-7"></a>
**ACT-7 Determinism, replay and restore (OWNER; ruled 2026-11-01).** The binding table, the effective table, the registry order and every held action are part of the `input` section, so they are snapshotted and hashed with the rest of the state (G1). A replay is the logged input events plus the state they landed in: because the table is state and not a host setting, replaying the same log on another machine produces the same action edges, the same queue entries and the same state hash (G3).

Restore rules:

1. A v2 input section restores into the defaults of [ACT-5](#act-5); no save is refused for version alone.
2. The registry is rebuilt by startup, never stored in the save. A save records bindings by action **name**, so a changed registration list cannot invalidate them.
3. A saved binding whose action is not registered after restore is kept as inert data with one `input.unknown-action` diagnostic; the save still loads and every other action still works. A save MUST NOT be refused, and no binding MUST be silently dropped, because either would lose data on a game update.
4. A surface's saved slot layout is the game's, not the save's, unless the game provides a layout action; the bar's order does not depend on the player's bindings, so a rebind never rearranges a spell bar.

<a id="act-8"></a>
**ACT-8 Action surfaces: bars, grids and pages (OWNER; ruled 2026-11-01).** In plain terms: a spell-and-skill game can put dozens of actions on screen — a bar of icons during play, a grid of spells in a book — and every one of them is reachable by keyboard, controller and mouse, and is described to a screen reader.

A **surface** is an ordered list of slots, each `{ slot, action, enabled }`, plus a layout the game chooses:

| Surface | Layout | Navigation |
|---|---|---|
| **bar** | one row of at most 10 slots, drawn during play | `left`/`right` move the cursor and wrap; `confirm` activates the focused slot |
| **grid** | rows × columns (a spellbook) | `left`/`right` wrap within the row, `up`/`down` change row and wrap at the ends; `confirm` activates |
| **paged list** | the stock menu and options shape | `up`/`down` move, `left`/`right` page, `confirm` activates, `cancel` leaves |

Rules: the pointer moves the surface cursor by hover and activates on release over the same slot ([A11Y-6](accessibility.md#a11y-6)); a slot whose action is bound to a control can be activated by that control without the cursor being on it, so a hotkey and a click do the same thing; a disabled slot (no resource, on cooldown, out of range) is drawn dimmed, is skipped by the cursor only if the game says so, and is always reachable by the pointer; the focused slot and every slot are described in the accessibility tree with their label, their enabled state and their cooldown as `value` ([A11Y-11](accessibility.md#a11y-11)); a cooldown is announced when it starts and when it becomes ready, never per frame; the bar never steals a control the engine set owns — the bar's actions are game actions, and the engine set stays bound to what it was. A script that draws its own screen declares a surface and gets **the same** cursor, pointer behaviour, focus ring and tree node shape the stock menu gets ([A11Y-15](accessibility.md#a11y-15)); there is no second-class navigation path for author-drawn UI.

## Audio

| Sound | Source |
|---|---|
| Board music | board `bkgMusic`, looped, started on entering the board (kept if the next board names the same file) |
| Battle music | fight background `music`, during battles |
| Menu and battle sounds | main file cursor sounds and fight background sounds, played by the plugins |
| Animation frame sounds | each `.anm` frame's sound, played when that frame is shown |
| Script sounds | `Wav()` for sound effects (one channel), `MediaPlay()` / `MidiPlay()` to change the background music |

Formats: anything the platform can play (the samples use MIDI and WAV; MP3 and OGG were supported). **Compatibility note:** the original engine's music code routed every file through its MIDI path because of a string-comparison bug; animation frame sounds bypassed PAK extraction, so they probably did not play from PAK games (inferred). **Reawakened rule (OWNER; formats).** Reawakened plays MIDI and WAV directly and converts MP3, Ogg, Opus and FLAC to WAV at import; tracker modules are not played (a recorded departure). The file's bytes, not its track or name, choose how it plays. See [audio-media.md#audio-format-policy](audio-media.md#audio-format-policy).

<a id="e-16"></a>
**E-16 Background music per board.** Board music starts on entry and changes when the player is sent to another board or crosses an edge; the file is kept playing when the next board names the same one. **Reawakened rule (OWNER; effect handoff).** Board music and per-frame `.anm` sounds post `audio` effect records through `postEffect`; audio-synth registers the applier and later creates `AudioCue`s. Board rendering owns neither `GameState.audio` nor `cueId`. The deterministic track, save, cue and wait contract is [audio-media.md#board-effect-mapping](audio-media.md#board-effect-mapping).
<a id="reawakened-audio-effect-records"></a>
**Reawakened rule (OWNER; audio effect records).** Board-rendering retains the effect vocabulary: board `bkgMusic` uses a `music.play` record and each visible `.anm` frame sound uses an `sfx.play` record. Records have no `cueId`; phase order and frame index order them. The audio applier maps them to the `music` and `sfx` tracks, decides same-file/replacement/silence, assigns monotonic cue IDs and creates generic per-track cues. Effects posted before registration remain in the bounded FIFO pending queue. See [audio-media.md#board-effect-mapping](audio-media.md#board-effect-mapping) for the exact fields and the producer seams.

<a id="e-100"></a>
**E-100 Background music.** One looping track at a time. MIDI is by far the most common (the bundled music pack is MIDI); MP3, OGG, WAV and tracker modules are also used. It changes per board, on battle start and end, and through `MediaPlay()` / `MediaStop()`. MP3 can be paused. The Reawakened core timeline and track lifecycle are [audio-media.md#audio-lifecycle](audio-media.md#audio-lifecycle).

<a id="e-101"></a>
**E-101 Sound effects.** One-shot effects (`Wav()`; the older `Sound()` is obsolete), optionally blocking until finished. They also come from animation frames, menu cursor sounds and battle background menu sounds. The Reawakened wait and null-audio rules are [audio-media.md#audio-track-wait](audio-media.md#audio-track-wait) and [audio-media.md#audio-headless](audio-media.md#audio-headless).

<a id="e-103"></a>
**E-103 MIDI playback.** Needs a General MIDI synthesiser with a SoundFont in any runner that lacks OS MIDI — browsers, mobile — and is a real parity requirement, because legacy games depend on it heavily. The core-to-synth boundary is [audio-media.md#audio-synth-seam](audio-media.md#audio-synth-seam). **Reawakened rule (OWNER; platform).** The SoundFont is configuration with player, script, author, runner and bundled layers ([audio-media.md#soundfont-layers](audio-media.md#soundfont-layers)); `soundFont()` and `soundFontReset()` are Reawakened additions ([audio-media.md#soundfont-commands](audio-media.md#soundfont-commands)); a bank the file asks for but the SoundFont lacks falls back to General MIDI bank 0 ([audio-media.md#midi-bank-fallback](audio-media.md#midi-bank-fallback)); the bundled bank must pass the provenance bar ([audio-media.md#path-b-bank](audio-media.md#path-b-bank)).

> **R-59 — audio routing and frame audio (settled by Epic 6.1 and 6.3).** The legacy feature inventory (E-100, E-101) describes looping music plus one-shot effects; the extracted compatibility note that the original routed every file through its MIDI path and that animation frame sounds bypassed PAK extraction remains a legacy bug note, not a Reawakened requirement. Reawakened keeps `music.play` and `sfx.play` as plain effect records, maps them to named tracks in the audio applier, and gives core the deterministic clock. Animation frame effects are emitted when the frame becomes visible; missing runner audio is silence plus a diagnostic and does not alter game state. 6.3 rules the routing: the file's bytes choose the source, frame sounds are one-shot `sfx` voices resolved through the package index, and menu and battle-menu sounds go to the `ui` track ([audio-media.md#r-59-routing](audio-media.md#r-59-routing)). See [audio-media.md#board-effect-mapping](audio-media.md#board-effect-mapping).

## Video

Scripts play video with `PlayAvi()` (full screen) and `PlayAviSmall()` (actual size, centred); `.avi`, `.mpg` and `.mov` were supported. Playback blocks the game and cannot be skipped.

<a id="e-62"></a>
**E-62 Video.** Plays an AVI full screen or in a small window, blocking. **Reawakened rule (OWNER; video request).** `playavi` and `playavismall` issue one `playVideo` request with a `presentation` of `full` or `small`, freeze the game until the matching `video.ended { reqId }`, stop the music and restart it from the beginning afterwards, and cannot be skipped ([audio-media.md#video-request](audio-media.md#video-request), [audio-media.md#video-wait-hold](audio-media.md#video-wait-hold), [audio-media.md#video-music](audio-media.md#video-music)).

<a id="e-104"></a>
**E-104 Video formats.** `.avi` is the native form; `.mpg` and `.mov` were also accepted. A rebuild can transcode on import to a portable format.

**Reawakened rule.** Video is **transcoded on import** to a portable container a runner can decode without a legacy codec; the imported copy is what the game plays from then on. The portable profile (WebM, VP9 video, Opus audio) and the name-preserving import are ruled in [audio-media.md#video-policy](audio-media.md#video-policy).

<a id="e-132"></a>
## Fonts

All `*.ttf` files in the project's `Font\` folder are made available to the game while it runs. Scripts select fonts by name (`Font()`), size, bold, italic and underline. Toolkit 2 bitmap fonts are not supported by the 3.x engine.

<a id="reawakened-fontref-and-metrics"></a>
**Reawakened rule (OWNER; FontRef).** A text draw command carries `FontRef = { asset, size, bold, italic }`; underline remains a separate `line` command and is not a FontRef field. Size and style are therefore visible in draw-list hashes and runner inputs.

**Reawakened rule (OWNER; TrueType metrics).** For a font with `unitsPerEm`, scale each advance, kerning adjustment, ascent, descent and line gap by `size / unitsPerEm`. Round each non-negative scaled advance and kerning adjustment with `floor(value + 0.5)`. Read ascent, descent and line gap from `hhea` only, never `OS/2` or Windows metrics. Compute `ascentPx = floor(ascent * size / unitsPerEm + 0.5)`, `descentPx = floor(-descent * size / unitsPerEm + 0.5)` and `lineGapPx = floor(lineGap * size / unitsPerEm + 0.5)` (the hhea descent is negative), then `lineHeight = ascentPx + descentPx + lineGapPx`.

**Reawakened rule (OWNER; family substitution).** Resolve a project font asset by case-insensitive family name. Otherwise substitute `Arial`/sans-serif with Liberation Sans, `Times New Roman`/serif with Liberation Serif, and `Courier New`/monospace with Liberation Mono, then use the documented fallback family. A `.fnt` is selected when the name resolves to one or when the project is TK2; other names use family substitution. Entry 4.3 owns the library, bundled assets and bitmap fallback.

<a id="reawakened-bundled-assets"></a>
**Reawakened rule (proposed, pending owner review; ticket 4.28; bundled assets).** The files the project itself ships under `media/` (the default bitmap font `media/fonts/tkr-8x8.fnt`, the Liberation TrueType fonts and the cursor images `media/cursors/tkr-hand.png` and `tkr-arrow.png`) reach the engine as bytes the host hands to `createEngine` (`bundled`, keyed by their `media/` path), like every other asset; the engine decodes each one the first time a frame needs it. A text command whose font asset is not available (a family name the game does not ship, such as `Comic Sans MS`) draws in the default bitmap font at the same size and style. A frame that cannot be replayed (a draw command names an asset that is not available) is reported as the located diagnostic `render.failed`, never left as a silently blank or partial image. Evidence: the closing suite (`golden/closing/plan.json`) found that without this seam both 3.1 sample games' title screens drew nothing. Rejected: the engine requesting bundled files through `asset` requests, because a draw list is a pure function and cannot post requests, and because the bundle is the host's own, not the game's.
