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
| Movement keys (main file, scan codes for 8 directions; default arrow keys) | queue a step in that direction when the player is idle; while the key remains held, queue another step each time the player becomes idle again, at the normal movement cadence; two keys 90° apart give a diagonal if allowed |
| Activation key (main file `key`, the demo uses space) | test programs and items in front of / under the player |
| Menu key (main file `menuKey`, Enter in new projects) | open the menu plugin |
| Run-time keys (main file) | run their programs |
| Mouse (if enabled in `movementControls`) | holding the left button path-finds the player towards the pointer |
| Any key while a script waits | delivered to `Wait()` / `Get()` through a key queue |

Input is read only while the player is idle; during blocking scripts keys go to the script's key queue. Losing window focus pauses the game; regaining it resumes.

<a id="reawakened-held-direction-movement"></a>
**Reawakened rule (OWNER; held direction movement).** In plain terms: if you keep a direction key held, the player keeps walking in that direction, one step at a time, at the same speed as if you had tapped the key repeatedly. Technically, and deterministically:

1. The input phase reads the current held direction state (`state.input.actions`) as well as any new press edges.
2. When the selected player is idle (`canAcceptDirection`) and a direction is held, one direction move is enqueued in that tick.
3. The move uses the same step size and speed rules as a tapped key; the next step is enqueued on the first tick the player becomes idle again while the key stays held.
4. Focus lost pauses tick consumption, so no new steps are enqueued while the window is unfocused; held state is updated normally when focus returns and the runner delivers key-up events.

Evidence: this page's Input table ("queue a step ... when the player is idle"); E-24 and E-110; the deterministic fixed-tick rule in [main-loop-and-startup.md](main-loop-and-startup.md#reawakened-phases) (R-56). **Rejected alternative:** relying on the host OS key-repeat events, which makes movement cadence depend on the host's repeat delay and rate and differs between runners (violating G3).

<a id="e-49"></a>
**E-49 Global keys.** The menu key opens the menu ([plugins-and-battle.md](plugins-and-battle.md#menu-plugin)); the run-time keys (up to 51 of them) run the programs they name, with a short debounce after the menu closes.

<a id="e-110"></a>
**E-110 Keyboard.** Named keys are returned to scripts (`Wait()` returns e.g. `"ENTER"`, `"LEFT"`, `"A"`); movement uses the configured scan codes; the menu, activation and run-time keys are character-coded. The buffered key queue can be cleared.

**Reawakened rule (entry 7.11 corrects a gap).** `Get()` and `ClearBuffer()` claim keys while a thread runs. A claimed key is removed from the queue at the start of the next tick's waits phase, before that phase rebuilds the claim list for waiting threads, so a key `Get()` returned is never returned again and `ClearBuffer()` empties what was buffered.

<a id="e-111"></a>
**E-111 Mouse.** Click (blocking or polling) and move coordinates for scripts, click-to-move, cursor maps and on-screen buttons.

<a id="e-112"></a>
**E-112 Joystick/gamepad.** An optional joystick, mapped to movement and confirm/cancel. The legacy engine records no other joystick behaviour, so the contract below is a **Reawakened addition**; the E-112 anchor is kept so citations to the id still resolve.

<a id="reawakened-gamepad-contract"></a>
<!-- OWNER: E-112 -->
**Reawakened rule (OWNER; E-112 gamepad contract; ruled 2026-10-18).** In plain terms: a game controller can walk the player and press confirm or cancel exactly like the keyboard does, and a controller that is unplugged is ignored. Technically, and deterministically:

1. *Normalized event.* The host reports `{ kind: "gamepad", device, connected, axes: { x, y }, buttons }` as plain data. `device` is an integer 0..3 (other values are ignored); `axes.x` and `axes.y` are integers in −1000..1000 (right and down positive); `buttons` is an integer bitmask: bit 0 up, 1 down, 2 left, 3 right, 4 confirm, 5 cancel, 6 menu. No host or browser controller API, object or float enters `core`; the host does the normalizing.
2. *Dead-zone.* An axis value with absolute value below 250 counts as 0 (strict less-than; 250 itself is active). The pressed directions are the d-pad bits OR the active axes (x < 0 left, x > 0 right, y < 0 up, y > 0 down).
3. *Project bindings.* The main file's bindings map each direction, confirm (the activation key), cancel and menu to the same logical actions as the keyboard (E-24, E-110); a gamepad input adds nothing the bindings do not name. Diagonals follow the keyboard rule (two directions 90° apart, only where diagonals are allowed).
4. *Same held/edge state.* A gamepad action updates the same held-key set and key queue as a keyboard key: a press edge on a tick appends one key-queue entry with the next monotonic input sequence number and sets the key held; a release edge clears it; a held action produces no repeat entries. Edges are computed per device from the previous event for that device; simultaneous edges are processed in ascending device then ascending bit order.
5. *Disconnect.* An event with `connected: false` releases everything that device held and is otherwise ignored; events for a device that has never reported `connected: true` are ignored. Connected devices are merged: an action is held while any connected device holds it.
6. *Buttons and cursor map.* On-screen button slots are a separate concern (entry 5.6 defines the slot data `{ id, x, y, w, h, action, enabled }`); the gamepad never moves the pointer.

Evidence: the legacy inventory's single line (joystick mapped to movement and confirm/cancel); `docs/spec/formats/main-file.md` `useJoystick`; the `GamepadInput` port in `packages/core/src/ports/input.ts` and AD-14 (event name fixed, payload deferred to this epic); the shared key-claim protocol (Epic 4, entries 4.1 and 4.19). **Rejected alternative:** exposing the browser or native controller API (or float analogue values and per-device bindings) to `core`, which would break G2/G3 and make replays host-dependent. Dead-zone value 250, the device range and the bit layout are an unverified default recorded under the owner's approval of the rule as written. Deferred: haptics, analogue speed, remapping UI and multiplayer assignment. Consumers: entries 5.2 (`input-replay-button-slots`), 5.6.

<a id="e-113"></a>
**E-113 Focus handling.** The game pauses when the window loses focus.

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
