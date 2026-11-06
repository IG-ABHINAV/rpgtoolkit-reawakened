# Host Capabilities, Display Planes and Touch Control Surface

The normative specification for **host capability negotiation**, **display viewport geometry**, and **touch input
presentation** in Toolkit Reawakened.

It builds directly upon [ADR 0017](../../adr/0017-input-actions-devices-and-accessibility.md) (semantic actions, devices,
and accessibility) and [runners.md](runners.md#boundary) (the runner boundary and presentation scaling).

**Status.** Normative. This page defines the plain-data contract between host runners and `core`, as well as the
author-facing APIs for responsive layouts, safe areas, and touch ergonomics.

- **G1 & G3:** `features` and `display` are plain JSON state sections. Initial host records are boot inputs captured in those sections; each later change is an explicit `host.features` or `host.display` AD-14 input carrying the complete normalized value. Those sections are snapshot- and hash-significant because RPGCode can query them. Replaying the same game, seed, initial host records, and ordered input log reproduces the same state and hash.
- **G2:** `core` never queries the DOM, `navigator.userAgent`, or OS platform APIs. The runner computes capabilities and geometry, then supplies them at boot or in logged AD-14 inputs. Core never learns a runner's name.
- **G4:** Renderers replay draw lists and do not invent game state. Author-drawn on-screen controls are ordinary draw commands; runner fallback controls are host presentation. The physical presentation transform (scale and placement of the logical viewport) is not state; the measured content/game rectangles and safe-area geometry are state because author code can query their derived values.

The terms “device state” and “geometry” in [runners.md#runner-may-decide](runners.md#runner-may-decide) distinguish raw host observation from deterministic input: a runner MUST NOT feed raw observations directly into simulation. A runner MAY report a change only as the explicit logged event defined below. Geometry's screen-to-canvas transform remains presentation-only and hash-neutral; the normalized geometry record consumed by RPGCode is hash-significant. Rendering and pointer mapping MUST use the last consumed `Engine.hostDisplayGeometry()` value, not a newer unconsumed DOM measurement; the method returns a fresh copy of the normalized record.

### State and input records

`HostFeatures` is a partial boot/event input:

```typescript
type HostFeatures = {
  touch?: boolean;
  pointer?: "fine" | "coarse" | "none";
  keyboard?: boolean;
  gamepad?: boolean;
  haptics?: boolean;
  orientation?: "landscape" | "portrait" | null;
};
```

Core normalizes boot values to `state.features` with all six own-properties present: absent booleans become `false`, absent `pointer` becomes `"none"`, and absent `orientation` becomes `null`. Unknown boot properties are discarded; persisted state contains no `undefined`. Unknown names queried by `hasFeature` return `0`. Logged events instead require all six known properties and reject unknown keys.

`HostDisplayGeometry` is:

```typescript
type HostDisplayGeometry = {
  content: { width: number; height: number };
  game: { x: number; y: number; width: number; height: number };
  safeArea: { top: number; right: number; bottom: number; left: number };
};
```

All ten numbers MUST be finite and non-negative. `content.width`, `content.height`, `game.width`, and `game.height` MUST be positive; `game.x + game.width` MUST NOT exceed `content.width`, and `game.y + game.height` MUST NOT exceed `content.height`. Insets may be zero and are not constrained to the content bounds. A missing boot record defaults to a content and game rectangle of `{x:0,y:0,width:logicalWidth,height:logicalHeight}` and zero insets. Invalid boot records and invalid `host.display` input events are rejected at the boundary and do not partially update state.

The state section is `state.display = { geometry: HostDisplayGeometry }`. `state.features` is the normalized record above. Initial records come from `createEngine({ ..., features, displayGeometry })`; boot `features` may be partial. Later updates use complete normalized values, not partial patches:

```typescript
{ kind: "host.features", features: NormalizedHostFeatures }
{ kind: "host.display", geometry: HostDisplayGeometry }
```

`NormalizedHostFeatures` has the same six fields as `HostFeatures`, but all are required. Both event kinds are stamped with the tick at which they take effect, validated as exact AD-14 records, and included in `TickReport.consumed`. Repeated events are retained in order; applying the same complete value twice leaves the same final state. No unspecified property is inferred from OS, browser, or display APIs by core.

The `action` input record is `{ kind: "action", action, down, source: "runner.fallback", modalId }`, where `modalId` is required and either a positive modal identity captured at pointerdown or `null`. A positive ID is legal only for `confirm` or `cancel`; every ordinary action, including `up`/`down`/`left`/`right` and registered `game.*`, MUST have `modalId: null`. It carries one semantic transition from runner-owned fallback controls; its `tick` is the ordinary `InputRecord.tick`. The source is stable across matching `down`/`up` records. It is not a key, pointer or gamepad event, and physical binding tables are not consulted. Modal-scoped Confirm/Cancel edges are held in a dedicated modal-action queue and validated against the captured identity when the matching wait claims input; stale edges cannot enter game pending actions or the compatibility key queue. Modal identities remain unique across in-engine `Reset()`, `MainFile()` and game-save restoration, so a still-held host pointer from the replaced timeline cannot be retargeted to a newly opened dialog. Restored modal-action queues retain their original target relationships and continue to replay. Unknown or unregistered ordinary action names are ignored with the ACT-2 once-per-boot diagnostic. The core and runners use this same action transition contract; author-surface pointer releases call the core transition helper from the recorded pointer event instead of manufacturing a second external record.
### Controller transition notifications

When an AD-14 `gamepad` input changes a device from disconnected to connected, or from connected to disconnected, the engine queues a script event for delivery in the ordinary events phase:

| Input edge | Script event | Detail |
|---|---|---|
| `connected: true` for a previously disconnected device | `device.connected` | `{ device: number, type: "gamepad" }` |
| `connected: false` for a previously connected device | `device.disconnected` | `{ device: number, type: "gamepad" }` |

`device` is the normalized AD-14 controller index (0 through 3). Repeated connected samples for an already-connected device and disconnect samples for an already-disconnected or unknown device do not emit a transition event. The event contains no browser object, device name, or other host-specific identity. A runner reports the normalized `gamepad` input; it never dispatches these script events directly. Thus connection notifications are replayed from the same ordered input log as controller state.

### Live host state after restore

A live runner MUST reconcile the complete current host capability record after every advance that may restore or reset game state. If restored `state.features` differs from the runner's latest observation, the runner MUST enqueue the complete observation as `host.features` input at the next consuming boundary; it MUST NOT mutate engine state through an unlogged setter. Pending feature records retain their order, and records stranded at the pre-restore tick are rebased to the next consuming tick in the same way as other unconsumed host observations. A successful live game load also replaces the saved controller sample. When the `blob.loaded` reply arrives, the runner MUST move every pending non-reply input record—not only gamepad records—into the reply batch in its original order **before** the blob reply, remove those records from the host pending queue, then append the blob reply and the current `host.features`, `host.display`, and complete `host.gamepads` snapshots. This marks events observed while awaiting the reply as belonging to the old timeline. On successful replacement, old raw primary gestures follow [the restore suppression rule](display-input-audio.md#act-4): complete pre-boundary down/up pairs are consumed without activation, held gestures stay suppressed through release, and genuinely fresh post-boundary presses remain eligible. Failed loads do not discard or suppress them. Each pending pointer record MUST retain its normalization geometry until this boundary; before flattening the records into the reply batch, the runner MUST insert a `host.display` record immediately before any pointer whose normalization geometry is not established by preceding pending `host.display` records. The first pending pointer with normalization geometry MUST be preceded by its own `host.display` unless an earlier pending display record establishes the same geometry. The current display snapshot MUST follow the blob reply and all pending records. When the engine is unfocused and pending pointer records remain queued, core MUST defer their associated `host.display` records with them instead of applying those display records during pre-tick handling. Outside the successful replacement exception above, when normal input routing resumes, a pointer release MUST be hit-tested using the geometry established before that release; if a later `host.display` follows the release, core MUST route the release before applying that later geometry. This preserves causal order among keyboard, semantic action, pointer, focus, and gamepad edges while ensuring current host state is authoritative. Core MUST apply capability and display snapshots before resumed script instructions and MUST preserve the input-record ordering through the normal input routing path; snapshots MUST NOT overtake or erase preceding physical transitions except the invalidated old raw gestures above. For a restored open tick that would otherwise resume script instructions before another input phase, core MUST route newly arrived input records through input event handling and gamepad action transitions before continuing that open tick, without repeating tick-start cleanup or phase registrations already performed by the saved tick. The controller snapshot contains every currently connected normalized standard-layout device; an omitted device is disconnected. Records are ordered by device index, and core emits transitions only for actual differences from restored state. Reset preserves the last logged host features, display geometry, and physical gamepad sample; subsequent hardware changes are applied by ordinary input records. Held action state is recomputed after package action registrations have been rebuilt. These changes are logged input, preserving deterministic replay and keeping current hardware authoritative.


### Geometry-derived values

For configured logical size `W × H`, `scaleX = game.width / W` and `scaleY = game.height / H`. `marginWidth(side)` returns `floor(distance / scaleX)` for left/right, using `game.x` and `content.width - game.x - game.width`; `marginWidth`'s vertical counterpart uses `scaleY` and the top/bottom distances. `safeAreaInset(side)` returns `floor(the corresponding CSS-pixel inset / that axis's scale)`. `displayAspect()` is `content.width / content.height`. `viewWidth()` and `viewHeight()` remain the configured logical dimensions. Pointer mapping and presentation use the same presented rectangle but do not mutate `state.display`.

Snapshots persist both sections and their current schema versions. Restore validates every field and rejects unsupported future versions or malformed records; older snapshots that predate either section migrate to the defaults above, using configured logical dimensions when the engine performs restore and 320×240 when a standalone restore supplies no dimensions. `hashGameState` includes both normalized sections. Consequently a resize or capability change can change the state hash only when represented by its consumed host input; a runner's poll cadence, cache invalidation, interpolation, scale/placement calculations or raw event objects cannot.

<a id="host-features"></a>
## The host capabilities contract (`HostFeatures`)

Rather than inspecting OS strings or browser user-agents, the engine negotiates hardware capabilities through an
extensible, typed feature record.

### 1. Specification of `HostFeatures`

The runner passes initial features at engine boot via `createEngine({ ..., features })`:

```typescript
export type HostFeatures = {
  /** Coarse direct pointer input (finger / touchscreen) is available. */
  readonly touch?: boolean;
  /** Pointer precision: 'fine' (mouse, stylus), 'coarse' (touch), or 'none'. */
  readonly pointer?: "fine" | "coarse" | "none";
  /** A physical hardware keyboard is present and usable. */
  readonly keyboard?: boolean;
  /** A standard-layout gamepad or controller is connected and active. */
  readonly gamepad?: boolean;
  /** Device haptic feedback or rumble vibration is supported. */
  readonly haptics?: boolean;
  /** Primary presentation orientation. */
  readonly orientation?: "landscape" | "portrait" | null;
};
```

Normalization, geometry structure, validation, logged-change events, and persistence are specified in [State and input records](#state-and-input-records) above. `hasFeature` and `pointerType` query the normalized current `state.features`; these queries do not inspect the runner or operating system.

### 2. Author API in RPGCode

Authors query capabilities by name without knowing the underlying OS or hardware:

| Function | Signature | Returns | Description |
|---|---|---|---|
| `hasFeature` | `int hasFeature(string name)` | `1` or `0` | Returns `1` when the named normalized capability is active, otherwise `0`; names are case-insensitive. `touch`, `keyboard`, `gamepad`, and `haptics` use their boolean values; `pointer` is active unless its value is `"none"`; `orientation` is active unless its value is `null`. Unknown names return `0`. |
| `pointerType` | `string pointerType()` | `"fine"`, `"coarse"`, or `"none"` | Current normalized pointer precision. |
| `declareCustomTouchControls` | `void declareCustomTouchControls()` | none | Explicitly declares that this game supplies usable custom touch controls. A capability query or ordinary `uiBegin`/`uiEnd` surface does not declare them. Declaration is persistent deterministic game state, included in snapshots and hashes, and remains set until the game state is replaced by loading another game. |

The host reads the current declaration through `Engine.customTouchControlsDeclared()`. The query returns the saved declaration bit and does not inspect host capabilities or infer intent from rendered commands. Hosts suppress fallback controls only when it returns `true`.
```rpgcode
// Adaptive author logic
if (hasFeature("touch") && !hasFeature("gamepad")) {
    #spawn_touch_hud();
}
```

<a id="display-planes"></a>
## The three display planes and geometry (`HostDisplayGeometry`)

Display layout is modeled across three distinct geometric planes to decouple gameplay simulation from physical
screens, safe areas, and letterbox borders.

```
+--------------------------------------------------------------------------+
| Plane 2: Available Physical Content Window (Cw × Ch, e.g. 2532 × 1170)    |
|                                                                          |
|  [Left Pillarbox]        +--------------------+       [Right Pillarbox]  |
|  (Plane 3: Margins)      | Plane 1:           |       (Plane 3: Margins) |
|                          | Logical Viewport   |                          |
|  *Safe area for custom   | (W × H, e.g.       |       *Safe area for     |
|   author touch D-pad*    |  320 × 240)        |        custom action     |
|                          |                    |        buttons*          |
|                          | 4:3 Game Canvas    |                          |
|                          +--------------------+                          |
+--------------------------------------------------------------------------+
```

### 1. Plane Definitions

1. **Plane 1 — The Logical Viewport ($W \times H$):**
   The internal pixel resolution of the game world (e.g. $320 \times 240$, $640 \times 480$, or widescreen
   $480 \times 270$), configured by the `.gam` main file. All gameplay logic, board blits, and sprites operate in this
   space.
2. **Plane 2 — The Physical Content Window ($C_w \times C_h$):**
   The actual dimensions of the application window or display container, along with its display aspect ratio ($C_w / C_h$).
3. **Plane 3 — Presentation Margins and Safe Areas:**
   * **Letterbox / Pillarbox Margins:** Empty space surrounding Plane 1 when the window aspect ratio differs from the
     logical game aspect ratio (under AD-33 integer-scaled letterboxing).
   * **Hardware Safe Area Insets:** Display regions reserved by the operating system for device cutouts, camera notches,
     dynamic islands, or system navigation bars (`env(safe-area-inset-*)`).

### 2. Desktop vs. Mobile Characteristics

* **Desktop:** The safe area insets are always zero (`{ top: 0, bottom: 0, left: 0, right: 0 }`). Margins are zero if the
  window matches the game aspect ratio, or small uniform bars when resized.
* **Mobile (Smartphones & Tablets):** Safe area insets reflect physical notches. On ultra-wide phone displays
  (e.g. 19.5:9 or 20:9), running a classic 4:3 game leaves wide pillarbox margins on the left and right. **These
  margins are usable presentation space for touch controls.**

### 3. Author API in RPGCode

Authors access geometry to align custom UI elements, HUDs, or touch buttons:

| Function | Signature | Returns | Description |
|---|---|---|---|
| `viewWidth` | `int viewWidth()` | integer | Current logical viewport width in pixels, as configured for the game. |
| `viewHeight` | `int viewHeight()` | integer | Current logical viewport height in pixels, as configured for the game. |
| `marginWidth` | `int marginWidth(string side)` | integer | Letterbox margin in logical pixels for `"left"`, `"right"`, `"top"`, or `"bottom"`. Horizontal distances use `scaleX`; vertical distances use `scaleY`; each result is floored. |
| `safeAreaInset` | `int safeAreaInset(string side)` | integer | Hardware safe-area inset in logical pixels for `"left"`, `"right"`, `"top"`, or `"bottom"`, divided by the corresponding axis scale and floored. |
| `displayAspect` | `float displayAspect()` | float | Physical content-window aspect ratio, `content.width / content.height`. |

`marginWidth` and `safeAreaInset` accept side names case-insensitively; any other value raises the catchable `builtin.bad-arg` error. `viewWidth`, `viewHeight`, these geometry queries, and `pointerType` read the current normalized host state, including changes applied earlier in the same tick.

* **Resize Events:** Each accepted `host.display` input that changes the normalized geometry queues a non-cancelable `viewportResized` event on the game emitter. The existing `events` phase delivers it in queue order; delivery is never synchronous with input application. Repeating the same geometry still appears in the consumed input log but does not queue a duplicate notification. Event `detail` contains the current integer logical-pixel values `marginLeft`, `marginRight`, `marginTop`, `marginBottom`, `safeAreaTop`, `safeAreaRight`, `safeAreaBottom`, and `safeAreaLeft`, calculated by the same rules as `marginWidth` and `safeAreaInset`:

  ```rpgcode
  on(game, "viewportResized", (event) => {
      hud.reposition(event.detail.marginRight, event.detail.safeAreaBottom);
  });
  ```

After restoring a game snapshot, the runner MUST compare the live host geometry with the restored engine geometry and enqueue the live normalized `host.display` value before accepting any subsequent pointer record. This reapplication is required even if the runner's observation cache already contains the same live value: the snapshot may restore an older geometry while the observer itself saw no new resize. The resulting ordered input is the shared source for engine display queries, pointer mapping, and presentation rendering.

<a id="touch-controls"></a>
## Touch control presentation: author HUD vs. runner fallback

To balance modern authorial freedom against legacy backward compatibility, the engine establishes a **two-tier touch
presentation policy**:

### Tier 1: Author-Owned Touch HUD (Preferred)

The game explicitly calls `declareCustomTouchControls()` when it supplies usable custom touch controls. `hasFeature("touch")` alone does not suppress fallback controls, and publishing an ordinary accessibility surface does not imply a usable touch HUD.
* **The runner renders zero chrome** after the declaration is committed. No virtual sticks, D-pads, or buttons are injected by the host.
* **Margin positioning:** Authors may place custom controls directly inside usable Plane 3.
* **Action integration:** Author-drawn touch controls use the `uiBegin`, `uiItem`, `uiEnd` surface API. A declared item's explicit semantic action (`confirm`, `cancel`, or registered `game.*`) dispatches on primary-pointer release over the same enabled item.

### Tier 2: Runner Fallback Virtual Gamepad (Legacy Compatibility)

When touch is available and the game has not explicitly declared usable custom touch controls, including for
unpatched Toolkit 3.1 games:
* **Automatic Minimal Gamepad:** The runner renders a clean, non-intrusive virtual D-pad on the left and primary Action
  buttons on the right.
* **Placement:** When the safe pillarbox margins have sufficient room, the runner docks controls there. Otherwise it
  places translucent controls over the gameplay viewport rather than shrinking it or leaving the player without controls
  (owner ruling).
* **Contextual Tap-to-Walk:** Direct pointer taps on walkable ground dispatch movement toward that coordinate, while
  tapping adjacent interactable tiles dispatches the `confirm` action.

Fallback contextual taps are resolved on **primary-pointer release**, not press. The core first resolves the tapped
board point against interactables using the same eligibility, reach/collision checks, and deterministic precedence as
the ordinary `confirm` path ([movement-and-collision.md#activation-programs-and-items](movement-and-collision.md#activation-programs-and-items),
including the item-before-region and item/region tie-breaks). If that resolution yields an interactable that the normal
`confirm` path can activate from the player's current position, the core updates the player's facing to the cardinal
board-axis direction from the player toward that interactable, then applies exactly one semantic `confirm` press through
the normal trigger path; it does not move the player. Facing uses the greater absolute pixel displacement; an exact tie
selects the horizontal board axis. If no eligible reachable interactable is hit, the pointer tap is handled as the
ordinary click-to-walk destination. The tap never bypasses activation conditions, trigger order, script blocking, or
collision/reach rules.
