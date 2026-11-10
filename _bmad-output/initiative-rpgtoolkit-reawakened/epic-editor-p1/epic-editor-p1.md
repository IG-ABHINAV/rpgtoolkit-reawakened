---
type: epic
title: "P1 editor tools"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-16"]
assignee: ""
risk: low
tracker_id: "#1359"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1359"
---

# P1 editor tools

## Description

Tile editor, tile grabber, tileset editor, enemy, special move, status effect and battle background editors, lighting and shading, the auto-tiler, undo and clipboard, export image and legacy upgrade wizards.

## Outcome

Authors get the full legacy toolset beyond P0; the CAP-16 success check is the signal.

## Done when

1. Each P1 tool opens, edits and saves its legacy format and the result loads in the runner and re-opens unchanged.
2. The auto-tiler picks tiles from the 8-neighbour rules and matches the variant order of community sample sets.
3. Export image writes the current view or the whole board without editor overlays.
4. The coordinate and legacy-board upgrades of T-30 and T-31 run in the editor with correct object movement.

## Boundaries

P1 tools of editor-features section 11. Not P0 or P2.

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- reference - docs/editor-features.md, sections 4, 6, 7, 11

## Notes

- Audit (2026-10-31): this envelope has no `tickets.toml` breakdown, so it has no `tracker_id` and no GitHub parent issue, contrary to the initiative's mirror rule. Recorded, not fixed: a parent issue needs a real breakdown, and inventing entries to satisfy the rule was rejected. Filed as issue #882; `epic-editor-foundation` is the one to break down first because Epic 22's 22.9 waits on its seams. See `DISCOVERY-envelope-audit.md`.


- Open question: the auto-tiler variant ordering must be rebuilt from sample sets under G7; which sample sets? Entries wait on that answer.
- Decision: epic set approved by the user, 2026-10-10.
- Waits on editor-assets-p0 because: the board editor and shared tileset browser.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.
- Handoff (owner direction, 2026-11-09): the proposed tile, asset and board architecture is [research flow 11](../research-editor-ux-for-beginners/flows/11-tile-asset-and-board-architecture.md). For this epic it proposes unifying T-25 and T-36 to T-38 into a Tile & Iso Studio backed by a DOM-free Tile Forge in `editor-model` (sheet slicer, kitbash stack, flat → iso projection reusing `isoSourceOffset`, three-face iso blocks, tall-iso decomposition, Tilesetter-style 47-variant autotile generator), plus isometric and image-mask boundary tracing, and the `.tkrtile` / `.tkrpack` YAML formats (schema page in `docs/spec/` first, per G7). Settle at inception; not yet part of the Done-when list.
