---
title: 'Document how to run the desktop player'
type: 'feature'
ticket: '15'
created: '2026-11-01'
status: 'done'
baseline_revision: 'd4e2d29f27100c4c67f6fdb0d27edff14b565785'
route: 'oneshot'
route_source: 'auto'
risk: 'low'
tracker_id: '#1013'
context: []
---

# Document how to run the desktop player

Documents the real, runnable behaviour of the landed desktop player (`runner-desktop`, entry 11). It changes no
`docs/spec/` semantics — this is documentation of what already works, written from commands actually run.

## Files touched

- `docs/playing-the-desktop-player.md` — **new**. User-facing page: what the desktop player is, what it needs, the exact
  build-and-launch commands with the expected output of each, honest OS notes, and a plain statement that the board is
  currently measured off-screen and that interactive play (the live player page, web-runner-packaging entry 16 / #1018) is not landed.
- `CONTRIBUTING.md` — add the developer fragment "Run the desktop player" under Commands, and correct the stale
  "Where things are" table and the "web runner … do not exist" sentence to name `render-webgl2`, `runner-web` and
  `runner-desktop`.
- `_bmad-output/initiative-rpgtoolkit-reawakened/epic-web-runner-packaging/tickets.toml` — entry 15 with
  `tracker_id = "#1013"`.

## Steps verified on a clean worktree

Run from `origin/main` (`d4e2d29f`) with no build cache: `pnpm install --frozen-lockfile`, `pnpm build`,
`pnpm fixtures:fetch`, `pnpm make-package fixtures/legacy/demo --closing-plan golden/closing/plan.json --game demo
--out fixtures/packages/demo.tpk --title Demo`, `pnpm desktop:build`, `pnpm desktop:measure`.

Observed results (macOS arm64, pre-E-02): `pnpm desktop:measure` printed `"error": null`, `"tick": 120`,
state hash `bff947dce3a11b4f`, draw hash `9a40be8a0b5ca816`,
`"frame": { "worst": 0 }`. A manual `electron packages/runner-desktop/dist --serve . --package … --page …`
left a window open with its title set to `bff947dce3a11b4f` (no post-E-02 launch is recorded), no
load/preload/renderer error, and the board drawn off-screen (no canvas is attached to the document in
`app/player.ts`).
**Historical measurement note:** These macOS results and the visible-window title were recorded before E-02. The later E-02 baseline was `91172695de52cfd6` / `9a40be8a0b5ca816`; both values are now historical. See `golden/regression/closing.json` for the current demo closing baseline. This plan records no post-E-02 desktop measurement or launch.



Two friction points documented, not hidden: on a fresh checkout the first `desktop:measure` can fail with
`ENOENT …/Electron` while Electron's runtime is still downloading after `pnpm install`; and the node on this machine
(26.13.0) differs from the pinned 24.21.0 in `.node-version`.

## Acceptance

- [x] At this ticket's original completion, both docs described commands and outputs actually observed in the pre-E-02 clean-worktree transcript. The later E-02 update preserves that transcript as history, points to the current closing baseline, and states that no post-E-02 desktop measurement or launch is recorded.
- [x] Both docs state plainly that the board is measured off-screen and interactive play is not landed (web-runner-packaging
      entry 16 / #1018), and that mobile/Android is out of scope.
- [x] No `docs/spec/` file is modified.
- [x] `pnpm lint` and `pnpm provenance` pass (docs-only change).

## Verification

- `pnpm lint` -- expected: clean.
- `pnpm provenance` -- expected: clean (docs-only, no new dependencies).
