# Plugin data models: what the research showed and what was decided

**Status: research record.** The decisions below are the owner's, recorded in [ADR 0023](../../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md) and [ADR 0024](../../adr/0024-plugin-data-contributions.md) (both still Proposed) and written into [the spec](../../spec/formats/native-contracts.md#plugin-blocks). Nothing here changes a ruling. The research was done against `origin/main` at `39fa89e8` (2026-11-09); every repository claim below is from that revision.

| | |
|---|---|
| Question | Where does data that a plugin owns live, for an actor, a scene, a clip or the project: in a document of its own, linked both ways to its owner, or inside the document it belongs to? |
| Evidence | How VS Code, Cargo, Python's `pyproject.toml` and glTF handle namespaced, tool-owned data; what the repository already says; and small measurements made for this question: Git merges of one document, the checker, and the writers. |
| Decision | Plugin data lives in the document it belongs to, under one open key, `pluginData`, in a block per plugin id with its own version. The core checks the envelope and never the contents. See [the rulings](#the-owners-rulings). |

## The question

[ADR 0023](../../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md) as first written (2026-11-08) put each plugin's data for an owner in a **separate document** with its own contract and version. The owner and the plugin document named each other by ID, and a missing, one-way or mismatched link was an error. That rule rejected a namespaced block inside the owner's document, for three reasons: the core and each plugin version independently, plugin edits stay off the core's lines in a merge, and an absent plugin's data is trivially safe to leave alone.

On 2026-11-09 the owner pointed at the VS Code settings model instead. This record compares the models, measures what could be measured, and states what is unverified.

## The owner's rulings

All are dated 2026-11-09 unless stated. The brief for this change called them four rulings and listed six numbered points; they are grouped here as four.

| # | Ruling | Where it is written |
|---|---|---|
| 1 | **Plugin data lives in the document it belongs to**, under one open key, keyed by plugin id; each block has its own `version` and `data`. The core checks only the envelope (id well formed, version parses, `data` is a mapping). The plugin owns schema, version and migration. Unknown keys inside `data` are tolerated and never dropped. An absent plugin's block is preserved as written. Data newer than the plugin is read for its known keys. It replaces the 2026-11-08 ruling that plugin data is a separate, two-way-linked document. | ADR 0023 decision 7 |
| 2 | **The two-rule model.** A contract's own fields are closed (an unknown key is an error, so `colorKey` cannot pass for `colourKey`); plugin namespaces are open (unknown keys tolerated and preserved). Every writer must preserve what it does not understand, byte for byte, comments included. | ADR 0023 decision 12 |
| 3 | **Plugin ids may be qualified with dots** (`com.example.weather`), and **a plugin contributes its configuration much as a VS Code extension does through `contributes.configuration`**, declaring which asset contract each contribution attaches to, so a plugin can contribute a per-actor and a per-project configuration separately. | PKG-2 amendment; ADR 0024 |
| 4 | **The three two-way-link checker classes are retired**; one class, `plugin-block`, replaces their role. The **rename tool is kept with a smaller scope** (no link rewriting). How a rename treats references inside plugin data is an **open question**, with two candidate answers and no decision. | ADR 0023 decisions 8 and 12 and open questions; the spec's checker and rename sections |

The statements behind them, as the owner made them:

- 2026-11-09, on the direction: "the VS Code settings ecosystem would be perfect for how we do our YAML files. Provide a namespace and give it a version to have to follow inside the namespace. We could consider this same path forward internally as well if we plan to dogfood. This would allow the plugins to define the version number and the migration needed."
- 2026-11-09, on data newer than the plugin: "I'd tolerate unknown keys. just take what is there. we will have the plugins provide schemas that the sections can be validated against."
- 2026-11-09, on contributions: "every property added likely belongs to a particular asset type so we need a way to qualify which asset type is getting that new property. This way if someone wanted to add to `tkranm` they would be able to do so with their own namespacing."
- 2026-11-09, on the shape and the name of the key: see [the shape and the name](#the-shape-and-the-name-of-the-open-key).
- 2026-11-09, a tentative direction, **not a ruling**: [the shrinking core](#the-shrinking-core).

The dates of the first two statements are the date of the session in which they were made; the research had no timestamp from the owner's messages themselves.

## What the evidence showed

### How VS Code models extension settings

- An extension contributes settings through a manifest contribution point and the user edits them in `settings.json` ([contribution points](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration)). Keys are namespaced by a prefix, with uniqueness rules only: "each setting of the extension must still have its own unique ID". The documentation read shows the prefix as a convention and does not say it is enforced ([unverified 1](#unverified)).
- **The extension supplies the schema:** "Configuration keys are defined using a superset of JSON Schema", used both for intellisense and for the settings UI. A separate contribution point exists for file schemas (`contributes.jsonValidation`).
- **Unknown or absent settings are kept, not rejected.** The documentation does not state what happens to the settings of an uninstalled extension; the evidence is issue threads: [#106852](https://github.com/microsoft/vscode/issues/106852) ("when an extension is uninstalled, this file continues to contain informations about the old extension. Therefore, if the extension is installed again, the old settings are taken into account"), [#110495](https://github.com/microsoft/vscode/issues/110495) and [#115957](https://github.com/microsoft/vscode/issues/115957), where unknown settings are greyed out and a maintainer closed a request to warn about them "as designed". VS Code keeps the keys, shows them as unknown (a hint, not an error) and applies them again if the extension returns. This is the behaviour the owner's tolerance ruling asks for.
- **Per-namespace versioning and migration: none found** in the contribution-point, settings and sync pages read ([unverified 3](#unverified)). Extensions handle it ad hoc (the Python extension's wiki describes a setting that "is no longer used" and a new key). The plugin-defined version and migration are therefore **our** addition to the VS Code model.
- **Structured per-object data is not a setting.** VS Code's own answer for arbitrary per-extension data is outside `settings.json` (`ExtensionContext.storageUri`, `workspaceState`), and Python moved machine-specific state out of `settings.json` because it broke committed team settings. The settings file is the editor's convenience layer; data that a non-editor consumer must read lives in the project's files, which is where every model here puts it.

### Other formats that keep their own fields beside one open, namespaced region

- **Cargo.** "Cargo by default will warn about unused keys in Cargo.toml to assist in detecting typos and such. The `package.metadata` table, however, is completely ignored by Cargo and will not be warned about." Cargo's own fields stay unwrapped in `[package]`, next to one open table ([manifest reference](https://doc.rust-lang.org/cargo/reference/manifest.html#the-metadata-table)). This is the two-rule model in production.
- **Python `pyproject.toml`.** "The `[tool]` table is where any tool related to your Python project, not just build tools, can have users specify configuration data as long as they use a sub-table within `[tool]`", and a project may use `tool.$NAME` "if, and only if, they own the entry for `$NAME`" on PyPI ([PEP 518](https://peps.python.org/pep-0518/)). The core tables stay at the top level.
- **glTF 2.0.** The root object keeps its own properties (`asset`, `scenes`, `nodes` and the rest) unwrapped and has an optional `extensions` dictionary; "Any glTF object MAY have an optional `extensions` property". Extensions "used" must be listed in `extensionsUsed` and those "required" in `extensionsRequired`. For this project the `.gam` package list already says which packages a game requires, so no per-document list is kept ([specification](https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc)).

### What the repository already said

- **Plugin ids** were the PKG-2 identifier, with no dots ([PKG-2](../../spec/engine/rpgcode-modules-and-objects.md#pkg-2)); a package version "is a string compared for equality only", so a block's version, the version of a data contract, is a different thing.
- **The project definition** was already described as owning "startup and global hooks, extension configuration" ([candidate constructions](../native-data-boundaries/candidate-constructions.md)).
- **The settings split for the editor** is [ADR 0022](../../adr/0022-shared-editor-authoring-contracts.md) D6: authored game data never lives in `settings.json`; plugin contributions to the editor's settings catalogue are not decided there.
- **The #1799 YAML research** had already prototyped a namespaced extension block: `extensions:` with `com.example.weather` keyed by a qualified id, an integer `version`, a closed plugin schema, and a newer version treated as an error ([yaml-profile](../native-data-notations/yaml-profile/README.md)). The owner's ruling differs on three points: the version is a semver-form string, the payload is under `data`, and a newer version is read for its known keys, not refused.

## The models compared

| Model | Shape |
|---|---|
| **A** (the 2026-11-08 rule) | One plugin document per owner per plugin, linked both ways by a field in each. |
| **B** (as first rejected) | A namespaced block in the owner, with no per-block version, no envelope rule and no tolerance rule. |
| **C** | One project-level plugin-data document, a namespace per plugin, entries keyed by owner ID. |
| **D** | One document per plugin at project level, entries keyed by owner ID. |
| **E** | Hybrid: small data in a block, bulky or independently identified data in a document. |
| **F** | A drop-in directory beside each owner (`guard.tkract.d/weather.tkrwea`): the location is the link, so there is no stored link. |
| **G** (chosen, with E's test) | Namespaced, versioned blocks in the owning document under one open key; the core checks the envelope only. Data with its own identity, no native owner or bulk is a document of a plugin-defined contract, referred to one way by ID (proposed). |

In one line each: A stays correct for documents with an identity of their own and is wrong as the default. B is G without version, envelope and tolerance. C concentrates every plugin edit in one file under one stamp. D has A's merge locality without A's file count but one plugin's entries share a file. F is the sidecar shape if sidecars are kept, and keeps A's file count.

## Measured Git merge behaviour

**Caveat that governs this section.** These are **single synthetic files**, `git 2.55.0`, the default merge, with edits made by script. They show a mechanism and not a rate. Merge behaviour for models C and D was inferred from the same mechanics and not run. The experiments named the open key `plugins`, which was the working name then; the key's name has no effect on the result.

A document in model G's shape with two blocks, one edit on each branch:

| Scenario | Result |
|---|---|
| S1: a core `delay` edit against a block's data value | clean merge |
| S2: two plugins' data lines in adjacent blocks | clean merge |
| S3: both branches append a key to the same block's `data` | **conflict** |
| S4: both branches append a new block at the end | **conflict** |
| S5: the same new plugin id added at the top by one branch and at the end by the other | **clean merge that left the id twice** |
| S6: an edit to the last core line against the open key's own line (adjacent) | **conflict** |
| S7 (model A): two branches each add a different plugin to one owner's list line | **conflict** |
| S8 (model A): one branch deletes a plugin document and its list entry while the other edits the document | **conflict** (modify/delete) |

Reading: plugin edits **do** land in the core file's merges under G, adjacent edits conflict, and a clean merge can silently duplicate a namespace (so the checker needs the `duplicate` problem kind). Model A conflicts too, on the owner's list line. Sorted insertion of blocks is expected to turn S5 into a visible conflict, because both branches then insert at the same place; that was not measured.

## Other measurements

- **The checker, as built on `origin/main`:** a plugin document whose extension is not in the registry is invisible to it, so a correct pair is false-reported as an owner link with no back-link ("no such document, but no document has this ID"); a plugin document that uses the owner's extension is reported as extension and contract disagree. So the old rule forced a registry row and an extension per plugin contract, in the core package.
- **Writers:** reading a block into a JavaScript value and writing it back turned `futureKnob:   1.10` into `1.1`, moved an integer-like key `10` first and quoted it, expanded the flow map `{y: 1,  x: 2}` and dropped every comment. Re-printing the **unedited** parsed document changed the spacing before trailing comments and the flow padding, which is why the spec forbids it. A splice of one core scalar left the block byte for byte and changed one line.
- **The clip reader and editor on main** refuse any clip that carries the open key, as an unknown key of a closed contract, so a one-property edit of such a clip is refused (loudly, not by losing data). The rename planner preserves block bytes, because it edits only the scalars it found in reference fields, and leaves a reference **inside** plugin data dangling and unreported. That limit is true of model A as well.
- **The ownership of the schema:** a JSON Schema for the envelope (plugin id, a version in the standard form, `data` a mapping, nothing else) validated ten sample documents with Ajv 8; it cannot see a repeated plugin id (YAML reports it as `DUPLICATE_KEY`, but the parsed value passes) or an anchor crossing a block's boundary.

## File-count arithmetic

Upper bound: every owner carries every plugin's data. The sparse case is `owners × plugins × f`, where `f` is the fraction of owners that carry a plugin's data.

| | Actors: 200 owners, 5 plugins | Scenes: 1,000 owners, 5 plugins |
|---|---|---|
| **A** extra files | 200 × 5 = **1,000** (1,200 files in all) | 1,000 × 5 = **5,000** (6,000 in all) |
| **C** extra files | **1** | **1** |
| **D** extra files | 5 | 5 |
| **F** extra files | 1,000, with no link fields | 5,000 |
| **G** extra files | **0**: 1,000 blocks inside the 200 files | **0**: 5,000 blocks inside the 1,000 files |

Under A each plugin document holds one owner field and each owner lists one entry per plugin: 2,000 link fields that must agree for the actors (1,000 pairs), and 10,000 for the scenes. Under A every plugin contract also needs a registry row and its own extension. A plugin MAJOR upgrade touches 200 files under G, as many as under A.

**Grounding in the corpus.** From [`assets.jsonl`](../native-data-boundaries/data/assets.jsonl) (15,897 rows), counting distinct `sha256` per game label: the largest actor-like total (`.tem`, `.itm` and `.ene`) is 249, and the largest `.brd` count is 394. So 200 actors is the upper end of what was recovered and 1,000 scenes is about 2.5 times the largest recovered game. The corpus README's caveat applies: a label is not a distinct game, and the counts include files the decoders refused. The script was not committed ([unverified 9](#unverified)).

## The strongest counter-argument

The file boundary was the only isolation that did not depend on every tool behaving. Under blocks a plugin's buggy or third-party writer can corrupt or reformat the *core's* document, plugin edits land in the core file's merges, and "an absent plugin's data is safe" becomes "safe only while every writer in the ecosystem follows the splice discipline", which can be tested for our writers and cannot be tested for anyone else's. Adjacent edits conflicted in the measurements (S3, S4, S6), and one clean merge silently produced a duplicate namespace (S5).

Weaker counter-arguments worth stating: with the plugin absent, a typo inside `data` is invisible, and with it present an optional key that is misspelt is just an unknown key, which is the price of tolerance. A block's `version` line repeats in every owner. A nested object (a scene placement, a clip frame) has no ID and so no door, whatever the model.

## The shrinking core

**A tentative direction, owner-stated, and explicitly not a decision.** On 2026-11-09 the owner said: "eventually there may not be any 'core' items in a sense. every field will likely have a plugin / extension they are driven by."

**The principle, as recorded.** Long term, game-semantic fields may migrate from a contract's core fields into plugin namespaces, and the core shrinks to what cannot be plugin-owned. **Nothing moves today, and no existing contract changes because of this.** None of the rulings above depends on it, and none is weakened by it.

**What must stay in the core: a proposal, not a ruling.** Everything in (a) to (e) is defensible as core; everything else is a candidate to move into a namespace.

- (a) **What a document needs to be identified:** its path, the stamp, `contract` and `version`.
- (b) **What other documents need to reference it:** its ID and the references it holds, so that rename and the checker keep working without any plugin code.
- (c) **What tooling needs to load and structure-check it with no plugin installed:** the closed spine, the one open key and the envelope.
- (d) **What keeps determinism, replay and saves sound:** G1 and G3, the tick model, and the package list that pins which plugins and versions produced a save.
- (e) **Anything a security boundary requires:** the trust baseline of [ADR 0008](../../adr/0008-rpgcode-packages-and-trust-baseline.md) and the plugin contract of [ADR 0004](../../adr/0004-script-ast-step-ir-and-plugins.md).

**The consequences, as risks and not as arguments against.**

- **A project becomes dependent on its exact plugin set.** This is absence at scale, not just an absent optional block: a game whose fields live in plugins is not playable, or not editable, without them.
- **The closed or open split matters more, not less.** The core spine must stay small enough to check with no plugin installed.
- **Migrations become an ecosystem problem.** A plugin that disappears leaves data that no one can migrate.
- **A field that moves out of the core is a MAJOR change to that contract,** because the shape of the document changes. With the flat shape of the spec the move itself is mechanical: `delay` becomes `pluginData.<id>.data.delay`.

**What would have to be true before any specific field leaves the core.** The plugin definition's data descriptor exists ([ADR 0024](../../adr/0024-plugin-data-contributions.md)). The plugin-present validation pass exists. Saving and loading pin plugin versions. A migration owner exists for orphaned data. There is no timeline here, and no list of fields to move.

## The shape and the name of the open key

These are the owner's proposals of the same day, recorded with the reasons in [ADR 0023](../../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md#alternatives-considered). They are separate from the rulings above.

- **A `core:` wrapper for a contract's own fields.** The owner: "there will be a set of core shared fields that identify the document. We could even setup a special 'namespace' for core that is toplevel. That way we can make those 'core' properties beyond the identity." Considered and not adopted in the documents; the flat shape (a contract's own fields at the top level, beside the stamp, with one open key) is recommended, and the owner is weighing it. The reasons are the extra nesting level, the collision with the word "core" as this repository uses it, the precedent of Cargo, `[tool]` and glTF above, shorter error paths and an equally mechanical later move. The one benefit of the wrapper is that whether a field is core or plugin can be told from its depth alone.
- **The name of the open key.** The owner found `plugins` not descriptive and floated `metadata`, `extensionData` and `pluginData`. `pluginData` is used. `metadata` is already a reserved stamp key for provenance, and "extension" already means a file extension (`.tkranm`) throughout the ADR that defines the extension registry.

## Unverified

1. Whether VS Code *enforces* that a setting key's prefix matches the contributing extension. The documentation read shows the prefix as a convention only.
2. Any VS Code documentation page stating what happens to the settings of an uninstalled or disabled extension. The evidence is issue threads and one maintainer's "as designed" on a related issue.
3. Absence claim: that VS Code has no per-namespace versioning or migration facility. Based on the contribution-point, settings and sync pages read, not an exhaustive search.
4. How Settings Sync treats keys of namespaces it does not know.
5. `launch.json` behaviour when the debugger extension is missing: only a user-reported message, not a documentation page.
6. The exact dates of the owner's first two statements (the session date was used).
7. The Git experiments are single synthetic files, default merge, `git 2.55.0`; they show the mechanism, not rates. Merge behaviour for C and D is inferred.
8. The checker, rename planner and clip reader were run from a copy of `origin/main`'s sources with Node 26.13.0 (`--experimental-strip-types`) and `yaml` 2.9.1; the repository's own test runner was not used and no repository tests were run.
9. The census counts: distinct `sha256` per game label from `assets.jsonl`, including files the decoders refused; a label is not a distinct game; the script was not committed.
10. Whether any plugin will need data attached to binary assets or legacy files: no repository evidence either way.
11. The payload keys in every example (`footstep`, `bloom`, `wind`, `charge` and the rest) are illustrative; the repository says what a stock package owns, not what it would store per actor or per project.
12. Reverse-DNS ids appear only in the #1799 prototype before this ruling; no manifest or spec used them.
13. Whether plugin migrations are written in RPGCode or TypeScript, and how G2 and G3 apply to them. [ADR 0024](../../adr/0024-plugin-data-contributions.md) makes migrations plain-data operations, which sidesteps the question until a computed migration is wanted.
14. The perturbation tests of the preservation rule (each test run against a deliberately regenerating writer) are a design. Only the three regenerating-writer demonstrations above were run.
15. That sorted insertion of blocks turns a silent duplicate into a visible conflict is inferred from S5, not measured.

## What was not copied

The research used throwaway scripts and scratch copies of `origin/main`'s sources outside the repository. None of that is committed here; the figures above are the record.
