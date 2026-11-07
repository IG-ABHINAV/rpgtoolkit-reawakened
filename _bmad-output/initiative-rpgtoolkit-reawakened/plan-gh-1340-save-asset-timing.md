---
title: 'Preserve shared asset readiness across Save and Load (#1340)'
type: 'bugfix'
ticket: ''
tracker_id: '#1340'
created: '2026-11-07'
status: 'built'
baseline_revision: 'c7c3aeae483cc27a1f04e2c0231f9d1328792adb'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'readiness-edge-cases']
review_loop_iteration: 2
context: ['docs/guardrails.md', 'docs/spec/formats/save-game.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Unloaded animations resume on different ticks because cold destinations lose saved asset readiness and warm destinations leak later readiness.

**Approach:** Save the global acquired-key set. Restore that visibility and reacquire absent saved-warm files before simulation resumes. Leave previously cold files to ordinary consumers.

## Boundaries & Constraints

**Always:** Preserve source compatibility, atomic validation, phases, cancellation, shared consumers, request freeze and debugger stepping. Save keys, not bytes. Use current installed assets (owner choice, 2026-11-07). Hash semantic readiness, not physical bytes/decoded caches/prefetch facts.

**Never:** Reuse PR #1616; backdate clocks; prepare animations early; request cancelled cold pictures; replay completed phases; impose recovery fingerprints; bump IR.

**Tradeoff requiring approval:** Load eagerly reads all saved-warm keys, even previously used files never used again. Missing/invalid unused files cannot fail the game; only normal consumers observe failures. No previously cold files are prefetched.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Unloaded animation | Cold/warm source and destination | Identical origin, frames, sounds and pixels at matching ticks | Existing consumer policy |
| Shared assets | Second animation/image after Save | Shared saved availability, no destination-warm leak | Deduplicate requests |
| Cancellation | End animation before acquisition | No request for its cold pictures | Missing cancelled picture is harmless |
| Warm unused file | Removed/changed since Save | Current content; no failure unless consumed | Existing consumer policy |
| Loaded animation | Saved frames/clock | Preserve progress; rebuild pictures | Existing required-asset policy |
| Older save | No manifest | Deterministic cold fallback; preserve loaded progress | Historical unloaded timing unrecoverable |
| Invalid manifest | Malformed/duplicate/noncanonical keys; newer schema | Refuse atomically, preserving caches/counters | Located `restore.shape` |
| Lifecycle | Reset/repeated Load | No stale decoded data/visibility | Existing lifecycle policy |

</frozen-after-approval>

## Code Map

- `packages/core/src/engine/engine.ts`: cache, requests/replies, `applyLoadedGame`, `syncEngineState`, `drive`, `finalizeBlobRequests`. Mid-phase requests do not stop the current tick.
- `packages/core/src/save/{sections/engine.ts,state.ts,snapshot.ts}`: shape, version, migration and validation.
- `packages/core/src/save/{game-save.ts,hash.ts}`: canonical envelope, compatibility and counter projection.
- `packages/core/test/{battle-fresh-load,save-operation,save-migration,render-now}.test.ts`: reuse real-engine, migration and preparation-phase patterns.
- `golden/`, `tools/fixtures/saveload/`: schema/hash artifacts; inventory before regenerating.

## Tasks & Acceptance

**Execution:**
- [x] `docs/spec/formats/save-game.md` — document readiness, eager-warm tradeoff, current assets, hashing and legacy fallback; commit docs first.
- [x] `packages/core/src/save/{sections/engine.ts,state.ts,snapshot.ts}` — bump engine schema, validate keys, migrate legacy readiness explicitly; preserve IR.
- [x] `packages/core/src/engine/engine.ts` — efficiently capture keys; stage restoration after source validation; hide destination-only bytes; hold drive/VM during warm rehydration; defer unused failures; invalidate derived caches/presentation; preserve rollback/reset/stepping.
- [x] `packages/core/test/` — small procedural real-engine matrix regressions and migration/atomic refusal coverage.
- [x] `golden/`, affected fixtures, `CHANGELOG.md` — deliberately update after smoke proof; remove incidental implementation tests rather than re-pin them.

**Acceptance Criteria:**
- Given unchanged game data, when a real unloaded-animation save loads cold or warm, then its timeline, sounds and pixels match uninterrupted execution at boundary ticks.
- Given shared consumers or cancellation after Save, when scripts resume, then availability and cold acquisitions follow original phases.
- Given refused Load/reset, when execution continues, then restored visibility, counters and decoded data do not leak.

## Implementation Notes

### Implementation interface and ownership

All implementation occurs in `/private/tmp/tkr-1340-fresh`, never the dirty primary checkout. Parent owns docs-first commit, schema/type/validation/migration, integration and final gates. RuntimeFix owns `packages/core/src/engine/engine.ts` and any focused runtime helper. RegressionFix owns a new `packages/core/test/animation-save-readiness.test.ts` with small authored real-engine fixtures and behavioral matrix tests; do not edit runtime/schema files.

The shared shape is `readonly EngineSection.cacheKeys: string[] | null`: sorted unique canonical acquired keys; `null` is legacy unknown readiness. Engine schema becomes 2, IR unchanged. All section producers supply it; migration sets null. A new runtime initializes an empty array and synchronizes shared availability. Legacy Load retains deterministic boot-required main/font/program/initial-character assets and drops other destination cache warmth before consumers resume.

Runtime must treat restored-warm rehydration as a dedicated non-decoding acquisition path before any drive, frame rebuild, VM work or new save publication can consume the partially restored cache. Null replies for unused warm keys do not fail; later consumers own errors. Revalidate current source through the existing loader before committing cache changes. Invalidate image/tile/definition/actor-animation/cell-size/presentation caches together. Keep physical restoration and semantic readiness coherent through reset and repeated Load. No builds, tests, lint or formatters while implementation workstreams are in flight; parent runs all gates after integration.

- Integration: schema uses a readonly `cacheKeys` property with a mutable-array type, matching `PlainData`'s array contract. Parent corrected dropped runtime declarations/counter rollback, added an explicit frame-rebuild barrier and primed visible saved-board images whose dimensions are needed before blit emission.
- Verification: 25 real-engine behavioral cases pass, individually below 60 ms isolated; typecheck and lint pass. Direct smoke proves all four cache combinations plus shared consumers match uninterrupted pixel hashes; cancellation never requests cold pictures; missing/invalid unused warm files allow `continued=42`; changed pictures use current bytes.
- Perturbation proof in a separate disposable worktree: disabling warm rehydration changes origin 4→5 and fails cold/cold; retaining destination-only bytes changes origin 4→3 and fails cold/warm; requesting cancelled cold pictures fails cancellation with `asset.missing`. Reversing all three perturbations restores all 14 original cases. The disposable tree was removed.
- Preserved original engine-schema-1 battle fixtures separately before current-schema regeneration. Removed obsolete acquired-key-is-hash-neutral scenarios and inline incidental default hashes rather than re-pinning them; behavioral determinism, request-counter projection and committed golden checks remain.

## Plan Change Log

## Review Triage Log

| Finding | Verdict | Resolution / evidence |
|---|---|---|
| Quick 1: `.gph` with `tile:null` uses image decoder | Fixed | Reproduced `asset.invalid`; use the existing `.gph` tile classification. Visible single-tile Save/Load now preserves pixels. |
| Quick 2: restored window graphic remains invisible | Fixed | Reproduced missing saved blit; activate cached graphic at its actual consumer before composing. Tests cover both already-visible and later-created windows with valid font/window assets and pixel equality. |
| Quick 3: rollback/reset exposes deferred invalid bytes | Fixed | Reproduced reset failure and refused-Load failure on a later render; retain protections while retaining bytes, restore the old deferred set on rollback, and move external sprite binding before cache commit. |
| Edge 1: later consumers miss deferred decodes | Fixed | Reproduced wrong pixels for a later tileset animation and board background; activate at animation-frame and hydrated-board consumers. Both now match uninterrupted pixels. |
| Edge 2: `.gph` restore dispatch | Duplicate, fixed | Same root as Quick 1; shared dispatch fixed and tested. |
| Edge 3: reset clears deferred protection | Duplicate, fixed | Same root as Quick 3; reset and failed-source-Load tests both continue without unused-file errors. |
| Rereview contract: new installed sources disappear after Load; reset stalls | Fixed | Reproduced an uncallable new source and stalled reset. Keep installed sources physically available to synchronous resolution, promote only consumed keys, and acquire required boot assets on reset. Both targeted regressions pass; reviewer independently confirmed resolution. |
| Rereview runtime: offscreen tiles remain deferred after camera movement | Fixed | Prime actual visible blits before each frame rebuild. Real camera movement exposes distinct pixels and matches uninterrupted execution; perturbing to prime only the initial frame fails pixel equality. Reviewer confirmed resolution. |
| Rereview runtime: legacy visible tiles report a premature partial frame | Fixed | Reproduced spurious `render.failed`; await visible bytes/decoder dependencies before rendering. Legacy tiled-board Load now passes without diagnostics; reviewer confirmed resolution. |
| Integration gate: renderer-owned blits treated as raw file acquisitions | Fixed | Honor decoded textures first; main-plane requests require indexed assets, while retained margins preserve host-supplied unindexed requests. Existing GIF/cursor/demo guards and the rebuilt web cursor case pass. A direct margin request/reply decodes `[255,0,0,255]` without diagnostics. Reviewer confirmed both ownership and margin preservation. |

- Two independent review passes completed; all findings resolved, with narrow independent confirmation of final fixes. Nothing deferred.

## Design Notes

Lazy key-only restoration needs resumable VM/phase barriers to avoid duplicate effects. Restoring saved-warm files first avoids those barriers without acquiring cold files early. Missing warm files remain nonfatal until consumed. Old saves cannot reconstruct absent historical readiness.

## Verification

- Run focused regressions before/after; ordinary tests individually under one second.
- Real-engine smoke: cold/warm source/destination, actual draws/pixels, clocks, sounds and request traces.
- Perturb warm restoration, destination pruning and cancellation independently; guards must fail.
- Run typecheck, lint, strict tests, golden/closing, save-fixture checks, provenance and dependency/licence gates. Inspect intentional golden changes.
- Independent review; fix findings and rerun relevant gates before PR delivery.

### Recorded results

- Final-source typecheck, lint and full strict suite pass: 3,507 tests, 3,507 passed, zero failures or skips (`pnpm typecheck && pnpm lint && node tools/no-skips/run.mjs`). This includes all 25 new real-engine cases and existing GIF/cursor/margin/demo regressions.
- Node and Bun golden suites and all eight closing games match their baselines (two clean boots, six unchanged named expected failures). Independent-reference scenes match exact RGBA; save-fixture regeneration check passes.
- Licence, provenance and dependency checks pass (13 production / 228 total packages, 1,019 scanned files, 698 modules; zero violations).
- Baseline audit permits only 228 state-hash values, two engine-version fields, two readiness arrays and one save-byte count; all draw/pixel/event/outcome/tick values remain unchanged. Both preserved engine-1 migration fixtures are byte-identical to their original committed saves.
- Changed save-contract links/anchors resolve. Temporary direct-smoke and review-diff files were removed. The implementation worktree is retained for delivery.
- Execution environment: Node v26.13.0 and Bun v1.4.2; the repository's pinned Node v24.21 was not exercised here.
- PR #1669 CI follow-up: `script-dogfood` caught two omitted script-test baseline hashes. A throwaway module-loader oracle normalized only `schema.engine` and `engine.cacheKeys` and reproduced the complete old baseline exactly, proving schema-only drift. Updated only those two hashes; no runtime or test behavior changed. `pnpm script:dogfood` and all 45 script-cli/script-spec tests pass.
