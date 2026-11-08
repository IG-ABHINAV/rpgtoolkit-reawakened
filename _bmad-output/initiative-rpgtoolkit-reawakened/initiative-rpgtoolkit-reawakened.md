---
type: initiative
title: "RPG Toolkit 3 plays and is authored again, clean-room and MIT/Apache"
parent: none
covers: ["CAP-1", "CAP-2", "CAP-3", "CAP-4", "CAP-5", "CAP-6", "CAP-7", "CAP-8", "CAP-9", "CAP-10", "CAP-11", "CAP-12", "CAP-13", "CAP-14", "CAP-15", "CAP-16", "CAP-17", "CAP-18", "CAP-19"]
assignee: ""
risk: high
---

# RPG Toolkit 3 plays and is authored again, clean-room and MIT/Apache

## Description

A clean-room TypeScript rebuild of the RPG Toolkit 3 engine and authoring tools that reads legacy projects and runs on modern platforms. The spec owns the capabilities, constraints and non-goals; this initiative delivers them.

## Outcome

Legacy authors, modders and players keep their games and tools on browser, desktop, mobile and VS Code; the spec's success signal, the sample games playing end to end headlessly and in the browser and a game authored in both editor hosts, is the signal.

## Done when

1. The headless runner plays the `demo` and `Basic` sample games from recorded input with stable golden images and replay hashes.
2. The same games play in the web runner, and a packaged single-file game loads.
3. A game created from scratch in the VS Code host and in the PWA opens and plays identically.
4. CI blocks any merge that breaks a guard-rail G1 to G7, and no shipped dependency is outside the licence allowlist.
5. Every capability CAP-1 to CAP-19 is delivered, and each open question in the spec has an answer.

## Boundaries

The boundary is capability and ownership: the pure core and engine rules, the runners, the language tooling, and the editor with its hosts. Not the legacy engine or editor source, native plugins, or the spec's other non-goals. Tracer path: one sample board fetched, parsed, drawn into a draw list and replayed to a golden PNG (epics platform-baseline, legacy-formats, board-rendering).

- Touch point: SpessaSynth, FluidR3_GM, Monaco (standalone/browser code editor; [ADR 0021](../../docs/adr/0021-monaco-code-editor.md)), Capacitor, VS Code APIs - consumed; owner: epics audio-synth, editor-foundation, web-runner-packaging
- Touch point: legacy sample games - fetched at CI time as fixtures, never committed; owner: epic platform-baseline
- Touch point: the documentation site generator, hosting and domain - none chosen yet (inception proposal D-3, D-4); owner: epic documentation-website

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- constraint - docs/guardrails.md, sections G1 to G7
- constraint - docs/adr/0001-typescript-core.md, section Decision
- reference - docs/architecture-options.md, sections 8 and 9
- reference - CLAUDE.md, section Non-negotiable

## Notes

- Decision: epic set of 15 approved, 2026-10-10; engine and editor stay in one initiative.
- Decision: the contracts that several epics adopt (draw-list, audio-cue and request schema; VM state and built-in registration API; asset-resolver API; platform-services interface) are settled by a `bmad-architecture` spine, 2026-10-10. Epics cite its sections once it exists.
- Assumption: CAP-5's "every built-in resolves" is met across epics: each domain epic registers its built-ins and epic rpgcode-tooling asserts the whole catalogue. Confirm.
- Assumption: CAP-12, CAP-15 and CAP-18 are shared across epics: CAP-12's headless runner skeleton is in platform-baseline and the rest in web-runner-packaging; CAP-15 splits between editor-foundation and editor-assets-p0; CAP-18 between editor-foundation and desktop-shell. Confirm.
- Open question: the spec's open questions (desktop shell, legacy `.sav`, text-era formats and compiled `.prg`, AVI video, plugin replacement API, auto-tiler sample sets) gate the entries named in each epic's Notes.
- Waits on nothing: platform-baseline opens the order.
- Decision: Jensen, 2026-10-15: `docs/spec/` replaces `docs/format-spec.md` and `docs/engine-features.md` as the normative spec (ADR 0007, entry 1.13); the owner attests it is clean (extraction-log round 4).
- Decision: 2026-10-15: the reconciliation of docs/spec with the specs, epics and code is discovery/docs-spec-reconciliation.md; its changes went to the owning epics (entries 1.13, 1.14, 2.23–2.26, 16.13, 3.27, 3.28, and Notes on epics 4–9, 11 and 12).
- Evidence: docs/spec answers several of the spec's open questions in facts (legacy `.sav`, text-era formats, compiled `.prg`); what remains for those is scope, not layout.
- Decision: 2026-10-17 (draft, owner to confirm): a new epic 17, `epic-documentation-website`, covers a new capability CAP-19 (user and contributor documentation and a public website, verified against the built product). It is a new capability, not an extension of CAP-12, whose packaging scope is the product's single-file game. It stands last in build order and waits on the implementation, editor and runner epics. Discovery: epic-documentation-website/discovery/inception-proposal.md and docs-readiness.md. The envelope is drafted; the epic has no `tickets.toml` yet, like epics 5 to 15 awaiting their own inception.
- Assumption: CAP-19 is owned by epic 17 alone; the product's release process (npm publish, PWA deploy, extension publish, signing, store accounts) is named in the architecture spine as "release epics, owners named at their inception" and no epic of this initiative owns it. Epic 17 documents what ships; it does not own publishing the product. Owner decision D-13 of the inception proposal. Confirm.
- Decision: Jensen, 2026-10-19: 3.1 is a compatibility layer, not the model. The core is built on objects and forward design; legacy 3.1 names, commands and data shapes are aliases/adapters onto it. Our under-the-hood workings and forward design are not bounded by the 3.1 model. Consistent with ADR 0005 (independent product). 19.1 writes this into docs/adr/0009-compatibility-layer-not-the-model.md and the CLAUDE.md working notes.

- Decision: owner requested the independent RPGCode grammar implementation epic on 2026-10-24 after ADR 0011 (#623). Epic 22 (#624) contributes syntax/navigation to CAP-14/CAP-15/CAP-18, with eleven backlog tasks; only 22.9 waits for Epic 11. Games and existing language/editor foundations gain no reverse dependency.
