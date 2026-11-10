---
type: story
title: "Carry the settings tracer through the web and VS Code adapters"
ticket: 18
status: draft
---

## Scope

Implement platform-services in `host-web` and `host-vscode` over the one seam 11.17 created, mount the same `editor-ui` view in both, and prove the whole path. This story was cut out of 11.2 on 2026-11-10 (see the epic Notes).

- `host-web` implements `fs` over the File System Access API; it reports a browser that cannot hold a project handle as a session copy (ADR 0022 D1.4). `host-vscode` implements it over the workspace file system, holding the document behind a custom editor in the extension host (ADR 0022 D2). Neither host imports the other.
- One shared behaviour test runs against both adapters: edit the game title, save, reopen, and compare the persisted bytes of the two. A failing write in each host leaves the model dirty and shows the error.
- A round trip on a fetched-corpus `.gam`: open, edit the title, save, and check every other byte is preserved, then load the saved bytes in the headless runner. The corpus case needs `pnpm fixtures:fetch`.
- A vscode.dev proof with `@vscode/test-web` (owner ruling, 2026-11-10): the built extension loads in a web VS Code build and opens, edits, saves and reopens the document. `@vscode/test-web` is MIT and dev-only; the story adds its `THIRD_PARTY_NOTICES` line and runs the licence check (`pnpm licence`) on it. The browser it drives belongs to the Playwright lane of ADR 0015.
- A strict-CSP probe of the mounted view in the web host and in the VS Code webview counts violations (ADR 0025 follow-up 3 and decision 6); Monaco is not mounted here, so its `style-src` need does not arise.

**Local-skip policy for the corpus case (open, flagged for the owner).** Without fetched fixtures the corpus case skips, exactly like the existing sample-game cases under `pnpm test`; the skip message names the missing fixture. CI runs `pnpm fixtures:fetch` and then `pnpm test:strict`, which fails on any skip, so the case always runs there. A skip never covers a failing assertion. The no-skips gate's wording (CONTRIBUTING, "Test behaviour") says never add a skipped test to dodge a failure; this reading treats a missing fixture as a precondition, not a dodge, and needs the owner to confirm it.

## Acceptance

Both adapters pass the same behaviour test with equal persisted bytes; the corpus round trip preserves everything but the title and the headless runner loads the saved bytes; the vscode.dev proof and the CSP probe pass in CI; the dependency-graph check shows `editor-ui` imports no `host-*` and neither host imports the other.

## Verification

The same test edits the game title, saves and reopens through each adapter and the two persisted byte sequences are equal; a corpus `.gam` round-trips with every other byte preserved and the headless runner loads the saved bytes; the vscode.dev proof opens, edits, saves and reopens the document in a web VS Code build; the CSP probe reports no violation in the mounted view; `editor-ui` imports no `host-*` and neither host imports the other; the corpus case may skip locally only because `pnpm fixtures:fetch` has not run, and fails under `pnpm test:strict` in CI.

## Decisions and prerequisites

The CSP probe is added here because it needs a mounted view and ADR 0025 lists it among the first story's work; this allocation is the planner's, not the owner's, and is flagged in the epic Notes. VS Code autosave proof and full lifecycle conformance stay in 11.3.

Prerequisites: 11.17.
