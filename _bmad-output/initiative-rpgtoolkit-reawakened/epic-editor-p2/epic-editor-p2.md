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
