---
type: epic
title: "Standalone editor in a desktop shell"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-18"]
assignee: ""
risk: medium
tracker_id: "#1361"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1361"
---

# Standalone editor in a desktop shell

## Description

The desktop shell is **ruled** (epic web-runner-packaging, entry 9.1, D-1; text in that epic's ruling draft, and the
shell's ADR is 0013), so this epic does not re-run a three-way shell spike and does not choose an engine. It owns the
**editor application**: `host-desktop` as its **own package and its own application**, with its **own
`platform-services` instantiation**, the harness embedded for preview (the editor already runs the game it edits), its
chrome, and its **own signing, notarisation, updater and release cadence** — separate from the player's, because the two
audiences and their update churn differ. It **cites ADR 0013** and measures only what the ruling does not: how the
editor behaves in the ruled Electron shell — file I/O and watching, dialogs, file association and drag-and-drop of a
project onto the window — on macOS, Windows and Linux. It is not a mode of the player, and the player is not a stripped
editor.

## Outcome

Desktop users get the standalone editor with native file access; the CAP-18 success check for the desktop host is the signal.

## Done when

1. A written decision **cites ADR 0013** for the shell, states that the editor is its own application with its own update cadence rather than a mode of the player, and records the editor-specific measurements — platform-services file I/O and watch, dialogs, file association, drag-and-drop — from Windows, macOS and Linux.
2. `host-desktop` opens, edits and saves a project through platform-services.
3. The same `editor-ui` build runs in `host-desktop` with no host-specific editor features.

## Boundaries

The **editor application**: its own package (`host-desktop`), its own `platform-services` instantiation, the harness
embedded for preview, its chrome, and its own signing, notarisation, updater and release cadence. Not the shell choice,
which ADR 0013 rules and which epic web-runner-packaging's 9.1 records — this epic cites it and may not re-decide it —
and not the **player application**, which is epic web-runner-packaging's 9.10 and 9.11. Every feature lands in
`editor-ui` first.

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- reference - docs/adr/0001-typescript-core.md, decision 6
- reference - docs/architecture-options.md, section 4
- ruling - _bmad-output/initiative-rpgtoolkit-reawakened/epic-web-runner-packaging/story-rulings-the-runner-boundary-the-desktop-shell-image-storage-plan.md, D-1
- ruling - docs/adr/0013-desktop-shell-electron.md (lands with epic web-runner-packaging entry 9.1)
- architecture - _bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-18–22 and AD-29
- inventory - docs/editor-features.md, T-82
- design - _bmad-output/initiative-rpgtoolkit-reawakened/ux-connected-editors/EXPERIENCE.md and connected-authoring-and-tests.md

## Notes

- Audit (2026-10-31): this envelope has no `tickets.toml` breakdown, so it has no `tracker_id` and no GitHub parent issue, contrary to the initiative's mirror rule. Recorded, not fixed: a parent issue needs a real breakdown, and inventing entries to satisfy the rule was rejected. Filed as issue #882; `epic-editor-foundation` is the one to break down first because Epic 22's 22.9 waits on its seams. See `DISCOVERY-envelope-audit.md`.


- Decision: ADR 0001 defers the shell choice to a spike; the choice is reversible through platform-services. (Superseded 2026-10-31 by the decision below: the shell is ruled, not spiked.)
- Decision: epic set approved by the user, 2026-10-10.
- Decision (2026-10-31): the shell is ruled elsewhere. Epic web-runner-packaging's 9.1 records the owner's ruling that
  the harness is separate from the game bundle, that there are **two desktop applications from one codebase plus the
  PWA** — a player and an editor — and that both desktop applications use the same ruled Electron shell with `app://`
  and no service worker; this epic cites that ruling and **cannot overrule it by accident**. The split is this epic's
  reason to exist: the editor is its own package and application, with its own platform-services instantiation, the
  harness embedded for preview, and its own update cadence. A divergence found here is raised as a new ADR that
  supersedes 0013, not implemented as a second shell.
- Waits on editor-assets-p0 because: the editor application cannot be measured without a board editor to edit, which is
  now the only reason — the shell comparison it once waited on is ruled and is not re-run.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.

### Inception (2026-11-08)

- Decision: ADR 0013 already selects Electron; the first proof is a separate editor application opening, editing, saving and reopening a real `.gam` through the shared editor model and platform services, not a shell comparison. Desktop never owns a second editor feature or a player mode.
- Source conflict: CAP-18's older success text names VS Code and PWA but omits the desktop proof; this epic's Done when explicitly requires the same shared build in desktop. The spec package map and earlier ADR 0001 text describe a shell spike, superseded by ADR 0013; the historical audit above is retained, and #1361 now exists.
- Source conflict: the initiative's desktop prerequisite still says “board editor to spike against”; 12.1 is the board edit/save/render tracer for the desktop measurement, not a shell-selection spike. Parent integration must replace the stale epic prerequisite and declare the foundation dependency.
- Requirement map: CAP-18 governs all entries; T-82 maps specifically to 15.4 and platform proof 15.7, including explicit, user-initiated association. T-01/T-06/T-07/T-08/T-40 are shared editor behaviors supplied by Epic 11 and exercised through its interfaces, not new desktop implementations.
- Provider map: 11.1 shared contract ruling; 11.2 real `.gam` tracer; 11.3 document lifecycle/conformance; 11.4 workspace/navigation; 11.5 preferences; 11.7 Monaco and language service; 11.8 run boundaries; 11.9 creator test integration; 12.1 board tracer. These are planned providers, not claims of implementation.
- Sequencing: 15.1 is the first runnable tracer; stories 15.2–15.6 deliberately serialize host integration surfaces; 15.7 measures the resulting host against the board tracer on three actual platforms. Release credentials and real OS access are human-operated gates, not assumed to exist. 15.9 sweeps after all delivery stories; 15.10 independently exercises the whole integrated application.
- Open decisions: project-scoped OS filesystem authority, conflict/recovery details, file association packaging and updater channel/rollback policy require documented implementation decisions in the indicated stories, consistent with 11.1 and ADR 0013; no alternate shell is under consideration. Signed publication cannot be claimed without real credentials, platform access and verified distribution evidence.
