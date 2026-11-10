# ADR 0022 — Shared editor authoring contracts

* **Status:** Accepted (owner approval, 2026-11-09: Jensen answered all ten questions with "yes all of that sounds great", adopting every recommendation in the decision memo; merging PR [#1769](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/1769) is his written approval of the final wording). **Two items are decided but not yet closed inside this accepted ADR:** the retention numbers of D12.8 and the VS Code autosave proof of D11.6 are settled by the measurements named there (D12.8 by 11.14, D11.6 by 11.3), and 11.1 stays open until the owner has read this approved text.
* **Date:** 2026-11-08; owner decisions recorded 2026-11-09
* **Ticket:** [#1699](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1699) (entry 11.1)
* **Amends:** the document wording of AD-19 in the architecture spine (amended 2026-11-09; the `run` wording of AD-20 needed no change — see [What was and was not amended](#what-was-and-was-not-amended)); adds a Reawakened rule to [TOOL-5](../spec/engine/rpgcode-tooling.md#tool-5)
* **Does not reopen:** [ADR 0021](0021-monaco-code-editor.md) (Monaco in standalone/browser, native text editors in VS Code) or [ADR 0013](0013-desktop-shell-electron.md) (Electron)
* **Context documents:** [guardrails.md](../guardrails.md) G1–G7, [connected authoring](../../_bmad-output/initiative-rpgtoolkit-reawakened/ux-connected-editors/connected-authoring-and-tests.md), [shared architecture proposal](../../_bmad-output/initiative-rpgtoolkit-reawakened/ux-connected-editors/architecture.md)

## In plain terms

Before anyone builds the editor, the web editor, the VS Code extension and (later) the desktop editor must agree on a few things: what counts as "the same file", who owns the text and the undo history, what a save promises, where a setting lives, what a "test run" records, and what a creator-written test may do. If each host decides separately, the same project will save, undo and run differently depending on where it is opened. This ADR rules one answer to each. It writes down rules; it builds nothing, and where evidence is missing it says so instead of guessing.

## Evidence this ADR rests on

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
| The 3.1 editor left `Prg\sys_test.prg` behind, so imported projects already carry files of that name: 30 files in 29 of the corpus's 60 collection labels | `docs/findings/native-data-boundaries/data/assets.jsonl`, counted 2026-11-09 |
| A package is every file under the project folder except `Saved\`, other projects' main files and anything outside it — so a reserved in-project folder must be named as excluded | `docs/spec/formats/packaging-and-paths.md#distribution-package-this-projects-own` ("Not included" row) |
| AD-11's `stateHash`/`drawListHash` are 64-bit FNV-1a and explicitly "not a security boundary"; collision resistance is supplied separately, and a package descriptor already carries a SHA-256 | `save-game.md` ("Collision limit"), `packaging-and-paths.md` (`.tpk.json` descriptor, `sha256`) |
| Content hashing is cheap enough for a run snapshot: SHA-256 over 1,031 corpus files with authored extensions (57.5 MB, largest 3.35 MB) took 31 ms with `node:crypto` and 47 ms with `crypto.subtle` | measured 2026-11-09, one machine, Node v26.13.0, macOS arm64 (not a spec claim) |
| Board sizes drive history growth: boards are 36.5 KB at the median, 149 KB at p90, 482 KB at max; tilesets reach 4.3 MB | `docs/findings/native-data-boundaries/data/assets.jsonl`, analysed 2026-11-09 |
| VS Code's own Local History defaults to 256 KB per-file cap, 50 entries per file and a 10 s merge window "to reduce the overall number of entries … for example when auto save is enabled" | VS Code source, `src/vs/workbench/browser/workbench.contribution.ts` (`workbench.localHistory.*`), read 2026-11-09 |

## Decisions

### D1 — Document identity

1. A document is identified by its **project-relative path with `/` separators**, compared **ASCII-folded**, as `docs/spec/formats/README.md#paths-inside-files` defines: the fold rewrites `\` as `/` and folds `A`–`Z` to `a`–`z`, leaving every other code point exactly as it is. It is **not** Unicode case folding, so `U+212A` KELVIN SIGN is not the ASCII letter `k`. The identity is bound to one **project handle** supplied by the host. The host-native URI (a `vscode.Uri`, a File System Access handle path, an Electron path) is an implementation detail behind `platform-services`; `editor-ui` and `editor-model` see only the identity.
2. A path that folds to an existing document's identity opens that document. Two files differing only in case in one project are reported as a conflict and not opened as two documents. This is the same test the engine applies to asset keys and a package applies to its entries, where such a pair is refused (L10).
3. Rename and Save As produce a **new** identity; the old document is closed or kept, never silently re-keyed. Known references are listed for review; references the editor cannot prove (dynamic script strings) are shown as *uncertain* and never rewritten silently.
4. A host that cannot give a stable project handle (for example a plain browser download/upload session) declares so in `capabilities`; the editor then treats the project as a session copy and says so.
5. When native YAML documents arrive (ADR 0023, deferred for the first release by the owner's decision of 2026-11-09), their identity is the same kind of thing — the path with its extension, empty and `.` parts dropped, a duplicate a reported error naming both paths (`docs/spec/formats/native-contracts.md#identity`) — so one rule covers both, and this ADR does not adopt that contract before it is approved.

*Reason: one identity across three hosts, matching the way the engine and the packager already compare names — ASCII only, so behaviour never depends on a locale or on Unicode tables (G3).*

### D2 — Who owns a document's content

| Content | Authority | Views |
|---|---|---|
| Editable binary game files (`.gam`, `.brd`, `.tem` and the other formats with a same-version writer) | `editor-model` document: bytes plus a serialisable command stack. In VS Code the extension host holds it behind a `CustomEditorProvider`. | Webviews and panels hold view state only. |
| RPGCode text (`.prg`, `*.spec.prg`) in **VS Code** | The VS Code `TextDocument`. `editor-model` does **not** keep a second editable copy. | Native text editor; any visual view uses `WorkspaceEdit` and follows `onDidChangeTextDocument`. |
| RPGCode text in **standalone/browser/desktop** | An `editor-model` text document. | Monaco is a view and client only (ADR 0021). |
| Native YAML documents (`.tkr*`, ADR 0023), when they arrive | **Deferred for the first release** (owner decision, 2026-11-09; ADR 0005 amendment). When they are editable they are text and follow the RPGCode-text row above: the host's text document is the authority, `editor-model` keeps no second editable copy, and no visual view keeps a parallel model (D2.2). | Text; a visual view edits through the same text authority. |
| A format without a same-version writer, compiled binary `.prg`, legacy text boards | **Not editable.** Open read-only with the reason, or not at all. The editor never converts or downgrades a file to open it. | Read-only view. |

1. A **read-only view is allowed and a read-write open is never offered** without a same-version writer (owner ruling, 2026-11-09). The real cases: the board writer refuses any board below vector minor 4 (`packages/core/src/formats/board/writer.ts`), so pre-vector boards have a reader and a converter but no same-version writer; the main-file writer re-emits the minor it was given; no shipped tool writes a compiled program. Conversion is only the explicit upgrade of [T-30](../editor-features.md) and [T-31](../editor-features.md), and the editor never converts on open. This answers the spine's open question about 2.x text boards, other text-era formats and compiled `.prg`.
2. AD-19's "bytes plus commands" is therefore the rule for **binary** documents. For text in VS Code the adapter wraps the `TextDocument`; the platform-services `document` surface is the same, so `editor-ui` is unaware of the difference.
3. A visual view of text (for example the later visual event builder) submits an edit as a labelled text change to the owner and must tolerate source that is temporarily invalid. It never keeps a parallel model that can drift.
4. Native-editor undo is the host's. A visual edit to text joins the same undo stack because it is applied to the same document.
5. The `editId` undo protocol of AD-19 applies to binary documents; for VS Code text the host's native undo applies and `editId` is not exposed.

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
2. **Catalogue entry:** stable ID, type (boolean, number, string, enum, list of those), default, label and plain-language description, group, validation constraint, a scope, and **whether the entry may appear in the project layer**. An invalid stored value falls back to the default and is reported once; it is never silently coerced.
3. **Layers, broadest to most specific:** default, user, project. **The project layer wins over user.** There is no per-file and no per-language layer in the first release. A project-layer value is a plain file in the project so it can be committed; its name and format are fixed in 11.5. Reset removes the value from the layer being edited, restoring the next layer down.
   * **Two layers are enough** (owner ruling, 2026-11-09). A project layer earns its place because some entries are genuinely conventions of the game rather than of the person — the header template for new programs and the RPGCode indent width (T-40, T-42) — and because user + workspace maps one-to-one onto VS Code's settings, so the same two layers mean the same thing in both hosts.
   * **Some entries are user-only**, and the catalogue marks them: **autosave, history retention, and layout** at least. A project that someone cloned must not quietly change another person's autosave, recovery floors or panel arrangement. Shared code **ignores a project-layer value for a user-only entry** and reports it once; it does not rely on VS Code to enforce this, because D6.4 forbids the `application` scope that would be the native mechanism, and a workspace file from an untrusted project is only covered once the workspace is trusted.
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
2. **Save before run.** The editor saves the documents the run reads. If a save fails it stops and names the document. Nothing is run from unsaved memory. **Owner ruling, 2026-11-09:** this is deliberate and it changes 3.1, whose editor wrote the open program text, saved or not, to `sys_test.prg`. The research record listed "save-first" as unconfirmed (`research-editor-ux-for-beginners/decisions.md` §6 item 11); it is confirmed here and that note is superseded.
3. A run records a **snapshot**: launch kind, project handle, the identity and **SHA-256 content hash** of each saved document the run was given, start board and position (when applicable), seed, fixture reference (when applicable), and the runner build. Results show the snapshot.
   * **SHA-256, not AD-11's FNV-1a.** AD-11's `stateHash`/`drawListHash` are 64-bit and non-cryptographic, and `save-game.md` ("Collision limit") says so plainly; D12 deduplicates history by content hash, so a collision would silently substitute one version of a creator's board for another. SHA-256 is already the project's convention where identity must survive (`packaging-and-paths.md`: the descriptor's `sha256`).
   * **Shape.** Per-document hashes for the documents the run explicitly targets (the program under test, the fixture board, the spec file) and **one project manifest hash** over the sorted `(path, sha256)` pairs for the rest, encoded with length-prefixed fields the way `derivePackageIdentity` is (`save-game.md`), so no path or content can be re-split into another record. A normal game run reads the whole project, so this keeps the snapshot readable and stable.
   * **Cost, measured not assumed.** On one machine (2026-11-09, Node v26.13.0, macOS arm64) SHA-256 over 1,031 corpus files with authored extensions (57.5 MB) took 31 ms with `node:crypto` and 47 ms with `crypto.subtle`. The browser worker and packaged Electron costs are proved in 11.3.
4. A running game is **never changed by later edits**. Authoring views stay synchronised with each other, not with a running game; restart or reload is an explicit user action that creates a new snapshot.
5. **`sys_test.prg`.** The 3.1 editor wrote the open program to `Prg\sys_test.prg` and left it there. Reawakened passes the program and the editor's test settings to the runner through `run.startProgram` with a fixture; it **does not write a file into the creator's `Prg` folder** and never overwrites a creator file of that name. The test settings the legacy prefix applied are fixture data. **Confirmed by the owner, 2026-11-09.** An existing `Prg\sys_test.prg` in an imported project is an **ordinary creator program**: preserved byte for byte (AD-18), opened like any other program, and **never used as a run input**. This is not hypothetical — the corpus inventory records 30 such files in 29 of its 60 collection labels, because the 3.1 editor left them behind.
6. A launch the host or provider cannot perform is disabled with its specific reason. The editor never substitutes another battle system or runner silently.

### D9 — Creator tests (summary; normative text is the TOOL-5 block)

The normative contract is the **Reawakened rule (accepted, 2026-11-09; creator tests)** under [TOOL-5](../spec/engine/rpgcode-tooling.md#tool-5). In brief: tests are plain `*.spec.prg` files extending the existing framework, not a second runner; a case runs real engine behaviour on a tiny authored fixture with a bounded tick budget; assertions report expected, actual, source line, last action and tick; test-only files are excluded from game packages and the exclusion is verified by inspecting the produced package. The visual fixture and action-list **representation** and its generated-code boundary are ruled in 14.1, not here, so basic code tests never wait for the visual builder.

**Accepted by the owner, 2026-11-09, with two limits stated in the accepted text:** the RPGCode spellings of the fixture, action and wait operations are fixed in a docs-only 11.9 commit after review, not here; and the block does **not** settle the open 10.8 matcher ruling ("F-A"), which may need TOOL-5's "one native command" wording widened to a closed, test-only set. That is an **open dependency on 10.8**, not a decision of this ADR.

### D10 — What this ADR does not promise

No cross-document atomic undo or save; no backup beyond what a host really provides (D12 history is the editor's own, and is a recovery aid, not a guarantee against disk loss); no arbitrary code-to-visual round trip; no byte-identical shortcuts or behaviour between native VS Code text and Monaco; no plugin sandbox; no hot reload of a running game; no editing of a format that has no same-version writer; no claim that any of this is implemented.

### D11 — Automatic save

1. **Autosave is on by default in every host** (owner direction, 2026-11-08). It is a user-layer editor setting (`editor.autosave`, default on, with a delay, default one second after the last accepted edit). A user may turn it off.
2. **It writes whole, accepted commands only.** A drag, brush stroke or typing burst is saved after it ends; nothing is written mid-gesture, so autosave never writes a half-made edit.
3. **It never overwrites an unseen external change.** Before writing, the editor compares the file on disk with the revision it last read or wrote. If they differ it does not write; it raises the external-change flow of D3.5 and keeps the local work dirty.
4. **A failed autosave** keeps the document dirty, shows which document failed and why, and retries on the next accepted edit or after a visible interval. It never reports clean.
5. **Every autosave is a history entry** (D12), so autosave cannot destroy the previous version.
6. **Per-host mechanism, one outcome.** The outcome is the same everywhere; the mechanism is not. VS Code ships autosave **off** and owns `files.autoSave`; the extension **never silently changes a user's global setting**. **Owner ruling, 2026-11-09: asking once on first use is acceptable**, and the order below is the ruling, cheapest and least intrusive first:
   1. **Language-scoped default.** Where VS Code lets the extension default autosave on for the editor's own documents with a **language-scoped** `configurationDefaults` entry (for the `.prg` language id), it does that — it does not set `files.autoSave` globally, which would change autosave for every file the person opens.
   2. **Ask once.** For the binary custom editors, where no such default exists, the extension asks once on first use and records the answer. It does not ask again, and it never flips the global setting.
   3. **Own autosave if VS Code does not deliver it.** If the measurement below shows that `files.autoSave` does not reach `saveCustomDocument`, those documents use the editor's own scheduled save from the catalogue's `editor.autosave`, rather than shipping a promise VS Code does not keep.
   Whether VS Code's autosave drives a `CustomEditorProvider` save is still **[UNVERIFIED]**; the owner's ruling is conditional on that proof, which 11.3 owns. The **cheap proof** (about 30 minutes, throwaway, not committed): a minimal `CustomEditorProvider` that fires `onDidChangeCustomDocument` on a click, run once with `files.autoSave: afterDelay` in the Extension Development Host and once under `@vscode/test-web`, logging whether `saveCustomDocument` fires within 1–2 s, then again with only the language-scoped default. Browser and desktop hosts run the editor's own scheduled save.
7. **Run and export** need no extra step: with autosave on the documents are already saved, and the save-before-run rule of D8.2 still verifies it.

### D12 — History and checkpoint groups

*In plain terms:* undo takes back what you just did in this sitting. History is the record of every saved version, kept across sessions, so you can go back to yesterday's version of a board, or undo a whole wizard in one step. It is separate from undo and from Git, and it works the same in every host.

1. **Undo is not history.** Undo is the host's in-session command stack (VS Code's native undo for text; `editId` undo for binary documents). It is not changed by this section and VS Code's own undo is used as is.
2. **Per-document history.** Every successful save (automatic or manual) appends an entry: the content (deduplicated by **SHA-256** content hash, the algorithm fixed in D8.3), a reason (`auto`, `manual`, `before-run`, `before-restore`, `before-conflict-resolution`, `before-delete`, `before-wizard`, `checkpoint`), the time, and a checkpoint group id when the save belongs to one. Deltas are not specified; the first release stores whole contents, deduplicated.
3. **Checkpoint groups.** An operation that writes several documents (the animation and tile wizards, a rename that updates references, an import or conversion, a restore) creates **one group**. The group records the content of every document it touches **before** the first write and the files it created. **Restore group** puts every document back to its pre-operation content and removes files the operation created, as new accepted edits. Because saving is not atomic, restore reports each file separately (restored, already as wanted, failed) and can be retried; it never claims all-or-nothing.
4. **Named checkpoints.** The user can name a **project checkpoint**: a manifest of every authored document's content hash. It is cheap because content is deduplicated. Restoring one is a group restore.
5. **Restore never destroys.** A restore is a new accepted edit and its own history entry, preceded by a `before-restore` entry, so a restore can itself be undone or restored away.
6. **Browsing.** A document timeline and a project timeline list entries with reason, time and size, preview any entry in a read-only view of the same editor, and restore it. Compare is a visual or semantic preview side by side, **not a byte diff**, for binary formats.
7. **Where it lives.** Hosts that can write the project folder keep history inside the project in one reserved folder, so it travels with the project and survives a host change. **Owner ruling, 2026-11-09: confirmed**, on the precedent of `Saved\`, the reserved in-project folder a package already excludes. **That folder is never included in a game package, is listed as excluded in the package inventory check, and is not committed unless the author chooses** (the editor offers an ignore entry and never edits an ignore file silently). Hosts that cannot write the folder (a browser with no folder access) use host storage and say plainly that it can be cleared by the browser.
   * **The exclusion is not free today.** `packaging-and-paths.md` says a package holds *every* file under the project folder and its "Not included" row names only `Saved\`, other projects' mains and anything outside the project. So the exclusion has to be **written into that table and proved in the exporter**, not assumed. That spec amendment and the exporter-level check are owned by **12.9** (whose verify already reads "excludes test-only material"; the history folder is added to it by this ADR) together with **11.14**, which owns the folder. D5.4 and TOOL-5 item 8 rest on the same check for test-only files.
8. **Retention (the numbers are not fixed by this ADR; owner ruling, 2026-11-09).** The proposed 30 days / 90 days / 500 MB are **not adopted**. They cannot be set by judgement: with whole-content entries and D11.5 making every autosave an entry, a p90 board (149 KB, from the corpus) saved 360 times an hour is about 54 MB an hour and reaches 500 MB in about nine working hours, before the 30-day floor is even reached, while content dedup helps only for identical saves. What this ADR fixes, and what 11.14 must set from one measurement:
   * **autosave entries coalesce within a merge window** (the mechanism VS Code's own Local History uses, whose defaults are a 256 KB per-file cap, 50 entries per file and a 10 s merge window "for example when auto save is enabled");
   * the "keep every entry" floor applies to the **non-autosave reasons** (`manual`, `before-run`, `before-restore`, `before-delete`, `before-wizard`, `checkpoint`, and every group record, which are kept until the user deletes them), and **autosave entries get a shorter floor**;
   * history names **which files it covers** — a type allow-list and a size cap — because tilesets reach 4.3 MB in the corpus;
   * a per-project **warning and a thinning offer**, never thinning silently below the floors;
   * all of them are editor settings (D6.2), and **autosave and retention are user-only entries** (D6.3).
   * **The measurement that sets them** is 11.14's first task: one real editing hour through the 11.2/11.3 tracer (or a scripted board-painting hour that calls `writeBoard` on a corpus board), counting accepted-edit gestures per hour and therefore entries per hour for merge windows of 10, 60 and 300 s, then fixing the window and the floors from the resulting MB/day. Until that number exists the settings are `unset` and the store keeps a conservative cap, not an invented one.
9. **Same in every host.** History lives in shared code on top of `fs`; a host adds no history feature of its own (AD-20). VS Code's own Timeline (Local History) keeps working beside it and is not replaced or hidden.

### D13 — Git integration

*In plain terms:* Git is the right tool for sharing and for the long history of a game. The editor should work well with it, not reinvent it.

1. **Git is a capability, not a dependency.** The editor works fully without Git. Hosts declare an `scm` capability; the editor shows Git features only where it is present and says why otherwise.
2. **VS Code uses its built-in Git.** The extension does not implement Git. It cooperates: files the editor writes appear in Source Control as ordinary changes, the history folder is offered for ignoring (D12.7), and an action such as "Commit this checkpoint group" hands the changed files to the built-in Git view rather than committing silently.
3. **Standalone hosts (browser, desktop) get a small, shared Git surface** through a platform-services `scm` interface: status of changed documents, diff preview in the same read-only view as history, stage and commit, and read-only log. Which engine backs it (the user's installed `git` in desktop; an in-browser implementation in the PWA) is a separate decision gated by G6; this ADR selects none. Push and pull, remotes and credentials are **out of scope** until ruled.
   * **Owner ruling, 2026-11-09: this surface is allocated to 11.15, and it is *not* on epic 11's closing path.** It is not a prerequisite of the refactor sweep (11.12) or the closing acceptance (11.13). The reasons, recorded so they are not re-argued: epic 11's envelope has no Git item and no entry in epics 11–15 mentions Git; the engine is a G6 decision with **no candidate evaluated anywhere in the repository**; as scoped it cannot address the loss the research evidences, which is whole-machine and archive loss, because a local commit lives on the same disk; and the Git work that does matter is already the format direction (text-first, Git-friendly authored data) plus VS Code's built-in Git. D13.1, D13.2, D13.4 and D13.5 stay binding now.
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
| History store, checkpoint groups, retention, timeline UI and package-inventory exclusion: unspecified in code | 11.14 ([#1828](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1828), allocated 2026-11-09); the spec text and exporter check also need 12.9 |
| Git surface (`scm`), its engine choice and the VS Code Git API hand-off: unspecified | 11.15 ([#1829](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1829), allocated 2026-11-09); not on epic 11's closing path, and the engine needs its own G6 decision first |
| Native VS Code text/visual synchronisation has been read from documentation, not prototyped | 11.7 |

## Alternatives considered

* **Keep AD-19's generic byte model for VS Code text.** Rejected: it creates a second editable copy next to the `TextDocument`, which is exactly the dual ownership D2 forbids.
* **Store personal preferences in the game.** Rejected: a project would carry one author's layout, and the game format gains fields it has no reason to hold.
* **Keep `sys_test.prg`.** Rejected: it writes into creator-owned folders and can overwrite a file the creator wrote.
* **Pick `dockview` or Dock Spawn now.** Rejected: the libraries' keyboard support is unverified or Enterprise-only, and even with the framework settled ([ADR 0025](0025-editor-ui-framework-preact-tsx.md)) a library still has to pass the D7.3 packaged-host gate.
* **A cross-document transaction for linked edits.** Rejected: no host provides one and a false rollback promise is worse than an honest per-file report. Checkpoint groups (D12.3) give the recovery without the promise.
* **Rely on each host's own history (VS Code Local History) and Git only.** Rejected: browser and desktop have neither, and neither groups several documents into one restorable operation; behaviour would differ per host (D12.9). VS Code's own features stay available beside ours.
* **Implement Git inside the VS Code extension.** Rejected: VS Code's built-in Git is better and users already have it.
* **Autosave off by default, as VS Code does.** Rejected by the owner: a creator's work should not be lost to a missed save; history (D12) is what makes autosave safe.

## Owner decisions, 2026-11-09

Jensen answered all ten questions with **"yes all of that sounds great"**, adopting every recommendation of the decision memo written for this ticket. Each answer and its reason are recorded below; the original question is kept so the answer reads against what was asked. Two of them (7 and 8) are decisions **with a measurement still owed**, and their measurement is named.

1. **"Approve D1–D8 as written, or mark the rules to change." — Approved, with three wording edits and one follow-up.**
   * **D1.1** now says **ASCII**-folded, as `docs/spec/formats/README.md#paths-inside-files` defines, and points at the native-contracts identity when those documents arrive. Reason: the engine and the packager already fold ASCII only, so an unqualified "case-folded" could be implemented with Unicode lowercasing and then disagree with them on, for example, `U+212A`.
   * **D2** now has a row for native YAML documents, saying they are **deferred** for the first release (the owner's decision of 2026-11-09 amending ADR 0005) and that when they arrive they are text and follow the RPGCode-text row. Reason: as written, a YAML document fitted none of D2's four rows.
   * **D8.2** now records **save-before-run as an explicit owner ruling**, dated, and supersedes the "unconfirmed" note in the research record. Reason: it changes 3.1 behaviour, and an unconfirmed proposal must not become a rule by accident.
   * **F1, the follow-up:** `packaging-and-paths.md` says a package holds every file under the project folder, so the test-file and history-folder exclusions must be written into that table and proved in the exporter. Allocated to **12.9** with **11.14**; see D12.7.
2. **"D6.3: are two layers (user, project) enough for the first release?" — Yes, two layers, and the catalogue may mark user-only entries.**
   * Reason: the header template and the RPGCode indent width are conventions of the game, and user + workspace maps one-to-one onto VS Code's settings; but a cloned project must not change another person's autosave, history retention or layout, so those entries are flagged user-only and shared code ignores a project value for them. Recorded in D6.2–D6.3.
3. **"D7.3: which UI framework does `editor-ui` use (or is the choice a separate ADR before docking)?" — Preact with TSX, decided separately in [ADR 0025](0025-editor-ui-framework-preact-tsx.md).**
   * Reason: the choice gates 11.2 (the first UI), not only docking, and this ADR needed 11.1's contracts closable without it. The docking library is still not selected: D7.3's packaged-host gate stands, and a React-only library needs a further ADR admitting `preact/compat`.
4. **"D8.5: confirm `sys_test.prg` is not reproduced." — Confirmed.**
   * Reason: the 3.1 editor left the file behind and the corpus records 30 of them in 29 of 60 collection labels, so imported projects already carry real files with that name. D8.5 now says such a file is an ordinary creator program, preserved and never used as a run input.
5. **"D2: confirm the editor does not open a format without a same-version writer even read-write." — Confirmed: a read-only view is allowed, a read-write open is never offered, and conversion is only the explicit upgrade.**
   * Reason: AD-18 promises a writer emits the version it read; opening read-write without a writer would break that or upgrade silently. The real cases are pre-vector boards (the writer refuses below vector minor 4) and compiled programs (no shipped tool writes one). Recorded in D2.
6. **"Approve the TOOL-5 creator-test block, including that spellings of the new fixture and action operations are fixed at 11.9 after review." — Approved, with spellings deferred to 11.9, and item 3 phrased with actions, not keys.**
   * Reason: no implementation exists to test an API shape against, and ADR 0017 makes actions the engine's vocabulary, so a test written against keys would break on rebinding. The block is **accepted**; the open 10.8 matcher ruling ("F-A") remains an **open dependency**, because it may need TOOL-5's "one native command" widened to a closed, test-only set. D9 records both limits.
7. **"D11: confirm that in VS Code, where the extension cannot default autosave on, asking once on first use is acceptable." — Acceptable: language-scoped default first, ask once for custom editors, own autosave if VS Code does not deliver it.**
   * Reason: autosave on by default is what makes "never lose work" true, but the extension must never silently change a person's global `files.autoSave`. The order is D11.6, and the ruling is conditional on the 11.3 proof that `files.autoSave` reaches `saveCustomDocument` — **a measurement still owed by 11.3**, not a settled fact.
8. **"D12.7–D12.8: confirm history lives inside the project in a reserved folder (not committed by default) and set the retention numbers." — Location confirmed; the numbers are not set here.**
   * Reason: an in-project folder travels with the project, on the precedent of `Saved\`; but whole-content entries plus an autosave per accepted gesture make any fixed floor a guess — a p90 board at 360 saves an hour reaches 500 MB in about nine working hours. So D12.8 now fixes the *structure* (autosave entries coalesce within a merge window; the "keep every entry" floor applies to the non-autosave reasons; history names its files and a size cap; a warning and thinning offer; all user-only settings) and leaves the numbers to **one measured editing hour owned by 11.14 — a measurement still owed**, not a decision. The 30/90/500 proposals are not adopted.
9. **"D13.3: is a small shared Git surface in the browser and desktop hosts in scope, with push/pull deferred?" — The surface is allocated to 11.15 and is not on epic 11's closing path.**
   * Reason: epic 11's envelope has no Git item; the engine is a G6 decision with no candidate evaluated in the repository; a surface without push or remote cannot address the whole-machine loss the research evidences; and the Git work that matters is the format direction plus VS Code's built-in Git, which D13.2 already uses. D13.1, D13.2, D13.4 and D13.5 stay binding.
10. **"D8.3: confirm a run snapshot records content hashes of the saved documents it ran." — Confirmed, with SHA-256 named.**
    * Reason: AD-11's FNV-1a is 64-bit and non-cryptographic and `save-game.md` says so, while history dedup would treat an equal hash as the same content and could substitute one version of a board for another; the package descriptor already uses SHA-256. D8.3 fixes the algorithm, the shape (per-document hashes for targeted documents plus one project manifest hash) and the measured cost (31 ms / 47 ms over 57.5 MB on one machine, 2026-11-09 — a measurement, not a guarantee).

### What remains open inside the accepted rules

* **7 — the autosave proof.** Whether `files.autoSave` drives a `CustomEditorProvider` save, and whether a language-scoped default applies to a contributed language, are unmeasured. 11.3 owes the 30-minute proof; if it fails, D11.6 step 3 replaces the promise.
* **8 — the retention numbers.** 11.14 owes one measured editing hour, then fixes the merge window and the floors.
* **The 10.8 "F-A" ruling.** An open dependency of D9/TOOL-5, not a decision of this ADR.
* **11.1 itself.** This ADR is accepted; the ticket closes when the owner has read this approved text.

### What was and was not amended

* **AD-19, amended 2026-11-09.** "the document wording of AD-19" meant exactly one thing, because D2.1 and D2.4 say it: the *bytes plus commands* model is the rule for **binary** documents, and for a text document in VS Code the `TextDocument` is authoritative with the host's native undo and no `editId`. One sentence was added to AD-19's Rule to say that, and nothing else in it changed.
* **AD-20, not amended.** The ADR's status line used to promise "the `run` wording of AD-20", but D8 requires nothing that AD-20's `run` entry (`startGame`, `startProgram` with a fixture, returning a handle) does not already say. No wording was invented. If a later ruling adds a launch kind or a snapshot to the platform surface, that is the change AD-20 waits for.
* **TOOL-5, amended.** The creator-test block's status is now accepted by the same owner approval, with the spellings still fixed at 11.9.
