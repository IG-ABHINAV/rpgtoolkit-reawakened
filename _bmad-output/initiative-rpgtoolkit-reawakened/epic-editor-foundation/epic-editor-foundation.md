---
type: epic
title: "Editor foundation: editor-ui, platform-services and two hosts"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-15", "CAP-18"]
assignee: ""
risk: high
tracker_id: "#1357"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1357"
---

# Editor foundation: editor-ui, platform-services and two hosts

## Description

`editor-model` holds documents and command stacks, `editor-ui` hosts panels, the platform-services interface abstracts file access, test-run and export, and `host-vscode` and `host-web` run the same UI. The workspace, file tree, main-file editor and program editor with test-run work in both hosts.

## Outcome

Authors can open a legacy project in VS Code or in the browser and edit its settings and scripts; the CAP-15 and CAP-18 success checks, the same editor-ui opening and saving in both, are the signal.

## Done when

1. The same `editor-ui` build opens and saves a project through platform-services in VS Code (including a `vscode.dev` build) and in the PWA.
2. The workspace, file tree, folder-aware pickers with copy-in, and unsaved-change tracking work in both hosts.
3. The main-file editor reads and writes `.gam` so the result loads in the runner.
4. The program editor edits a program with the LSP and test-runs it against test fixtures in both hosts.
5. The dependency-graph check proves `editor-ui` imports no `host-*` package and neither host imports the other, and one host-conformance suite (undo by `editId`, save, revert, backup, external change) passes against both hosts.

## Boundaries

`editor-model`, `editor-ui` shell, `host-vscode`, `host-web`, platform-services (incl. `language.connect`), T-01 to T-14 and T-40 to T-41. Not asset editors (epic editor-assets-p0) and not the desktop shell (epic desktop-shell). Every feature lands in `editor-ui` first.

- Touch point: VS Code APIs, Monaco (standalone/browser code editor; [ADR 0021](../../../docs/adr/0021-monaco-code-editor.md)), File System Access API - consumed; owner: this epic

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- spine - _bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-19, AD-20, AD-21, AD-22
- constraint - docs/guardrails.md, section G2
- reference - docs/editor-features.md, T-01 to T-14, T-40, T-41
- reference - docs/architecture-options.md, sections 4 and 8

## Notes

- Audit (2026-10-31): this envelope has no `tickets.toml` breakdown, so it has no `tracker_id` and no GitHub parent issue, contrary to the initiative's mirror rule. Recorded, not fixed: a parent issue needs a real breakdown, and inventing entries to satisfy the rule was rejected. Filed as issue #882; `epic-editor-foundation` is the one to break down first because Epic 22's 22.9 waits on its seams. See `DISCOVERY-envelope-audit.md`.


- Open question: the platform-services interface surface; settled by the architecture spine.
- Assumption: epic editor-foundation owns CAP-18 until the desktop shell epic adds `host-desktop`. Confirm.
- Decision: epic set approved by the user, 2026-10-10.
- Waits on legacy-formats because: format readers.
- Waits on web-runner-packaging because: runner-web for preview and test-run.
- Waits on rpgcode-tooling because: the program editor's language tooling.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.
- Decision: Jensen, 2026-10-15: `docs/spec/` replaces `docs/format-spec.md` and `docs/engine-features.md` as the normative spec (ADR 0007, entry 1.13); the owner attests it is clean (extraction-log round 4). `docs/editor-features.md` (T-xx) is not replaced.
- Evidence (R-60): docs/spec/formats/rpgcode-program.md describes the editor's test run (`Prg\sys_test.prg` with its settings prefix, the engine run as `<main file> sys_test.prg`), and packaging-and-paths.md the new-project defaults; inputs for the test-run and new-project features.
- Handoff (from epic audio-synth exploration, 2026-10-18; detail in `epic-audio-synth/discovery/audio-exploration.md` §4, §6 and §7):
  - Historical handoff: the legacy `.gam` had no default-SoundFont field. Superseded by the TKR audio-settings extension (`docs/spec/formats/main-file.md#tkr-audio-settings-extension`); 11.6 edits its existing `audioSettings.defaultSoundFont` field.
  - Test-run should report loading stalls with the asset that caused them, and warn on asset references the prefetch planner cannot predict (e.g. `send(boardVar$)`).
  - Audio preview in editors plays through the `synth` package with the project's SoundFont.
  - Packaging bundles the authored SoundFont, warns on unclear bank licences, and never redistributes the legacy MIDI pack.

- Handoff (owner request, 2026-10-24): Epic 22 (#624, `epic-rpgcode-grammar`) task 22.9 consumes this epic's shared document, program-editor and platform-services seams for highlighting/outlines. It waits for those foundations; this epic does not wait for Epic 22. Grammar absence must leave text editing and test-run usable.

- Inception (2026-11-08): the owner authorized breaking down all five existing editor epics and publishing after validation; the individual unresolved contracts in 11.1 still require owner rulings. See `discovery/inception-proposal.md` and the backlog entries, not this historical note, for the provider map and trace.
- Source conflict: the 2026-10-31 audit above predates this envelope's existing parent #1357; retain it as historical evidence, not a current claim that no parent exists.
- Source conflict: the earlier broad wait on `rpgcode-tooling` means the specific LSP and test providers 10.1, 10.5, 10.8 and 10.9 where needed, not Epic 22; entry 22.9 depends on this epic, never the reverse.
- Source conflict: earlier research may name CodeMirror or compare shell choices; ADR 0021 selects Monaco for standalone/browser and native VS Code text remains native, ADR 0013 selects Electron, and Dock Spawn is only a candidate pending 11.1.
- Provider gap: 10.8 is partially implemented and its plan records F-A/F-D/F-E/F-G and PKG-7; `script-spec` project discovery uses Node file APIs and does not establish the browser or semantic gameplay-action API. Entry 11.1 rules the new contracts and 11.9 owns the host-neutral adapter and real engine test/action provider, without inventing a second runner. Publish 11.9 as the explicit missing gameplay-provider issue and keep 10.8's gaps with its own provider.
- Coverage: T-01=11.2/3/4; T-02=11.4 plus 12.2 and P0 board inspector; T-03=11.4 plus 12.2 board-brush action; T-04=11.10; T-05=11.4/10; T-06=11.3; T-07=11.8; T-08=11.5; T-09=11.11 plus Epic 14 tutorial and tip presentation; T-10–14=11.6; T-40=11.7/11; T-41=11.8/9. CAP-15 and CAP-18 are carried by all foundation entries; the end-to-end suite checks the foundation-owned portions, not other epics' unfinished work.
- Coordination: 11.3 owns integration registry and conformance infrastructure; later stories contribute through isolated registrations, and any unavoidable central registration edits must be serialized by the integration owner. Code tests do not depend on the visual fixture builder.
- Decision: Jensen, 2026-11-09, answering ADR 0022 question 3: `editor-ui` uses Preact with TSX ("good tsx files here we come. lets go prereact"); he was partial to Vue but it need not be Vue, and he said he would go Vue if Vite were available. Recorded in [ADR 0025](../../../docs/adr/0025-editor-ui-framework-preact-tsx.md) with the spike's evidence in [docs/findings/editor-ui-framework](../../../docs/findings/editor-ui-framework/README.md). `preact` is the one dependency; docking (ADR 0022 D7.3), a router, a state library and Monaco's `style-src` need are not decided there. Entry 11.2 starts by adding `preact` with its `THIRD_PARTY_NOTICES` entry, the JSX settings, and a check that no bundle contains `eval(` or `new Function`.
- Decision: Jensen, 2026-11-09: legacy formats (`.gam`, `.brd`, `.tem`, `.anm`, `.itm`, `.ene`, `.prg`) stay first-class editable for the first release. Native YAML documents (epic 27, ADR 0023) are deferred. See the ADR 0005 amendment dated 2026-11-09.
- Decision: Jensen, 2026-11-09, on all ten remaining ADR 0022 questions ("yes all of that sounds great"): [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md) is **Accepted**, and the TOOL-5 creator-test rule is accepted with it. The answers, each with its reason, are in the ADR's "Owner decisions, 2026-11-09"; the two decisions that still owe a measurement are the retention numbers (11.14) and the VS Code autosave proof (11.3). Entry 11.1 stays open until the owner has read the approved text.
- Decision (allocation, same approval): history and checkpoint groups are **11.14** ([#1828](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1828)), and the standalone Git surface is **11.15** ([#1829](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1829)). 11.14 is on this epic's closing path, so 11.12 and 11.13 wait for it; 11.15 is not, and neither waits for it. The envelope's Done-when is unchanged and says nothing about history, so the closing-path choice is flagged for the owner rather than treated as implied by the envelope.
- Open dependency: ADR 0022 D9/TOOL-5 does not settle entry 10.8's matcher ruling "F-A" (a closed, test-only set of native commands beside `specResult`); 11.9 inherits it, and 10.8 stays `blocked` until the owner rules.
- Decision: Jensen, 2026-11-10: he has read the merged [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md) (PR #1830) and approved its wording. Entry 11.1 ([#1699](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1699)) is closed and its plan is marked `done`; this ends the "stays open until the owner has read the approved text" line above.
- Decision: Jensen, 2026-11-10: story 11.2 ([#1700](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1700)) is split because one session cannot hold the toolchain, the model and view, two host adapters and the vscode.dev proof. The slices, in build order: **11.16** ([#1831](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1831)) the Preact and TSX toolchain with no product code, after 11.1; **11.17** ([#1832](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1832)) the `platform-services` interface, `editor-model` and `editor-ui` over an in-memory double, after 11.16 and 2.9; **11.18** ([#1833](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1833)) the `host-web` and `host-vscode` adapters, a shared behaviour test run against both, a fetched-corpus `.gam` round trip, the headless runner loading the saved bytes and a vscode.dev proof, after 11.17. 11.2 stays as the closing story with its acceptance unchanged and now waits on 11.16, 11.17, 11.18 and 2.9 (11.1 is reached through 11.16). The same ruling set: the `platform-services` interface is **its own package**; the tracer field is the **game title** (`gameTitle`); the vscode.dev proof uses **`@vscode/test-web`** (MIT, dev-only; it needs its `THIRD_PARTY_NOTICES` line and a licence check). The Coverage line above still holds: T-01 is 11.2/3/4, and under 11.2 it is delivered by 11.17 and 11.18.
- Decision (planner's allocation, flagged for the owner, 2026-11-10): ADR 0025's follow-up list and decisions 2, 8 and 9 say "11.2 does this first". Read them as 11.16 for the toolchain, except the strict-CSP probe, which needs a mounted view and so goes to 11.18. The owner's list for 11.18 did not name the probe; striking it from 11.18 leaves ADR 0025's follow-up 3 without an owner.
- Source conflict: AD-20 and AD-22 and `tools/deps/edges.json` — they treat platform-services as an interface with no package of its own (the layer table gives hosts "platform-services and chrome only", and the edge list has no `platform-services` node) vs the owner ruling of 2026-11-10 that it is its own package. 11.17 brings the spine and the edge list in line, docs first, and regenerates the diagram with `pnpm graph:write`; this docs-only change does not edit the spine.
- Open question: the corpus round trip in 11.18 needs fetched fixtures. Proposed local-skip policy: it skips locally without `pnpm fixtures:fetch`, like the existing sample-game cases under `pnpm test`, naming the missing fixture, and it runs in CI where `pnpm test:strict` fails on any skip. Does the owner accept that reading of the no-skips gate?
- Decision: story 11.17 ([#1832](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1832)) is built on branch `feat/editor-11-17-model-and-view` under the owner rulings of 2026-11-10 (`platform-services` is its own package; the tracer field is the game title; Preact with TSX). It closes the Source conflict above: `tools/deps/edges.json`, the spine's layer table, AD-20, AD-22 and the regenerated diagram now name the package, in a docs commit before the code. It also answers the `preact` open question: `preact` is a production dependency of `packages/editor-ui`, and the root keeps the same exact version as a dev-only dependency for the toolchain fixture, which is not a package; a toolchain test fails if the two differ. Two things are flagged for the owner. AD-20's `run`, `export`, `dialogs`, `clipboard`, `language.connect()` and `shell.openExternal` are not typed yet, because AD-20 names their methods but not their parameters; the entries that first call them fix the shapes. A `.gam` opens read-only when the writer does not reproduce the file byte for byte (ADR 0022 D2.1), which for the committed examples means the Toolkit 2 text main file; there is no committed minor-0 binary example, so the minor-0 test is minor 1 with only its header minor changed.
- Open question: before the `editor-ui` package exists (11.17), where does 11.16 declare `preact` and the DOM shim? Proposed default: the workspace root manifest beside the pinned `esbuild` and `typescript`, and 11.17 moves `preact` into the `editor-ui` manifest when it creates the package.
- Open question: is the vscode.dev proof (`@vscode/test-web`, which drives a browser) part of the required `gate` check or a separate lane under the no-skips rule? 11.18 assumes the Playwright lane of ADR 0015 runs it unconditionally.
