# Native data contracts: stamp, versions, identity and plugin blocks

**Status: proposed, pending owner approval** ([ADR 0023](../../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md), [ADR 0024](../../adr/0024-plugin-data-contributions.md), ticket 27.1). This is a **Reawakened rule**: it describes TK Reawakened's own native documents, not any Toolkit 3.1 behaviour. Legacy files keep the binary headers described in [the format conventions](README.md#header-and-version); they reach the native documents only through an importer ([ADR 0009](../../adr/0009-compatibility-layer-not-the-model.md)). **One part awaits the owner's choice:** a contract's own fields stay at the top level beside the stamp, as written on this page, and are not wrapped in a `core:` section of their own; [ADR 0023](../../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md#alternatives-considered) records the wrapper and why it is not adopted here.

## In plain words

A native document says at the top which kind of document it is and which version of that kind it follows, so a person or a tool always knows what shape to expect. Every kind of document (a "contract") has its own version number, so a change to animation clips never forces a change to actors. Every kind also has its own file extension, so you can tell an animation clip from anything else by its name, and a classic legacy file never shares an extension with a native document. A document is named by where it lives, extension included, so two documents can never quietly share a name. The fields of the kind itself are strict: a typo is an error. Anything a plugin adds to an actor, a scene or a clip lives in the same document, under one key, `pluginData`, in a block with the plugin's own name and its own version. That key is open: a plugin owns what is inside its block, a newer plugin's extra keys are kept and never reported, and a tool that does not know the plugin leaves its block exactly as written. A checker reports anything that does not line up, by name, and never fixes it on its own.

The rules below are precise. The examples use YAML, the authored notation the owner accepted in [research #1799](../../findings/native-data-notations/README.md); the rules do not depend on YAML, and the YAML profile and layout rules are not set here.

## The top level of a document

The top level of a native document holds exactly three kinds of key:

- **The stamp:** `contract` and `version` (required, always the first two keys) and optionally `tags` and `metadata`. It says what the document is.
- **The contract's own fields,** the **core fields**: well defined, listed on the contract's page (`canvas`, `delay`, `colourKey` and `frames` for an animation clip). They are **closed**: an unknown key at the top level is an error, so a typo such as `colorKey` cannot pass for `colourKey`.
- **`pluginData`:** the one open dictionary, with one block per plugin id ([plugin blocks](#plugin-blocks)). Inside a block's `data`, unknown keys are tolerated and preserved.

**Reserved top-level keys.** `contract`, `version`, `tags`, `metadata` and `pluginData` are reserved in every contract, and so are the core fields of each contract. A contract's own field is never named one of the five, and a **plugin id may not be one of the reserved keys**. The top level admits exactly the contract's core fields and the reserved keys, and nothing else.

**Words used on this page.** "The core" is the engine and its tools (the checker, the rename tool, a contract's reader). "Core fields" are a contract's own top-level fields, such as `delay`. A plugin is anything that declares a [data contribution](../../adr/0024-plugin-data-contributions.md), first-party or not.

**Why one dictionary and not a section for the core fields.** The closed or open rule then depends on one thing, whether a key is in `pluginData` or not, and the contract's own fields keep their short paths (`frames[1].image`). The formats that already solve this problem keep their own fields unwrapped beside one open dictionary ([findings](../../findings/plugin-data-models/README.md#what-the-evidence-showed)). A wrapper section was proposed and is recorded, with its one benefit, in [ADR 0023](../../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md#alternatives-considered). The key is spelt `pluginData`, and why is in [the notes of the same ADR](../../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md#notes).

## Stamp

Every native document starts with a **stamp**.

| Key | Required | Meaning |
|---|---|---|
| `contract` | yes | The name of the contract this document follows, such as an animation clip or an actor. |
| `version` | yes | The contract version the document was written against, in the [form below](#versions). |
| `tags` | no | A list of free-form labels for people and tools, such as `imported`. |
| `metadata` | no | Facts about where the file came from, such as the source file it was imported from. |

```yaml
contract: animation-clip
version: 1.0.0-pre.3
tags: [imported]
metadata:
  source: start_s.anm
```

Rules:

1. `contract` and `version` are the first two keys in the document.
2. The core reads only contract fields: the stamp and the contract's own fields. It never reads `tags` or `metadata`, and neither can change how a game plays. Anything that changes how the core behaves is a field of the contract, not a tag or metadata. A plugin reads only the block under its own id in `pluginData` ([plugin blocks](#plugin-blocks)), and may change how a game plays through it. Nothing reads `metadata`.
3. `tags` and `metadata` hold no timestamps and no values that change on every save. Git already records when a file changed, and such a value turns every edit into a second changed line and a merge conflict. The same is policy for a first-party plugin's block; the core cannot enforce it for a plugin's data.
4. A missing, repeated or unreadable stamp is an error. A reader never guesses a contract or a version.
5. Adding `tags` or `metadata` to a contract that lacks them is a MINOR change; both are optional.

The stamp keys use a fixed spelling. The exact spelling of the keys inside `metadata`, and the vocabulary of `tags`, are open ([open items](#not-decided-here)).

## Versions

### What a version number promises

Each contract has its own version, in the form `MAJOR.MINOR.PATCH` of [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). The rules are those of an API contract, where the two sides of the contract are the editor and the engine:

| Change | Bump | Rule |
|---|---|---|
| A bug fix, or a clarification of what the contract already meant | PATCH | Every existing document still means what it meant. |
| A new optional property or a new feature, compatible with every existing document | MINOR | Existing documents stay valid unchanged. |
| A change that breaks the contract between the editor and the engine | MAJOR | A document written before it may no longer load or mean the same. A migration is required. |

Two cases follow from the same test and are stated so they are not argued later:

- **Tightening a schema** is a MAJOR change only when the looser rule was intended and files in use relied on it. Otherwise the loose rule was a bug and the tightening is a bug fix (PATCH).
- **A change to what a field means** is a MAJOR change only when it changes the shape of the field. Otherwise it is a bug fix (PATCH).

**Version 1.0.0 is a promise.** A contract has no 1.0.0 until it is published in a release. From that release on it is honored under the rules above: nothing breaks without a MAJOR bump and a migration. Before that, a contract carries a pre-release version and is free to change.

### The form of a version string

```text
MAJOR.MINOR.PATCH[-pre.N][+build]
```

- `MAJOR`, `MINOR` and `PATCH` are non-negative whole numbers with no leading zeros. All three are always written.
- The optional **pre-release** is dotted, as in Semantic Versioning: `1.0.0-pre.12`. `N` is a whole number. Dotted numeric parts compare as numbers, so `pre.9` sorts before `pre.10` with no padding.
- The optional **build suffix** after `+` is debug evidence only, such as the tool build that wrote a file. The engine, the checker's version comparison and version precedence all ignore it. Two versions that differ only after `+` are the same version.

| Valid | Invalid | Why the invalid one fails |
|---|---|---|
| `1.0.0` | `1.0` | Patch missing. |
| `1.2.3` | `v1.2.3` | A prefix is not part of the version. |
| `1.0.0-pre.12` | `1.0.0-` | An empty pre-release. |
| `1.0.0+debug.7` | `1.0.0+` | An empty build suffix. |
| `1.0.0-pre.12+build.5` | `01.0.0` | A leading zero. |

Because a version always has three parts, a YAML reader reads it as text and never as a number. A bare `1.0` would lose its trailing zero as a number, which is why it is invalid.

A plugin block's `version` is written in this same form ([plugin blocks](#the-envelope)).

### One version per contract

Each contract is versioned on its own, like separate API definitions. A document records the version of its own contract only. There is no project-wide version number and no manifest of versions: each document carries its own stamp and a loader chooses the rules for each document from that stamp. A project can hold documents at different versions, and upgrading a project migrates the documents whose version is behind.

A plugin block carries a version of its own, the version of that plugin's data on that contract. It is independent of the document's contract version, of the plugin package's version ([PKG-2](../engine/rpgcode-modules-and-objects.md#pkg-2) compares package versions for equality only) and of every other block's version.

## File names

An extension that is registered below (each one starts with `tkr`) marks a native document of the registered kind, and a classic extension (`.anm`, `.brd`, `.tem`, `.itm`, `.ene`, `.tst` and the rest) marks a legacy file that is read through the compatibility layer ([ADR 0009](../../adr/0009-compatibility-layer-not-the-model.md)); the two families are told apart by extension alone. A legacy file and a native document with the same stem, such as `walk.anm` and `walk.tkranm`, can sit in the same folder, because they never share an extension.

1. **One extension per kind.** Each contract has one extension and each extension belongs to one contract. An extension is `.tkr` and a three-letter kind code, all lowercase ASCII letters. A new kind, such as a future actor or scene contract, takes `.tkr` and its own three letters when its contract is written.
2. **New names, not the legacy ones.** A native extension is never a legacy one. A project can therefore hold `walk.anm` and `walk.tkranm` together, and no tool that goes by extension takes a legacy binary for native YAML, or the reverse.
3. **The content is YAML,** the authored notation ([research #1799](../../findings/native-data-notations/README.md)). The extension names the kind; it says nothing about the version.
4. **The stamp stays authoritative.** A loader chooses the rules for a document from its stamp ([stamp rule 4](#stamp)); the extension serves people, file managers and tools that must decide before they open the file. The extension and the stamp's `contract` MUST agree, and a mismatch is an error: no reader trusts one over the other, and the [checker](#checker) reports it.
5. **Case.** An extension is compared with only A to Z folded ([identity](#identity), rule 1), so `.TKRANM` is `.tkranm`. A writer writes it lowercase.
6. **Not registered, not native.** A file whose extension is not in the registry is not a native document, whatever it holds. The checker does not read it and does not report it, and that holds for a legacy file and for a misspelt `tkr` extension alike ([open items](#not-decided-here)).

### The registry

| Extension | Contract | Contract page |
|---|---|---|
| `.tkranm` | `animation-clip` | [native-animation-clip.md](native-animation-clip.md) |

Only the animation clip has a contract so far. The registry grows with each new contract: when a contract is written (the actor, scene, item, enemy and tileset contracts are still to come, stories 27.7 and 27.8 of [epic #1802](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1802)), its extension is chosen by rule 1 and its row is added here and in `packages/native-data` in the same change. No extension is held for a contract that does not exist yet. A test fails when the code's registry and this table differ.

A plugin block is not a document and has no extension, so a plugin that attaches data to a native document needs no row here. Only a contract that is a document of its own does ([block or document](#block-or-document)).

## Identity

A document's **ID** is its path within the project, **extension included**: the ID of an animation clip is `clips/walk.tkranm`. The ID is authored (a person or the editor chose the path) and stable (it changes only through an explicit rename that updates every reference). Other documents refer to a document by its ID.

1. IDs are lowercase. Folding is **ASCII only**: the letters A to Z fold to a to z, in the extension as in the rest of the path. Every other character compares as written, so behaviour never depends on a locale or on Unicode tables (G3).
2. Comparison ignores case: `Guard` and `guard` are the same ID, and so are `.TKRANM` and `.tkranm`.
3. When a reference must be turned into an actual file, the file system is consulted and the entry whose casing matches is chosen. A writer creates new documents with a lowercase path.
4. Two paths that are equal after folding are an error that names both paths. This holds on a case-sensitive file system, where `Guard.tkranm` and `guard.tkranm` can both exist, and it is why a project checked out on a case-insensitive host never loses a document.
5. The separator between parts is `/`. An empty part and a `.` part do not change which file a path means, so `clips//walk.tkranm`, `./clips/walk.tkranm` and `clips/walk.tkranm` are one ID, and two documents that spell one ID differently are a duplicate ID. A `..` part is not resolved and a `\` is an ordinary character ([open items](#not-decided-here)).
6. Because the extension is part of the ID, a clip and an actor can both be named `guard`: `guard.tkranm` and `guard.tkract` are two IDs and nothing clashes. A legacy file such as `guard.anm` is not a native document and has no ID here.
7. A document's kind is part of its ID, so changing the kind changes the extension and is a rename: every reference to the document changes with it. The research found no evidence on whether that is a burden in practice ([findings](../../findings/native-file-extensions/README.md)).
8. A plugin id is not a document ID. It names a plugin, is not a path, is never folded and is never rewritten by a rename.

Why the path: two branches that each add the same new ID merged cleanly in every notation the research tested, and nothing reported the duplicate ([research](../../findings/native-data-notations/README.md#3-nothing-in-the-syntax-prevents-conflicts-or-duplicate-identities)). When the ID is the path, both branches added the same file and Git reports an add/add conflict, so the file system does the uniqueness check.

## Plugin blocks

A plugin's data for a document (an actor's, a scene's, a clip's, the project's) lives **in that document**, under the key `pluginData`, as a **block** named by the plugin's id. A block has a version of its own and a `data` mapping that the plugin owns. The core checks the block's envelope and never reads inside it, and a tool that does not know the plugin leaves the block exactly as written. These are the rules of [ADR 0023](../../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md), decisions 7 and 12. How a plugin declares its schema, its migrations and the contracts it extends is [ADR 0024](../../adr/0024-plugin-data-contributions.md).

### The envelope

```yaml
pluginData:
  com.example.weather:     # the plugin's id
    version: 1.2.0         # the version of this plugin's data on this contract
    data:                  # a mapping; the plugin owns everything inside it
      wind: 3
```

1. `pluginData` is a mapping from plugin id to block, and it is optional. Every native contract admits it at the top level, and no other place in a document holds a block ([limits](#limits-of-this-version)).
2. The key of a block is a **plugin id** as [PKG-2](../engine/rpgcode-modules-and-objects.md#pkg-2) spells it: lowercase ASCII segments separated by dots, such as `com.example.weather`, or one segment, such as `stock_battle`. It is not a reserved top-level key and not a core field of the document's contract. It is not a document ID. A dot inside an id is part of the key and never a path separator, so a tool addresses a block by its whole key and does not split it.
3. A block has exactly two keys, `version` and `data`. `version` is text in the [version form](#the-form-of-a-version-string). `data` is a mapping, which may be empty.
4. A plugin id appears once in `pluginData`.
5. The envelope is closed to `version` and `data`: a misspelt `dat:` is a missing `data`. The reading is flagged for the owner ([open items](#not-decided-here)).
6. A block is **self-contained**: an alias inside a block never names an anchor outside it, and nothing outside a block names an anchor inside it. The exact boundary is a rule of the YAML profile, which is open ([#1799](../../findings/native-data-notations/README.md)). The intent is that a block can be read, edited, moved and left alone without reading anything outside it.
7. Blocks are written in ASCII order of their ids. A writer that adds a block puts it at its sorted position and never reorders the blocks already there, so a hand-ordered file stays as it was written. *Reason:* two branches that add the same id then add it at the same place, where Git reports a conflict, and two branches that added the same id at different places merged cleanly and left a duplicate ([findings](../../findings/plugin-data-models/README.md#measured-git-merge-behaviour)). That this ordering prevents the silent duplicate is expected from that result and was not measured.

### What the core checks and what the plugin checks

| Region | Whose schema | What is checked | When |
|---|---|---|---|
| The contract's own fields | the contract | everything; an unknown key is an error | always (the contract's reader and schema) |
| The envelope of each block | the core, by this page | the id (grammar and reserved keys), the `version` form, `data` is a mapping, no repeated id, no boundary crossing, no extra envelope key | always (the core checker) |
| `data` of a block | the plugin | its own schema for the (plugin id, contract) pair; unknown keys are tolerated | only when the plugin is installed |

**The trade-off, stated plainly.** With the plugin absent, a typo inside `data` is invisible to every check, because nothing but the plugin can know the keys. With the plugin present, its schema catches a wrong type, an out-of-range value or a missing required key on the keys it knows, but an *optional* key that is misspelt is an unknown key and passes. That is the price of tolerating unknown keys, and it is why the contract's own fields, which the core owns, are closed.

### Which contract a block is for

A plugin extends particular contracts: a plugin may add a per-actor configuration and a per-project configuration as two separate contributions ([ADR 0024](../../adr/0024-plugin-data-contributions.md), decision 1).

- **Containment says which contract.** The block sits in a document whose stamp names its contract, so the block's key is the plugin id and nothing else. The contract is not repeated in the key and the block has no `contract` field: a second copy of what the stamp says could drift, which is the argument [ADR 0023](../../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md) used against a manifest of versions and against a stored back-link. The plugin's **declaration** names the contracts it extends; the key does not.
- **One plugin, several contracts.** The same plugin id may contribute to several contracts, with a different schema, version and migration list for each. A block is judged by the schema for its **(plugin id, contract) pair**, never by one schema per plugin.
- **A block is valid only on a contract the plugin declares.** The core cannot know this, because it holds no plugin code, so the core checker stays purely structural. The host-side check `plugin-contract-unsupported` reports a block that sits on a contract its plugin has no contribution for. **That check runs only when the plugin is installed, like every other check that needs the plugin.** With the plugin absent the block is preserved and noted as absent, and a block on a contract the plugin never meant to extend is not found until the plugin is installed.
- **A plugin never adds a core field.** "Adding to a `.tkranm`" means adding a namespaced block to the clip, never a new key of the clip. `com.example.glow` can carry `bloom` in its own block, and it cannot add `bloom` as a sibling of `frames`, which is an unknown key of a closed contract:

  ```yaml
  # allowed: the plugin's own key, in the plugin's own block
  pluginData:
    com.example.glow:
      version: 1.0.0
      data: {bloom: 0.4}
  ```

  ```yaml
  # an error: `bloom` is not a key of the animation clip contract; the contract is closed
  frames:
    - image: bitmap/hero_walk_s1.png
  bloom: 0.4
  ```

### Keys of different plugins

Two plugins may each use a data key named `strength` with no collision: `pluginData.com.example.glow.data.strength` and `pluginData.org.example.tint.data.strength` are different keys, because the namespaces separate them. What a plugin author must not do is read, write or rely on another plugin's block or keys. A plugin reads only the block under its own id, and there is no cross-plugin data contract.

### Tolerance, absence and newer data

- **Unknown keys** inside `data` are tolerated: never reported, never dropped, and kept exactly as written.
- **Data newer than the plugin** is read for the keys the plugin knows. There is no refusal, no migration on read and no key dropped. A key the plugin *knows* whose shape changed in a newer MAJOR is not an unknown key: the plugin's schema reports it as a located error on that key, and a plugin may treat a newer MAJOR as read-only.
- **Data older than the plugin** is read the same way. An upgrade is available and is never applied by reading.
- **A plugin that is absent:** its block is preserved as written, byte for byte. It is not parsed against a schema, not validated and not run, and it is never deleted without an explicit action. Preserved data is not thereby safe to execute. The `.gam` package list already says which packages a game requires, so no per-document list of needed plugins is kept.
- **Two plugins claiming one id** cannot be seen from documents, because a block carries no provenance. It is a catalogue fault, already reported as `manifest.duplicate-namespace` ([PKG-2](../engine/rpgcode-modules-and-objects.md#pkg-2)).

### Versions and migration

The plugin owns its data's version and how older data reaches it ([ADR 0024](../../adr/0024-plugin-data-contributions.md), decisions 8 to 10). A **write** changes only keys the writer owns and stamps a new `version` only as the result of an explicit upgrade. An **upgrade** is an explicit command, run with the plugin present, one plugin and one document at a time; **it never runs at engine load and never when the editor opens a document**, because the engine never writes and opening a file must not rewrite it. Its result is an ordinary reviewable diff: the `version` line and the keys the migration names. A project can hold blocks at mixed versions, as it can hold documents at mixed contract versions. A plugin that renames its id declares the old id, and the upgrade moves the key; without that, the old block stays as a dormant, preserved block and the new id starts empty.

### Preservation

**Every writer MUST preserve what it does not understand, byte for byte, comments included.** This binds every tool that writes a native document: the rename tool, the clip editor, an importer, a migration, a formatter, and anyone's plugin tool. The six rules:

1. No code path regenerates a document that holds a block from a parsed tree, by re-printing the parsed document or by reading it into a value and writing the value out. Both change bytes the writer never meant to touch: the spacing before a comment, flow padding, key order, quoting, and the spelling of a number (`1.10` read back as `1.1`).
2. Every change is a list of splices into the original text ([editing in place](native-animation-clip.md#reference-reader-writer-and-importer)).
3. Bytes inside `pluginData.<id>` change only when that plugin's own writer changes a key it owns. A key the writer does not understand is outside every splice: its text, comments, order, style and quoting stay as written.
4. A new block is inserted at its sorted position, and the order of the existing blocks never changes.
5. A writer that cannot meet rules 1 to 3 for an edit refuses with a located error. It never drops and never reformats.
6. A document created whole, as an importer creates one, writes a block only as the verbatim text of a source block.

A test of this proves nothing unless it fails against a writer that regenerates the document: run each test against a writer that reads into a value and writes it out, and against one that re-prints the parsed document, and confirm it fails ([findings](../../findings/plugin-data-models/README.md#measured-git-merge-behaviour), writers).

### Block or document

**Proposed, needing the owner's confirmation.** A piece of plugin data is a block unless it passes one of these tests, and then it is a document of a contract the plugin defines, with its own stamp and its own registered extension, referred to one way by ID:

1. **Identity (mechanical).** Does any document other than the one that holds it refer to it by ID? Then it has an identity of its own, and it is a document.
2. **Owner (mechanical).** Is its owner a native document that can hold `pluginData`? If not (an image, a sound, a legacy file), it cannot be a block.
3. **Bulk (tunable).** Does its `data` exceed a size bound? **No bound is set**: it has to come from a measurement on real documents.

How such a document gets an extension, when the registry is in the core package, is open.

### Limits of this version

- **A block exists only on a native contract document.** A plugin cannot attach data to a legacy binary file (`.anm`, `.brd` and the rest). Those files are read through the compatibility layer, have no stamp and no `pluginData` key, and a native writer never rewrites them.
- **A block exists only at the top level of a document.** A plugin cannot attach data directly to a non-document object, such as a scene placement or a clip frame. Such an object has no ID and no door. A plugin that needs per-placement or per-frame data keeps its own structure inside its own block on the owning document. Whether a placement may carry a nested door is the scene contract's decision (story 27.8 / [#1809](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1809)), not a ruling made here.

### A worked example

A clip that carries two blocks. The keys inside `data` are illustrative.

```yaml
contract: animation-clip
version: 1.0.0-pre.1
canvas: {width: 32, height: 48}
delay: 0.15
frames:
  - image: misc/start/start_s1.png
pluginData:                    # blocks in ASCII order of plugin id
  com.example.glow:            # installed: its schema for animation-clip applies
    version: 1.0.0
    data:
      bloom: 0.4
      futureKnob: 1.10         # a key this reader has no schema for: kept exactly as written
  com.example.weather:         # not installed on this machine: left untouched
    version: 0.1.0
    data: {wind: 3}
```

- The core checker reports nothing: both envelopes are well formed, and `futureKnob` is never a report.
- An edit of `delay` changes that one line. Both blocks stay byte for byte.
- Where `com.example.glow` is installed, its schema for `animation-clip` checks `bloom`; where it is not, the block is kept and noted as absent.
- The same block on an `actor` document is checked by the plugin's `actor` contribution, and reported `plugin-contract-unsupported` if there is none.

Each of these is a `plugin-block` problem, with its kind:

- `Com.Example.Glow:` as a key: **id**. The grammar is lowercase.
- A block with no `data`, or with a third key beside `version` and `data`: **shape**.
- `version: 1.0`, which YAML reads as the number 1: **version**.
- `data: [1, 2]`: **data**.
- `pluginData: [com.example.glow]`, the old link-list shape: **container**.
- `com.example.glow` twice in `pluginData`: **duplicate**.
- An alias in one block that names an anchor in another: **boundary**.

A top-level `bloom: 0.4` is not a `plugin-block` problem. It is the closed-contract error of the contract's own reader, and it is the same error as for any other unknown top-level key.

## Checker

A checker reads a folder of native documents and reports problems. It **reports and never repairs**. It reads only native documents, the files whose extension the [registry](#the-registry) holds: a file with any other extension, a legacy file such as `walk.anm` among them, is neither read nor reported, whatever bytes it holds. It reports every class below, each with the content shown.

| Class | Report names | Meaning |
|---|---|---|
| Missing or malformed stamp | the document path; which key is missing, repeated, or malformed, and the text found | The [stamp rules](#stamp) or the [version form](#versions) failed. |
| Duplicate ID | the ID and every document that resolves to it | Two documents resolve to the same ID ([below](#when-a-duplicate-id-can-arise)). |
| Two paths fold to one ID | both paths and the folded ID | The [identity rule](#identity), item 4 failed. |
| Plugin block (`plugin-block`) | the document path, the problem kind, the plugin id where there is one, and the text found | A block's [envelope](#the-envelope) failed. The problem kinds are in the next table. |
| Extension and contract disagree (**proposed, needs the owner's confirmation**) | the path, the extension, the registered contract, and the contract the stamp names | The [file name rule](#file-names), item 4 failed: the extension is registered for one contract and the stamp names another. |

The first four rows are the classes the owner ruled. The `plugin-block` class replaces the three link classes the 2026-11-08 ruling had (a plugin document with no owner, an owner link with no back-link, a mismatched link): they are **retired** (owner ruling of 2026-11-09), because plugin data has no document of its own to link. The fifth is an addition made with the file name rule and is not yet confirmed. It is judged only for a document whose extension is registered and whose stamp names one contract as text; any other stamp is already a stamp report.

A `plugin-block` report has one problem kind, as the stamp class has `missing`, `repeated`, `malformed`, `not-first` and `unreadable`:

| Kind | Meaning |
|---|---|
| `container` | `pluginData` is not a mapping (for example the old link-list shape, `pluginData: [a, b]`). |
| `id` | A key fails the plugin id grammar of [PKG-2](../engine/rpgcode-modules-and-objects.md#pkg-2), or is a reserved top-level key. |
| `duplicate` | One plugin id appears twice in one document. |
| `shape` | A block is not a mapping, `version` or `data` is missing or repeated, or the block has a key other than the two. |
| `version` | A block's `version` does not parse in the [version form](#versions). |
| `data` | A block's `data` is not a mapping. |
| `boundary` | An alias or anchor crosses the block boundary ([the envelope](#the-envelope), rule 6). |

**Never reported:** an unknown key inside a block's `data`. The checker cannot know a plugin's keys, and a newer plugin's keys are not a fault ([tolerance](#tolerance-absence-and-newer-data)).

**Not a class of the core checker:** an unknown key at the top level, such as `bloom` beside `frames`. The core checker reads no contract's fields, so it cannot tell that a key is unknown to a contract. That is the **closed-contract** error of the contract's own reader and schema, with the path and the line, in the words the clip reader already uses: `bloom` is not a key of the animation clip contract; the contract is closed. The checker does report, in the stamp class, a stamp that is not at the top of the document.

Each report names where the problem is and what was found. For the fifth class it cannot be told which side is wrong: either the extension or the stamp.

### When a duplicate ID can arise

Since the ID is the whole path with the extension, two documents on one file system cannot share it, and a walk of a folder lists each path once in one spelling. A duplicate ID can still arise when the documents do not come from one directory walk: the same path listed twice (an archive can hold two entries of one name), or two spellings of one path, such as `clips//walk.tkranm` and `clips/walk.tkranm`. Before the extension was part of the ID, `walk.yaml` beside `walk.yml` was the usual case; that case is gone.

This makes the class a special case of "two paths fold to one ID": two paths with one ID also fold to one. The report differs only in that no difference of case is involved. The class is kept as ruled, for the two cases above. **Flagged for the owner:** whether to keep it as its own class or to fold it into the fold-collision class.

### The reference checker

`tkr-native-check FOLDER` is the first checker (ticket 27.2). The rules above are implemented in `packages/native-data`, which reads no file; `packages/native-data-cli` walks the folder and prints the reports. It never writes. **The code on main still implements the 2026-11-08 link model** (the options `--owner-field` and `--plugins-field` and the three link classes) until the cutover story 27.10 ([#1822](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1822)) replaces it. This section is the target. Where the rules above leave a choice, the checker makes the smallest one, so each choice is stated here and each can change without changing the classes:

- **Nothing is required on the command line.** There are no link field names. The document extensions are the registry's by default; `--ext` replaces them, for example to read placeholder documents whose extension is not registered (a document whose extension is not registered has no contract to disagree with).
- **The ID is the path with the extension,** with `/` as the separator and an empty or `.` part dropped. So `Actors/Guard.tkranm` has the ID `Actors/Guard.tkranm`, and `Guard.tkranm` and `guard.tkranm` are two paths that fold to one ID. A directory walk never lists a path twice, so a duplicate ID comes only from a caller that does not walk one directory. A file system that cannot hold both of two paths is no reason to skip the check, so the walk lists paths and never asks the file system whether a name exists.
- **`pluginData` is read where it is:** a document's top-level `pluginData` mapping. Only its envelope is checked. Nothing inside a block's `data` is read, so an unknown key there produces no report. A plugin id that appears twice is found by the key's name, because a parsed mapping cannot hold two.
- **A file that is not UTF-8 text, a YAML error, more than one YAML document, or a top level that is not a mapping** is reported as an unreadable stamp. Nothing else in a document is checked except the stamp and the envelope of each block: the YAML profile and the rest of the schema are not decided.

### Checks that need the plugin

The core checker reads only native documents and has no plugin code, so it can never judge what is inside a block or which contracts a plugin extends. These checks belong to a host that has the plugin installed: the editor, or a checker option that is given the plugin catalogue (the command is not named here). **Every one of them runs only when the plugin is installed.** They are not classes of the core checker, and the core checker needs none of them.

| Check | Kind | Meaning |
|---|---|---|
| `plugin-data-invalid` | problem | A key the plugin knows fails the schema of the plugin's contribution for the document's contract. It names the plugin id, the contract and the path inside the block. An unknown key never fails it. |
| `plugin-contract-unsupported` | problem | A block sits on a document whose contract the installed plugin has no contribution for. The block is preserved, never dropped. |
| `plugin-absent` | note | A block's plugin is not installed: content preserved, not validated, not executable. |
| `plugin-data-newer` | note | A block's version is newer than the installed plugin's: read for the keys the plugin knows. |
| `plugin-data-older` | note | A block's version is older than the installed plugin's: an upgrade is available. |

A note never fails a run. Whether a host shows an unknown key inside `data` as a hint is open, and the answer is never an error and never a drop ([open items](#not-decided-here)).

## Rename

Moving or renaming a native document changes its ID, because [the ID is the path](#identity). A rename tool (`tkr-native-rename`, ticket 27.5 / [#1806](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1806)) changes both in one step:

1. the document's own location (the file move);
2. every reference to the old ID in other native documents.

A plugin block needs no step of its own: it is part of the document that holds it, so it moves with the document, and a rename never edits its bytes.

It is all or nothing: if any part cannot be done, no file in the project has changed. An edit to a referencing document replaces only the scalar that holds the old ID, as a splice into the original text (shared with the [clip editor](native-animation-clip.md#reference-reader-writer-and-importer)); a document is never regenerated from a parsed tree, because `Document.toString()` changes comment spacing and flow padding even on an unedited document. Every comment, unrelated line and line ending stays byte for byte, and a reference changes by the line that holds it.

**Status of the code.** The rename tool on main still rewrites both ends of an owner and plugin link (the options `--owner-field` and `--plugins-field`) under the 2026-11-08 model. The cutover story 27.10 ([#1822](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1822)) shrinks its scope to what this section says: it moves a document and rewrites every reference to its ID, all or nothing, with rollback.

Where the rules above leave a choice, the tool makes these, so each is stated and can change:

- **Planner against executor.** The planning rules (`planRename`, `verifyPlan`, `applyPlanToDocuments`) live in `packages/native-data` and read or write no file ([G2](../../guardrails.md#g2--hard-package-boundaries)). The file-system apply and the `tkr-native-rename` command live in their own package, `packages/native-data-rename`, rather than in `packages/native-data-cli`, because the checker's command is read-only by promise ("never writes").
- **What is configured, and multi-pair transactions.** `--ext` overrides which extensions mark a document. `--ref-field NAME` (repeatable) names further top-level fields that hold an ID or a list of IDs, because the contracts that will define such fields (actors, scenes and the rest) are not written yet. The command takes one or more `OLD=NEW` pairs and judges them as one transaction against the final state, so documents that move together, a chain, and two documents that swap names all work. There are no link fields: plugin data has no document of its own, so the options `--owner-field` and `--plugins-field` of the 2026-11-08 model are gone.
- **What it refuses before anything is written.** A new ID that is not a valid ID (empty, a control character, a `\` separator, a `..` part, a space at either end, an empty or `.` part that `documentId` would drop, or no extension); an extension that marks no native document; a registered extension whose contract disagrees with the document's stamp (changing the kind of a document is not a rename); a new ID that equals, or folds with A to Z to, another document's final ID, or two new IDs that fold to one; an old ID no document has, the same document named twice, or a pair that changes nothing; a reference field that cannot be read as an ID or a list of IDs, or a reference written over several lines that cannot be replaced in place; and **a project that is not checker-clean before the rename**, with every checker report named (a `plugin-block` report included). A clean project is required, rather than "proceed if the rename does not worsen it", because duplicate IDs and fold collisions make reference resolution ambiguous, a new ID could silently satisfy a pre-existing broken reference, and any problem left after the rename is indistinguishable from one the rename caused. After planning, the checker is run over the planned result in memory (`verifyPlan`), and any report there refuses the plan too. References are matched as the checker matches them: exact casing first, then ASCII-folded.
- **What it does not rewrite: references inside plugin data.** A reference inside a block's `data` to a document that is renamed is opaque to the tool. It reads only the reference fields it was given, so the value is left as written and is not reported. A plugin id is not a document ID and is never rewritten. **This is an open question, and no decision is made here:** the owner has not chosen between two candidate answers. (1) A plugin's definition declares which paths inside its `data` are references, and the host-side rename consults that; it cannot cover a plugin that is absent. (2) The rename refuses when any value inside any block equals the old ID; it also covers an absent plugin, and it can refuse over a value that is not a reference.
- **How the change is applied, and what is and is not guaranteed.** The executor runs in four phases: (1) inspect without writing, re-reading every file the plan touches to check that its bytes still match the text the plan was made from and that every target is free; (2) stage, creating any new folders and writing the new text of each edited document to a temporary file `.NAME.tkr-rename-TOKEN-N.new` next to its target (`wx`, with the original's permission bits and any UTF-8 byte order mark kept); (3) commit by `rename` alone, first moving every affected original aside to `.NAME.tkr-rename-TOKEN-N.bak` and then moving every staged file or unedited original into its final place, recording an undo step for each; (4) delete the `.bak` files of edited documents. Moving every original aside before placing any target is what makes a two-way swap, a chain and a case-only rename (`Guard.tkract` to `guard.tkract` on a case-insensitive file system such as macOS's default) work without one step clobbering another. **Guaranteed:** any refusal in phase 1 writes nothing; any failure of a file-system call in phases 2 or 3 undoes the recorded steps in reverse order and, when the undo succeeds, leaves every file, mode and time as it was (exit code 4; if an undo step itself fails, exit code 5 names each step that could not be undone). **Not guaranteed:** a power cut, kernel panic or `SIGKILL` during phase 3 cannot be rolled back by the process, and POSIX `rename` is atomic per call, not across several calls, so the project can be left partway through with the untouched originals beside their places as `.NAME.tkr-rename-TOKEN-N.bak`; files and directories are not `fsync`ed; a concurrent writer that races after phase 1 is not locked out; and folders emptied by a move are left in place.
- **Output.** `--dry-run` runs the planner and phase 1, prints each `move FROM -> TO` and each `edit PATH` with the 1-based line numbers and `- before` / `+ after` lines, and writes nothing; a real run prints the same plan and a `done:` summary, or `--json` prints one `tkr-native-rename/1` object.

## Editors and Git

The files are YAML under an extension no tool knows yet, so a project tells its tools:

- **Editors.** A YAML-aware editor needs the `tkr` extensions associated with YAML (in VS Code, the `files.associations` setting). The in-file modeline `# yaml-language-server: $schema=PATH-OR-URL`, written as the first line of a document, works without any association: the owner tested it. The research found that yaml-language-server's schema matching by glob (`yaml.schemas`, SchemaStore `fileMatch`) is documented as unreliable for a custom extension ([findings](../../findings/native-file-extensions/README.md)), so the modeline is the route that does not depend on it. A comment before the stamp does not change the rule that `contract` and `version` are the first two keys.
- **Git.** A project's `.gitattributes` should map the extensions to YAML and fix the line ending:

  ```gitattributes
  *.tkr* linguist-language=YAML
  *.tkr* text eol=lf
  ```

  The first line makes GitHub highlight the files as YAML; GitHub applies a linguist override only once the `.gitattributes` is committed. The second keeps every checkout of a document byte for byte the same on every host.
- **Shipping this is future work.** A VS Code extension and a new-project template that ship the association, the modeline and the `.gitattributes` are not built ([open items](#not-decided-here)).

## Not decided here

This page does not choose the layout contract (how a document is laid out on lines), the schema technology, or the YAML profile rules ([#1799](../../findings/native-data-notations/README.md) leaves those open). Also open:

- Which keys inside `metadata` are standard (source name, source hash, importing tool version) and how free-form `tags` are.
- Whether plugin ids are allocated by an enforced rule or only by convention ([PKG-2](../engine/rpgcode-modules-and-objects.md#pkg-2)), and whether a plugin id must avoid the core fields of every contract or, as written, only those of the contract of the document that holds the block.
- ID folding for non-ASCII names beyond "compare as written".
- Which other spellings of one path count as one ID: this page drops empty and `.` parts only; it does not resolve `..` parts, and a `\` is an ordinary character.
- The registry rows of the kinds whose contracts are not written yet (actor, scene, item, enemy, tileset and so on); each is added with its contract.
- Whether the checker should report a file whose extension starts with `tkr` but is not registered. It is ignored now, so a misspelt extension leaves that document unchecked.
- A VS Code extension and a new-project template that ship the editor association, the modeline and the `.gitattributes` above (future work).
- What a loader does with a document whose version is newer than it knows within the same MAJOR. For a plugin block this is decided ([tolerance](#tolerance-absence-and-newer-data)); for a contract it is not.
- **How a rename treats references inside plugin data:** the two candidate answers are in [rename](#rename). No decision.
- **The schema contribution contract,** which a plugin declares per contract, and its own open questions: [ADR 0024](../../adr/0024-plugin-data-contributions.md#open-questions).
- **For the owner to confirm:** that the envelope of a block is closed to `version` and `data`, and the retirement of the three link classes.
- The size bound of the [block or document](#block-or-document) test. None is set.
- Whether a nested object, such as a scene placement, may carry a door of its own: story 27.8.
- Whether a host shows an unknown key inside `data` as a hint. None is specified.
- Whether a contract's own fields stay at the top level, as written here, or move under a `core:` wrapper. The owner is weighing the two ([ADR 0023](../../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md#alternatives-considered)).
