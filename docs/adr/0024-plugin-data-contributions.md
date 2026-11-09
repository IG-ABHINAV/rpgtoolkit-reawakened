# ADR 0024 — Plugin data contributions: which native contracts a plugin extends, with a schema and migrations for each

* **Status:** Proposed (owner rulings of 2026-11-09, recorded for approval; ticket 27.1 / [#1800](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1800), epic 27 / [#1802](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1802)). The plugin-side companion to [ADR 0023](0023-native-data-contracts-versioning-identity-and-sidecars.md) decisions 7 and 12, which hold the document side.
* **Date:** 2026-11-09
* **Context documents:** [0004-script-ast-step-ir-and-plugins.md](0004-script-ast-step-ir-and-plugins.md) (`PluginDefinition`), [0023-native-data-contracts-versioning-identity-and-sidecars.md](0023-native-data-contracts-versioning-identity-and-sidecars.md), [0022-shared-editor-authoring-contracts.md](0022-shared-editor-authoring-contracts.md#d6--settings) (D6, settings), [spec/formats/native-contracts.md](../spec/formats/native-contracts.md#plugin-blocks), [spec/engine/rpgcode-modules-and-objects.md](../spec/engine/rpgcode-modules-and-objects.md#pkg-2) (PKG-2, the plugin id), [spec/engine/rpgcode-package-loader.md](../spec/engine/rpgcode-package-loader.md), [findings/plugin-data-models](../findings/plugin-data-models/README.md)

## Context

[ADR 0023](0023-native-data-contracts-versioning-identity-and-sidecars.md) decision 7 puts a plugin's data in the document it belongs to, in a **block** under the root key `pluginData`, keyed by plugin id, with its own `version` and `data`. The core checks the block's envelope and never reads inside it. That says what a document holds. It does not say how a plugin states what its data *is*: its schema, its version, how older data is brought forward, and which kinds of document it adds data to. This ADR is that plugin-side contract.

The owner's direction on 2026-11-09 was that the VS Code settings model is the pattern: "Provide a namespace and give it a version to have to follow inside the namespace ... This would allow the plugins to define the version number and the migration needed." Unknown keys are tolerated, and "we will have the plugins provide schemas that the sections can be validated against". A plugin therefore contributes its data configuration much as a VS Code extension does through [`contributes.configuration`](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration): the plugin ships the schema, and the host uses it. Two things are added, and both are the owner's:

* **A contract qualifier.** "Every property added likely belongs to a particular asset type so we need a way to qualify which asset type is getting that new property. This way if someone wanted to add to `tkranm` they would be able to do so with their own namespacing." A plugin can contribute a per-actor configuration and a per-project configuration separately, because each contribution names the contract it attaches to.
* **A version and a migration**, which VS Code does not give extensions: the plugin owns the data's version and how older data reaches it ([findings](../findings/plugin-data-models/README.md#what-the-evidence-showed)).

## Decision

1. **A plugin declares its data contributions in its definition, one entry per native contract it extends.** [`PluginDefinition`](0004-script-ast-step-ir-and-plugins.md) gains one optional field, `contributes`. It is **plain data only**: JSON values, no functions, so the host can supply it in the catalogue and the core can read it without loading plugin code ([G2](../guardrails.md#g2--hard-package-boundaries)).

   ```typescript
   export interface PluginDefinition {
     // id, version, commands, decoders and subsystems as in ADR 0004
     contributes?: readonly DataContribution[];
   }

   export interface DataContribution {
     contract: string;                      // a contract name as the stamp spells it, e.g. "animation-clip"
     version: string;                       // the current data version for this (plugin id, contract) pair
     schema: object;                        // the plugin's JSON Schema for its `data` block on that contract
     migration?: readonly MigrationStep[];  // how older data on that contract reaches `version`
     renamedFrom?: readonly string[];       // earlier plugin ids that blocks of that contract were written under
   }

   export interface MigrationStep {
     from: string;                          // the lowest block version this step applies to
     to: string;                            // the version the block has afterwards
     operations: readonly MigrationOperation[];
   }

   export type MigrationOperation =
     | { op: "rename"; path: readonly (string | number)[]; to: string }
     | { op: "set"; path: readonly (string | number)[]; value: unknown }   // value: plain data
     | { op: "remove"; path: readonly (string | number)[] }
     | { op: "move"; path: readonly (string | number)[]; to: readonly (string | number)[] };
   ```

   A plugin that extends two kinds of document has two entries. The same plugin id may contribute to several contracts, with a different schema, version and migration list for each (illustrative; the `actor` contract is not written yet, and the keys are examples):

   ```typescript
   {
     id: "com.example.glow",
     version: "2.1.0",                        // the package version (PKG-2): not a data version
     contributes: [
       {
         contract: "animation-clip",          // blocks on a .tkranm document
         version: "1.0.0",
         schema: { type: "object", properties: { bloom: { type: "number", minimum: 0, maximum: 1 } } },
       },
       {
         contract: "actor",                   // blocks on an actor document
         version: "0.2.0",
         schema: { type: "object", properties: { radius: { type: "integer", minimum: 0 } } },
         migration: [{ from: "0.1.0", to: "0.2.0", operations: [{ op: "rename", path: ["halo"], to: "radius" }] }],
       },
     ],
   }
   ```

   `contract` names the **contract**, as the stamp spells it (`animation-clip`), not the extension: the registry ([ADR 0023](0023-native-data-contracts-versioning-identity-and-sidecars.md), decision 11) maps the two, and the stamp is the authority. `schema` is a JSON Schema because the owner's shape says so and the clip contract already publishes one; the project-wide choice of schema technology is still open ([ADR 0023, open questions](0023-native-data-contracts-versioning-identity-and-sidecars.md#open-questions)) and `schema` follows it. A schema describes the keys the plugin knows and leaves `data` open, because unknown keys are never an error (ADR 0023, decision 7). Two entries for one contract in one definition are a catalogue fault, like two plugins with one id (`manifest.duplicate-namespace` today).

2. **A block is validated by the (plugin id, contract) pair, never by one schema per plugin.** The document's stamp names the contract and the block's key names the plugin. Together they select the contribution, and so the schema, the current data version and the migration list. A block of `com.example.glow` on a clip is judged by the clip entry above and a block of the same plugin on an actor by the actor entry.

3. **A block is valid only on a contract the plugin declares.** The core cannot know this: it holds no plugin code and the core checker stays purely structural (ADR 0023, decision 8). When the plugin is installed, the host-side check reports **`plugin-contract-unsupported`** for a block of that plugin that sits on a document whose contract the plugin has no contribution for. **That check runs only when the plugin is installed, like every other plugin-present check.** With the plugin absent, nothing is known about which contracts it would accept: the block is preserved as written and noted as `plugin-absent`, and a block on a contract the plugin never meant to extend is not found until the plugin is installed. The block is never dropped either way.

4. **The contract is not part of the key.** A block is written `pluginData.<plugin id>`, never `pluginData.<contract>.<plugin id>` and never with a `contract` field of its own. *Reason:* the block lives inside a document whose stamp names the contract, so containment already says which asset type it applies to. Repeating the contract in the key would be a second copy of what the document already says, and the two can disagree. That is the argument [ADR 0023](0023-native-data-contracts-versioning-identity-and-sidecars.md) used against a manifest of versions and against a stored back-link. The **declaration** names the contracts; the key does not.

5. **A plugin never adds a core property.** "Adding to `.tkranm`" means adding a namespaced block to a clip, never a new key of the clip. A document's top level is the stamp, the contract's own fields (the **core fields**, closed) and `pluginData`, the one open dictionary ([ADR 0023](0023-native-data-contracts-versioning-identity-and-sidecars.md), decisions 5 and 12). The worked example, a clip that carries data of a plugin with the qualified id `com.example.glow`:

   ```yaml
   contract: animation-clip
   version: 1.0.0-pre.1
   canvas: {width: 32, height: 32}
   delay: 0.15
   frames:
     - image: bitmap/hero_walk_s1.png
   pluginData:
     com.example.glow:
       version: 1.0.0
       data:
         bloom: 0.4        # the plugin's own key, inside its own block
   ```

   `com.example.glow` **cannot** add `bloom` as a sibling of `frames`:

   ```yaml
   frames:
     - image: bitmap/hero_walk_s1.png
   bloom: 0.4              # an error: `bloom` is not a key of the animation clip contract; the contract is closed
   ```

   An unknown key at the top level is an error, so a typo such as `colorKey` still cannot pass for `colourKey`. The plugin owns everything under `pluginData.com.example.glow.data` and nothing outside it.

6. **Namespaces separate plugins; a plugin never depends on another's keys.** Two plugins may each use a data key named `strength` with no collision, because each key is inside its own block: `pluginData.com.example.glow.data.strength` and `pluginData.org.example.tint.data.strength` are different keys. What a plugin author must not do is **read, write or rely on another plugin's block or keys**. A plugin reads only the block under its own id, and there is no cross-plugin data contract in this version.

7. **Limits of this version, with the reason for each.**
   * **A block exists only on a native contract document.** A plugin **cannot** attach data to a legacy binary file (`.anm`, `.brd` and the rest). Those files are read through the compatibility layer, have no stamp and no `pluginData` key, and a native writer never rewrites them ([ADR 0009](0009-compatibility-layer-not-the-model.md)).
   * **A block exists only at the top level of a document, in `pluginData`.** A plugin **cannot** attach data directly to a non-document object: a scene placement, a clip frame, a tile. Such an object has no ID and no door. A plugin that needs per-placement or per-frame data keeps its own structure inside its own block on the owning document. Whether a placement may carry a nested door is the scene contract's decision (story 27.8 / [#1809](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1809)), **not this ruling's**.
   * **Every native contract has the door.** The top level of every native document admits `pluginData`, so a plugin can contribute to any contract that has a contract page. A `pluginData` key anywhere else is an unknown key.

8. **Reading never migrates; an upgrade is explicit.**
   * **Read.** A reader takes the keys it knows from data of any version and ignores the rest. A block newer than the installed plugin is read for the keys the plugin knows: no refusal, no migration on read, no key dropped. A key the plugin knows whose shape changed in a newer MAJOR is not an unknown key; the plugin's schema reports it as a located error on that key, and a plugin may treat a newer MAJOR as read-only.
   * **Write.** A writer changes only the keys it owns, as splices into the original text, and stamps a new `version` only as the result of an explicit upgrade.
   * **Which schema.** The host validates a block against the contribution's `schema` when the block has the same MAJOR as the contribution's `version`; a block with another MAJOR is not validated and is noted (`plugin-data-newer` or `plugin-data-older`, with an upgrade available for the older one).
   * **Upgrade.** An explicit command (an editor action or a command-line command), run by the host with the plugin present, one (plugin, document) pair at a time, applying the contribution's `migration` steps in order from the block's version to `version`. **Migration never runs at engine load and never when the editor opens a document.** The engine never writes, and opening a file must not rewrite it. The result is an ordinary reviewable diff: the `version` line and the keys the steps name change, and nothing else. A project can hold blocks at mixed versions, as it can hold documents at mixed contract versions ([ADR 0023](0023-native-data-contracts-versioning-identity-and-sidecars.md), decision 1).

9. **A migration is a list of operations on the existing text, not a function.** The four operations are `rename` (change the last key of `path` to `to`, value untouched), `set` (give the key at `path` a plain value, adding it if absent), `remove` and `move`. The host applies them as splices into the original text. A function that returns a whole new `data` object would regenerate every key the plugin does not know and lose its comments, which breaks the preservation rule of [ADR 0023](0023-native-data-contracts-versioning-identity-and-sidecars.md), decision 12, so it is not accepted. Operations are plain data: pure, deterministic ([G3](../guardrails.md#g3--determinism)) and free of I/O ([G2](../guardrails.md#g2--hard-package-boundaries)), and there is no plugin code to trust at upgrade time.

10. **A plugin that renames its id declares it.** A block's key is the plugin's identity, so changing the id is a data migration across every document of every game that carries the block. The new definition lists the old ids in `renamedFrom` on each contribution that existed under them, and the explicit upgrade moves the key by splice and sets the new `version`. Without a declaration the old block is orphaned: preserved, dormant, and the new id starts empty. No tool guesses a rename.

11. **Plugin ids may be qualified with dots.** The id of a plugin is the `id` of its `PluginDefinition` and its package name; [PKG-2](../spec/engine/rpgcode-modules-and-objects.md#pkg-2) is amended so that `com.example.weather` is a valid id, and every id that was valid stays valid. The grammar, the reserved keys (a plugin id is never `contract`, `version`, `tags`, `metadata` or `pluginData`, and never a core field of the contract whose document holds the block) and the allocation convention are in PKG-2. A plugin id is not a document ID ([ADR 0023](0023-native-data-contracts-versioning-identity-and-sidecars.md), decision 6).

12. **Who holds and who runs what.** The host supplies each plugin's definition, `contributes` included, in the package catalogue ([rpgcode-package-loader.md](../spec/engine/rpgcode-package-loader.md)); the core loads no code and reads no file. The core checker never reads a contribution. The plugin-present checks (`plugin-data-invalid`, `plugin-contract-unsupported` and the notes of the [spec](../spec/formats/native-contracts.md#checks-that-need-the-plugin)), the editor and the upgrade command are host-side and need the plugin installed. The project stores no schema registry ([ADR 0023](0023-native-data-contracts-versioning-identity-and-sidecars.md), decision 1): the plugin's definition is the one copy.

13. **One mechanism for per-actor and per-project configuration.** A plugin that wants a setting per actor and a setting for the whole project makes two contributions, one for `actor` and one for the project definition contract (not written yet: the project definition is described in [findings/native-data-boundaries](../findings/native-data-boundaries/candidate-constructions.md) as owning "extension configuration"). Each has its own schema, version and migration. Until that contract exists, per-project configuration has no document to live in; this is recorded, not worked around. Contributions to the **editor's settings catalogue** ([ADR 0022](0022-shared-editor-authoring-contracts.md#d6--settings), D6.5) stay undecided: this ADR decides game data only, and per-user view state is never a block (D6.1).

## Consequences

* A plugin author, or a third party, extends an existing kind of document, a clip for example, with a block under a namespace of their own and a contribution in their plugin. No change to the contract's page or to the extension registry is needed, because a block has no extension of its own.
* A contract's core fields should be assumed to shrink over time (the owner's tentative direction, not a decision: [the shrinking core](../findings/plugin-data-models/README.md#the-shrinking-core)), so the `pluginData` door is designed as the primary extension surface and not as an escape hatch. A field that ever leaves the contract is a mechanical move from the top level to the plugin's block: `delay` becomes `pluginData.<id>.data.delay`.
* The core and the core checker stay free of plugin code. The price is that every check that needs the schema or the contract list runs only when the plugin is installed. With the plugin absent a typo inside `data` and a block on the wrong contract are both invisible, and with it present an optional key that is misspelt is an unknown key and passes.
* Plugin versions are the plugin's to manage. Mixed block versions in one project are normal; upgrading is explicit, per plugin and document, and a diff.
* A contribution is part of a plugin's compatibility surface. Removing a contract from `contributes` turns every existing block of that plugin on that contract into `plugin-contract-unsupported` while the plugin is installed. The block is kept, not deleted.
* Renaming a plugin id costs a data migration in every document that carries a block.
* Anyone who adds a writer for native documents must preserve blocks they do not understand ([ADR 0023](0023-native-data-contracts-versioning-identity-and-sidecars.md), decision 12). That is a rule on writers, and it can be tested for ours and not for anyone else's.

## Alternatives considered

* **One schema per plugin, with no contract qualifier.** Rejected: an actor and a clip have different shapes and different owners, so one schema would have to branch on the contract anyway. The owner asked for the qualifier so that a plugin can extend `.tkranm` with its own namespace and an actor separately.
* **The contract in the key (`pluginData.animation-clip.com.example.glow`) or a `contract` field in each block.** Rejected: decision 4. A second copy of what the document's stamp says, free to drift.
* **A prefix convention and no declaration, as VS Code treats the prefix of a setting's key.** Rejected: the documentation read does not show VS Code enforcing the prefix ([findings, unverified 1](../findings/plugin-data-models/README.md#unverified)), and the host needs a declaration to find a schema and a migration for a (plugin, contract) pair.
* **A project-level registry of plugin schemas and versions.** Rejected for the reason [ADR 0023](0023-native-data-contracts-versioning-identity-and-sidecars.md) gives against a manifest of versions: a second copy that can disagree with the plugin and the documents.
* **A migration written as a function that returns the new `data`.** Rejected: decision 9.
* **A per-document list of the plugins a document needs, as glTF's `extensionsUsed` and `extensionsRequired`.** Not adopted: the `.gam` package list already says which packages a game requires ([PKG-3](../spec/engine/rpgcode-modules-and-objects.md#pkg-1)), and a per-document list would be a second copy.

## Open questions

* The schema technology of `schema` follows the project-wide choice, still open ([ADR 0023](0023-native-data-contracts-versioning-identity-and-sidecars.md#open-questions)). How a host treats a plugin schema that closes `data` (`additionalProperties: false`), which would turn an unknown key into an error and so contradict decision 7: refuse it when the catalogue is built, or ignore that keyword.
* **Severity of `plugin-contract-unsupported` when the plugin is older than the data.** A newer plugin may have begun to contribute to a contract the installed older one does not know. As written it is a problem, because "valid only on a contract the plugin declares" is the ruling, and the block is preserved either way. The owner may prefer a note in that one case.
* What the host does with a contribution that names a contract the registry does not hold: a note or a refusal when the catalogue is built.
* Whether a plugin may contribute to every contract at once (a wildcard `contract`). Not provided.
* Whether a migration may ever be computed rather than declared with the four operations, and then under which trust rule ([ADR 0008](0008-rpgcode-packages-and-trust-baseline.md)).
* Whether the reservation of ids is enforced, not only conventional ([PKG-2](../spec/engine/rpgcode-modules-and-objects.md#pkg-2)).
* How a plugin-defined contract that is a document of its own gets an extension, when the registry (decision 11 of ADR 0023) lives in the core package.
* What a contribution carries for a settings UI (a label, a description, a group, defaults), as `contributes.configuration` does in VS Code. Not needed by the checker; tied to ADR 0022 D6.5.
* The project definition contract, which per-project configuration needs, is not written.
