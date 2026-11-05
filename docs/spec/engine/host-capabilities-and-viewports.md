# Host Capabilities, Display Planes and Touch Control Surface

The normative specification for **host capability negotiation**, **display viewport geometry**, and **touch input
presentation** in Toolkit Reawakened.

It builds directly upon [ADR 0017](../../adr/0017-input-actions-devices-and-accessibility.md) (semantic actions, devices,
and accessibility) and [runners.md](runners.md#boundary) (the runner boundary and presentation scaling).

**Status.** Normative. This page defines the plain-data contract between host runners and `core`, as well as the
author-facing APIs for responsive layouts, safe areas, and touch ergonomics.

**Guard-rail invariants:**
- **G1 & G3:** All feature flags and geometry records are plain JSON data. They are recorded in `state.display` and
  `state.features` and included in the state hash. The input log records the initial host data and subsequent changes;
  the same game, seed and input log reproduce the same state and hash.
- **G2:** `core` never queries the DOM, `navigator.userAgent`, or OS platform APIs. The runner computes capabilities and
  geometry and passes them into core at boot or via AD-14 inputs. **The core never learns a runner's name.**
- **G4:** Renderers replay draw lists and do not invent game state. On-screen controls drawn by the author are ordinary
  draw commands; runner fallback controls are host presentation, outside the logical viewport when space permits.

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
  readonly orientation?: "landscape" | "portrait";
};
```

* **Mid-Session Hardware Changes:** If a device is plugged in or unplugged during gameplay (e.g. connecting a Bluetooth
  gamepad or pairing an external keyboard), the runner emits an AD-14 input event:
  `{ tick, event: { kind: "device", type: "gamepad_connected" } }`. Core updates `state.features` deterministically on
  that tick.

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
