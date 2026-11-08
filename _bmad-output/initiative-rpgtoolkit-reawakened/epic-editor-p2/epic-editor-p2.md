---
type: epic
title: "P2 editor tools for beginners"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-17"]
assignee: ""
risk: low
tracker_id: "#1360"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1360"
---

# P2 editor tools for beginners

## Description

The visual event builder, skin editor, audio preview, setup builder and tutorials.

## Outcome

First-time creators can build scripts and ship setups without writing code; the CAP-17 success check is the signal.

## Done when

1. The visual event builder emits RPGCode that runs and passes the LSP without errors.
2. The skin editor and audio preview open and save their assets.
3. The setup builder produces an installable bundle of a game.
4. A tutorial walks a new author through a first board in both hosts.

## Boundaries

P2 tools of editor-features section 11. Not the obsolete built-in web browser (T-81).

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- reference - docs/editor-features.md, T-45, T-64, T-72, T-80, section 11

## Notes

- Audit (2026-10-31): this envelope has no `tickets.toml` breakdown, so it has no `tracker_id` and no GitHub parent issue, contrary to the initiative's mirror rule. Recorded, not fixed: a parent issue needs a real breakdown, and inventing entries to satisfy the rule was rejected. Filed as issue #882; `epic-editor-foundation` is the one to break down first because Epic 22's 22.9 waits on its seams. See `DISCOVERY-envelope-audit.md`.


- Decision: epic set approved by the user, 2026-10-10.
- Waits on editor-assets-p0 because: the program editor and board editor.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.

- Decision (2026-11-08): Epic 14 also owns visual fixture and player-action-list authoring; 11.9 owns the executable fixture/action contract and code test integration, and neither requires the visual editor to run code tests.
- Source conflict: the 2026-10-31 audit above describes the historical empty envelope; this epic now has parent issue #1360 and this inception supplies its breakdown, without rewriting that dated record.
- Source conflict: Done when 2 says audio preview saves assets, while T-80 describes auditioning; the skin editor saves its skin, whereas audio audition must not imply an audio editor or mutate the source.
- T-ID coverage: T-45 → 14.1–14.3; T-64 → 14.4; T-80 → 14.5; T-72 → 14.1, 14.6; T-09 → 14.8; visual test authoring → 14.1, 14.7. CAP-17 spans all entries; 14.9–14.10 close the whole epic.
- The setup contract and code/visual representation require a docs-first owner ruling in 14.1, without reopening selected Monaco or Electron; unknown setup signing, targets and installer/uninstaller behavior must be ruled before the dependent implementation.
- The package/build provider is 12.9; the nine-step tutorial consumes 11.10 new-project creation, 12.10 board creation and 12.3 startup placement, and visual tests consume 11.9 rather than adding another engine or runner.
- Media-import handoff allocated: 14.11 rules the pending audio/video import contracts, licensing and host capability; 14.12 implements audio conversion, 14.13 video conversion and 14.14 connects project import and package export. This is separate from audition. No unapproved codec, dependency or silent deferral is implied.
