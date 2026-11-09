# ADR 0009 — RPG Toolkit 3.1 is a compatibility layer, not the model

* **Status:** Accepted (owner decision, 2026-10-19). Extends [ADR 0005](0005-independent-product-v1-and-native-format.md), decision 2.
* **Date:** 2026-10-19
* **Context documents:** [0005-independent-product-v1-and-native-format.md](0005-independent-product-v1-and-native-format.md), [0007-docs-spec-is-the-normative-specification.md](0007-docs-spec-is-the-normative-specification.md), [spec/README.md](../spec/README.md)
* **See also:** [0023-native-data-contracts-versioning-identity-and-sidecars.md](0023-native-data-contracts-versioning-identity-and-sidecars.md).

## Context

[ADR 0005](0005-independent-product-v1-and-native-format.md) made TK Reawakened an independent product and said TK3 behaviour is "a compatibility target, not a design constraint". It did not say which way the dependency runs inside the core: whether new features are shaped by 3.1's storage and naming or 3.1 is adapted onto the core's own shapes. The platform epic (object runtime, emitters, packages) and the actor epic need that rule stated before they build.

## Decision

1. **3.1 is a compatibility layer, not the model.** The core is built on objects and forward design (dictionary objects, first-class callables, emitters, packages). Our under-the-hood workings and forward design are **not bounded** by the 3.1 model.
2. **Legacy 3.1 names, commands and data shapes are aliases and adapters onto the core model.** A 3.1 `.tem` stat global such as `HP!` is a live alias onto the actor's own stat; a legacy `class` is a kind of dictionary object; a legacy command name resolves onto the same table as every other command. The alias or adapter is where 3.1's behaviour is kept, so the core never has to carry it.
3. **3.1 behaviour remains the oracle for what a legacy game observes.** A legacy game that ran under 3.1 plays unchanged; the headless goldens (G5) and the spec's legacy-behaviour rows stay the check. A departure from an observable 3.1 behaviour is a **Reawakened rule** with a stated reason (ADR 0007, decision 2), never an accident of the model.
4. **A 3.1 quirk is reproduced only where a game is found to depend on it, and then case by case, in the compatibility layer** (an importer, an adapter or a dialect frontend), never in the core. Example: 3.1's "assigning to a virtual variable breaks its link to the engine for the session" is **not** reproduced; a write writes through or is a catchable runtime error ([VIRT-1](../spec/engine/rpgcode-language.md#virt-1)). If a game is found to depend on the broken link, the compatibility layer handles that game.
5. **Prior internal shapes of this project carry no compatibility promise** either: Reawakened's own earlier internal formats may be replaced without shims (a deliberate golden re-record, G5, explains the change).

## Consequences

* Specs state the model first and the 3.1 name as an alias of it, with the author-facing explanation ahead of the technical rule (the help-text rule in `CLAUDE.md`).
* Format work keeps the legacy reader layer separate from the native model (ADR 0005 consequences).
* A compatibility shim that reproduces a 3.1 quirk needs evidence that a real game depends on it, and lives outside `core`.
* The risk is a game that depends on an undocumented 3.1 quirk we chose not to reproduce. Mitigation: the corpus and golden runs, and the case-by-case compatibility layer of decision 4.

## Alternatives considered

* **Model the core on 3.1 and add objects on top.** Rejected: every new feature would carry the 3.1 storage and naming quirks, and two object stores would have to agree.
* **Reproduce every 3.1 quirk for safety.** Rejected: it freezes defects (such as the broken virtual-variable link) into the model and makes the core depend on the legacy engine's accidents.
