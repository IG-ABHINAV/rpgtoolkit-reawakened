---
title: 'Pre-vector board converter'
type: 'chore'
ticket: '8'
created: '2026-10-11'
status: 'done'
baseline_revision: '05de90ce8dd865a5ad69d53662c9d85e7040683a'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
review_loop_iteration: 2
context: ['{project-root}/docs/guardrails.md', '{project-root}/docs/format-spec.md', '{project-root}/_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless the human renegotiates">

## Intent

**Problem:** The vector board reader of AD-18 refuses minors 2–3 and points at the pre-vector layout of format-spec §4.8, because those boards store object positions in tile coordinates and collision as a per-tile type rather than as geometry. Until they are read and converted, a legacy 3.0.x project cannot load at all: entry 2.5 covers only minor ≥ 4, and the corpus of sample games ships no minor 2–3 board.

**Approach:** Add `packages/core/src/formats/board/pre-vector-reader.ts` for the §4.8 binary layout (minors 2 and 3) and `pre-vector-convert.ts` for §4.8's conversion rules into the existing vector `Board` model of §4.2: per-tile-type vectorization, program trigger regions, shading flattened into layer 0, and tile → pixel positions for the start point and the sprites. Both are pure and deterministic (G2, G3): the reader consumes a `BinaryReader` and returns a located `Result`, and the converter is a pure function of the model, so the same bytes always produce the identical `Board`.

## Boundaries & Constraints

**Always:** `core` stays pure (G2): no DOM, no Node, no `Buffer`, no `process`, no imports of other packages. Determinism (G3): only the allowlisted `Math` members (`Math.min` here), no `**`, no `Date`/`performance`/`Intl`/`Math.random`. Every implementing file names its `docs/format-spec.md` section (G7). One public entry per package (AD-22): the new modules are re-exported from `board/index.ts`, which `formats/index.ts` already re-exports. `kebab-case.ts` files, `PascalCase` types, `camelCase` functions. The landed vector reader, writer and model are untouched.

**Never:** add a runtime dependency; change the behaviour of the minor ≥ 4 reader or writer; edit `golden/**`; touch the legacy GPL source; invent geometry the spec does not pin (it is recorded instead).

</frozen-after-approval>

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/formats/board/pre-vector-reader.ts` — `readPreVectorBoard(reader) -> Result<PreVectorBoard>`, the §4.8 layout exactly: header (`str magic`, `i16 major`, `i16 minor` 2 or 3, byte 14 must be 0), the reserved registration pair (`i16`, `str`), `sizeX/sizeY/sizeL`, `startX/startY/startLayer` in tiles, `disableSaving`, the LUT (`i16` bound then `str` × bound+1, index 0 the "no tile" entry), the tile matrix (row-major within a layer; `i16 < 0` is a run marker `count = -value` followed by `i16 index, i16 r, i16 g, i16 b, i8 tileType` covering `count` cells; a non-negative value is a plain `i16 r, i16 g, i16 b, i8 tileType` for one cell), the background/foreground/border image strings, the background and border colours, the ambient preset, the four links in the order **N, S, E, W**, `battleSkill`, `battleBackground`, `allowBattles`, the day/night fields (`i16 × 3`, `str`), the `i16 × 11` constants, the background music, the `str × 9` layer titles, the programs (positions in tiles), `enterPrg`, the reserved string, the sprites (positions in tiles), and — only when minor ≥ 3 — the `i32` thread list and the `i8 coordType`. Refuses minor 0–1 and minor ≥ 4 and points at the right layout; a non-zero byte 14 is a text board; a wrong magic or a short file is a located `FormatError`.
- [x] `packages/core/src/formats/board/pre-vector-convert.ts` — `convertPreVectorBoard(board) -> Result<Board>` applying §4.8's conversion rules: tile-type vectorization (0 → nothing; 1 → closed TT_SOLID polygon; 2 → closed TT_UNDER with `TA_BRD_BACKGROUND`; 3/4 → open TT_SOLID polylines along the blocking edges; 11–18 → closed TT_STAIRS with `attributes = tileType − 10`), program trigger regions (a closed 32×32 rectangle, or §4.8's 64×32 diamond on an iso-stacked board), shading flattened into shade layer 0 with the cast layer at the highest shaded layer, and the tile → pixel conversion of the start point and the sprite positions via §5/§4.6 (with §4.8's `(64, 64)` on layer 1 fallback). The converted board's minor is 4 and its `coordType` the source's; every old program gets `activationType |= PRG_STOPS_MOVEMENT`; sprite loading conditions equal the activation conditions; legacy `!`/`$` variable suffixes are stripped.
- [x] `packages/core/src/formats/board/index.ts` — re-export both new modules; the landed reader/writer/model untouched.
- [x] `packages/core/test/format-board-pre-vector.test.ts` — synthetic minors 2 and 3 boards built byte by byte, covering runs that wrap a row end and a layer boundary, every converted tile type, a program rectangle, multi-layer shading, positions, determinism and the located errors.
- [x] `_bmad-output/initiative-rpgtoolkit-reawakened/deferred-work.md` — one entry for the §4.8 gaps that need a doc/human decision (below).
- [x] `tickets.toml` entry 8 — no change needed; the plan file marks it done.

**Acceptance Criteria:**
- Given a synthetic minor 2 or 3 board, `readPreVectorBoard` returns the exact layout and `convertPreVectorBoard` returns a `Board` with `minor === 4`, the source `coordType`, the vectorized geometry, the flattened shading and pixel positions.
- Given a run marker that wraps a row end or a layer boundary, the expanded matrix matches the §4.8 traversal order.
- Given a program at tile `(x, y)`, the converted program's points are the closed 32×32 rectangle `((x−1)·32, (y−1)·32)`–`(x·32, y·32)` (or the iso-stacked diamond) and its `activationType` carries the stops-movement bit.
- Converting the same bytes twice gives deep-equal boards (G3).
- Minor 0–1, minor ≥ 4, a wrong magic, a non-zero byte 14 and a truncated file all return located `FormatError`s, never throws.

## Implementation Notes

- **No minor 2–3 sample exists.** All three `.brd` files in the fetched corpus (`demo/Boards/start.brd`, `demo/Boards/out.brd`, `Basic/Boards/start.brd`) are minor 4 — verified from their headers (byte 14 is `0`, the minor field at bytes 17–18 is `4`). There is therefore no real pre-vector board to pin against, and §4.8 is pinned entirely by synthetic fixtures built byte by byte. The test file carries a guarded scan that converts any minor 2–3 board if one ever appears under `fixtures/legacy/`, and otherwise records that none exists.
- **Grid.** §4.8 gives the tile matrix as `sizeX/sizeY/sizeL` in z, y, x order and never states §4.2's `(sizeX + sizeY)²` effective grid. The reader therefore always reads `sizeX × sizeY` cells per layer — the only reading a reader can apply, since `coordType` is the final field and cannot be known before the matrix.
- **Iso-rotated is refused.** §4.8 records no mapping from the `sizeX × sizeY` pre-vector matrix onto §4.2's `(sizeX + sizeY)²` rotated grid, and its program-region rule names only the iso-stacked diamond. `convertPreVectorBoard` returns a located error rather than guess; recorded for a doc fix.
- **Iso-stacked is converted.** §5 gives the tile centre for a stacked board and §4.6 the 64×32 diamond, so a tile vector and a program region are both that diamond; tile vectors are emitted per tile because the merged-run rule has no diamond analogue.
- **Merge rule.** §4.8 says "merge contiguous non-zero tiles into vector geometry" but not how. This plan originally assumed "each maximal horizontal run of one type"; that assumption was never checked against the original routine and is **wrong** — see the correction below. A 2D board merges **greedy rectangles**: scan column by column (x ascending, then y), grow down the column, grow right one whole column at a time, and consume the block (`docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector`). Passages emit both blocking edges per tile either way, and an iso-stacked board merges in the rotated grid, which stays unverified because no such board exists in the corpus.
  **Correction (2026-11-04).** Both original programs share one conversion routine (the editor reaches it through `BRDVectorize`), and it grows rectangles, not runs: a 2×2 block of solid cells is ONE polygon. The previously reported 2,667 polygons over 143 pre-vector boards measured an interim converter, not the original; that implementation could reuse consumed cells and has been superseded. The original's consumed-cell handling and polygon count are unverified. PR #1279 adopts exclusive consumption as a Reawakened rule ([#1280](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1280)).
- **Shading.** §4.8 does not define how differing per-layer shades combine. They are summed per cell (shades are additive offsets, §4.5), the cast layer is the highest layer with any non-zero shade, and a board with no shading gets no shade layer.
- **Constants and titles.** §4.8's eleven constants are numeric and become their decimal strings in the §4.2 `constants` list; the nine fixed layer titles fill `sizeL + 1` entries, padded with empty strings when `sizeL + 1 > 9`.
- **Unused fields dropped on conversion:** the foreground and border images, the border colour, the day/night fields and the reserved trailing string have no §4.2 field; the background image becomes a parallax background (`backgroundDrawType = 1`), and the ambient preset maps to its §4.8 offsets (unknown presets become none, with a warning).

## Review Triage Log

### Round 2 — 2026-10-13 (`review-r2-formats`)

| # | Lens | Finding | Verdict | Route |
|---|---|---|---|---|
| 1 | intent-alignment | Empty program slot becomes a closed rect with `closed:-1`; §4.8 says no points, `closed 0` (`pre-vector-convert.ts:403-418`) | blocker, spec divergence | rejected — STALE on re-baseline: fixed by epic 2.16 (`1a42973`) |
| 2 | intent-alignment | Empty sprite slot is placed at the stored tile's pixels (`(16,63)`, `(-16,-1)`), not `(0,0)` (`pre-vector-convert.ts:419-437`) | blocker, spec divergence | rejected — STALE on re-baseline: fixed by epic 2.16 (`1a42973`) |
| 3 | edge-case-hunter | No cell cap: 21 KB → 1.0 GB RSS, 360 KB → OOM abort `exit=134` (`pre-vector-reader.ts:558-560`) | blocker | fixed — branch `fix/epic2-prevector-and-battle-validation` (`f56e694` fix, `9caaeaf` docs) |
| 4 | verification-gap | G7 doc-first skipped: §4.8 rules written 8 h after the code, closing Done-when 4 by description | real, process | deferred — recorded in `deferred-work.md` |
| 5 | blind-hunter | Over-long runs clamped, not kept with a warning as in §4.2; unrecorded | real, low | deferred — recorded in `deferred-work.md` |
| 6 | verification-gap | No tests for empty slots, the cell cap, the overrun warning or the negative-run refusal | real | deferred — recorded in `deferred-work.md` (the cell-cap and empty-slot tests have since landed) |
| 7 | blind-hunter | Pre-vector residue is carried into the converted §4.2 board's residue | low | accepted — §4.8/§4.2 do not address it |

## Code Review

### 2026-10-11

**Code review complete.** 0 `decision-needed`, 3 `patch`, 6 `defer`, 10 rejected. Every patch is applied (2026-10-11).

Scope: 06b250e; diff excludes the ticket's own plan file. Lenses run: blind-hunter, edge-case-hunter, verification-gap, intent-alignment (thorough). Decision, patch and defer counts are entries after grouping; the rejected count is findings.

- [x] [Review][Patch] `coordType` validation rejects §5's combinable `PX_ABSOLUTE` flag [packages/core/src/formats/board/pre-vector-convert.ts:342-345] — a board stored as `PX_ABSOLUTE` (coordType 4 or 5, "combinable with 0, 1, or 2" in §5) converts to no `Board` at all; mask bit 4 before the 0/1/2 check and pass the value through, leaving the iso-rotated refusal in place. — applied 2026-10-11: `PX_ABSOLUTE` (coordType 4 and 5) converts and is passed through; an isometric-rotated board (2 and 6) is still refused.
- [x] [Review][Patch] Over-long run-length counts break the write-back of large boards [packages/core/src/formats/board/pre-vector-convert.ts:236-246,293-302] — a uniform matrix over 32768 cells converts to a board `writeBoard` rejects, and a shade run of 32768 cells wraps `i16` on write so the file no longer re-reads; chunk tile runs at 32768 and shade records at 32767 cells. — applied 2026-10-11: Tile runs are chunked at 32,768 cells and shade records at 32,767; a 192×192 uniform board writes with `writeBoard` and re-reads.
- [x] [Review][Patch] The converter branches and converted properties are unpinned by tests [packages/core/test/format-board-pre-vector.test.ts] — the `tileType` 0 skip (`:201`), the ambient presets, the constants mapping, the trailing properties (`links`, `lut`, `layerTitles`, `enterPrg`, battle fields, music) and any `writeBoard` round-trip have no assertion; add cases to the existing synthetic tests. — applied 2026-10-11: Tests added for the `tileType` 0 skip, the ambient presets and the unknown-preset warning, the LUT, constants, links, layer titles, `enterPrg`, battle fields and music, and a `writeBoard` then `readBoard` round trip.
- [x] [Review][Defer] The board load path still refuses minors 2–3 [packages/core/src/formats/board/reader.ts:195-203] — deferred: pre-existing refusal, not caused by this change; the first caller lands outside the diff in `2aa135e` (epic 2.11, `runner-headless/src/dump/parse.ts`).
- [x] [Review][Defer] §4.8's "standard default vector bases" rule is implemented nowhere [packages/core/src/formats/board/pre-vector-convert.ts:340-346] — deferred: §4.2's `BoardSprite` has no base field and the actor readers synthesise no defaults for minor < 7/8, so the rule needs a spec/design decision (already recorded for §4.8).
- [x] [Review][Defer] Iso-rotated pre-vector boards yield no board at all [packages/core/src/formats/board/pre-vector-convert.ts:346-352] — deferred: the refusal is deliberate and recorded (`deferred-work.md`), §4.8 gives no `(sizeX+sizeY)²` mapping, so closing it needs a doc decision (and leaves `tilePixel`'s rotated branch dead in the meantime).
- [x] [Review][Defer] Empty program/sprite slots get invented off-board geometry [packages/core/src/formats/board/pre-vector-convert.ts:383,390] — deferred: §4.8 pins a fallback only for the start point, so the rect/diamond at tile (0,0) and sprite x=-16,y=-1 are unrecorded inventions needing a §4.8 decision.
- [x] [Review][Defer] A legacy repeat bit converts to `repeatDistance: 0` [packages/core/src/formats/board/pre-vector-convert.ts:380-381] — deferred: §4.8 does not say the pre-vector `activationType` carries §4.4's bit 2 and the record has no distance field, so masking the bit versus defaulting a distance is a spec decision.
- [x] [Review][Defer] The remaining §4.8 readings are recorded only in the deferred-work log, not the spec [packages/core/src/formats/board/pre-vector-convert.ts:340-346] — deferred: G7 doc-first was not followed for the empty-slot, activation-type, shade-range, dropped-field and constants/titles decisions; a spec amendment is a human decision on §4.8.

**Rejected**
- blind-hunter: Shade sums are unbounded and unvalidated against the documented ±255 — low: real (510 written and re-read) but the clamp is a guard the spec never asks for, the value renders clamped, and no consumer trusts the range.
- blind-hunter: Shade flattening cannot represent per-layer differences — low: inherent to §4.8's mandated flattening into one shade layer and already recorded; no §4.2 shape can express per-layer shades.
- blind-hunter: Every conversion error reports `offset: 0` and no path; four `fail` helpers — low: a pure function of the model has no byte positions or path to report, and each message names the offending value.
- blind-hunter: Error attribution differs from the sibling vector reader — false: both readers report the same condition, offset and message for the same bytes; only the `section` label differs and each names the section that function implements.
- blind-hunter: Silent data loss where the warning channel already exists — low: §4.8 marks those fields "unused", the unknown tile types have no conversion rule, and the layer-title truncation matches the model invariant `writer.ts` enforces; warnings would add branches and name no harm.
- blind-hunter: Tile and diamond metrics are hard-coded although core already owns them — low: the `.iso` tileset constants are a different concern and `boardGrid` is moot because iso-rotated is refused; dormant duplication.
- blind-hunter: The synthetic-fixture method cannot catch a misreading of §4.8 — low: inherent (the corpus has no minor 2–3 board) and already stated in the test file's header; the remaining ask edits the plan's verification record.
- blind-hunter: The corpus test asserts almost nothing and re-derives the header by hand — low: true, but the corpus holds no pre-vector board and the ticket's fixtures are synthetic; the hand-rolled header parse is a hygiene nit.
- edge-case-hunter: A matrix LUT index at or beyond `lut.length` is accepted — false: the sibling reader applies no such check, neither §4.2 nor §4.8 requires it, and no code resolves LUT indices, so the claimed harm has no consumer.
- intent-alignment: Tests are self-referential and cannot be an oracle — low: unavoidable with no pre-vector sample; the ticket's verify line claims only synthetic fixtures, which the unconditional unit tests run.

### Round 2 — 2026-10-13

**Code review (round 2, independent reviewer `review-r2-formats`).** Verdict: FAIL. 5 live findings (1 BLOCKER, 1 MAJOR, 2 MINOR, 1 low). The first pass ran against a stale checkout (`3ec2ab9`) and was re-baselined against `origin/main` (`9d4d336`): B1 (empty program/sprite slots inventing geometry) is STALE — fixed on `origin/main` by epic 2.16 (`1a42973`) — so it is rejected. B2, the missing cell-count cap (a 360 KB crafted board aborted the process with `exit=134`), is fixed on branch `fix/epic2-prevector-and-battle-validation` (`f56e694` fix, `9caaeaf` docs), which bounds the declared grid by `BOARD_MAX_CELLS`. The G7 doc-first ordering, the clamped over-long runs and the missing tests are deferred (recorded in `deferred-work.md`); the carried-over pre-vector residue is accepted. Round 1 above is unchanged.
