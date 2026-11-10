---
id: 1
type: story
title: "The native data contracts have approved rulings for versioning, identity and plugin-data separation"
parent: epic-native-data-contracts
covers: [E1, E2, E3, E4, E5]
after: []
tracker_id: "#1800"
refined: true
hitl: true
risk: medium
---

# The native data contracts have approved rulings for versioning, identity and plugin-data separation

## Description

Jensen decided these rules in a team session on 2026-11-08, after research #1778 and #1799. This ticket writes them into one ADR and one normative spec page, so later tickets can build the validator, the rename tool and the first contracts from them. It writes documents only. Jensen approves the wording before it merges, because a published 1.0 contract is a promise.

## Acceptance Criteria

1. **Versions are per contract and 1.0 is a promise**
   **Given** the ADR
   **When** a reader asks what version a document has and what a version number promises
   **Then** the ADR says each logical contract has its own semantic version (MAJOR.MINOR.PATCH)
   **And** it says a contract's 1.0 is a promise honored from the release that publishes it
   **And** it says MINOR adds properties or features compatibly, PATCH fixes bugs or clarifies the contract, and MAJOR breaks the contract between the editor and the engine
   **And** it says tightening a schema is a MAJOR change only when the looser rule was intended and files in use relied on it; otherwise the tightening is a bug fix (PATCH)
   **And** it says a change to what a field means is a MAJOR change only when it changes the field's shape; otherwise it is a bug fix (PATCH)
2. **Pre-release and build forms are exact**
   **Given** the spec page
   **When** a reader checks which version strings are valid
   **Then** the page defines the core as three non-negative whole numbers, an optional dotted pre-release such as `1.0.0-pre.12`, and an optional `+` build suffix
   **And** it says the build suffix is debug evidence only: the engine and the version precedence ignore it
   **And** it shows one valid and one invalid example of each form
3. **Every document carries a stamp**
   **Given** the spec page
   **When** a reader checks what a native document starts with
   **Then** it names two required keys, `contract` and `version`, placed first in the document
   **And** it names optional `tags` and `metadata` blocks that record where a file came from
   **And** it says the engine never reads tags or metadata, and neither holds timestamps or values that change on every save
   **And** it says a missing or unreadable stamp is an error, never a guess
4. **Identity is the lowercased path**
   **Given** the spec page
   **When** a reader checks how a document is named by others
   **Then** it says the ID is the document's path, authored and stable, lowercased, and compared without regard to case
   **And** it says case folding is ASCII only, and other characters compare as written
   **And** it says that when the file system must be consulted, the entry whose casing matches is chosen
   **And** it says two paths that match after folding are an error naming both paths
5. **Plugin data lives in its own documents**
   **Given** the spec page
   **When** a reader checks where a plugin keeps its data for an owner such as an actor
   **Then** it says the plugin data is a separate document with its own `contract` and `version`, and no document holds both core and plugin data
   **And** it says the owner and the plugin document each name the other by ID
   **And** it says a link that is missing, one-way or mismatched is an error that names both ends
   **And** it says a plugin document whose plugin is absent is left unchanged, not validated and not run
6. **The validator's error classes are listed**
   **Given** the spec page
   **When** a reader asks what the checker must reject
   **Then** it lists these classes, each with the message content it needs: missing or malformed stamp, duplicate ID, two paths folding to one ID, plugin document with no owner, owner link with no back-link, mismatched link
   **And** it says the checker reports and never repairs
7. **Scope and non-promises are recorded**
   **Given** the ADR
   **When** a reader asks how the first contracts are shaped
   **Then** it says the item, NPC and enemy family is redefined into the logical contracts the research supports, and the board's placement is separated from its definition
   **And** it says animation clips, tile layers, skills and effects are translated with small corrections, and the first contract to reach 1.0 is the animation clip
   **And** it says the 1:1 importer output is a test oracle, is never published as 1.0 and is never the native format
   **And** it says no promise is made of a lossless migration of every legacy game, or that every game runs
8. **The documents are consistent and checkable**
   **Given** the ADR and the spec page are written
   **When** the docs checks and a link check run
   **Then** every link and anchor resolves
   **And** the ADR cites the spec page and ADRs 0005 and 0009, and the spec page cites the ADR
   **And** no existing guardrail (G1 to G7) is contradicted, and no legacy GPL source was opened (G7)

## Boundaries

- Must not change: any package, decoder, schema file, runtime or editor behavior.
- Must not change: the research documents under the findings folder.
- Must not change: ADR 0005 and ADR 0009, except to add a link to the new ADR.
- Must not select the layout contract (how a document is laid out on lines), the schema technology, or the YAML profile rules. #1799 leaves those open.

## References

- research — docs/findings/native-data-notations/README.md, "What both investigators agree on" and the YAML profile page beside it
- research — docs/findings/native-data-boundaries/README.md, "Conclusions the evidence supports"
- adr — docs/adr/0005-independent-product-v1-and-native-format.md
- adr — docs/adr/0009-compatibility-layer-not-the-model.md
- spec — docs/spec/formats/README.md
- guardrails — docs/guardrails.md
- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1778
- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/1799
- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1772

## Notes

- Decision: versions are per contract; 1.0 is a promise once a contract is published in a release; semver rules apply (2026-11-08).
- Decision: MINOR is for added properties or features, PATCH for bug fixes and contract clarifications, MAJOR for a break between the editor and the engine (2026-11-08).
- Decision: pre-release is dotted, `1.0.0-pre.N`, replacing the earlier `-pre-####`; `+build` is debug evidence only (2026-11-08).
- Decision: versions live inside each document; there is no separate manifest of versions (2026-11-08).
- Decision: the stamp is two keys, `contract` and `version`, with optional `tags` and `metadata` (2026-11-08).
- Decision: IDs are authored and stable, and the path is the ID; lowercased, ASCII-only folding, case-insensitive compare (2026-11-08).
- Decision: plugin data is kept apart from core data so each versions independently; owner and plugin document link both ways, and a mismatch is an error (2026-11-08). Superseded on 2026-11-09: see the Decision lines below.
- Decision: a validator and a tested rename tool are wanted; the validator comes before the first plugin document exists (2026-11-08).
- Decision: tightening a schema is MAJOR only if the API was intended to be that loose and was actually used that way; otherwise it is a bug fix. Changing what a field means is a break only if it changes the field's shape; otherwise it is a bug fix (2026-11-08).
- Decision: Jensen, 2026-11-09: plugin data lives in the document it belongs to, under one open top-level key, `pluginData`, keyed by plugin id. Each block has its own `version` and `data`. The core checks only the envelope (id well formed, version parses, `data` is a mapping); the plugin owns its schema, version and migration. Unknown keys inside `data` are tolerated and never dropped; an absent plugin's block is preserved as written; data newer than the plugin is read for its known keys. This replaces the 2026-11-08 separate-document ruling (ADR 0023 decision 7). The key name was chosen over `plugins`, `metadata` and `extensionData`.
- Decision: Jensen, 2026-11-09: a contract's own fields are closed (an unknown key is an error, so `colorKey` cannot pass for `colourKey`) and plugin namespaces are open; every writer must preserve what it does not understand, byte for byte, comments included (ADR 0023 decision 12).
- Decision: Jensen, 2026-11-09: plugin ids may be qualified with dots, such as `com.example.weather` (PKG-2 amended; a bare name like `stock_battle` stays valid). A plugin contributes its data configuration through its definition, one entry per native contract it extends, each with a schema and a migration list; a block is valid only on a contract the plugin declares, which only the plugin-present check can see (ADR 0024).
- Decision: Jensen, 2026-11-09: the three link checker classes (plugin document with no owner, owner link with no back-link, mismatched link) are retired and one class, `plugin-block`, replaces their role. The rename tool is kept without link rewriting. How a rename treats references inside plugin data is an open question with two candidate answers (the plugin declares which data paths are references, or the rename refuses when a block holds a value equal to the old ID) and no decision.
- Open question: Jensen, 2026-11-09, proposed a top-level `core:` wrapper for a contract's own fields. The documents use the flat shape (own fields at the top level beside the stamp, one open dictionary) and record the wrapper under ADR 0023's alternatives. He has not chosen.
- Direction (tentative, owner-stated, not a decision): Jensen, 2026-11-09: "eventually there may not be any 'core' items in a sense. every field will likely have a plugin / extension they are driven by." Nothing moves and no contract changes because of it.
- Open question: which provenance fields are standard in `metadata` (source name, source hash, importing tool version) and how free-form `tags` are.
- Open question, closed by the 2026-11-09 rulings: how a plugin document's own path is chosen from its owner's path. Plugin data no longer has a document of its own.
- Open question: ID folding for non-ASCII names beyond "compare as written".
- Proposed follow-on stories, not created here: the validator; the rename tool that rewrites references and both ends of each link in one step; the animation clip contract at 1.0 (drop the sparse fixed slots, keep order and timing, keep tile lookup indices unchanged); the actor family; the board placement-versus-definition split. Each needs its own ticket after the owner approves these rulings.
- Check outside the ticket's criteria (medium risk): Jensen reads and approves the ADR before merge.
