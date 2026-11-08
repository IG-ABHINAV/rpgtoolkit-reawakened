# Candidate native data constructions

**Research proposals, not an approved format or migration.** These boundaries follow the owner's direction in [the research brief](README.md#direction), the field catalogue and the measured corpus. They do not select TOML, YAML or JSON, change an ADR, or require creators to edit text manually.

## The main distinction: definition, placement, state

An actor definition says what something is and what it can do. A scene placement says where a particular instance starts and what that placement changes. Runtime/save state says what has happened to that instance. Those have different ownership and lifetimes even when an editor presents them together.

The current data already supports this distinction: an `.itm` owns movement graphics, collision/activation bases and default programs; a board sprite owns its position, loading condition and activation/multitask overrides. Copying all definition fields into every scene placement would discard an existing useful boundary.

## Candidate logical owners

These are candidate *contracts*, not a list of compulsory files or editor tabs.

| Logical owner | Data it owns | Relationships, not copied data | What should not leak into it |
|---|---|---|---|
| Project definition | Title, starting scene/party, input defaults, audio-track definitions, encounter/game rules, startup and global hooks, extension configuration | Initial scene and actors; scripts; reusable rules/assets | User/editor preferences, machine paths, live input, save-game progress |
| Actor definition | Identity and world-presence capabilities: presentation binding, movement, collision, interaction area, default behaviour and events | Presentations, behaviours, optional gameplay capabilities | Current position, current HP, inventory stack quantity, legacy slot padding |
| Item capability/definition | Description, menu icon, value, stacking/consumption policy, equip eligibility, stat modifiers, actions and possible skill grants | Actor/world representation where applicable; skills/effects | An assumption that every inventory object is continuously simulated on a board |
| Character/combat capability | Initial stats, progression, equipment slots, skill eligibility, AI and combat events/rewards where applicable | Skills, status/effect definitions, presentation bindings | A compulsory `.tem` versus `.ene` split merely because TK3 stored them separately |
| Skill definition | What the action does, cost, targeting/eligibility, menu description/icon and default effect presentation | Effects/statuses, presentation cues, hooks | World placement/movement; one universal caster animation forced on every character |
| Skill binding or grant | Which actor/item provides a skill, eligibility and lifetime; actor-specific performance presentation | Skill identity, caster stance/clip, item or actor source | Duplicated copies of the skill's cost, damage or description |
| Status/effect definition | Duration, periodic or immediate effects, stacking/removal policy where supported, hooks | Other effects, cues and scripts | Current remaining duration on an affected actor |
| Scene definition | Spatial extent, coordinate conventions, tile layers, geometry, placements, triggers, environment, connections, encounter overrides | Actors, presentation assets, scripts, battle environments | Repeated actor definitions and unrelated inventory databases |
| Presentation definition | Reusable frame/clip/stance bindings; world, portrait, menu and action roles; timing, anchors, visual variants and synchronized sounds | Image/pixel assets, tile regions, audio | Combat identity, item price, HP or script globals |
| Tile/image composition | Tile-region identities, animation cycles, composed pictures and tints | Binary image/atlas payload and other clips | Pixel arrays serialized into a general-purpose authoring document merely to make everything text |
| Battle environment | Background composition, music and event sounds | Images/compositions and audio | Enemy definitions, encounter eligibility, mutable battle state |
| Behaviour/script binding | Behaviour parameters and event hooks; inline source or a referenced source file | Shared programs and their assets | Filesystem-failure guessing as the discriminator between source and a filename |

**Actor includes items and NPCs**, as requested. The item row does not exclude items from the actor model: it separates inventory/equipment semantics from the capability to appear and move in the world. A world pickup could be an actor with an item capability, or an actor referring to an inventory definition. An NPC can be an actor without inventory semantics. Which representation gives the cleanest identity and editing experience remains a design question, not a settled inheritance tree.

The existing runtime/save actor kinds are **not** evidence that the authored definition model must retain that exact type list. Conversely, introducing an authored actor contract does not justify silently rewriting save identity or compatibility adapters.

## Items, skills and contextual presentation

A useful candidate relationship is:

| Relationship | Example meaning | Decision still needed |
|---|---|---|
| Actor has skill | This character can use a named skill after meeting its progression condition | Eligibility, ordering and temporary versus learned access |
| Item grants skill | Equipping a staff provides a named skill | While equipped, while held, on consumption, or permanently learned; duplicate grants and removal |
| Actor binds skill performance | This character performs that skill using its own stance/clip | Override precedence and what happens when the binding is absent |
| Skill has menu presentation | The skill has an icon and description when listed | Whether this belongs inline in the skill or references a reusable presentation |
| Skill triggers effect presentation | A projectile, flash, sound or target effect accompanies use | Timing and ownership independent of the caster's body animation |

The first relationship is already visible in character special-move slots. The item-grant relationship is an owner-requested candidate; this census does **not** claim it found a direct legacy field implementing it. The pattern pass likewise did not establish a repeated item-grants-skill convention. Do not convert that absence into a rejection of the feature.

## A concrete worked construction, without choosing syntax

The shipped demo provides a small useful design exercise:

| Existing source | Candidate construction | Preserve during import |
|---|---|---|
| `demo/Item/man.itm` | World actor with movement presentation, collision/interaction geometry and behaviour | Item-origin compatibility identity and default hooks |
| `demo/Chrs/start.tem` | Player actor plus character/combat/progression capabilities | Starting stats, script-variable aliases, equipment eligibility, skill conditions |
| `demo/Misc/start/start_s.anm` | A reusable south-walk clip referencing two tile regions | Frame order, 0.15-second timing, transparency and per-frame sound semantics |
| `demo/Boards/start.brd` sprite | A placed actor reference with position/layer and local hook overrides | Stable placement identity, conditions and trigger ordering |
| Board trigger/waypoint geometry | Scene-owned regions and paths | Units, closed/open shape, layer and stable references |
| `demo/Prg/man_wander.prg` | Referenced behaviour; potentially a parameterized wander/intercept feature | Relative range, proximity rule, path wait, recheck after movement, randomness and sleep ordering |

This is a conceptual redistribution, **not a converted demo**. No game bytes, fixtures or runtime contracts were changed.

## Inline and separate RPGCode are both legitimate

Use an explicit source choice in a future binding: **inline RPGCode text** or **program reference**. The spelling of that choice is undecided. An inline block is not automatically a new global program, and a file reference should not silently become source code because a file was renamed.

The current demo already combines both: a scene trigger holds an inline `send` call; a sprite holds an inline `itemPath` call and a separately referenced activation program. Three Chickit Hunt item hooks initially flagged by punctuation screening proved to be `.prg` filenames, not inline source. That verification reinforces why a new contract should distinguish the cases explicitly; it does not establish identical fallback rules for every legacy hook.

Before finalizing this contract, specify:

- Source/target/current actor context and scope for each event; whether a hook waits or starts a thread.
- Relative asset/include resolution, source identity and cache invalidation.
- Diagnostics and debugger locations for a block inside a document as well as an external file.
- Stable identity when moving a block between inline and external storage, including save/continuation implications.
- Deterministic ordering and serialization under G1/G3; inline storage changes neither rule.
- Editor extraction/inline actions that preserve meaning, not just copy text.

Keep shared or substantial programs separate when reuse, debugging or collaboration benefits. Keep small asset-local hooks inline when that makes ownership clearer. Do not prescribe a line-count threshold as a format rule.

## Logical encapsulation before physical documents

Keep a separately named document when it has independent identity, reuse, lifecycle, review ownership or meaningful concurrent editing. Nest data that exists only as part of its owner: a placement transform, a trigger polygon, or a clip frame ordinarily does not need its own file. Sharing or scale can justify a later extraction without changing its logical meaning.

Do **not** combine every actor, item and skill into one database because the serializer permits it. Also do not make one file per scalar/vector merely to maximize separation. A reusable presentation can live separately; a one-off actor-local presentation can remain part of that actor's document if the eventual contract explicitly permits both.

Large tile layers deserve a measured editing experiment: stable row/chunk organization may produce better diffs than a single enormous scalar or thousands of separate cell files. Compression is a distribution/performance choice to justify with measurements, not the default authoring model. Binary image pixels are an appropriate exception to text-first authoring.

## Editors follow tasks, not these rows

A creator-facing actor workflow may edit identity, capabilities, presentations and placed-instance overrides together while making each edit's scope visible. A skill workflow can show who learns/grants it and character-specific performance bindings. A scene workflow can place and configure actors without cloning their definitions. A presentation browser can serve actors, skills, menus and scenes.

The underlying files are contracts. Their existence should not force creators to understand serialization syntax, locate every reference manually, or navigate one editor per physical file. The data model must remain useful independently of a particular host or pane layout.

## What to decide next

Review the boundaries using the demo, an NPC-heavy game, a script-heavy game and an older tile-based game. Resolve identity and instance overrides first, then skill grants/presentation bindings and script context. Only then compare candidate textual syntaxes using the **same** representative constructions and edit operations: rename an actor, move a clip, change one tile row, resolve a merge conflict, and extract an inline hook.

This research does not approve a schema, extension, conversion command, compatibility-removal plan or editor implementation. The [coverage limits](coverage.md) must travel with later design claims; undocumented recovered variants need investigation before anyone promises a lossless conversion of every game.

## Key source files

- [Actor fields](fields-actors.md), [project/world fields](fields-world-project.md), [presentation fields](fields-presentation.md), [runtime/package boundary](fields-compatibility-runtime.md).
- [Measured evidence and reproduction](README.md), [RPGCode patterns](script-patterns.md).
- [Independent product and native format](../../adr/0005-independent-product-v1-and-native-format.md), [compatibility layer, not the model](../../adr/0009-compatibility-layer-not-the-model.md).
- [Board layout](../../spec/formats/board.md#vector-layout-minor-4-and-later), [program source forms](../../spec/formats/rpgcode-program.md#text-form).
