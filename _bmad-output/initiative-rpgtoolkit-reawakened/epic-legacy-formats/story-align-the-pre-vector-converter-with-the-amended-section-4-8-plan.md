---
title: 'Align the pre-vector converter with the amended section 4.8'
type: 'feature'
ticket: '16'
created: '2026-10-12'
status: done
baseline_revision: 'ac714685be47b029aa7de07daeca228db0aa0597'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['docs/guardrails.md', 'CLAUDE.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `docs/format-spec.md` section 4.8 was amended (PR #41) with the rules the entry 2.8 converter had to guess. The converter (`packages/core/src/formats/board/pre-vector-convert.ts`, reader `pre-vector-reader.ts`) may still follow the old guesses, so the board it builds can disagree with the spec, and the deferral entries about 4.8 in `_bmad-output/initiative-rpgtoolkit-reawakened/deferred-work.md` stay open.

**Approach:** Audit the converter against every bullet of the section 4.8 "Conversion rules" and the field table, change only what disagrees, and pin each ruled case with a synthetic pre-vector board test. Section 4.8 is the only source (G7); never open `../rpgtoolkit`.

## Boundaries & Constraints

**Always:** the rules in section 4.8 as written: grid and cell polygon; per-run merging on 2D only and one diamond per tile on iso-stacked; tile types 0, 1, 2, 3, 4, 11-18 as stated and any other type emits nothing and is not reported; `PRG_STOPS_MOVEMENT` OR-ed into every program with `repeatDistance` 0 and bit 2 passed through; empty program slot has an empty point list and `closed = 0`; empty sprite slot is at (0, 0) with its stored layer; shade layers summed unclamped, cast layer the highest shaded layer, no shade layer when all unshaded; start (64, 64) layer 1 when `startX <= 0` or `startY <= 0` else `startLayer` or 1; no default base generated; dropped fields; `backgroundDrawType = 1`; ambient preset mapping with a warning for other values; the eleven constants as decimal strings; layer titles by the stated index rule; `coordType` 2 and 6 refused with a located error, 0, 4, 1, 5 convert and `PX_ABSOLUTE` passes through. Keep `core` pure (G2, G3). Existing tests that encode the old guesses are changed to the amended rule (never the reverse); do not weaken unrelated tests.

**Never:** edit `docs/` or the spine (a spec gap is reported in Implementation Notes, not patched here); change other readers, golden files or hash vectors unless a changed expectation forces it (then say why); add dependencies; push.

</frozen-after-approval>

## Code Map

- `docs/format-spec.md` section 4.8 (line ~433 on) and sections 4.2, 4.4, 4.5, 5 — the rules; read only.
- `packages/core/src/formats/board/pre-vector-convert.ts`, `pre-vector-reader.ts` — the code under audit.
- `packages/core/test/format-board-pre-vector.test.ts` — existing synthetic-board tests; extend here.
- `_bmad-output/initiative-rpgtoolkit-reawakened/deferred-work.md` — the 4.8 deferral entries (lines ~41-43, 85-100) say what the old guesses were; read only, never edit (ledger is append-only).

## Tasks & Acceptance

**Execution:**
- [x] Audit each section 4.8 bullet against the converter; list agree/disagree in Implementation Notes.
- [x] Fix each disagreement in `pre-vector-convert.ts` (and the reader only if a field is read wrongly).
- [x] One test per ruled case: bases generated none, per-run merge, iso-stacked diamonds, types 5-10 and above 18 silent, type 3/4 open polylines, program region and stops-movement flag, bit 2 pass-through, empty program and sprite slots, summed unclamped shades and cast layer, start fallback, dropped fields and `backgroundDrawType`, ambient mapping and warning, constants and titles, iso-rotated refused (coordType 2 and 6) while 4, 1, 5 convert.
- [x] Commit `feat(core): align the pre-vector converter with section 4.8 (epic 2.16)`, staging only your files.

**Acceptance Criteria:**
- Given a synthetic pre-vector board for each ruled case, when converted, then the result has the geometry section 4.8 states.
- Given coordType 2 or 6, when converted, then a located error is returned and no board.
- Given the sample boards, when `pnpm test:strict`, `pnpm golden`, `pnpm dump:check` run, then they pass unchanged.

## Implementation Notes

**Audit of the amended §4.8 "Conversion rules" against `pre-vector-convert.ts`.** One bullet disagreed; the rest already agreed. The reader (`pre-vector-reader.ts`) reads every §4.8 field correctly, so it was not changed.

- **Grid** (`sizeX × sizeY` cells per layer, z, y, x; the shade layer covers the same cells): **agree** — `buildTileVectors`/`buildShadeLayers` walk `sizeX * sizeY` cells per layer.
- **Cell polygon** (2D closed 32×32 rect `((x−1)·32,(y−1)·32)`–`(x·32,y·32)`; iso-stacked closed 64×32 diamond on the tile): **agree** — `tileCellRect`, `tileDiamond`.
- **Tile types 0/1/2/3/4/11–18**, and any other type emitting nothing and not reported: **agree** — `buildTileVectors` emits only for {1, 2, 3, 4, 11…18}; types 0, 5–10 and >18 are skipped with no warning.
- **Merge** (2D maximal horizontal runs only; iso-stacked one diamond per tile): **agree at the time, and the rule was wrong** — this story re-affirmed the plan's assumption instead of reading the conversion routine. The original grows rectangles (scan a column, grow down, grow right over whole columns), so a 2×2 block of solid cells is one polygon; an iso-stacked board merges in the rotated grid, which no sample verifies. The previously reported 2,667 polygons over 143 pre-vector boards measured an interim converter, not the original; it could reuse consumed cells and has been superseded. The original's consumed-cell handling and polygon count remain unverified. PR #1279 adopts exclusive consumption as a Reawakened rule ([#1280](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1280)).
- **Program region** (closed cell rect/diamond) with `PRG_STOPS_MOVEMENT` OR-ed into every program, `repeatDistance = 0`, bit 2 passed through: **agree**.
- **Empty slots**: **disagree** — the converter mapped an empty slot through §5 as if it sat on tile `(0, 0)`: an empty program became a closed rect `(−32,−32)…(0,0)` (2D) or a diamond centred `(−64,−16)` (iso), and an empty sprite became `x = −16, y = −1` (2D) / `x = −64, y = −16` (iso). Fixed to the amended rule: an empty program slot (empty `program`) now has an empty point list and `closed = 0`; an empty sprite slot (empty `itemFile`) is at `(0, 0)` on its stored layer. Both slots are still converted, so indices stay stable.
- **Shading** (summed unclamped into layer 0; cast layer the highest shaded layer; no shade layer when all unshaded): **agree**.
- **Positions** (tile → pixels through §5 with the base point; start `(64,64)`/layer 1 when `startX ≤ 0` or `startY ≤ 0`, else `startLayer` or 1): **agree** — sprites and programs at a non-positive tile still map through §5, because only the start has a fallback.
- **Dropped fields** (registration pair, foreground, border image, border colour, day/night, reserved) and `backgroundDrawType = 1`, ambient preset mapping with a warning for other values: **agree**.
- **Numeric constants** (eleven decimal strings, in order) and **layer titles** (`0…sizeL`, missing index empty): **agree**.
- **No default base generated**: **agree** — the amended §4.8 withdrew the old "standard default vector bases" sentence; the conversion emits no base, and `BoardSprite` has no base field.
- **Iso-rotated refused** (`coordType` 2 and 6) with a located error while 0, 4, 1 and 5 convert and `PX_ABSOLUTE` passes through: **agree**.

The stale code comments that still described the withdrawn "standard default vector bases" sentence and implied §4.8 left the geometry unmapped were corrected to cite the amended rules.

## Plan Change Log

## Review Triage Log

## Verification

Dependencies and fixtures are installed in this worktree.

**Commands:**
- `pnpm typecheck && pnpm lint && pnpm test:strict && pnpm golden && pnpm dump:check && pnpm graph && pnpm provenance` -- expected: all pass, no skipped tests

**Results (2026-10-12):** all seven commands pass; `test:strict` runs 464 tests, 0 skipped. Focused `node --test packages/core/test/format-board-pre-vector.test.ts` runs 31 tests, 0 skipped. No golden file or hash vector changed (the synthetic corpus and the three sample boards are unaffected: the sample boards are all minor 4, and the `runner-headless` dump fixture has no programs or sprites).

Pass 1 (quick lens): high 0, medium 0, low 4 (all patched), false 0. The lens also checked every 4.8 bullet against the converter and found no second behavioural disagreement.

| Verdict | Route | Finding and evidence |
|---|---|---|
| low | patch | `passageEdges`, `buildShadeLayers` and `buildTileVectors` doc comments still described withdrawn pre-amendment wording; verified at the cited lines, reworded to the ruled bullets. |
| medium | patch | Plan item "summed unclamped shades" had no test that sums past ±255 (existing cases sum 10+5); added +255+255=+510 and -255-255=-510. |
