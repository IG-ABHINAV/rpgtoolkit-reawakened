# Accessibility

<a id="a11y-1"></a>
**A11Y-1 Scope and level.** In plain terms: everything the engine draws and controls itself can be used by somebody who cannot see it well, cannot use a mouse, or cannot use a keyboard — and the engine tells a screen reader what is on screen so a game is not a silent picture.

Technically, the commitment is **WCAG 2.2 level AA** for **engine-owned chrome and controls** only:

| In scope (the engine is accountable) | Out of scope (the game author is accountable) |
|---|---|
| The message window, `MsgBox`, the message box for errors | Board art, tilesets, sprite art, their contrast and motion |
| The stock menu, equip, item, abilities, shop, inn, save and load dialogs | A game's own script-drawn screens and their content |
| The options and controls screens, including focus and remapping | Scripted text: its wording, reading level, punctuation |
| The cursor-map hand, the focus ring, engine cursor images | Custom cursor graphics, custom menu graphics (`MenuGraphic`) |
| Engine effects: fades, wipes, shakes, flashes | A script's own effects on its own canvases |

The split is deliberate. For **its own chrome** the engine holds itself to AA and is tested against it. For **a game's own content** the engine does its best — it projects what a script draws into the tree without being asked ([A11Y-14](#a11y-14)), offers the author the tools below ([A11Y-12](#a11y-12)), and reports what it cannot describe — but it cannot make every author follow best practice, and it never rewrites a game's own decisions. A game MAY declare its intentions in an `a11yProfile`; the registry records the claim and the engine reports, but never enforces it. A published guide for authors is tracked in [#1111](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1111).

<a id="a11y-2"></a>
**A11Y-2 Keyboard operability (SC 2.1.1).** Every function performed by the engine's own chrome is operable by keyboard alone: opening and closing the menu, moving the cursor, choosing, cancelling, paging a list, scrolling a dialog, save and load, and remapping. No function of the chrome requires a pointer. A script's own screen is out of scope but is reached, left and paused by keyboard alone.

The test is behavioural: a headless play-through completes a menu-only and dialog-only session using keyboard actions only, and produces the same selection state as the pointer run.

<a id="a11y-3"></a>
**Contrast of engine chrome (SC 1.4.3, 1.4.11).** Engine-drawn text meets **4.5:1** against its background, and engine-drawn interactive boundaries and indicators — the focus ring, the cursor-map hand's selected point, button borders, the menu frame, the selection bar — meet **3:1**. The stock theme is authored to meet both with its default palette, and a surface MAY sample a background so long as the result is checked at draw time against the actual pixels behind the text.

The engine computes the ratio with the deterministic maths of [ADR 0002](../../adr/0002-core-pixels-and-deterministic-maths.md) (no `Intl`, no locale) and reports any stock surface that fails as a located `a11y.contrast` diagnostic in the harness. An authored theme that fails is reported, never silently corrected.

<a id="a11y-4"></a>
**Character key shortcuts (SC 2.1.4).** A single-character shortcut — any binding whose control is one character-producing key, which is exactly what the legacy activation, menu and run-time keys are — MUST be remappable, or disableable, or limited to when a chrome control has focus. A **locked** action ([ACT-6](display-input-audio.md#act-6)) whose only bindings are single-character keys is an accessibility violation: the engine reports `a11y.character-shortcut` at load and lists the action as fixed in options. It does not unlock it behind the game's back, because a locked action is a compatibility promise.

<a id="a11y-5"></a>
**Focus visible and unobscured (SC 2.4.7, 2.4.11).** Every surface draws a focus indicator for the current cursor position: at least **2 logical pixels** on every side, at least **3:1** against both the surface and the item, and never removed while the surface can accept input. The indicator is part of the draw list, so a renderer cannot forget it. The focus indicator MUST NOT be covered by the message window or a fade: a surface whose cursor would fall behind the message window moves the window, shrinks the list or scrolls the cursor into view rather than obscuring it.

<a id="a11y-6"></a>
**Pointer cancellation (SC 2.5.2).** A pointer press MUST NOT perform its action. The action happens on **release over the same target**, and moving off the target before release cancels it. This applies to menu items, cursor-map entries, on-screen buttons, the shop and the options screen. Dragging is never the only way to perform an action ([2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)): every drag in engine chrome has a click-click alternative.

<a id="a11y-7"></a>
**Target size (SC 2.5.8).** An interactive target in engine chrome is at least **24 by 24 logical pixels** at 1× scale, or meets the spacing exception. Legacy surfaces are drawn on a 16-pixel grid, so the engine provides:

1. **nearest-target resolution** — a pointer position inside the spacing envelope selects the nearest target, deterministically by distance then by list order; the stock menu's rows are themselves 24 logical pixels high and tile their list, so each is a full 24 × 24 target;
2. a **large-cursor option** that scales the stock theme to 1.5× and 2× with nearest-neighbour sampling, so text and targets scale without blurring;
3. a documented exception list for targets embedded in a legacy game's own art.

<a id="a11y-8"></a>
**Timing (SC 2.2.1).** The engine imposes no time limit on any decision: no menu, dialog, cursor map or battle screen expires, and no surface auto-advances. The 75 ms, 90 ms and 100 ms pauses in [display-input-audio.md](display-input-audio.md#input) and [plugins-and-battle.md](plugins-and-battle.md#e-80) are internal debounce between accepted inputs and are not time limits on the player. Where a script or package imposes its own timer through an engine surface, the engine exposes an extend/disable preference; the engine never extends a script's own logic silently.

<a id="a11y-9"></a>
**Motion, flashes and sound (SC 2.2.2, 2.3.1).** The `ui` section carries a **reduce-motion** preference, off by default, which the options screen toggles. When it is on, engine effects — wipes, fades, shakes, the screen-transition animation and the cursor-move animation — are shortened to a single frame, and motion that carries no information is removed. A scripted effect that the engine drives (`Wipe`, `Fade`, screen shakes) is shortened the same way; one that a script draws itself is that script's own art. Engine effects MUST NOT flash more than three times in any one second, at any intensity, in either preference state.

<a id="a11y-10"></a>
**No trap, no surprise (SC 2.1.2, 3.2.1, 3.2.2).** `cancel` always leaves the current surface, including a nested one, and no surface consumes it to stay open. Moving the cursor never activates anything, and choosing never changes context without the action the player took — a Quit confirmation is a separate screen, not a side effect of Enter on a list row.

<a id="a11y-11"></a>
**The accessibility tree (SC 4.1.2, 4.1.3).** `core` emits, alongside the draw list and never inside it, a plain-data accessibility tree for the surfaces currently drawn:

```
A11yNode = {
  id:      string,                    // stable for the surface's life, not per frame
  role:    "surface" | "menu" | "menuitem" | "dialog" | "message" | "button"
         | "list" | "listitem" | "text" | "label" | "status" | "image" | "heading",
  label:   string,                    // MUST be non-empty; the visible text, not a key name
  value:   string | null,             // e.g. "3 of 12", the gold amount; null means none
  state:   { disabled: boolean, selected: boolean, checked: boolean | null },
  focused: boolean,                   // exactly one leaf per surface is focused
  bounds:  { x, y, w, h },            // logical pixels, integer
  children: readonly A11yNode[]
}
```

Rules: the tree is rebuilt each frame from the same state the draw list uses, so they cannot disagree; it contains no DOM, function or host object (G2) and no locale-formatted string (G3); a transient message that the player must hear is also queued as an announcement `{ politeness: "polite" | "assertive", text }`, assertive for errors and polite for dialogue; roles and labels are the game's own language strings, never a legacy key name such as `LEFT`.

Runners bridge it: the browser and mobile hosts maintain a hidden ARIA mirror, the desktop host forwards to the platform accessibility API, and the headless harness dumps it as text. A node with an empty label, two focused leaves in one surface, or a `listitem` outside a `list` FAILS the harness suite; a stock surface without any tree node fails as well. The tree is opt-in per host request so that no existing draw-list golden moves.

<a id="a11y-12"></a>
**What the engine gives authors (support, not certification).** The engine exposes: the action table and remapping ([ACT-6](display-input-audio.md#act-6)), the reduce-motion preference, the large-cursor option, the automatic projection of [A11Y-14](#a11y-14) for script-drawn surfaces, and these ordinary RPGCode commands, none of which is one of the 282 catalogue names:

The commands are `a11yLabel`, `a11yRole`, `a11yAnnounce`, `a11yPref` and `contrastRatio`, specified with their signatures in the [Reawakened additions](rpgcode-functions.md#reawakened-additions) table. They change no drawing and never wait.
An author who needs narration beyond label and value supplies it through the message window, which is announced. The guide that puts these together for authors is [#1111](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1111).

<a id="a11y-13"></a>
**A11Y-13 Many actions and dense surfaces (SC 1.4.1, 2.4.3, 2.4.6).** A spell-and-skill game can register hundreds of actions ([ACT-2](display-input-audio.md#act-2)) and draw them as a bar, a grid or a paged list ([ACT-8](display-input-audio.md#act-8)). Four rules keep that usable:

1. **Grouping is a heading, not a colour.** The options screen and any grouped surface present a `group` as a `heading` node, whose `label` is the group name and which precedes the group's items, in the accessibility tree (an unlabelled heading is reported as `a11y.unlabelled`), and the reading order equals the visual order.
2. **Paging never loses the player.** A paged options list keeps the cursor on a real row after a page turn, announces the new page (`value: "2 of 5"` on the list node), and `cancel` leaves in one step. The stock item list's `left`/`right` paging rule is the only paging gesture.
3. **State is never colour alone.** Enabled, disabled, on cooldown, selected and "unusable here" are each conveyed by a distinct icon, glyph or text as well as a tint, and the accessibility tree carries the same state (`state.disabled`, `value` for a cooldown). A player who cannot distinguish the tints loses no information.
4. **Cooldowns are announced at the edges, not continuously.** A cooldown produces one polite announcement when it starts and one when the action becomes ready; it never updates per frame, so a screen reader is not flooded while a timer runs.

A surface with more slots than fit on the frame scrolls or pages; it MUST NOT shrink its slots below the target-size rule ([A11Y-7](#a11y-7)) to fit them. The stock menu pages by viewport capacity, `P = max(1, floor((h − 90) / 24))` rows ([plugins-and-battle.md](plugins-and-battle.md#e-80-stock-menu) item 5), and draws a list that fits whole.

<a id="a11y-14"></a>
**A11Y-14 Script-drawn content is described by default (OWNER; ruled 2026-11-01).** In plain terms: a game made with ordinary RPGCode commands is already described to a screen reader, because the engine describes what the script drew — the message window reads its own text out, and `text()` lines become readable text without the author doing anything.

`core` projects the primitives a script already calls into the accessibility tree of [A11Y-11](#a11y-11), from the same call that produces the drawing, in the same frame:

| The script calls | The tree gets |
|---|---|
| `mwin(str)`, `msgbox(...)`, `prompt(question)` | a `message` node (a `dialog` for `msgbox`/`prompt`) whose label is the visible text **after `<var>` splicing**, plus one announcement — `polite` for `mwin`, `assertive` for an error |
| `text(x, y, str)` | a `text` node with `str` and the cell rectangle it occupies; consecutive `text` calls on the same row coalesce into one node |
| `cursorMapRun(map, ...)` | a `list` node with one `listitem` per point, `focused` on the selected index, `value: "<index+1> of <count>"`, and a polite announcement when the selection changes |
| `setButton(file, slot, x, y, w, h)` | a `button` node whose label is the script's `a11yLabel` for that slot, or the slot's registered name; an unlabelled slot is reported, not guessed |
| `createCanvas` + `renderNow` | one `surface` node over the canvas, labelled by the script's `a11yLabel`, or reported as unlabelled |
| any image draw | an `image` node labelled by `a11yLabel`, or reported as unlabelled |

Rules: **projection is on by default and costs a script nothing** — a script using only `mwin`, `text`, `prompt` and cursor maps needs no accessibility code at all. A script MAY override the label or role, hide a decorative node, or add nodes for a screen it drew pixel by pixel ([A11Y-12](#a11y-12)). A node that the engine cannot label is reported in the harness as `a11y.unlabelled` and **never** fails gameplay: an author who ignores the guidance still ships, they just ship an undescribed screen. Projection adds no drawing commands, changes no pixels, hashes or goldens, and is produced only when the host asks for a tree.

<a id="a11y-15"></a>
**A11Y-15 The custom-UI insertion point (OWNER; ruled 2026-11-01).** In plain terms: a game that builds its own screen — a title menu, a spellbook, a character sheet — hands the engine a list of what is on it, and gets the same keyboard, controller and mouse navigation, the same focus ring and the same screen-reader description the stock menu gets. The author writes the screen; the engine provides the behaviour.

A script declares a surface for the frame and fills it:

```
uiBegin("title", "menu", 40, 60, 560, 320)   // id, role, bounds in logical pixels
  uiItem("New Game", { id: "new" })
  uiItem("Continue", { id: "load", enabled: 0 })
  uiItem("Options",  { id: "opts" })
uiEnd()                                       // publishes the tree, drives the cursor
```

Rules:

1. **One model, no second-class path.** A declared surface gets exactly what `stock_menu` gets: the engine cursor ([A11Y-5](#a11y-5)) driven by `up`/`down`/`left`/`right`, activation by `confirm`, `cancel` to leave, pointer hover to move the cursor and pointer **release** to activate ([A11Y-6](#a11y-6)), one accessibility-tree subtree ([A11Y-11](#a11y-11)), and the target-size and contrast rules. The author never re-implements navigation, hit-testing or announcement.
2. **The engine owns the cursor, the script may move it.** `uiSelection()` reads the focused item index; `uiFocus(i)` sets it. The pointer and the actions write the same value, so a mouse hover and an arrow key cannot disagree.
3. **Activation is claimed, not polled per frame.** `uiActivated()` returns the 0-based index of the item that was confirmed, on the one frame it happened, and `-1` on every other frame (so item 0 is distinguishable from "not activated"; a script tests `uiActivated() >= 0`); `uiCancelled()` returns 1 on the one frame the event happened and 0 otherwise. Both claim the event through the shared input-sequence protocol, so a script loop cannot act twice on one press and cannot miss a press between frames.
4. **Nodes come from items.** Each `uiItem` becomes one tree node: `label` is required, `id` is stable while the surface is open, `value`, `enabled` and `bounds` are optional and default to sane values (bounds laid out by the engine, enabled). The list order is the tree order and the navigation order — one order, not two.
5. **Projection yields inside a declared surface.** Primitives drawn inside an open surface's bounds are **not** projected into the tree; the declared items are the description. An author who deliberately draws extra readable text inside the surface adds an item with role `"text"`. This is what stops a stock-shaped screen being described twice.
6. **A malformed surface never breaks the game.** A duplicate `id` in one surface, no item at all, a negative size, more than 256 items, or an item whose label is empty is a located `a11y.surface` refusal: the surface is dropped for that frame, the script keeps running, and the harness reports it. Nothing about declaring a surface may raise into gameplay.
7. **An undeclared frame is not an error.** A script that draws with primitives and never declares a surface is described by [A11Y-14](#a11y-14). Declaring a surface is the upgrade path for a screen whose structure the primitives cannot express; it is never a requirement.

The commands are `uiBegin`, `uiItem`, `uiEnd`, `uiSelection`, `uiFocus`, `uiActivated` and `uiCancelled`, specified with their signatures in the [Reawakened additions](rpgcode-functions.md#reawakened-additions) table. They draw nothing themselves: the script keeps its own art and the engine adds the focus ring and the tree.

Example: with items `"Fire"` (index 0) and `"Ice"` (index 1), confirming the first item makes `uiActivated()` return `0` on that frame and `-1` on every other, so `if (uiActivated() >= 0)` fires for `"Fire"` and never fires on an idle frame.

<a id="a11y-16"></a>
**A11Y-16 Ported games: what a 3.1 game gets without being touched (OWNER; ruled 2026-11-01).** In plain terms: a game written for Toolkit 3.1 runs with no edit, and the engine still gives it real accessibility. Where it cannot, it says so — so somebody porting a game knows exactly what needs changing instead of guessing.

Notice first what needs **no** change: the game file may carry no input block ([ACT-6](display-input-audio.md#act-6) rule 1), the scripts may call `wait()`, `get()` and `clearBuffer()` exactly as before ([E-110](display-input-audio.md#e-110)), a controller works by default ([ACT-5](display-input-audio.md#act-5)), and a player's remap **adds** a control without taking away a key a script reads ([ACT-6](display-input-audio.md#act-6) rule 3). Those four rules are the backwards-compatibility guarantee.

What the game's own screens get is tiered, and the tier is reported rather than assumed:

| Tier | How the screen is drawn | Provided with no game change | Not provided |
|---|---|---|---|
| **A — engine-owned** | stock menu, battle, options, save/load, message box, error boxes | everything in [A11Y-1](#a11y-1)…[A11Y-15](#a11y-15) | — |
| **B — documented primitives** | `mwin`, `msgbox`, `prompt`, `text`, cursor maps, `setButton`, canvases | automatic projection ([A11Y-14](#a11y-14)), announcements, pointer activation where the primitive already has it, the cursor model for cursor maps | structure the primitives do not express: no list semantics for a hand-laid-out grid, no per-item disabled state, no labels for art drawn without text |
| **C — pixels only** | image blits, `scan`/`mem` screens, custom canvases with no text primitive | the keyboard and controller still drive the script; one `surface` node exists | any label, any list, any focus order — reported as `a11y.unlabelled` |
| **D — script key polling** | a loop reading `get()` or checking held keys, choosing its own behaviour | the additive remap keeps the game's keys working; the loop keeps running | a cursor the engine can describe or move; the screen is content the engine cannot see into — reported as `a11y.unstructured` |

**The upgrade path is additive and small.** A tier-C or tier-D screen becomes tier-B by drawing its text with `text()`, or tier-A-quality by declaring a surface ([A11Y-15](#a11y-15)); no game logic changes. Nothing in the engine rewrites, guesses at or "improves" a game's own screen.

<a id="a11y-17"></a>
**A11Y-17 The accessibility report for a port (OWNER; ruled 2026-11-01).** Every engine surface and every script-drawn surface reachable in a run contributes a row to a report the harness can emit: its id and tier, the labels it produced, the nodes it left unlabelled, whether a cursor model applies, and the script location that drew it. The report is how a porter answers "can this game be made accessible, and what would it cost" without reading the game.

Rules: the report is produced by the harness from a run, never statically guessed at, and any inference (a screen never reached, a branch never taken) is marked inferred, not asserted; it never changes gameplay, goldens or hashes; and it is available from the headless runner and from the editor's preview, so a porter sees it without writing a test.
