# Epic 11 inception proposal

Status: planned breakdown; the owner authorized breakdown and publication, not unresolved 11.1 rulings. Independent review and planning verification are recorded below; no future editor implementation is claimed.

## Outcome and first runnable proof

Create a game-making workspace with the same shared editor UI in web/PWA and VS Code, including vscode.dev, backed by one model per URI and host-owned undo, dirty and save timing. The opening human decision 11.1 precedes the first executable tracer 11.2: open a real `.gam`, change one real field, save and reopen it through each host, and load the result in the runner. It proves the data, UI and host boundary rather than a mock screen; 11.3 expands lifecycle conformance. Browser file capability limitations must be explicit, not silently treated as durable folder access.

## Evidence and source conflicts

- `docs/editor-features.md` T-01–14 and T-40–41 give the legacy capability inventory; `docs/spec/formats/` is normative for format compatibility; UX `EXPERIENCE.md` and `connected-authoring-and-tests.md` are design proposals except their explicitly marked owner direction. `research-editor-ux-for-beginners/engagement-area-map.md` EA-01/05/08/09 and `engagement-user-flows.md` F-01, F-11 and F-13 provide scenario context, not observed usability proof.
- AD-18 requires round-trip preservation; AD-19 one model per URI and host-owned document timing; AD-20 platform-services only; AD-21 transport-free LSP; AD-22 public package edges. AD-29's shared compositor applies to board providers, not a foundation-specific replacement. G1–G7 remain binding.
- `packages/core/src/formats/main-file/writer.ts` exports `writeMainFile`; epic 2.9 supplies the `.gam` reader/layout, not an editor. `packages/lsp/src/index.ts` exports `createServer`; 10.1 and 10.5 are the server/semantic providers. `packages/script-spec/src/project.ts` discovers and runs specs, but directly imports Node fs/path; it is not currently the browser adapter. `packages/script-spec/src/index.ts` exposes `runSpecProject`. There is no existing `editor-ui`, `editor-model`, `host-web` or `host-vscode` package (also `CONTRIBUTING.md` host status).
- TOOL-5 is partially implemented, not a completed provider: 10.8's plan records F-A/F-D/F-E/F-G and PKG-7 gaps. `toBeCloseTo` optional tolerance is not established; its acceptance test documents a two-argument-only path. Runtime fixture/action movement, event projection and bounded gameplay waits are not established by script-spec. Entry 11.1 specifies the missing contract; 11.9 and its GitHub mirror explicitly own its implementation and host-neutral discovery. Existing matcher/framework gaps stay in 10.8, not a second framework.
- Source conflict: the envelope's older assertion that this epic waits for RPGCode tooling must not imply waiting on Epic 22; 22.9 consumes these seams. The 2026-10-31 audit predates the now-recorded parent #1357 and is retained as history. ADR 0021 supersedes older CodeMirror proposals; it chooses Monaco for standalone/browser, while native VS Code owns text editing. ADR 0013 already chooses Electron; Dock Spawn is only a candidate.
- `docs/spec/formats/rpgcode-program.md#test-runs-from-the-editor` documents historical `sys_test.prg` and settings prefix; this is evidence to reconcile in 11.1, not permission to overwrite creator files. The older SoundFont handoff is superseded by `docs/spec/formats/main-file.md#tkr-audio-settings-extension`: 11.6 consumes `audioSettings.defaultSoundFont`, not a new storage convention.

## Coverage map

| Requirement | Entry and allocation |
|---|---|
| CAP-15 / CAP-18 | 11.1–11.11 implement shared editing and both hosts; 11.12–13 sweep and integrated proof. |
| T-01 | 11.2 tracer, 11.3 lifecycle, 11.4 tabs/workspace. |
| T-02 | 11.4 dock show/hide/resize and contextual shell; 12.2 owns shared contextual tileset browser and its keyboard actions, and board inspector belongs to P0. |
| T-03 | 11.4 file tree, open/rename/delete/refresh/collapse and external dispatch; 12.2 owns animated-tile board-brush context action. |
| T-04 / T-05 | 11.10 new project and standard tree; 11.4/10 reserved folders, relative paths, outside copy-in. Rights-cleared optional starter assets require actual sources. |
| T-06 | 11.3 save/save-as/save-all/close, edit-ID undo/redo, recovery and external changes. |
| T-07 | 11.8 normal game run; board and program testing remain distinct. |
| T-08 | 11.5 schema preferences, including board colors/behavior, syntax styles and tip toggle. |
| T-09 | 11.11 contextual manual, what's-new and quick reference; Epic 14 owns tip-of-day presentation and nine-step tutorial, not a dependency of code testing. |
| T-10–T-14 | 11.6 all project, startup, fighting, graphics and plugin fields; 11.2 is only the first field tracer. |
| T-40 | 11.7 native/Monaco program editing, coloring, bookmarks, signatures, insertion, header and distraction-free view; 11.11 reference/help. |
| T-41 | 11.8 program run and legacy preference fixture; 11.9 code-authored repeatable unit/component/gameplay tests. Visual fixture/action-list authoring is Epic 14 and does not gate direct code. |

## Dependencies, lanes and decisions

| Lane | Entries and prerequisites | Shared-file ownership / unresolved decision |
|---|---|---|
| Contracts | 11.1 | Owner rules schemas, preference scope, doc/native-text ownership, docking assessment, fixtures and run snapshots; no Monaco/Electron reopening. |
| Tracer and lifecycle | 11.2 after 11.1, 2.9; 11.3 after 11.2 | 11.3 owns shared lifecycle, integration registry and conformance harness. It must provide isolated contribution registration so later lanes do not simultaneously edit a central barrel/config; if that is impossible, integration owner serializes registration explicitly before parallel execution. |
| Workspace/settings | 11.4 after 11.3; 11.5 after 11.4; 11.6 after 11.3/4 and 21.2; 11.10 after 11.4/6 | Separate feature contributions only; consume the existing game-file audio block, no duplicate settings model or host APIs; selective starter content and unavailable providers are explicit. |
| Code / launch | 11.7 after 11.3/5 and 10.1/5; 11.8 after 11.3/4 and 9.3/16; 11.11 after 11.4/7 and 10.9 | 9.16's interactive runner is incomplete per its own notes; a screenshot or offline measurement is not proof of interactive launch. Text identity across native VS Code and shared document services is gated by 11.1. |
| Creator tests | 11.9 after 11.1/7/8 and 10.8 | Complete blocked 10.8 provider; specify and implement gameplay API and browser-capable host-neutral inputs, no alternate test framework and no Epic 14/22 prerequisite. |
| Closure | 11.12 after 11.1–11.11, 11.13 after 11.12 | Cleanup only, then real cross-host acceptance; external P0/P2 contributions have their own closure. |

Entry dependencies are implementation prerequisites, not evidence those providers have passed. Named external entry IDs are pins to existing `tickets.toml` entries; initiative declarations are the integration owner's responsibility. Where feature modules collide despite the planned isolated registration, their shared integration is serialized by the owner, not edited concurrently.

## Limits and handoff

The desktop shell is Epic 15, P0 assets are Epic 12, P1 assets Epic 13, and visual builder/fixture authoring/tutorials Epic 14. Do not require these to author code tests. A creator test uses a real simulation and a named revision, seed and fixture; authoring views synchronize but running game state is not hot reloaded. Unsupported features retain source data, expose capability and avoid invented fallback behavior. No cross-document atomic undo, universal backups, arbitrary block/code roundtrip, plugin security boundary, or silently redistributed legacy starter kit is promised. The last suite validates only foundation-owned parts of split T-02/T-03/T-09; initiative-wide acceptance must combine the owning epics.

## Independent review

Foundation review passed after reconciling the existing SoundFont contract and pinning 21.2. See the shared [validation record](../../ux-connected-editors/editor-delivery-plan.md#validation-and-publication-record); implementation remains unstarted.
