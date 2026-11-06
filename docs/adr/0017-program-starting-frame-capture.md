# ADR 0017 — Program starting-frame capture seam

* **Status:** Proposed (awaiting owner rulings)
* **Date:** 2026-11-02
* **Amends:** [docs/spec/engine/main-loop-and-startup.md](../spec/engine/main-loop-and-startup.md) (adds the Reawakened rule for starting-frame capture); reuses the surface-hash projection ruling in [docs/spec/formats/save-game.md](../spec/formats/save-game.md#state-hash-surface-projection) (2026-11-02)
* **Context documents:** [docs/spec/engine/runners.md](../spec/engine/runners.md#surface-read-and-state-hash), [docs/spec/formats/save-game.md](../spec/formats/save-game.md#state-hash-request-projection), AD-5 (host requests), AD-14 (input events), AD-17 (blob storage), AD-27 (`engine.surfacePixels`)
* **Tracks:** issue #1067

## Summary

In plain terms:

1. **When an outermost program starts, the core asks the runner for the frame currently on screen.** The request carries the logical viewport width and height. The runner replies with RGBA bytes, or with `null` if it cannot or does not capture the display.
2. **Core never reads the display directly (G2).** The captured bytes become a core-owned script surface that the starting program can read or draw over, just like any other `cnvX` surface.
3. **The captured frame is a presentation cache, not game progress.** It is excluded from `hashGameState` and is rebuilt deterministically on restore, exactly like the presented screen surface in the existing 2026-11-02 ruling.
4. **Interactive runners supply the last presented frame; headless and golden runners reply `null`.** A `null` reply gives the program a transparent-black starting surface, preserving the existing approximation while making the seam explicit.
5. **The request is blocking and correlated.** Time freezes until the reply arrives. The request id is part of the outstanding-request projection, so *whether a capture is in flight* changes the state hash, but the pixel bytes themselves do not.
6. **Replay uses whatever the replaying runner supplies.** The same input log replayed under a headless runner may see `null` where the original interactive run saw a frame; the replay is still deterministic because the reply is part of the request/reply stream that the input log records.

## Context

The original engine's outermost program starts by copying whatever is currently displayed on screen. In the Reawakened core this is approximated today by starting every outermost program with a black surface. The seam was deferred because it needs a correlated blocking host request that carries viewport dimensions and RGBA bytes, and because the rulings below on determinism, replay and save timing had not been recorded.

This ADR records those rulings. It does not implement the seam; implementation is tracked by issue #1067 and the lifecycle work on branch `fix/1045-script-lifecycle`.

## Decision

### 1. Request/reply shape

A new blocking request kind is added to the AD-5 request union:

```ts
export type CaptureFrameRequest = {
  readonly kind: "captureFrame";
  readonly reqId: number;
  readonly w: number;
  readonly h: number;
};
```

And a matching reply is added to the AD-14 input-event union:

```ts
export type FrameCaptured = {
  readonly kind: "frame.captured";
  readonly reqId: number;
  readonly rgba: Bytes | null;
};
```

* `w` and `h` are the logical viewport dimensions the engine was initialised with (the same dimensions used for `Engine.drawList`). They are sent so the runner can validate the reply and so the core can reject a mismatched reply without trusting the runner's byte length.
* `rgba`, when present, is exactly `w * h * 4` bytes in row-major order, straight (non-premultiplied) alpha, matching the format used by `engine.surfacePixels` and the `SurfacesSection` snapshot.
* The runner owns the pixel source. The core copies the bytes into a fresh `SurfaceId` that becomes the starting program's working surface.

#### Ownership and size limits

* The captured frame is a **new core-owned surface**, not a reference to runner memory. The runner may discard its copy as soon as it has sent the reply.
* The requested dimensions are capped at the engine's initialised viewport. The core refuses a reply whose `rgba` length is not exactly `w * h * 4` by treating it as `null`.
* A host that cannot supply the frame (headless runner, a runner whose platform forbids screen readback, a runner whose presented surface has not been created yet, or any validation failure) replies `null`.

### 2. Determinism

#### Input log

The captured frame does **not** appear as a standalone input event in the replay log. Like `asset`, `blob.loaded` and `extension.result`, it is a correlated reply to a blocking request. The replay log records the request (via `TickReport.requests`) and the reply (as an `InputRecord` whose `event` is `frame.captured`). A replay engine feeds the same records in the same order, so the captured bytes are reproducible whenever the replaying runner supplies the same bytes.

#### State hash

The pixel bytes of the captured frame are **excluded from `hashGameState`**, by the same ruling that excludes the presented screen surface and `surfacePixels` polls ([docs/spec/formats/save-game.md#state-hash-surface-projection](../spec/formats/save-game.md#state-hash-surface-projection)). The captured frame is a derived presentation cache.

However, the **request itself** is part of the outstanding-request projection and therefore *does* affect the state hash while it is in flight ([docs/spec/formats/save-game.md#state-hash-request-projection](../spec/formats/save-game.md#state-hash-request-projection)). A program whose start is observed before the capture reply arrives has a different hash from a program whose start is observed after the reply arrives, because the work-in-flight set differs.

#### Replay when the frame is not reproducible

When a replaying runner cannot reproduce the captured frame, it replies `null`. The core then initialises the starting surface to transparent black (`rgba` all zeroes). The script sees the same transparent-black surface on every replay, so the replay remains deterministic. Any script behaviour that depended on the original captured pixels will differ, but that difference is expected: the script observed a host-specific presentation cache, and a different host is not required to reproduce it.

#### Save mid-program

A save written while a program is running captures the current script-owned surface state through the existing `SurfacesSection`, exactly as it does today. The original captured frame bytes are not stored separately; they have already been merged into the script surface that the program drew on. A `Save` waits until all blocking requests have settled before serialising state, so the capture request is never outstanding in a saved snapshot.

### 3. Failure and timing semantics

* **Blocking.** `captureFrame` is a blocking request. Until the reply arrives, `advance` returns `loading` and consumes no simulation ticks.
* **Late reply.** The core waits indefinitely. Runners are expected to reply promptly; a runner that cannot capture synchronously may return `null` immediately rather than stall the simulation.
* **Refused or invalid reply.** Any reply with `rgba: null`, or with bytes whose length does not match `w * h * 4`, is treated as `null`. The program starts with a transparent-black surface.
* **Reply arrives after the program advanced.** This cannot happen for a correctly correlated request because the program does not start until the reply is consumed. A stale reply whose `reqId` is not in the pending set is ignored.
* **Program start.** The program starts with either the captured frame or transparent black. It does **not** fail, pause, or retry.

### 4. Interactive-vs-headless rule

| Runner kind | Behaviour |
|---|---|
| Interactive (`runner-web`, `runner-desktop`, `runner-mobile`) | Supplies the RGBA bytes of the last presented frame, if one exists. |
| Headless / golden (`runner-headless`) | Replies `null`. |
| Conformance harness (`runner-harness`) | Replies `null` unless the test explicitly injects a fake reply. |

The interactive runner's frame is the composed output it would have presented: the board, sprites, effects, animations and the enabled `cnvRenderNow` overlay (E-57). It is read after presentation, so it reflects exactly what the user saw.

A golden test proves the interactive path without becoming non-deterministic by:

1. Recording an input log on an interactive runner where a script reads the captured frame.
2. Replaying that log and asserting the script's observable state (variables, subsequent draw commands) matches.
3. Replaying the same log under the headless runner and asserting identical state and draw-list hashes — the headless runner's `null` replies are deterministic for that runner, so the replay hashes match.
4. Perturbing the interactive runner to reply `null` and asserting the script sees transparent black instead of the prior frame.

The headless path therefore does not exercise the capture, but it proves that capture replies do not leak into the state hash and that replay remains deterministic when the runner replies `null`.

### 5. Smallest implementation plan

1. **Ports.** Add `CaptureFrameRequest` to `packages/core/src/ports/requests.ts` and `FrameCaptured` to `packages/core/src/ports/input.ts`. Update `RunnerRequest` and `InputEvent`.
2. **Engine seam.** At the start of an outermost program, before the program's first instruction, emit one `captureFrame` request if no script surface is already bound as the starting frame. Hold the program in a loading state until the reply is consumed; on reply, create a surface from the bytes (or transparent black) and bind it as the program's initial working surface.
3. **Runners.**
   * `runner-web`: reply with the last presented frame's RGBA bytes from the canvas used for `Engine.drawList` presentation.
   * `runner-desktop`: reply with the last presented frame from the Electron surface.
   * `runner-mobile`: reply with the last presented frame from the Capacitor web view.
   * `runner-headless`: reply `null` immediately.
4. **Save/load.** No schema change: the starting surface is already covered by `SurfacesSection`. Ensure a save cannot be serialised while a `captureFrame` request is pending (this is already guaranteed by the in-flight request rule).
5. **Spec update.** Add the Reawakened rule in [docs/spec/engine/main-loop-and-startup.md](../spec/engine/main-loop-and-startup.md) pointing to this ADR.

### 6. Test matrix

| Test | What it proves | Perturbation |
|---|---|---|
| Core unit: `captureFrame` request emitted at outermost program start | The seam is reached | Remove the request emission and assert no `captureFrame` appears in `TickReport.requests` |
| Core unit: `null` reply yields transparent-black surface | Fallback determinism | Change the reply to a non-matching byte length and assert it is treated as `null` |
| Core unit: valid reply yields a readable surface | Bytes are copied into a core surface | Replace the reply bytes with a known pattern and assert `engine.surfacePixels` reads it back |
| Headless golden: replay with `null` replies matches hashes | Capture replies do not affect state hash | Remove the capture request from the headless path and assert the replay still hashes identically |
| Browser live-player: script reads the prior presented frame | Interactive path works end to end | Force the runner to reply `null` and assert the script reads transparent black |
| Save/load: surface state round-trips through a save | Mid-program saves store the current surface, not the original capture | Save immediately after the program overwrites the captured frame and assert the saved surface is the overwritten one |

## Consequences

* **G2 is preserved.** Core never reads the display, a window handle or a platform surface. All pixel bytes cross the AD-5 seam as a plain request/reply.
* **G3 is preserved.** Replay is deterministic because the reply is part of the recorded input stream, and the pixel bytes are excluded from the state hash.
* **G1 is preserved.** No new asynchronous boundary is introduced; the request is blocking and the program remains a resumable step machine.
* **What this costs.** Interactive runners must keep the last presented frame available for readback. Browser runners already present to a canvas, so this is a `canvas.toDataURL`/`getImageData` equivalent; desktop and mobile runners read back from their presentation surface.
* **What this fixes.** Outermost programs that partially redraw can retain the last presented frame underneath, matching the Toolkit 3.1 behaviour without the core touching host display state.

## Open questions for the owner

1. **Scope of programs that capture.** Should `captureFrame` be emitted for every outermost program start (board `enterPrg`, item activation programs, menu-choice programs, run-time key programs) or only for the start-up program and program-test mode? Toolkit 3.1 copies the display for any blocking program that partially redraws.
2. **Overlay inclusion.** Should the captured frame include the enabled `cnvRenderNow` overlay canvas (the composed presented frame) or only the board/effects/animations layer underneath it?
3. **Null fallback colour.** Should a `null` reply produce transparent black (`rgba` all zeroes) or solid black (`alpha 255, rgb 0`)? Transparent black lets the board background show through if the program reads the surface with blending; solid black preserves today's approximation exactly.
4. **Premultiplied alpha.** Is the captured frame straight RGBA (matching `SurfacesSection` and `engine.surfacePixels`) or premultiplied RGBA? All existing core surface storage is straight alpha.
5. **Saved-game capture replay.** When a saved game is loaded mid-program and then replayed from the beginning, should the replay log re-capture the frame at the original program start, or is the loaded surface state sufficient? The proposed design uses the loaded surface state.
6. **Program-test mode.** In `engine <file.gam> <program.prg>` program-test mode there is no board or prior frame. Should the runner always reply `null`, or should it capture whatever the host happens to display (e.g., the editor canvas behind the test window)?
