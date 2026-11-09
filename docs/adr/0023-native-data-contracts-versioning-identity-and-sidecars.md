# ADR 0023 — Native data contracts: per-contract versions, path identity and separate plugin documents

* **Status:** Proposed (owner decisions of 2026-11-08, recorded for approval; ticket 27.1 / [#1800](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1800)).
* **Date:** 2026-11-08
* **Context documents:** [0005-independent-product-v1-and-native-format.md](0005-independent-product-v1-and-native-format.md), [0009-compatibility-layer-not-the-model.md](0009-compatibility-layer-not-the-model.md), [spec/formats/native-contracts.md](../spec/formats/native-contracts.md), [findings/native-data-notations](../findings/native-data-notations/README.md), [findings/native-data-boundaries](../findings/native-data-boundaries/README.md)

## Context

[ADR 0005](0005-independent-product-v1-and-native-format.md) permits a native format and leaves open "schema versioning and migration policy". Research #1778 and #1799 compared notations on real recovered games and found that the layout of a document and the identity rules decide how well it survives Git far more than the notation does. In every notation tested, two branches that added the same ID merged cleanly and silently produced a duplicate.

The owner's direction is that formats are like API definitions: logical contracts, not editor screens. A contract needs a version that says what shape to expect, a name that cannot silently collide, and a place for plugin data that cannot break the core contract. This ADR records those rules. The normative text is [spec/formats/native-contracts.md](../spec/formats/native-contracts.md).

## Decision

1. **Each logical contract has its own semantic version** (`MAJOR.MINOR.PATCH`). There is no project-wide version number and no manifest of versions. Each document carries its own stamp.
2. **Version 1.0.0 of a contract is a promise,** honored from the release that publishes it. Before that a contract is pre-release (`1.0.0-pre.N`) and free to change.
3. **The rules are those of an API contract.** MINOR adds properties or features compatibly. PATCH fixes bugs or clarifies the contract. MAJOR breaks the contract between the editor and the engine.
   * Tightening a schema is MAJOR only when the looser rule was intended and files in use relied on it; otherwise it is a bug fix.
   * A change to what a field means is a break only when it changes the field's shape; otherwise it is a bug fix.
4. **Version strings.** Three parts always. The pre-release is dotted (`1.0.0-pre.12`), which supersedes the earlier `-pre-####` spelling because dotted numbers sort numerically with no padding. A `+build` suffix is allowed as debug evidence only and is ignored by the engine and by version precedence.
5. **Every native document starts with a stamp:** required `contract` and `version`, optional `tags` and `metadata`. The engine reads only contract fields. The two optional blocks hold no timestamps or per-save values. A missing or unreadable stamp is an error, never a guess.
6. **A document's ID is its path:** authored, stable, lowercase, ASCII-only folding, compared without regard to case. The file system lookup picks the entry whose casing matches. Two paths that fold to the same ID are an error naming both.
7. **Plugin data lives in its own documents,** each with its own contract and version, never in the owner's document. The owner and the plugin document name each other by ID; a missing, one-way or mismatched link is an error. A document whose plugin is absent is left unchanged, not validated and not run.
8. **A checker comes first.** It reports six classes (missing or malformed stamp, duplicate ID, two paths folding to one ID, plugin document with no owner, owner link with no back-link, mismatched link) and never repairs. A tested rename tool follows, so moving a document rewrites every reference and both ends of each link in one step.
9. **How the first contracts are shaped.** The item, NPC and enemy family is redefined into the logical contracts the research supports, and the board's placement is separated from its definition. Animation clips, tile layers, skills and effects are translated with small corrections. The animation clip is the first contract to reach 1.0. The 1:1 importer output is a test oracle, is never published as 1.0 and is never the native format.
10. **Not promised.** A lossless migration of every legacy game, or that every game runs. The research counted 1,200 candidate files the current decoders refuse ([#1772](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1772)).

### Relation to ADR 0005

[ADR 0005](0005-independent-product-v1-and-native-format.md) decision 3 says a native format would be "a major bump on the existing magic + major/minor header". This ADR refines that for native documents: they carry the stamp above, not the legacy binary header. Legacy files keep their magic and major/minor and are read through the compatibility layer ([ADR 0009](0009-compatibility-layer-not-the-model.md)). ADR 0005's text is unchanged; this ADR is the later and more specific rule for native documents.

## Consequences

* The checker, the rename tool and the first contract are built in epic 27 ([#1802](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1802)). Nothing is published as 1.0 by this ADR.
* The cost of a breaking change is a migration for every published contract, kept for as long as documents at the old version exist. The incentive is to get the tangled contracts (the actor family, scenes) right before they publish, and to let clean ones go first.
* Path identity makes a move or rename an identity change. It needs the rename tool, and by hand the checker names every reference that now points nowhere.
* A project can hold documents at mixed versions; upgrading migrates the ones that are behind.
* Plugin schemas version independently of the core contract that their owner uses.

## Alternatives considered

* **A single project-wide version number.** Rejected: one contract's break would force every document to move, and the number would say little about any one of them.
* **A manifest of versions beside the documents.** Rejected: it is a second copy of what each document already says, and the two can disagree. What a manifest could give, such as the lowest engine a project needs, is computed from the stamps.
* **A separate authored ID key inside each document.** Rejected: Git merges two branches that add the same ID cleanly (all 18 research runs did), so the duplicate is found only if a checker looks. With the path as the ID, the file system and Git report it.
* **Plugin data as a namespaced block inside the owner's document.** Rejected by the owner: separate documents let the core and each plugin version independently, keep plugin edits off the core's lines in a merge, and make an absent plugin's data trivially safe to leave alone.
* **`+build` metadata for provenance.** Rejected: it ignores precedence, allows only letters, digits and hyphens, and tends to change on every build, which is diff churn. Provenance goes in the optional `metadata` block.
* **A straight 1:1 translation of every legacy file as the native format.** Rejected: it would make the legacy shapes the model, against [ADR 0009](0009-compatibility-layer-not-the-model.md). Translation remains the importer oracle, and the tangled families are redefined.
* **Pre-release as `-pre-####`.** Superseded by the dotted form, which sorts numerically without padding.

## Open questions

Deliberately not decided here (see [the spec's open items](../spec/formats/native-contracts.md#open-items)):

* The layout contract, the schema technology and the YAML profile rules ([#1799](../findings/native-data-notations/README.md)).
* The standard `metadata` keys and the `tags` vocabulary.
* How a plugin document's path is derived from its owner's, and the link field names.
* Whether an ID includes the extension, and the path separator.
* ID folding beyond ASCII, and what a loader does with a newer MINOR or PATCH it does not know.
* Composition against inheritance for the actor family: the owner prefers composition where possible; the contract is settled in 27.7.
