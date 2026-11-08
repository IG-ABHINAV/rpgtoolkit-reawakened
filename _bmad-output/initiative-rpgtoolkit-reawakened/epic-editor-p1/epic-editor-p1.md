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

- Decision (2026-11-08): incept all editor epics; entry 2's art reuse evidence and approval precede entry 1, the real `.tst` edit/save/reopen/board-use tracer, not a browser or a new document model.
- Source conflict: the 2026-10-31 audit above is historical; this envelope now has parent #1359 and this breakdown, but its child issue mirroring is a separate publication step.
- Source conflict: section 11's P1 list omits T-39 although section 4 and research F-05 explicitly inventory animated tiles; entry 6 owns `.tan` editing and consumes the one 12.2 browser.
- Source conflict: T-42–44 and T-46 are not assigned a priority in section 11; CAP-14 and 10.5/10.7 own language rewrites and formatting, while entry 16 owns the P1 editor-facing review/apply workflows, including project-wide upgrade and cleanup, without a second formatter or syntax engine.
- Source conflict: T-73's 2.x project-layout upgrade is listed in the feature inventory but the initiative spec explicitly makes it a non-priority non-goal; no implementation is assigned without a future owner scope decision, and unpublished entry 17 is retired. T-71 is not a distinct compiler tool; P0 packaging owns the distribution package.
- Source conflict: AD-18's same-version preservation and the Done-when legacy save obligation cannot be met by assuming every reader has a matching writer; enemy's minor-0 text reader and binary-only `writeEnemy` are a concrete example (`packages/core/src/formats/actor/enemy.ts`); each affected entry must prove or implement same-version writing from the normative format spec, or obtain a docs-first owner ruling before changing format, never silently upgrade.
- Requirement map to CAP-16: T-36 → 1–3; T-37 → 4; T-38 → 5; T-39 → 6; T-25 → 7–8; T-56 → 9; T-57/58 → 10; T-63 → 11; T-23/26 lighting and shading → 12; T-28 expanded clipboard → 13 (basic board undo belongs to 12.1); T-32 → 14; T-30/31 → 15; T-42–44/46 editor presentation → 16 (transform providers 10.5/10.7); integrated acceptance → 19.
- External dependencies: 11.1–11.4 supply shared contracts, lifecycle and linked visits; 11.7 supplies text integration; 12.1 board tracer, 12.2 the one contextual browser, 12.3 board properties, 12.11 board object modes and inspector, and 12.4 shared sprite editing; 10.5 and 10.7 are existing language-tool provider entries. Each leaf names the actual provider it needs; parent must declare the cross-epic edges.
- Art-tool reuse remains an evidence-gated choice, not a selected dependency: entry 2 compares suitable maintained candidates and an in-house route for license/transitives G6, host/keyboard/offline support, document/undo integration and required pixel operations before any new dependency is installed; if no candidate qualifies, implement in-house.
- Auto-tiler ordering is not established by the generic blob rule: entry 7 must obtain and document rights-cleared community samples and independently verify indexed variants, recording provenance and ambiguous cases before entry 8 may implement a mapping; absence of adequate evidence blocks parity, never invent an order or read GPL source.
- Shared registration and integration is owned by entry 1; art, board and database stories modify their own feature modules, with ordering inside each lane and adapter/registry changes routed through the initial stable registration contract; none creates a second browser. No synchronised multi-cell animation channel, cross-document atomic undo, plugin UI or hot reload is assumed.
