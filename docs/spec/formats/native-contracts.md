# Native data contracts: stamp, versions, identity and plugin data

**Status: proposed, pending owner approval** ([ADR 0023](../../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md), ticket 27.1). This is a **Reawakened rule**: it describes TK Reawakened's own native documents, not any Toolkit 3.1 behaviour. Legacy files keep the binary headers described in [the format conventions](README.md#header-and-version); they reach the native documents only through an importer ([ADR 0009](../../adr/0009-compatibility-layer-not-the-model.md)).

## In plain words

A native document says at the top which kind of document it is and which version of that kind it follows, so a person or a tool always knows what shape to expect. Every kind of document (a "contract") has its own version number, so a change to animation clips never forces a change to actors. A document is named by where it lives, so two documents can never quietly share a name. Anything a plugin adds to an actor or a scene lives in its own document, linked both ways to the thing it belongs to, so core data and plugin data can change independently. A checker reports anything that does not line up, by name, and never fixes it on its own.

The rules below are precise. The examples use YAML, the authored notation the owner accepted in [research #1799](../../findings/native-data-notations/README.md); the rules do not depend on YAML, and the YAML profile and layout rules are not set here.

## Stamp {#stamp}

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
2. The engine reads only contract fields. It never reads `tags` or `metadata`, and neither can change how a game plays. Anything that changes behaviour is a field of the contract, not a tag or metadata.
3. `tags` and `metadata` hold no timestamps and no values that change on every save. Git already records when a file changed, and such a value turns every edit into a second changed line and a merge conflict.
4. A missing, repeated or unreadable stamp is an error. A reader never guesses a contract or a version.
5. Adding `tags` or `metadata` to a contract that lacks them is a MINOR change; both are optional.

The stamp keys use a fixed spelling. The exact spelling of the keys inside `metadata`, and the vocabulary of `tags`, are open ([open items](#open-items)).

## Versions {#versions}

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

### One version per contract

Each contract is versioned on its own, like separate API definitions. A document records the version of its own contract only. There is no project-wide version number and no manifest of versions: each document carries its own stamp and a loader chooses the rules for each document from that stamp. A project can hold documents at different versions, and upgrading a project migrates the documents whose version is behind.

## Identity {#identity}

A document's **ID** is its path within the project. The ID is authored (a person or the editor chose the path) and stable (it changes only through an explicit rename that updates every reference). Other documents refer to a document by its ID.

1. IDs are lowercase. Folding is **ASCII only**: the letters A to Z fold to a to z. Every other character compares as written, so behaviour never depends on a locale or on Unicode tables (G3).
2. Comparison ignores case: `Guard` and `guard` are the same ID.
3. When a reference must be turned into an actual file, the file system is consulted and the entry whose casing matches is chosen. A writer creates new documents with a lowercase path.
4. Two paths that are equal after folding are an error that names both paths. This holds on a case-sensitive file system, where `Guard.yaml` and `guard.yaml` can both exist, and it is why a project checked out on a case-insensitive host never loses a document.

Why the path: two branches that each add the same new ID merged cleanly in every notation the research tested, and nothing reported the duplicate ([research](../../findings/native-data-notations/README.md#3-nothing-in-the-syntax-prevents-conflicts-or-duplicate-identities)). When the ID is the path, both branches added the same file and Git reports an add/add conflict, so the file system does the uniqueness check.

## Plugin data {#plugin-data}

A plugin's data for an owner (an actor or a scene, for example) is a **separate document** with its own `contract` and its own `version`. No document holds both core data and plugin data, so a core contract and a plugin contract never share a versioned document and neither can break the other's schema.

1. The owner and the plugin document each name the other by ID. The link is findable from either end.
2. A link that is missing, one-way, or whose two ends disagree is an error that names both ends.
3. A plugin document whose plugin is absent is left unchanged: it is not parsed against a schema, not validated and not run. It is preserved byte for byte. Preserved data is not thereby safe to execute.

How a plugin document's path is chosen from its owner's path, and the names of the link fields, are open ([open items](#open-items)).

## Checker {#checker}

A checker reads a folder of native documents and reports problems. It **reports and never repairs**. It reports every class below, each with the content shown.

| Class | Report names | Meaning |
|---|---|---|
| Missing or malformed stamp | the document path; which key is missing, repeated, or malformed, and the text found | The [stamp rules](#stamp) or the [version form](#versions) failed. |
| Duplicate ID | the ID and both documents | Two documents resolve to the same ID. |
| Two paths fold to one ID | both paths and the folded ID | The [identity rule](#identity), item 4 failed. |
| Plugin document with no owner | the plugin document and the owner ID it names | The owner it names does not exist. |
| Owner link with no back-link | the owner and the plugin document it names | The plugin document does not name the owner back. |
| Mismatched link | both ends and what each names | The two ends name different documents, or one end names a document that names a third. |

Each report says which side to fix when one can be told, for example a plugin document that names `guard` while the owner `guard` names a different plugin document.

### The reference checker {#reference-checker}

`tkr-native-check FOLDER --owner-field NAME --plugins-field NAME` is the first checker (ticket 27.2). The rules above are implemented in `packages/native-data`, which reads no file; `packages/native-data-cli` walks the folder and prints the reports. It never writes. Where the rules above leave a choice, the checker makes the smallest one, so each choice is stated here and each can change without changing the six classes:

- **What is configured, not fixed.** The two link field names have no default; the command requires them. The document extensions default to `.yaml` and `.yml` and can be given again with `--ext`.
- **The ID is the path without the document extension,** with `/` as the separator. So `Actors/Guard.yaml` has the ID `Actors/Guard`, and `guard.yaml` and `guard.yml` both have the ID `guard`: that is a duplicate ID. `Guard.yaml` and `guard.yaml` are a different case: two paths that fold to one ID. A file system that cannot hold both is no reason to skip the check, so the walk lists paths and never asks the file system whether a name exists.
- **A plugin document is a document with the owner field; an owner is a document with the plugins field.** The owner field holds one ID. The plugins field holds a list of IDs. A link ID is matched to a document by exact casing first, then by folded casing. When several documents answer to one ID, the identity reports already name them, so no link report is added.
- **A link field the checker cannot read as an ID, or as a list of IDs, is reported where it is** with the text found, under the class of the end that wrote it (a plugin document's owner field: no owner; an owner's plugins field: no back-link).
- **A link that is one-way from the plugin document's side** (the plugin document names an owner that names nothing, or names other plugin documents) is a mismatched link: the two ends do not name each other. It is not reported twice when a different owner names the plugin document, because that owner's own report covers it.
- **An owner that names a plugin document no file holds** is reported as an owner link with no back-link, naming no path for the plugin document.
- **Which side to fix** is told only when the other evidence points one way: a plugin document that names an owner which names other plugin documents is the side to fix; an owner that names a plugin document which names a third document that names it back is the side to fix; an owner that names a plugin document that does not exist is the side to fix; a plugin document that names a missing owner could mean either a wrong link or a missing owner, so no side is named. Otherwise no side is named.
- **A file that is not UTF-8 text, a YAML error, more than one YAML document, or a top level that is not a mapping** is reported as an unreadable stamp. Nothing else in a document is checked: the YAML profile and the rest of the schema are not decided.

## Not decided here {#open-items}

This page does not choose the layout contract (how a document is laid out on lines), the schema technology, or the YAML profile rules ([#1799](../../findings/native-data-notations/README.md) leaves those open). Also open:

- Which keys inside `metadata` are standard (source name, source hash, importing tool version) and how free-form `tags` are.
- How a plugin document's own path is chosen from its owner's path, and the spelling of the link fields.
- Whether an ID includes the file extension, and the path separator in an ID.
- ID folding for non-ASCII names beyond "compare as written".
- What a loader does with a document whose version is newer than it knows within the same MAJOR.
