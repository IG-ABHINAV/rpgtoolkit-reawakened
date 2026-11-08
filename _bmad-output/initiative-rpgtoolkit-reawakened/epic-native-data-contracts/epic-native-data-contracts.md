---
tracker_id: "#1802"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1802"
type: epic
title: "Native data contracts: versioned, text-first documents, proved on the animation clip"
parent: initiative-rpgtoolkit-reawakened
covers: []
after: []
assignee: ""
risk: high
---

# Native data contracts: versioned, text-first documents, proved on the animation clip

## Description

The native game-data documents become explicit, versioned contracts. Each logical contract has its own semantic version, a path that is its ID, and a stamp at the top of every document. Plugin data lives in its own documents, linked both ways to its owner. The epic writes the rulings, builds the checker and the rename tool, and proves the whole path on one contract, the animation clip, before the actor family and scene contracts are specified. Jensen decided the rules on 2026-11-08, after research #1778 and #1799; ticket 27.1 records them.

## Outcome

A creator or a tool author can open a native document, see which contract and version it follows, and edit it in a text editor or the editor with one-line diffs and comments kept. The owner can tell any two documents' contracts apart, and a broken ID or link is reported by name, not guessed.

## Requirements

Covers is empty: no capability in the product spec names the native format, and ADR 0005 makes it permitted, not required. Each line cites its source instead.

- E1: Versions are per contract, semver, and 1.0 is a promise once published in a release (ticket 27.1 Notes; #1800).
- E2: Every document carries a stamp (`contract`, `version`, optional `tags` and `metadata`); the path is the ID; plugin data is a separate document linked both ways (ticket 27.1).
- E3: A checker reports stamp, ID and link errors by name and never repairs (ticket 27.1, criterion 6).
- E4: The animation clip is the first contract; the 1:1 importer output stays an oracle and is never the native format (ticket 27.1, criterion 7).
- E5: A rename keeps every reference and both ends of each sidecar link valid (ticket 27.1, Notes).
- E6: The actor family and the board's placement-versus-definition split are specified as contracts, not copied from legacy file boundaries (`docs/findings/native-data-boundaries/README.md`).

## Done when

1. The ADR and the spec page from 27.1 are approved by Jensen and merged.
2. The checker, run over the authored fixtures, reports each ruled error class with the ruled message content and reports nothing on the clean fixture.
3. Legacy `.anm` files from the corpus import into native clip documents that decode to the same ordered frames and delays; a one-property edit changes one line and keeps every comment.
4. Renaming or moving a document leaves the checker clean on a fixture project with references and a sidecar link.
5. The editor opens a native clip and saves a one-property change as a one-line diff.
6. The actor-family and scene contracts exist as approved pre-release specs, not published as 1.0.

## Boundaries

This is the data-contract and document-tooling boundary. It does not include building editors for the actor family or scenes, runtime loading of those contracts, or migrating whole legacy games. It does not choose the layout contract, the schema technology or the YAML profile; #1799 leaves those open and they are decided inside the stories that need them. It makes no promise of a lossless migration of every legacy game, or that every game runs.

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/initiative-rpgtoolkit-reawakened.md
- research — docs/findings/native-data-notations/README.md
- research — docs/findings/native-data-boundaries/README.md
- adr — docs/adr/0005-independent-product-v1-and-native-format.md
- adr — docs/adr/0009-compatibility-layer-not-the-model.md
- constraint — docs/guardrails.md, G2, G3, G6, G7
- source — docs/spec/formats/README.md

## Notes

- Decision: Jensen, 2026-11-08: the first round is not a straight 1:1 translation of every file. The item, NPC and enemy family and the board's placement-versus-definition split are redefined; clips, tile layers, skills and effects are translated with small corrections; the 1:1 importer output is a test oracle only.
- Decision: Jensen, 2026-11-08: the animation clip is the first contract; a thin slice through one contract comes before designing the others. Editors follow the contracts; the actor and scene editors wait for 27.7 and 27.8.
- Decision: Jensen, 2026-11-08: the other rulings (versions, stamp, IDs, sidecars, validator, rename tool) are recorded as dated Decision lines in ticket 27.1.
- Assumption: a contract stays pre-release (`1.0.0-pre.N`) until the owner promotes it at a release. Nothing here publishes a 1.0.
- Assumption: no new capability id is minted for this epic. Offer `bmad-spec` or an architecture amendment if the owner wants the native format listed as a capability.
- Open question: which package owns the path, ID and link rules, and which owns the file walk, given G2 (core touches no I/O). 27.2 settles it in its plan.
- Open question: whether epics 12 to 14 gain a prerequisite on 27.6 once the editor proof exists.
- Parked: runtime loading, importer output and editor support for the actor-family and scene contracts. They are planned in a re-slice after 27.7 and 27.8 are approved.
- Waits on epic 2 because: the 1:1 importer oracle reads legacy files through the format registry and readers (27.4).
- Waits on epic 11 because: 27.6 needs the shared editor documents and platform-services. Early stories are independent.
