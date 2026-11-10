---
type: epic
title: "P0 asset editors: board, character, item, animation, tile bitmap, packaging"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-15"]
assignee: ""
risk: medium
tracker_id: "#1358"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1358"
---

# P0 asset editors: board, character, item, animation, tile bitmap, packaging

## Description

The board editor (tiles, layers, vectors, programs, sprites, images, properties), character, item, animation and tile bitmap editors, and packaging let an author build a complete game inside either host.

## Outcome

A person can author a game from scratch; the CAP-15 success check, such a game loading and playing in the web runner from either host, is the signal.

## Done when

1. A new game is created, edited with every P0 editor and played in the web runner, from the VS Code host and from the PWA.
2. The board editor covers all object modes, tools, undo and the coordinate-system aware snapping of T-20 to T-35 that P0 names.
3. Each editor reads and writes its legacy format so unchanged data round-trips.
4. Packaging produces a single-file game that loads in the web runner.

## Boundaries

P0 tools of editor-features section 11 only. P1 tools (epic editor-p1) and P2 tools (epic editor-p2) are excluded.

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- reference - docs/editor-features.md, sections 3, 6, 7, 8 and 11
- spine - _bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-18, AD-19, AD-29
- constraint - docs/guardrails.md, section G2

## Notes

- Audit (2026-10-31): this envelope has no `tickets.toml` breakdown, so it has no `tracker_id` and no GitHub parent issue, contrary to the initiative's mirror rule. Recorded, not fixed: a parent issue needs a real breakdown, and inventing entries to satisfy the rule was rejected. Filed as issue #882; `epic-editor-foundation` is the one to break down first because Epic 22's 22.9 waits on its seams. See `DISCOVERY-envelope-audit.md`.


- Open question: where P0 draws the line inside T-20 to T-35 (editor-features names priority per tool, not per feature); settle at inception.
- Decision: epic set approved by the user, 2026-10-10.
- Waits on editor-foundation because: editor-ui and both hosts.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.
- Decision: Jensen, 2026-10-15: `docs/spec/` replaces `docs/format-spec.md` and `docs/engine-features.md` as the normative spec (ADR 0007, entry 1.13); the owner attests it is clean (extraction-log round 4).
- Evidence (R-60): docs/spec/formats/legacy/conversion.md specifies what the original editor generated when it converted legacy sprites (the `.tbm`/`.anm` names, sizes, delays and transparent white) and the Toolkit 2 folder-upgrade wizard: inputs for T-31 and the packaging tool. The editor writes `.gph` numbers the VB6 way (" 2 ").
- Handoff (owner direction, 2026-11-09): the proposed tile, asset and board architecture is [research flow 11](../research-editor-ux-for-beginners/flows/11-tile-asset-and-board-architecture.md). For this epic it proposes the unified Asset & Tileset Viewer (T-02, T-24), one-gesture `PlaceSceneAsset` that lowers a pack asset to layer images or tiles plus translated solid/under vectors, image-first boards and bake, and 2D boundary intelligence (click floor → wall the rest, walkable/solid brush, trace from tile roles). All of it lowers to records `core` already loads; no runtime change. Settle at inception; not yet part of the Done-when list.

- Reconciliation (2026-11-08): the 2026-10-31 audit above is historical; this epic now has parent #1358 and this inception supplies its breakdown, not evidence that any story is implemented.
- Source conflict: §11 puts undo/clipboard in P1 but T-28 and this envelope require board undo for P0. Basic multi-level undo/redo of P0 board edits is in 12.10–12.11; expanded clipboard operations and select-all belong to Epic 13. P1 also owns shading/lighting modes, autotile, image export and coordinate/legacy upgrade; P0 retains bitmap cell shading (T-62), ordinary ambient properties and the remaining board modes.
- Source conflict: Done when 1 names only VS Code and PWA, whereas CAP-15 says each editor host. The closing suite proves both named hosts here; the separate Epic 15 desktop host must run the same conformance and applicable creator proof once its adapters exist, not be misrepresented as already validated.
- Source conflict: Done when 3 cannot be assumed from a reader/writer existing; AD-18 requires same-version preservation and residue, so each editing story checks its actual supported formats and versions and blocks on a docs-first format/provider fix instead of silently upgrading or dropping data.
- T-ID mapping (CAP-15): 12.1 T-21/T-23/AD-29 tracer; 12.2 T-02/T-24; 12.3 T-27/T-29; 12.4 T-52; 12.5 T-50/T-51/T-53/T-54; 12.6 T-55; 12.7 T-60/T-61; 12.8 T-62; 12.9 T-70/T-71/T-74; 12.10 T-20–T-24/T-28/T-33; 12.11 T-23/T-26/T-28/T-34/T-35; 12.12 connected visits, T-05/T-07; 12.13 cleanup; 12.14 CAP-15 integrated success.
- Packaging is a TPK-compatible ZIP and separate install descriptor, not an EXE; 9.7 provides the existing package path, not the editor workflow. Setup ZIP is Epic 14; choosing an export path cannot imply a host has native installation or signing. Test-only fixtures/helpers must be excluded by an explicit auditable policy.
- Contract dependencies: 11.1 owns multi-file wizard recovery and package exclusion/destination decisions; the board and actor APIs retain version and residue, so representative edited round trips and compositor use are implementation checks, not generic owner-decision blockers.
- Connected authoring means one model per URI and synchronized authored views, not hot reload of a running game; local placement and shared definition remain distinct, unavailable uniqueness and untraceable dynamic references are disclosed.
