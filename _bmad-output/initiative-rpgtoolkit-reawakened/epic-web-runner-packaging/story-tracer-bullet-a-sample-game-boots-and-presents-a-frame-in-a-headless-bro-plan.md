---
title: "Tracer bullet: a sample game boots and presents a frame in a headless browser from the same core build"
type: 'feature'
ticket: 3
created: '2026-10-31'
status: done
tracker_id: "#928"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/928"
baseline_revision: 'c1471b17'
risk: 'high'
context:
  - '_bmad-output/initiative-rpgtoolkit-reawakened/epic-web-runner-packaging/epic-web-runner-packaging.md, Done when 1'
  - '_bmad-output/initiative-rpgtoolkit-reawakened/epic-web-runner-packaging/discovery/inception-proposal.md, entries 3 and 4'
  - '_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-1, AD-4, AD-22, AD-33, Operations (CSP and single-file IIFE bundles)'
  - 'golden/regression/closing.json and golden/closing/plan.json'
  - 'docs/spec/engine/audio-media.md#video-policy and #audio-browser-test'
  - 'docs/guardrails.md, G5 rule 4 (sample games are fetched, never committed)'
---

# Tracer bullet: a sample game boots and presents a frame in a headless browser from the same core build

## Intent

Prove the browser limb of CAP-12 end to end before the replayer is finished: the shipped `tsc -b` output boots `demo`
in headless Chromium, reports the closing suite's own tick-120 hashes, and puts the composed frame on a canvas. The
value is the evidence — a lane that fails on a clean runner the moment the browser build, the fixture fetch or the
frame presentation breaks.

## Scope

`packages/runner-web` (its public entry, its declared `./app` subpath and the player page), the `runner-harness` seams
a host needs (`runClosingFrames`, `decodeAssetTexture`), the `render-webgl2` package the page presents through, and
`tools/browser` (esbuild IIFE bundles, the static host, the Playwright specs). No audio, no input loop external to the
plan's scripted keys, no desktop or mobile wrapper, no packaging.

## Decisions taken here

- **The page boots through the closing suite's own path.** `runClosingFrames` runs the plan's first batch — the batch
  the committed baseline records — so the hashes are the baseline's by construction rather than by a copy of the boot
  sequence. `runClosingGame`'s cross-batch determinism check stays with the headless lane.
- **The replayer ships with the tracer.** The entry text named the reference rasteriser as the presenter and left
  `render-webgl2` to entry 4; the owner's instruction for this entry was the real WebGL2 replayer, so the draw-list
  replay, the AD-3 pixel pipeline for key, tint and the three blends, the target stack and the surface pull landed here
  and entry 4 keeps text, the exact line and ellipse, `.iso`, `.tan`/`.tbm`/`.gph`, the full vector set and the ledger.
- **Deferred means counted.** Text, the exact line and ellipse, `.iso` and the animated, tile-bitmap and single-tile
  textures are counted in `deferredByKind` with a diagnostic string, never approximated, so the lane reports progress
  instead of hiding it.
- **esbuild and Playwright are dev-only**, in the `ovsx` precedent ADR 0015 records; `allowBuilds: esbuild` in
  `pnpm-workspace.yaml` is what lets a frozen-lockfile install run esbuild's platform download.

## Landed

Merged in two PRs, both squash:

- **`892fff18`** — "feat(entry 3): boot a sample game in Chromium through the real WebGL2 replayer" (PR
  [#977](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/977)). The tracer, the replayer, the bundles, the
  static host and the two Playwright specs.
- **`adb6c95b`** — "test(entry 3): give runner-web its unit group and CI shard" (PR
  [#979](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/979)). The entry's own `tools/no-skips` group and
  `unit` matrix row, six Node-level tests over the transport helpers and the decode adapter, and the guard's
  self-tests moved to ten groups.

The independent review found two blocking pixel defects (R-15's white→245 / black→10 remap and the alpha-0 skip), one
dependency-graph break, one CI gap and four correctness items; all are fixed, and four vectors joined the committed kit
so the two pixel defects can never return silently.

## The lane's own result

`demo` at tick 120 — previous state hash (later E-02 baseline `91172695de52cfd6`), draw `9a40be8a0b5ca816`, 128 commands, **123 drawn / 5 deferred
(text)**, boot about 0.45 s, all seven conformance vectors exact.

**Historical browser result (pre-E-02):** The recorded previous demo state hash and the later E-02 baseline `91172695de52cfd6` / `9a40be8a0b5ca816` are historical. See `golden/regression/closing.json` for current values. The lane result and merge checks below are not a post-E-02 run.

## Gates at the merge

`pnpm typecheck` (including the page's own project), `pnpm lint`, `pnpm provenance` (755 files, 0), `pnpm licence`,
`pnpm graph` (no violations, 2683 dependencies), `pnpm fixtures:test` (99), `pnpm no-skips:test` (12), `pnpm
test:strict` (2506/2506, none skipped), `pnpm closing` (8/8), `pnpm browser:test` (3 passed), `node tools/no-skips/run.mjs
--verify-groups` (ten groups, 195 files). CI green on every check of run 41248756087, including the new `unit
(runner-web)` shard and the coverage `gate`.

No golden, state hash, draw hash or snapshot moved.

## Close-out record

Merged in PR #977 (merge commit `892fff188`, 2026-10-31). Honest caveat on the
verify text: its literal demo tick-120 hash was the current baseline when this
landed but is retired; the committed baseline is the `demo` game's `board`
frame at tick 120 in `golden/regression/closing.json`, and the browser lane
reads that committed baseline at test time, so the equality check kept its
force (satisfied, not fossilised). The
lane is a required `gate` dependency and the VP9+Opus / no-WebAssembly probes
run in the committed `tracer.spec.ts`. Ledger entry reconciled to closed issue
#928 in the 2026-11-03 ticket audit.
