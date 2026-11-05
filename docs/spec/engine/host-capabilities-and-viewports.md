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
+
+The terms “device state” and “geometry” in [runners.md#runner-may-decide](runners.md#runner-may-decide) distinguish raw host observation from deterministic input: a runner MUST NOT feed raw observations directly into simulation. A runner MAY report a change only as the explicit logged event defined below. Geometry's screen-to-canvas transform remains presentation-only and hash-neutral; the normalized geometry record consumed by RPGCode is hash-significant.
+
+### State and input records
+
+`HostFeatures` is a partial boot/event input:
+
+```typescript
+type HostFeatures = {
+  touch?: boolean;
+  pointer?: "fine" | "coarse" | "none";
+  keyboard?: boolean;
+  gamepad?: boolean;
+  haptics?: boolean;
+  orientation?: "landscape" | "portrait" | null;
+};
+```
+
+Core normalizes this to `state.features` with all six own-properties present: absent booleans become `false`, absent `pointer` becomes `"none"`, and absent `orientation` becomes `null`. Unknown input properties are discarded; persisted state contains no `undefined`. Unknown names queried by `hasFeature` return `0`.
+
+`HostDisplayGeometry` is:
+
+```typescript
+type HostDisplayGeometry = {
+  content: { width: number; height: number };
+  game: { x: number; y: number; width: number; height: number };
+  safeArea: { top: number; right: number; bottom: number; left: number };
+};
+```
+
+All ten numbers MUST be finite and non-negative. `content.width`, `content.height`, `game.width`, and `game.height` MUST be positive; `game.x + game.width` MUST NOT exceed `content.width`, and `game.y + game.height` MUST NOT exceed `content.height`. Insets may be zero and are not constrained to the content bounds. A missing boot record defaults to a content and game rectangle of `{x:0,y:0,width:logicalWidth,height:logicalHeight}` and zero insets. Invalid boot records and invalid `host.display` input events are rejected at the boundary and do not partially update state.
+
+The state section is `state.display = { geometry: HostDisplayGeometry }`. `state.features` is the normalized record above. Initial records come from `createEngine({ ..., features, displayGeometry })`. Later updates use complete values, not partial patches:
+
+```typescript
+{ kind: "host.features", features: HostFeatures }
+{ kind: "host.display", geometry: HostDisplayGeometry }
+```
+
+Both event kinds are stamped with the tick at which they take effect, validated as exact AD-14 records, and included in `TickReport.consumed`. Repeated events are retained in order; applying the same complete value twice leaves the same final state. No unspecified property is inferred from OS, browser, or display APIs by core.
+
+### Geometry-derived values
+
+For configured logical size `W × H`, `scaleX = game.width / W` and `scaleY = game.height / H`. `marginWidth(side)` returns `floor(distance / scaleX)` for left/right, using `game.x` and `content.width - game.x - game.width`; `marginWidth`'s vertical counterpart uses `scaleY` and the top/bottom distances. `safeAreaInset(side)` returns `floor(the corresponding CSS-pixel inset / that axis's scale)`. `displayAspect()` is `content.width / content.height`. `viewWidth()` and `viewHeight()` remain the configured logical dimensions. Pointer mapping and presentation use the same presented rectangle but do not mutate `state.display`.
+
+Snapshots persist both sections and their current schema versions. Restore validates every field and rejects unsupported future versions or malformed records; older snapshots that predate either section migrate to the defaults above. `hashGameState` includes both normalized sections. Consequently a resize or capability change can change the state hash only when represented by its consumed host input; a runner's poll cadence, cache invalidation, interpolation, scale/placement calculations or raw event objects cannot.

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
| `hasFeature` | `int hasFeature(string name)` | `1` or `0` | Returns `1` if the named capability is active on the host, otherwise `0`. Unknown feature names safely return `0`. |
| `pointerType` | `string pointerType()` | `"fine" \| "coarse" \| "none"` | Returns current active pointer precision. |

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
| `viewWidth` | `int viewWidth()` | integer | Current logical viewport width in pixels. |
| `viewHeight` | `int viewHeight()` | integer | Current logical viewport height in pixels. |
| `marginWidth` | `int marginWidth(string side)` | integer | Letterbox margin in logical pixels on `"left"`, `"right"`, `"top"`, or `"bottom"`. |
| `safeAreaInset` | `int safeAreaInset(string side)` | integer | Hardware safe area inset in logical pixels on `"left"`, `"right"`, `"top"`, or `"bottom"`. |
| `displayAspect` | `float displayAspect()` | float | Aspect ratio of the physical window ($C_w / C_h$). |

* **Resize Events:** When a window resizes or a phone rotates, the runner emits `viewport.resized`, notifying active
  event listeners with updated geometry:
  ```rpgcode
  on("viewportResized", def(event) {
      hud.reposition(event.marginRight, event.safeAreaBottom);
  });
  ```

<a id="touch-controls"></a>
## Touch control presentation: author HUD vs. runner fallback

To balance modern authorial freedom against legacy backward compatibility, the engine establishes a **two-tier touch
presentation policy**:

### Tier 1: Author-Owned Touch HUD (Preferred)

**Owner ruling:** A game must explicitly declare or register its own touch controls to suppress the runner's fallback.
Checking `hasFeature("touch")` alone does not suppress it: a query does not prove that usable controls exist.
For example, a package may declare `touchControls: "custom"`:
* **The runner renders zero chrome.** No virtual sticks, D-pads, or buttons are injected by the host.
* **Margin Positioning:** Authors may place custom touch controls directly inside the Plane 3 lateral margins. This
  prevents fingers from obscuring the game canvas or text boxes on mobile devices.
* **Action Integration:** Author-drawn touch controls utilize the ADR 0017 Surface API (`uiBegin`, `uiItem`, `uiEnd`).
  Tapping a custom button triggers the semantic action (`confirm`, `cancel`, or `game.*`) with hit-testing on pointer
  release.

### Tier 2: Runner Fallback Virtual Gamepad (Legacy Compatibility)

When touch is available and the game has not explicitly declared or registered custom touch controls, including for
unpatched Toolkit 3.1 games:
* **Automatic Minimal Gamepad:** The runner renders a clean, non-intrusive virtual D-pad on the left and primary Action
  buttons on the right.
* **Placement:** When the safe pillarbox margins have sufficient room, the runner docks controls there. Otherwise it
  places translucent controls over the gameplay viewport rather than shrinking it or leaving the player without controls
  (owner ruling).
* **Contextual Tap-to-Walk:** Direct pointer taps on walkable ground dispatch movement toward that coordinate, while
  tapping adjacent interactable tiles dispatches the `confirm` action.
