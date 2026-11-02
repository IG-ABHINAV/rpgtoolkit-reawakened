---
title: 'surfacePixels screen read mutates hashed surface state'
type: 'bug'
ticket: '41'
status: 'in-review'
tracker_id: '#1048'
risk: 'high'
---

# Plan

**Approved ruling (owner: Jensen, 2026-11-02).** The combined rule replaces the earlier owner-decision-required wording:

1. The presented screen is a derived presentation cache, excluded from the state hash and rebuilt deterministically on restore before any script read.
2. Host `surfacePixels(id, rev)` is observationally read-only: it returns the requested stored revision or `null` and cannot mutate `GameState`, revisions, the state hash, saves or future diagnostics, whatever the polling or cache-flush cadence.
3. Any refresh for script-visible `getpixel`, `canvasgetscreen` or `savescreen` is a deterministic core operation separate from host reads.

Jensen's principle: “Drawing to the surfaces shouldn't cause a hash change. The only reason the hash should change is if the application store changed, e.g. rpgcode surface plus some of the game-loop globals needed to store coordinates.”

The owner clarified that script-owned canvases (`cnvX`) are application store, like script variables and globals, and stay hashed; a draw that changes a canvas legitimately changes the hash. Game-loop globals needed to store coordinates are hashed too. Drawing to, reading or refreshing the derived presented screen, and any host `surfacePixels` poll, are hash-neutral.

Implemented by the pull request that fixes #1048 (in review); #1047 is merged. The screen is rebuilt at the end of `advance`, before a script's screen read and on restore; scripts draw to a persistent script-screen layer (reserved id `-1`) composited into surface 0, and `hashGameState` omits `surfaces.entries["0"]` and `["-1"]`. Follow [the runner contract](../../../docs/spec/engine/runners.md#surface-read-and-state-hash) and [the hash projection](../../../docs/spec/formats/save-game.md#state-hash-surface-projection). Compare no reads, repeated reads, cache-flush reads and stale revisions for identical per-tick hashes, saves, revisions and future diagnostics; verify the requested stored revision or `null`, restore before script reads, script-visible capture behavior, a store-changing `cnvX` draw changing the hash, and presented-screen drawing, refresh, reads and host polling leaving it unchanged.
