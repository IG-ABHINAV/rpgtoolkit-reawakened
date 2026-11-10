# Editor delivery plan

**Inception, 2026-11-08.** The owner requested all five existing editor epics be broken into stories and published to GitHub. This plans implementation; it does not claim the editors exist. The design inputs merged in PR [#1682](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/1682); this follow-up is reviewed separately on `docs/1357-editor-epic-inception`. The branch incorporates current main before planning, rather than using the older design snapshot as implementation evidence.

## Where the work lives

| Epic | Stories | Responsibility | Breakdown and evidence |
|---|---:|---|---|
| [11 · Foundation](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1357) | 15 | Shared documents, hosts, navigation, schema-driven preferences, game settings, Monaco/native text, contextual runs, code-authored tests, document history and the standalone Git surface (11.14–11.15 added by the accepted ADR 0022, 2026-11-09) | [Inception](../epic-editor-foundation/discovery/inception-proposal.md), [tickets](../epic-editor-foundation/tickets.toml) |
| [12 · P0 assets](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1358) | 14 | Board, shared tileset browser, sprite graphics, character, item, animation, tile bitmap and packaging | [Inception](../epic-editor-assets-p0/discovery/inception-proposal.md), [tickets](../epic-editor-assets-p0/tickets.toml) |
| [13 · P1 tools](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1359) | 18 | Pixel art, extraction/tilesets/animated tiles, battle data, lighting, autotiles, clipboard, export and supported upgrade workflows | [Inception](../epic-editor-p1/discovery/inception-proposal.md), [tickets](../epic-editor-p1/tickets.toml) |
| [14 · Beginner tools](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1360) | 14 | Visual events, skins, audio audition, media import/export conversion, setup delivery, tutorials and visual fixture/action authoring | [Inception](../epic-editor-p2/discovery/inception-proposal.md), [tickets](../epic-editor-p2/tickets.toml) |
| [15 · Desktop editor](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1361) | 10 | Separate Electron editor application, native services, lifecycle, security, platform measurements and release/update path | [Inception](../epic-desktop-shell/discovery/inception-proposal.md), [tickets](../epic-desktop-shell/tickets.toml) |

Every story has a canonical plan and is unstarted. `status: draft` in the repository's plan vocabulary maps to backlog; it is not a claim of implementation or owner approval of unresolved choices. GitHub publication records each story's `tracker_id` beside its entry. No future epic is assigned a sprint merely by publishing it.

## Start here

**[11.1 · #1699](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1699) is answered:** the owner approved [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md) on 2026-11-09 with all ten answers (recorded in its "Owner decisions, 2026-11-09"), and TOOL-5's creator-test rule with it. The ticket closes when the owner has read the approved text. Two of those answers wait on a measurement named in the ADR: the history retention numbers (11.14) and the VS Code autosave proof (11.3). The framework question was answered separately by [ADR 0025](../../../docs/adr/0025-editor-ui-framework-preact-tsx.md) (Preact with TSX).

**[11.2 · #1700](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1700) is the first running editor proof:** open a real game-settings document in web and VS Code, edit, save and reopen it. Then 11.3 hardens lifecycle and conformance. Board tracer 12.1 and desktop tracer 15.1 consume specific foundations rather than the whole epic.

The shared tileset browser is 12.2. Its board-brush and source-edit actions remain distinct and accessible; it does not require the pixel editor before board painting can work. P1 supplies the actual source artwork editor later. Code-authored creator tests are 11.9; the visual fixture/action editor in Epic 14 consumes that contract instead of creating a second runner.

Epic 22's highlighting/outline consumer 22.9 now pins 11.3 and 11.7. Foundation does not wait for that consumer, and grammar absence must not disable editing or test-run.

## What remains a decision or provider gate

- Dock Spawn is a candidate, not an approved dependency. Monaco version, worker/LSP integration and native-text lifecycle need proof under ADR 0021.
- Settings schema metadata, scopes and reset semantics need a shared contract; game settings and personal workspace preferences remain different data.
- Visual event/test representations need an explicit supported subset and safe handwritten-code boundary, not an arbitrary code-to-visual promise.
- Art reuse needs licence and integration evidence; autotile ordering needs approved clean-room sample evidence.
- Existing Epic 10 framework gaps remain in 10.8; 11.9 adds the newly requested real-engine fixture/action and host integration surface without replacing that framework. Open runner/tooling providers remain real gates.
- Native signing, distribution credentials and Windows/macOS/Linux measurements require genuine operator evidence.
- The inherited audio/video import handoff is allocated to 14.11–14.14. Owner approval of pending format contracts, G6 evidence and actual host/portable playback support precede the conversion tools.
- T-73's legacy folder upgrade is not silently promoted from the specification's non-priority boundary. P1 entry 17 was removed before publication and its number is not reused.

## Validation and publication record

Mechanical checks used the repository's `_bmad/method/scripts/tickets.py`, not the differently versioned installed skill. All 69 plans resolve as unstarted backlog; the corrected tree adds no problems, drift, unpinned/undeclared prerequisites or ordering conflicts relative to the current-main baseline. One independent review per epic plus a cross-epic review passed after corrections. These reviews checked plans and providers, not future editor implementations.

The pre-existing global ticket-store warnings are tracked in [#1684](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1684), rather than presented as a clean whole-repository result. The issue-body publisher's omission of decision gates and premature implementation wording is tracked in [#1683](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1683); these editor issues must include decision context and prospective guardrails.

Verification exercised: `pnpm build`, `pnpm lint` and `pnpm provenance` passed (1,022 files, zero provenance violations). The existing script-spec math fixture returned two passing cases; a temporary deliberately wrong assertion returned a located expected/actual failure. That proves the current basic assertion/report path, not the future gameplay action API or complete TOOL-5 conformance. The temporary fixture was removed. Local Markdown links and anchors were checked across the editor planning package.

Planning defects found and corrected in this review are recorded in issues [#1685](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1685)–[#1698](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1698): existing SoundFont ownership, omitted screen-layout coverage, skin/tutorial contracts, PNG policy, missing rendering/decoding/playback providers, media-import and bank-packaging allocation, and desktop release/acceptance prerequisites. The review PR closes these planning defects, not the implementation stories.

GitHub readback verified 69 unique story issues (#1699–#1767), matching canonical titles and bodies, each open and in Project 3 with status `draft` and no sprint. All 69 are attached as native sub-issues to the five existing parents, whose project state is also `draft` with no sprint. Every local `tracker_id` resolves; no extra or missing child appears under those parents. The updated #633 body pins 11.3/#1701 and 11.7/#1705. Repository readiness identifies only 11.1/#1699 as the first editor start.
