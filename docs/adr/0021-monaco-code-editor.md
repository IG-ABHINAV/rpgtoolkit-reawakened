# ADR 0021 — Monaco for standalone and browser code editing

- **Status:** Accepted (owner ruling, 2026-11-08); integration not yet claimed complete.
- **Amends:** the CodeMirror choice in the architecture stack, editor-foundation envelope, package map and architecture-options editor guidance. Does not change G1–G7 or ADR 0013's Electron decision.

## Context

Jensen chose Monaco directly: “I would say we chose monaco right off the bat. especially if we care at all considering vs code and another editing plane for the future.” The previous architecture named CodeMirror 6; the recent UX proposal mistakenly continued to frame Monaco as an unresolved comparison. This ruling closes that choice.

The goal is a familiar code-editing experience alongside the shared visual editors, with VS Code as one host and standalone/browser workspaces as others. Similar editing surfaces do not imply identical host APIs or complete VS Code workbench compatibility.

## Decision

1. **Monaco Editor is the selected embedded code editor for Reawakened's standalone desktop and browser editor surfaces.** CodeMirror 6 is superseded as the planned component; inception does not rerun that selection contest.
2. **VS Code uses its native text editors** for RPGCode, with language integration. Do not embed another Monaco workbench inside VS Code merely to reproduce the same text view. Shared visual editors continue to use the established host adapters and custom-editor surfaces.
3. Language semantics, diagnostics, formatting, document identity, save/undo coordination and test-run meaning remain shared contracts. Monaco is a view/client, not a second parser, authoritative document store or test runner. The applicable editor-model/platform-services ownership rules remain binding.
4. Select and pin a supported Monaco version, verify its shipped dependency/assets licence inventory under G6, configure local workers and CSP/offline loading, and prove language/document lifecycle integration during implementation. These are integration obligations, not a reopened library choice. No package is installed or runtime migration asserted by this ADR.
5. Dock Spawn remains a candidate. This decision selects no docking library, new plugin trust model, settings-storage format or arbitrary code/visual round-trip.

## Consequences and boundaries

- Standalone/browser code editing can follow the familiar VS Code editing model while the surrounding UI remains a game maker, not a cloned IDE.
- Monaco does **not** supply VS Code's extension host, workbench, configuration service or complete LSP/debugger integration. Those remain deliberate host/service integrations. See [Monaco's upstream documentation](https://github.com/microsoft/monaco-editor).
- Do not promise byte-identical behaviour or identical shortcuts across native VS Code and embedded Monaco versions. Test relevant user-facing contracts explicitly.
- Future editor hosts reuse the shared editor and service boundaries where supported; selecting Monaco is not a claim of mobile-browser suitability or universal host support.
- Previous architectural reviews and version logs mentioning CodeMirror are historical evidence, not current selection instructions.

## Verification before implementation acceptance

Use a real RPGCode document in standalone/browser and native VS Code: edit, receive the same language diagnostics, navigate references, undo/redo, save/reopen, handle external changes and recover after view disposal. Exercise contextual test-run and located failure navigation. Check worker loading/CSP, offline operation, keyboard access, scaled text and host shortcut ownership. Demonstrate that multiple views do not create competing document/undo stores. No such runtime proof is claimed by this documentation-only decision.

## References

- [G2 host boundary](../guardrails.md#g2--hard-package-boundaries)
- [ADR 0001](0001-typescript-core.md)
- [ADR 0013](0013-desktop-shell-electron.md)
- [Architecture spine](../../_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md)
- [Editor design review](../../_bmad-output/initiative-rpgtoolkit-reawakened/ux-connected-editors/ux-connected-editors.md)
