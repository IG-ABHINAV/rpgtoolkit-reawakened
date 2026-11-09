# ADR 0022 — Shared editor authoring contracts

* **Status:** Proposed (drafted 2026-11-08 for owner review; nothing below is accepted until the owner approves it)
* **Date:** 2026-11-08
* **Ticket:** [#1699](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1699) (entry 11.1)
* **Amends, once accepted:** the document wording of AD-19 and the `run` wording of AD-20 in the architecture spine; adds a Reawakened rule to [TOOL-5](../spec/engine/rpgcode-tooling.md#tool-5)
* **Does not reopen:** [ADR 0021](0021-monaco-code-editor.md) (Monaco in standalone/browser, native text editors in VS Code) or [ADR 0013](0013-desktop-shell-electron.md) (Electron)
* **Context documents:** [guardrails.md](../guardrails.md) G1–G7, [connected authoring](../../_bmad-output/initiative-rpgtoolkit-reawakened/ux-connected-editors/connected-authoring-and-tests.md), [shared architecture proposal](../../_bmad-output/initiative-rpgtoolkit-reawakened/ux-connected-editors/architecture.md)

## In plain terms

Before anyone builds the editor, the web editor, the VS Code extension and (later) the desktop editor must agree on a few things: what counts as "the same file", who owns the text and the undo history, what a save promises, where a setting lives, what a "test run" records, and what a creator-written test may do. If each host decides separately, the same project will save, undo and run differently depending on where it is opened. This ADR proposes one answer to each. It writes down rules; it builds nothing, and where evidence is missing it says so instead of guessing.

## Evidence this draft rests on

| Fact | Source |
|---|---|
| One document model per URI; the host owns undo and save timing; hosts never edit bytes | AD-19 (architecture spine) |
| `editor-ui` reaches the host only through `platform-services`; `run.startProgram` takes a fixture | AD-20, G2 |
| VS Code: an editable non-text resource uses `CustomEditorProvider`; VS Code derives undo and dirty state from the edit events the extension emits | [VS Code custom editors](https://code.visualstudio.com/api/extension-guides/custom-editors#custom-editor) |
| VS Code: a text resource's authority is the `TextDocument`; a custom text editor edits it with `WorkspaceEdit` and observes `onDidChangeTextDocument`; two competing models for one text file are avoidable only by this route | [Custom text editors](https://code.visualstudio.com/api/extension-guides/custom-editors#custom-text-editor) |
| vscode.dev runs only web extensions (browser worker, no Node, `workspace.fs` only); a watcher is not a complete change log | [Web extensions](https://code.visualstudio.com/api/extension-guides/web-extensions#web-extension-main-file), [watcher API](https://code.visualstudio.com/api/references/vscode-api#workspace.createFileSystemWatcher) |
| Hidden webviews can be destroyed; `getState`/`setState` keep JSON view state only | [Webview persistence](https://code.visualstudio.com/api/extension-guides/webview#persistence) |
| `.gam`, `.brd`, `.tem` are binary at 3.1; `.prg` is Windows-1252 text with a separate compiled binary form | `docs/spec/formats/README.md`, `docs/spec/formats/rpgcode-program.md` |
| The 3.1 editor's "Run program" writes `Prg\sys_test.prg` with a settings prefix and leaves it behind | `docs/spec/formats/rpgcode-program.md#test-runs-from-the-editor` |
| Asset keys are case-folded and package-relative | `docs/spec/engine/audio-media.md` (`AssetKey`) |
| `script-spec` exists and is partly implemented (see "Provider gaps"); its discovery imports `node:fs` | `packages/script-spec/src/project.ts:1-5`, 10.8 plan |

## Decisions

### D1 — Document identity

1. A document is identified by its **project-relative path with `/` separators**, compared **case-folded** (as asset keys are), and bound to one **project handle** supplied by the host. The host-native URI (a `vscode.Uri`, a File System Access handle path, an Electron path) is an implementation detail behind `platform-services`; `editor-ui` and `editor-model` see only the identity.
2. A path that case-folds to an existing document's identity opens that document. Two files differing only in case in one project are reported as a conflict and not opened as two documents.
3. Rename and Save As produce a **new** identity; the old document is closed or kept, never silently re-keyed. Known references are listed for review; references the editor cannot prove (dynamic script strings) are shown as *uncertain* and never rewritten silently.
4. A host that cannot give a stable project handle (for example a plain browser download/upload session) declares so in `capabilities`; the editor then treats the project as a session copy and says so.

*Reason: one identity across three hosts, matching the case-insensitive way the engine already finds assets.*

### D2 — Who owns a document's content

| Content | Authority | Views |
|---|---|---|
| Editable binary game files (`.gam`, `.brd`, `.tem` and the other formats with a same-version writer) | `editor-model` document: bytes plus a serialisable command stack. In VS Code the extension host holds it behind a `CustomEditorProvider`. | Webviews and panels hold view state only. |
| RPGCode text (`.prg`, `*.spec.prg`) in **VS Code** | The VS Code `TextDocument`. `editor-model` does **not** keep a second editable copy. | Native text editor; any visual view uses `WorkspaceEdit` and follows `onDidChangeTextDocument`. |
| RPGCode text in **standalone/browser/desktop** | An `editor-model` text document. | Monaco is a view and client only (ADR 0021). |
| A format without a same-version writer, compiled binary `.prg`, legacy text boards | **Not editable.** Open read-only with the reason, or not at all. The editor never converts or downgrades a file to open it. | Read-only view. |

1. AD-19's "bytes plus commands" is therefore the rule for **binary** documents. For text in VS Code the adapter wraps the `TextDocument`; the platform-services `document` surface is the same, so `editor-ui` is unaware of the difference.
2. A visual view of text (for example the later visual event builder) submits an edit as a labelled text change to the owner and must tolerate source that is temporarily invalid. It never keeps a parallel model that can drift.
3. Native-editor undo is the host's. A visual edit to text joins the same undo stack because it is applied to the same document.
4. The `editId` undo protocol of AD-19 applies to binary documents; for VS Code text the host's native undo applies and `editId` is not exposed.

### D3 — Lifecycle promises

These are the promises every host passes in the shared conformance suite (11.3):

1. **Edit.** A command is accepted or rejected whole. A rejected command leaves the document unchanged and returns a reason.
2. **Dirty.** Derived by the host from accepted edits. Selection, scroll, zoom, preview and browsing are not edits.
3. **Save** captures a revision, writes it through the host, and marks the document clean **only when the host reports that revision durably written**. Edits made after the revision stay dirty. A failed save leaves all pending work visible and names the document.
4. **Save As** resolves destination, collision and reference consequences **before** writing. Cancellation and partial failure are never reported as success.
5. **External change.** Detected where the host can detect it. Local dirty work is preserved and the external version is kept; the user chooses compare, keep local, reload or manual merge. Neither side is overwritten silently. Where the host cannot watch, the editor says live change detection is unavailable.
6. **Revert and close** confirm possible loss. Recovery is offered **only** where the host actually holds a backup; the editor never implies one.
7. **View disposal** (a hidden webview, a closed tab, a moved dock) never discards the document or its undo stack while another view or unsaved work remains.

### D4 — Operations that touch several documents

1. There is **no cross-document transaction or all-or-nothing save**; no host provides one. Each document saves, fails and undoes on its own and the editor presents each result separately. What the editor adds instead is **recovery**: every operation that writes more than one document is recorded as one checkpoint group ([D12](#d12--history-and-checkpoint-groups)), so the whole operation can be restored in one action even though it could not be saved atomically.
2. **Multi-file commits** (the animation wizard writes a `.anm` and frame bitmaps; the tile wizard writes named bitmaps) follow one pattern: (a) validate every destination first, naming any collision and asking before overwrite; (b) write in a fixed, documented order with the file the user will open first written last; (c) after a failure keep the files already written, stop, and show a per-file list of written, skipped and pending items with *retry remaining* and *leave as is*. Preview and cancel before step (b) never write. No rollback is promised.
3. Linking to a missing target offers choose, explicit create, keep unresolved or cancel; navigating to a missing reference creates nothing.

### D5 — Package export destination

1. The destination is chosen by the user through `dialogs` in every host; the editor never writes the package beside the source without asking.
2. A host without folder write access offers a download of the single package file and says so.
3. Cancelling at any point leaves the project and any pre-existing destination file untouched. The package is written to a temporary name and renamed on success where the host supports rename; otherwise the editor says an interrupted write may leave a partial file.
4. **Test-only content is excluded and the exclusion is verified**, not assumed from names: see D9.

### D6 — Settings

1. Three kinds of data stay apart:
   * **Authored game data** (input, cursor, startup, movement, battle, audio settings and so on) belongs in the game's own documents: the `.gam` main file (including its additive Reawakened blocks) or the document that owns it. It is edited through the owning document, undoable and saved with it, even when shown on a Settings screen. It never lives in VS Code `settings.json` or a preferences file (owner ruling, 2026-11-08).
   * **Editor settings** (layout, grid display, zoom, syntax colours, tip toggle, autosave, history retention) are the only things in the settings ecosystem: a declarative **catalogue**.
   * **Runtime state** belongs to a running game or test and is never saved as authored data.
2. **Catalogue entry:** stable ID, type (boolean, number, string, enum, list of those), default, label and plain-language description, group, validation constraint, and a scope. An invalid stored value falls back to the default and is reported once; it is never silently coerced.
3. **Layers, broadest to most specific:** default, user, project. **The project layer wins over user.** There is no per-file and no per-language layer in the first release. A project-layer value is a plain file in the project so it can be committed; its name and format are fixed in 11.5. Reset removes the value from the layer being edited, restoring the next layer down.
4. **VS Code mapping.** The catalogue generates a `contributes.configuration` block for the subset of types VS Code supports. User maps to user settings and project to workspace settings; entries use scope `window` and never `application`/`machine`. Language-overridable scope is unused. Preferences the editor treats as risky to take from an untrusted project are listed under `restrictedConfigurations` and ignored until the workspace is trusted. The effective value must read identically in both hosts for the same layers; 11.5 proves it with an effective-value trace.
5. Plugin or extension contributions to the catalogue are **not** decided here. Existing direction is one ungated in-process plugin contract; this ADR adds no trust tier or permission list. Plugin data attached to a native game document is a different thing and is decided in [ADR 0024](0024-plugin-data-contributions.md): a plugin declares a data contribution for each contract it extends, and its blocks live in the document under `pluginData` ([ADR 0023](0023-native-data-contracts-versioning-identity-and-sidecars.md), decision 7). Whether the editor's project settings layer ever uses the same envelope is **not** decided by either ADR, and per-user view state is never plugin data (D6.1).

### D7 — Workbench layout and docking

1. A dock holds a **view handle**, never the authoritative document, history or unsaved edits. Closing, moving, hiding or restoring a panel disposes or recreates the view and leaves the document intact (D3.7). Layout is saved as view and layout identifiers only.
2. **Library not selected here.** Research (2026-11-08, metadata-level, not a locked-install audit) found:

| Candidate | Finding |
|---|---|
| Dock Spawn (original) | MIT, framework-agnostic, but last release 2014 and last push 2015. Reject as a dependency. |
| `dock-spawn-ts` (maintained fork) | MIT, no declared runtime dependencies, release 4.5.4 on 2026-10-23, one open issue. Small maintainer base. Keyboard and ARIA support unverified. |
| `dockview` | Core is MIT, no runtime dependencies, active. **Keyboard docking and broader keyboard navigation are in the proprietary `dockview-enterprise` package, which G6 excludes**, so those must be supplied by us. Documents tab/ARIA basics. |
| `flexlayout-react` | MIT, active, but needs React. Keyboard-only docking unverified. |

3. **Blocking question, answered 2026-11-09:** which UI framework `editor-ui` uses is decided by [ADR 0025](0025-editor-ui-framework-preact-tsx.md) (owner decision: Preact with TSX). A React-only library therefore cannot be adopted without a further ADR that admits `preact/compat`. This ADR does not pick a library; it fixes the **adoption gate**: a candidate is accepted only after a packaged-host proof in the browser/PWA and packaged Electron host showing two views over one dirty document that survive move, split, close and recreate with identity, content and undo history intact; layout round-trips across restart and missing panel types; keyboard-only navigation, resize, move and close with focus restoration; no Enterprise code bundled (G6 gate); packaged CSS, CSP and offline loading; and no shortcut collisions with Monaco.
4. VS Code uses its native editor groups and views; no dock library is embedded there.

### D8 — Launches and run snapshots

1. Four launches stay distinct and are labelled so in every host: **normal game** (configured startup), **board test** (explicit board, start position, party, state), **program test** (one program with a declared fixture), **saved tests** (`*.spec.prg`, D9). Asset preview is presentation only and is not a gameplay test.
2. **Save before run.** The editor saves the documents the run reads. If a save fails it stops and names the document. Nothing is run from unsaved memory.
3. A run records a **snapshot**: launch kind, project handle, the identity and content hash of each saved document the run was given, start board and position (when applicable), seed, fixture reference (when applicable), and the runner build. Results show the snapshot.
4. A running game is **never changed by later edits**. Authoring views stay synchronised with each other, not with a running game; restart or reload is an explicit user action that creates a new snapshot.
5. **`sys_test.prg`.** The 3.1 editor wrote the open program to `Prg\sys_test.prg` and left it there. Reawakened passes the program and the editor's test settings to the runner through `run.startProgram` with a fixture; it **does not write a file into the creator's `Prg` folder** and never overwrites a creator file of that name. The test settings the legacy prefix applied are fixture data.
6. A launch the host or provider cannot perform is disabled with its specific reason. The editor never substitutes another battle system or runner silently.

### D9 — Creator tests (summary; normative text is the TOOL-5 block)

The normative contract is the **Reawakened rule (proposed; creator tests)** under [TOOL-5](../spec/engine/rpgcode-tooling.md#tool-5). In brief: tests are plain `*.spec.prg` files extending the existing framework, not a second runner; a case runs real engine behaviour on a tiny authored fixture with a bounded tick budget; assertions report expected, actual, source line, last action and tick; test-only files are excluded from game packages and the exclusion is verified by inspecting the produced package. The visual fixture and action-list **representation** and its generated-code boundary are ruled in 14.1, not here, so basic code tests never wait for the visual builder.

### D10 — What this ADR does not promise

No cross-document atomic undo or save; no backup beyond what a host really provides (D12 history is the editor's own, and is a recovery aid, not a guarantee against disk loss); no arbitrary code-to-visual round trip; no byte-identical shortcuts or behaviour between native VS Code text and Monaco; no plugin sandbox; no hot reload of a running game; no editing of a format that has no same-version writer; no claim that any of this is implemented.

### D11 — Automatic save

1. **Autosave is on by default in every host** (owner direction, 2026-11-08). It is a user-layer editor setting (`editor.autosave`, default on, with a delay, default one second after the last accepted edit). A user may turn it off.
2. **It writes whole, accepted commands only.** A drag, brush stroke or typing burst is saved after it ends; nothing is written mid-gesture, so autosave never writes a half-made edit.
3. **It never overwrites an unseen external change.** Before writing, the editor compares the file on disk with the revision it last read or wrote. If they differ it does not write; it raises the external-change flow of D3.5 and keeps the local work dirty.
4. **A failed autosave** keeps the document dirty, shows which document failed and why, and retries on the next accepted edit or after a visible interval. It never reports clean.
5. **Every autosave is a history entry** (D12), so autosave cannot destroy the previous version.
6. **Per-host mechanism, one outcome.** The outcome is the same everywhere; the mechanism is not. VS Code ships autosave **off** and owns `files.autoSave`; the extension **never silently changes a user's global setting**. Where VS Code lets the extension default it on for the editor's own documents, it does; otherwise the extension asks once, on first use, and records the answer. Whether VS Code's autosave drives a `CustomEditorProvider` save is **[UNVERIFIED]** and is proven in 11.3 before this rule is accepted as implementable. Browser and desktop hosts run the editor's own scheduled save.
7. **Run and export** need no extra step: with autosave on the documents are already saved, and the save-before-run rule of D8.2 still verifies it.

### D12 — History and checkpoint groups

*In plain terms:* undo takes back what you just did in this sitting. History is the record of every saved version, kept across sessions, so you can go back to yesterday's version of a board, or undo a whole wizard in one step. It is separate from undo and from Git, and it works the same in every host.

1. **Undo is not history.** Undo is the host's in-session command stack (VS Code's native undo for text; `editId` undo for binary documents). It is not changed by this section and VS Code's own undo is used as is.
2. **Per-document history.** Every successful save (automatic or manual) appends an entry: the content (deduplicated by content hash), a reason (`auto`, `manual`, `before-run`, `before-restore`, `before-conflict-resolution`, `before-delete`, `before-wizard`, `checkpoint`), the time, and a checkpoint group id when the save belongs to one.
3. **Checkpoint groups.** An operation that writes several documents (the animation and tile wizards, a rename that updates references, an import or conversion, a restore) creates **one group**. The group records the content of every document it touches **before** the first write and the files it created. **Restore group** puts every document back to its pre-operation content and removes files the operation created, as new accepted edits. Because saving is not atomic, restore reports each file separately (restored, already as wanted, failed) and can be retried; it never claims all-or-nothing.
4. **Named checkpoints.** The user can name a **project checkpoint**: a manifest of every authored document's content hash. It is cheap because content is deduplicated. Restoring one is a group restore.
5. **Restore never destroys.** A restore is a new accepted edit and its own history entry, preceded by a `before-restore` entry, so a restore can itself be undone or restored away.
6. **Browsing.** A document timeline and a project timeline list entries with reason, time and size, preview any entry in a read-only view of the same editor, and restore it. Compare is a visual or semantic preview side by side, **not a byte diff**, for binary formats.
7. **Where it lives.** Hosts that can write the project folder keep history inside the project in one reserved folder, so it travels with the project and survives a host change. **That folder is never included in a game package, is listed as excluded in the package inventory check, and is not committed unless the author chooses** (the editor offers an ignore entry and never edits an ignore file silently). Hosts that cannot write the folder (a browser with no folder access) use host storage and say plainly that it can be cleared by the browser.
8. **Retention (proposed defaults; the owner sets the numbers).** Keep every entry for 30 days; after that keep the latest per day for 90 days; keep named checkpoints, `manual` entries and every group record until deleted by the user. Warn at 500 MB per project and offer thinning; never thin silently below these floors. All are editor settings.
9. **Same in every host.** History lives in shared code on top of `fs`; a host adds no history feature of its own (AD-20). VS Code's own Timeline (Local History) keeps working beside it and is not replaced or hidden.

### D13 — Git integration

*In plain terms:* Git is the right tool for sharing and for the long history of a game. The editor should work well with it, not reinvent it.

1. **Git is a capability, not a dependency.** The editor works fully without Git. Hosts declare an `scm` capability; the editor shows Git features only where it is present and says why otherwise.
2. **VS Code uses its built-in Git.** The extension does not implement Git. It cooperates: files the editor writes appear in Source Control as ordinary changes, the history folder is offered for ignoring (D12.7), and an action such as "Commit this checkpoint group" hands the changed files to the built-in Git view rather than committing silently.
3. **Standalone hosts (browser, desktop) get a small, shared Git surface** through a platform-services `scm` interface: status of changed documents, diff preview in the same read-only view as history, stage and commit, and read-only log. Which engine backs it (the user's installed `git` in desktop; an in-browser implementation in the PWA) is a separate decision gated by G6; this ADR selects none. Push and pull, remotes and credentials are **out of scope** until ruled.
4. **Binary game files.** Diffs of `.gam`, `.brd` and other binary documents are shown through the editor's preview (D12.6), not as raw bytes, and merge conflicts in a binary document are never auto-resolved; the editor shows both versions and lets the user choose one. It never writes conflict markers into a binary file.
5. **Git and history do not depend on each other.** History is the safety net for the last hours and days and for group restore; Git is the shared, durable record. Neither is required for the other to work.

## Provider gaps this ADR finds (not fixed here)

| Gap | Owner entry |
|---|---|
| Browser-capable discovery and run: `script-spec` imports `node:fs`/`node:path` | 11.9 |
| Fixture selection of a tiny authored board; input and movement action lists; bounded condition waits; gameplay state/event projection | 11.9 (contract: TOOL-5 block) |
| Matchers: arrays in `toEqual`/`toContain`, `toThrow`, `.not.toThrow`, strict `toBe` types, `toBeCloseTo` tolerance; group hooks run per case instead of once | 10.8 |
| CLI failure diagnostics hard-code line 1, column 1 | 10.9 |
| Test-file exclusion from exported packages: only the default-manifest check exists; no exporter-level proof | 12.9 / 11.9 |
| Editor-side `.gam`, `.brd`, `.tem` writers for every supported version | 11.2 and each editor entry |
| Autosave on by default: VS Code `files.autoSave` default and its effect on `CustomEditorProvider` are unverified | 11.3 |
| History store, checkpoint groups, retention, timeline UI and package-inventory exclusion: unspecified in code and not allocated to any entry | new entry (proposed 11.14) |
| Git surface (`scm`), its engine choice and the VS Code Git API hand-off: unspecified and not allocated | new entry (proposed 11.15) |
| Native VS Code text/visual synchronisation has been read from documentation, not prototyped | 11.7 |

## Alternatives considered

* **Keep AD-19's generic byte model for VS Code text.** Rejected: it creates a second editable copy next to the `TextDocument`, which is exactly the dual ownership D2 forbids.
* **Store personal preferences in the game.** Rejected: a project would carry one author's layout, and the game format gains fields it has no reason to hold.
* **Keep `sys_test.prg`.** Rejected: it writes into creator-owned folders and can overwrite a file the creator wrote.
* **Pick `dockview` or Dock Spawn now.** Rejected: the UI framework is undecided and the libraries' keyboard support is unverified or Enterprise-only.
* **A cross-document transaction for linked edits.** Rejected: no host provides one and a false rollback promise is worse than an honest per-file report. Checkpoint groups (D12.3) give the recovery without the promise.
* **Rely on each host's own history (VS Code Local History) and Git only.** Rejected: browser and desktop have neither, and neither groups several documents into one restorable operation; behaviour would differ per host (D12.9). VS Code's own features stay available beside ours.
* **Implement Git inside the VS Code extension.** Rejected: VS Code's built-in Git is better and users already have it.
* **Autosave off by default, as VS Code does.** Rejected by the owner: a creator's work should not be lost to a missed save; history (D12) is what makes autosave safe.

## Questions for the owner

1. Approve D1–D8 as written, or mark the rules to change.
2. D6.3: are two layers (user, project) enough for the first release? (D6.1 now records your ruling that game data stays in the `.gam`/project documents and only editor settings use the settings ecosystem.)
3. D7.3: which UI framework does `editor-ui` use (or is the choice a separate ADR before docking)? **Answered 2026-11-09 (owner): Preact with TSX, recorded in [ADR 0025](0025-editor-ui-framework-preact-tsx.md).**
4. D8.5: confirm `sys_test.prg` is not reproduced.
5. D2: confirm the editor does not open a format without a same-version writer even read-write.
6. Approve the TOOL-5 creator-test block, including that spellings of the new fixture and action operations are fixed at 11.9 after review.
7. D11: confirm that in VS Code, where the extension cannot default autosave on, asking once on first use is acceptable.
8. D12.7–D12.8: confirm history lives inside the project in a reserved folder (not committed by default) and set the retention numbers (30 days all, 90 days daily, 500 MB warning are proposals).
9. D13.3: is a small shared Git surface (status, diff, commit, log) in the browser and desktop hosts in scope, with push/pull deferred? The engine behind it needs its own G6 decision.
10. D8.3: confirm a run snapshot records content hashes of the saved documents it ran (this was my recommendation 5; not yet answered).
