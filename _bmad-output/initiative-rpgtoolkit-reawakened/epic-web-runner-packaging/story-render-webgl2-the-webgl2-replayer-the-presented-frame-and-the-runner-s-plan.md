---
title: "render-webgl2: the WebGL2 replayer, the presented frame and the runner's presenter"
type: 'feature'
ticket: 4
created: '2026-10-31'
status: done
tracker_id: "#929"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/929"
baseline_revision: 'adb6c95b'
risk: 'high'
context:
  - '_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-3, AD-4, AD-15, AD-27, AD-33'
  - 'docs/spec/engine/runners.md#draw-list and #webgl2-agreement'
  - 'docs/spec/engine/parity-checklist.md#golden-image-oracle'
  - 'golden/ledger.json, tools/fixtures/conformance/raster/'
  - 'docs/guardrails.md, G4 (the replayer owns no logic), G5 (goldens are deliberate)'
---

# render-webgl2: the WebGL2 replayer, the presented frame and the runner's presenter

## Intent

Make the browser limb of CAP-12 whole: every command AD-3's union can carry is drawn by the replayer the shipped
player presents through, and the agreement with `core/raster` is proved on the committed vector kit and on every gating
row of the golden ledger — not on a demonstration frame.

## Scope

`packages/render-webgl2` (the replayer and its pure leaves), `packages/runner-web` (fonts and the presenter), the
`runner-harness` seams a replayer needs, the committed raster kit and the browser lane. No audio (entry 5), no input loop
(entry 9/entry 10), no packaging (entry 13), no desktop or mobile wrapper (entry 11/entry 12).

## Decisions taken here

1. **The pixels a GPU cannot derive come from `core/raster`'s leaves, not a second implementation.** `linePixels`,
   `rectOutlinePixels`, `ellipsePixels`, `isoSourceOffset` and `textInk` were extracted from the reference rasteriser and
   the rasteriser now plots exactly those; `drawText`, `drawRect`, `drawEllipse` and the `.iso` mapping call them. The
   replayer draws one one-pixel quad per point, so a Bresenham line or a midpoint ellipse cannot drift by a pixel. The
   rewrite changed no golden: `pnpm golden` 20 rows, `pnpm closing` 8/8, core tests 2247/2247.
2. **Text is `textInk`'s coverage, composited by the GPU.** Legacy cells keep the reference's forward cell mapping, the
   italic shear and bold's second ink; TrueType keeps `getGlyphRaster`'s coverage and per-glyph offsets. A coverage of
   255 is a plain write, any other coverage is the reference's integer coverage blend — which Chromium reproduces
   exactly today (measured, not assumed).
3. **A family the game does not ship draws in the default bitmap font.** The engine already substitutes
   `DEFAULT_FONT` before rasterising; that constant became `DEFAULT_FONT_ASSET` in `core/raster/text.ts`, the engine
   imports it, and the replayer takes it as `fallbackFont`. Without this the Basic sample presented four blank labels.
4. **A tiled blit uploads only its tile.** A 589-tile `.tst` is wider than `MAX_TEXTURE_SIZE`; an incomplete texture
   samples as black, which is how Caoquest presented a wrong frame with no diagnostic. Cropping the strip to the named
   tile removed both the size limit and the silent failure.
5. **Presentation is viewport geometry (AD-33).** `presentationFrame` is pure: `letterbox` scales the logical frame by an
   integer factor and centres it, `expand` shows it at 1:1 and leaves the surround black. The draw list is always drawn
   at its logical resolution, so no command is ever drawn at a fractional coordinate.
6. **The closing frame carries its reference pixels.** A closing row's oracle is the engine's own screen (what the
   baseline locks, AD-4), not a rasterisation of the draw list — the two differ where the engine substitutes a font. The
   captured frame now carries `pixels` so a replayer can be compared with it.

## What ships

- **`render-webgl2`**: all eight AD-3 commands, key/tint/R-15/three blends, the `.iso` projection, persistent surfaces,
  the `pushTarget`/`popTarget` stack, instanced one-pixel ink, cache flush (`flush()`), `canvas` and `dispose()`.
  Pure leaves worth a Node test — `cropTile`, `presentationFrame` — sit beside it with their own unit group.
- **`runner-web`**: `fontProvider` (legacy `.fnt` and `.ttf` through core), the fallback font, and the presenter.
- **`runner-harness`**: `TracerResult.textures` and `ClosingFrameWithDrawList.pixels`.
- **the kit**: 16 vectors (was 3) — line, rectangle outline, ellipse outline and filled, the `.iso` projection, legacy
  text, TrueType text, both R-15 remaps, the alpha-0 skip and the row order.
- **the lane**: a conformance spec over all 16 vectors and an agreement spec over all 19 gating ledger rows, each
  replayed twice with `flush()` between.

## Verification

- `pnpm browser:test` — 16/16 vectors **exact**, 19/19 gating ledger rows **exact**, every row flush-stable.
- `pnpm golden` 20 rows, `pnpm closing` 8/8, `pnpm test:strict` (2512/2512, none skipped), `pnpm typecheck`,
  `pnpm lint`, `pnpm graph` (539 modules), `pnpm fixtures:test` (99), `pnpm licence`, `pnpm provenance`,
  `pnpm no-skips:test` (12).

## Landing

Merged as **`a95cebbf`** — "feat(entry 4): replay every AD-3 command in WebGL2 and prove it against the oracle" (PR
[#984](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/984), squash; #929 closed as completed). One commit.

Two things the work turned up that the entry text did not name, both fixed here because the presentation was wrong
without them: the engine's default-font substitution (`DEFAULT_FONT_ASSET`, now a core leaf the engine imports) and the
tileset strip exceeding `MAX_TEXTURE_SIZE`, which sampled as black on the largest closing board. Neither moved a
golden. CI run 41251593546 green on every check, including the new `unit (render-webgl2)` shard and the coverage
`gate`.

## Out of scope

The audio cue player and Web Audio (entries 5 and 6), the live input loop (entry 16), load modes (entry 9), the desktop
and mobile wrappers (entries 11 and 12), the single-file package (entry 7).

## Close-out record

Merged in PR #984 (merge commit `a95cebbf1`, 2026-10-31). The conformance
browser lane (`tools/browser/tests/conformance.spec.ts`) replays every raster
vector and every gating golden row through WebGL2 against the independent
reference at main; it passed both the #1218 gate and the 2026-11-03 audit
gate. The verify's literal demo tick-120 hash is retired; the lanes read the
`demo` game's `board` frame at tick 120 in `golden/regression/closing.json` —
satisfied, not fossilised. Ledger entry reconciled to closed issue #929.
