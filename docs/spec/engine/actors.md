# Actors, progression, behaviours, and hydration

This page defines the Reawakened actor model for party members, enemies, NPCs, and board sprites. An actor is plain data owned by the actor section. RPGCode and packages receive an actor view and request changes through the actor owner; they do not keep a second copy of actor state.

## Core and battle boundary

The core owns actor data and the interpretation rules that are true for any game:

- actor identity, stats, statuses, equipment-derived bonuses, and progression state;
- the default `fallen` state (`HP <= 0`), status countdown, equipment interpretation, and level-up policy;
- actor snapshot, restore, hashing, and hydration;
- actor events that describe core state transitions.

The stock battle package owns battle-specific systems: charge and turn order, damage formulas, AI, battle UI, rewards timing, and the meaning of a battle round. A battle script chooses when `advanceStatus(n)` is called. The core does not own a battle scheduler.

A `battle` save section MAY hold transient, saveable package data, but that section does not create a core `battle` tick phase. Random encounter evaluation is a trigger-phase responsibility and may start a custom fight program or the stock battle package.

## Actor data and identity

Every runtime actor has one stable scalar `id` and plain-data fields. The stable id is the save and event identity. A script object handle and an emitter registration key such as `actor:<id>` are rebuilt runtime identities and are never used as saved actor ids.

A runtime actor MAY contain:

- source asset and kind (`party`, `enemy`, or `npc`); a board sprite is not an actor kind
  ([Sprites and board geometry](#sprites-and-board-geometry));
- current and maximum stats, including level and total experience;
- status counters and equipment-derived state;
- progression state and actor-owned progression policy data;
- a behaviour name, or no behaviour name;
- declared custom event names from the source asset.

It MUST NOT contain a callable, compiled program, host object, emitter listener table, or raw `.prg` path. Host methods and emitters are hydrated after load.
The current persisted actor-section schema is version 2. A version-1 actor section is migrated in place during snapshot restoration without replacing its records: the restore step carries the saved actor, stats, and policy fields forward, derives `nextRequirement` and `remainingExperience` using the recurrence in [progression-and-levels.md](progression-and-levels.md), and sets `legacyLevelUp` to `null` because a version-1 save has no persisted source-program flag. `null` means legacy precedence is unresolved; the actor owner MUST resolve it from the source asset before awarding XP. A malformed or unsafe migrated policy is rejected as a restore-shape error; an actor-section version newer than version 2 is unsupported and MUST be rejected rather than treated as current. Existing actor identity, stats, statuses, equipment, and progression policy are never reset.

## Store and action boundary

Actor records are the store's plain-data state. Code does not call methods on
an actor record or mutate its fields directly. Actor operations are dispatched
through an action/service layer: an action identifies the requested operation
and its plain-data inputs; the actor service validates it, runs the applicable
core rule or behaviour, and commits the resulting plain-data patch to the
actor store. The store remains the single owner of actor state and produces
snapshots, hashes, and transition events from committed changes.

The action and service layers are runtime machinery and are not serialized into
the actor record. A hydrated RPGCode object may expose those operations as
methods, but each method dispatches through the actor service and never turns
the underlying record into an object with methods.

A package command receives the actor operations themselves — `readActor`, `updateStats`, `damage`, `advanceStatus`, `applyEquipment` and `awardExperience` — as part of the view it is called with. Calling one dispatches through the actor owner, resolves that actor's behaviour hooks, validates the patch, commits it, and queues the resulting transitions. A command that patched the actor section directly would skip the hooks and the events, so it MUST NOT. An RPGCode battle script applies damage and awards experience through its package's commands and the actor owner's damage operation; the battle's damage formula still belongs to the package (Core and battle boundary).

### Owner-mediated damage operation

The actor host exposes a `damage(amount, source, pool)` operation to package
code. `amount` MUST be a finite number. `pool` is `hp` by default and is `smp`
only when explicitly selected; any other pool value resolves to `hp`.
`source` is an actor id or `null`, and `null` is retained when the operation
has no attacker attribution. The operation applies the requested subtraction
through the actor owner with cause `damage`, so the normal stat validation and
`[0, max]` clamping run before the committed result is observed. It returns
the actual amount removed after clamping. A committed HP transition to
non-positive emits the ordinary `fallen` transition with cause `damage` and
the supplied source; an HP transition from non-positive to positive follows
the ordinary revival rules. The operation does not choose battle formulas or
dispatch battle timing events; those remain the stock battle package's
responsibility.

The action type is section-specific: `ActorAction` covers actor operations,
while `BoardAction`, `InventoryAction`, `BattleAction`, and the other core
sections use the same boundary for their own state. These are plain-data
discriminated records, not methods attached to records. Exact action members
are defined by the section that owns them.

This rule does not require a persistent-immutable implementation or a full
state-tree copy on every tick. An owner MAY update its private live store
in place, provided callers receive read-only views, only the owner mutates
the store, and snapshots, hashes, saves, restores, and action results observe
the same deterministic committed state.

## Sprites and board geometry

A sprite is a board-scoped plain-data presence record, not an actor subtype.
It represents something occupying or capable of occupying board space and may
be static or moving, visible or invisible, actor-backed or asset-only. An
actor may have no sprite or more than one sprite; a sprite MAY reference an
actor through `actorId`.

Sprite geometry is separate from the actor record:

```text
geometry
├── occupancy   // movement collision and board blocking
├── activation  // interaction and trigger reach
└── hitbox      // attack, projectile and effect overlap
```

Each geometry role is optional, with a deterministic tile-aligned square as
the normal board default. Visual bounds are presentation data and do not
implicitly define gameplay geometry. Sprite state, geometry, movement queues,
and animation playback belong to the sprites/presentation owner; actor state
contains gameplay identity and rules.
Board hydration joins the two records by copying only the actor's stable
`actorId` onto the sprite. A sprite source MAY provide the actor id explicitly;
when the source is a board NPC whose actor record is selected by the board
hydration input, the owner links it only when exactly one actor source matches.
Shared assets require an explicit sprite-to-actor mapping; the owner never
silently chooses one actor. The sprite never copies stats, behaviour hooks, or
actor methods.
Actor operations (including behaviour resolution) dispatch through the actor
owner using this id; movement, collision, activation, trigger state, and
presentation continue to dispatch through the sprite owner. An asset-only
sprite has no actor id and follows the same sprite phases as before.


## Progression

The authoritative compatibility arithmetic is [Experience, rewards, and level progression](progression-and-levels.md). In summary:

- `levelType` is the initial XP requirement for the first level-up;
- `experienceIncrease` is the later-threshold parameter;
- `levelUpType = 0` selects percentage-labelled stat growth and percentage threshold growth;
- `levelUpType = 1` selects fixed-point stat growth and direct threshold growth;
- percentage threshold growth truncates after calculating `oldThreshold * experienceIncrease / 100`;
- a non-empty legacy `levelUpProgram` takes precedence over a behaviour `levelUp` hook.

Modern actors MAY store explicit progression policy data. A policy is plain data; it can tune the supported core modes without storing executable code. A resolved behaviour can replace or patch the core result. The precedence is:

```text
legacy levelUpProgram, when non-empty
→ behaviour levelUp hook
→ actor progression policy
→ legacy levelType/experienceIncrease compatibility policy
→ core defaults
```

A behaviour that supplies `levelUp` receives the actor and a plain-data context, including the XP award and core proposal. It returns a plain-data patch. Omitted fields mean unchanged; `undefined` is invalid and `null` is not an implicit unchanged marker. Stat changes use deltas where possible. The core validates and applies the final result, then emits `leveledUp`.

## Behaviours and hydration

A package registers behaviours separately from `registerPlugin` during package startup:

```text
package.behaviourStartup(registerBehaviour => {
  registerBehaviour("stock-rpg.hero", hooks)
})
```

The host invokes each resolved package's `behaviourStartup` callback in
manifest order during `runPackageStartup`, passing a registrar scoped to that
package's declared namespace. The registrar is valid only while that callback
executes; retaining it and calling it later MUST be rejected without mutating
the session registry. A callback's `registerBehaviour(name, hooks)`
call MUST use that namespace; a cross-package name is rejected with a located
diagnostic. This is a distinct startup registration surface, not a
`PluginDefinition.behaviours` data list and not a `registerPlugin` key.
Registrations are session data, rebuilt at boot, reset, and restore before
actor hydration.

Behaviour names use a hyphenated package namespace followed by a dot and a
behaviour identifier (`namespace.name`). The hook list is closed and defined by
core. Unknown behaviour names, unknown hooks, malformed names, wrong
namespaces, and duplicate registrations produce located diagnostics and
register nothing.

A behaviour hook takes the actor as an explicit argument. The actor is the
canonical plain-data read view; the hydrated RPGCode object wrapper is a
separate runtime object and owns method dispatch. No method, emitter, host
object, or callable is stored directly on the serialized actor record. Hooks
may emit queued events. A hook invoked by a script thread may use ordinary
script waits or cancelable event dispatch. An engine-originated hook is
synchronous and non-waiting; interactive follow-up belongs in an event listener.

A save stores actor data and a behaviour name only. On load, package startup rebuilds the session registry and hydration resolves the name. A missing behaviour uses the core default and emits one located diagnostic; it never refuses the save. Package versions and executable code are not stored in actor data.

## Behaviour hooks

The core hook surface includes:

- `levelUp(actor, context)`: returns a plain-data result patch; omitted fields do not change the core proposal;
- `revive(actor, context)`: may alter the synchronous revival result;
- `statusChanged(actor, context)`: may alter a status transition result;
- `equipmentChanged(actor, context)`: may alter equipment-derived stat results;
- `statsChanged(actor, context)`: may alter derived-stat results.

The `statusChanged` hook context receives `previousRounds`, clamped post-operation `rounds` (zero on expiry), and the caller-supplied `source` or `null`; countdown advancement supplies no implicit source. Hook result patches are validated separately from the returned `statusChanged` event detail.

These core-originated hooks do not wait. `levelUp` may wait only when it is invoked from a script thread, such as a script-driven XP award. Hook contexts and result patches are separate from standard-event detail payloads; the core validates and mutates actor state and returns plain transition records, while the owning event layer performs dispatch.
Hook result objects are closed plain-data patches. `revive` accepts only `hp`; `statusChanged` only `rounds` (a safe non-negative integer); `equipmentChanged` only `equipped` and `bonuses`, with bonus keys limited to `hp`, `dp`, `fp`, and `smp` and safe-integer values; `levelUp` only `deltas` and `stats`, with delta keys limited to `maxHp`, `dp`, `fp`, and `maxSmp` and safe-integer values. Unknown keys, unsafe or fractional values, and negative status-round patches are errors rather than silently ignored or clamped. The `statsChanged` patch uses the actor-stat key set and the same safe-integer validation.

For a stat or equipment operation, the core applies its operation-specific hook and then `statsChanged`; if the final proposed HP is positive after those patches and the actor was fallen, it invokes `revive` exactly once. The resulting `revived` transition is returned only when the final committed HP is positive; a revive patch that leaves HP non-positive produces no `revived` transition. An XP award invokes `statsChanged` only when at least one non-legacy level-up applies core stat growth; XP-only, max-level, and legacy-handoff awards do not invoke that hook.

**Item-action boundary (#589; TKR engineering rule).** For the composed inventory/equipment transaction only, preparation stages hook-emitted queued events and the actor patch until inventory and actor state can commit together. Its final equipped references and bonuses must match the canonical inventory-derived projection; a conflicting valid hook patch refuses that transaction rather than changing inventory behind the hook. Failed preparation discards staged events; prior committed item-program effects and arbitrary native external side effects are not rolled back. Success publishes hook events, actor transitions and inventory events in the order specified by the [item-action contract](plugins-and-battle.md#epic-85-item-action-proposal). This restriction does not change independent actor operations.

## Standard actor and board events

Notifications use past-tense lowerCamelCase names. Core actor and board events are:

| Event | Emitter | Cancelable | Ownership |
|---|---|---:|---|
| `fallen` | actor | no | core, only on transition into fallen |
| `revived` | actor | no | core, on transition out of fallen |
| `statusChanged` | actor | no | core status operation |
| `leveledUp` | actor | no | core after applying the final level-up result |
| `entered` | actor/board | no | board transition |
| `left` | actor/board | no | board transition |
| `talked` | actor | no | `stock_rpg` bridge after `dialogue.completed`; detail `{ actorId, targetId (actor id or null), text }` |
| `beforeEnter` | board | yes | board transition; canceled step does not happen |
| `beforeDamage` | actor/battle operation | yes | battle RPGCode thread, not a core actor rule |

`fallen` detail contains `cause` (`damage`, `status`, or `script`) and `source` (an actor id or `null`). `revived` carries the same `cause` and `source` fields; the revival cause is the operation that raised HP above zero. `statusChanged` detail is `{ status, previousRounds, rounds, expired, source }`, where `rounds` is the post-operation counter (zero when the status expires), `expired` is true only when the status is removed, and `source` is the actor id supplied by the caller when it attributes the operation, otherwise `null`; a countdown has no implicit source. Core hook result patches are not event details: `equipmentChanged` and `statsChanged` are hook names only. These are plain transition records returned by core operations; the core does not dispatch an event bus. `defeated` belongs to the stock battle package and is not a core actor event. Package events re-emitted on shared emitters receive the package namespace prefix.

An unloaded board unregisters its emitter and drops its listeners. Queued work targeting that emitter is stale and is discarded; it does not keep the board or its actors alive.

## Legacy stat aliases

Legacy `.tem`-named stat globals such as `HP!` and `Level!` are live read/write aliases to the actor-owned stat. They are not copies. Writes resolve through the actor owner. A write to a read-only alias raises `assign.read-only`; `kill()` on an actor stat alias or another protected system name raises catchable `kill.system-owned` and changes nothing.

## Custom actor events

An actor-producing asset MAY declare custom event names. Declarations are asset data read during hydration and are not copied into the saved actor record. Any event string remains valid at runtime; an undeclared event produces the tooling/runtime diagnostic defined by EMIT-12 but still dispatches. Custom declarations may not reuse reserved standard-event names.

## Actor contract entries

| Entry | Contract | Builder |
|---|---|---|
<a id="act-10"></a>
| ACT-1 | Actor identity is one stable scalar id; runtime handles and emitter keys are not save ids. | 20.3 |
| ACT-2 | Actor state is plain data; executable programs, host objects, listeners, and raw `.prg` paths are hydrated runtime concerns. | 20.8 |
| ACT-3 | The actor owns current/max stats, statuses, equipment-derived state, and progression state. | 20.3, 20.6 |
| ACT-4 | `levelType`, `experienceIncrease`, and `levelUpType` use the compatibility arithmetic in [progression-and-levels.md](progression-and-levels.md). | 20.6 |
| ACT-5 | A non-empty legacy `levelUpProgram` takes precedence over modern behaviour and policy selection. | 20.6, 20.7 |
| ACT-6 | Behaviour hooks receive the actor and return validated plain-data patches; omitted fields mean unchanged. | 20.7 |
| ACT-7 | Core-originated hooks do not wait; script-thread invocation may wait through the script scheduler. | 20.6, 20.7 |
| ACT-8 | Core owns actor mutation and emits actor transition events after applying validated results. | 20.6, 20.9 |
| ACT-9 | Board unload unregisters emitters and discards queued work targeting the unloaded board. | 20.9 |
| ACT-10 | The core has no battle phase; battle-package systems run through package threads and trigger handoff. Sprites are board presences that may reference actors, not actor subtypes. | 20.6, 20.10, Epic 7 |

The actor model inventory is entry 20.2. The actor store is 20.3; script object exposure and aliases are 20.4; asset hydration is 20.5; core interpretation rules are 20.6; behaviour registration is 20.7; save and hydration are 20.8; events and board emitter lifetime are 20.9; actor-backed sprites are 20.10. Epic 7 owns stock-battle behavior, and the editor epics own warnings and conversion of legacy `levelUpProgram` values.

## Actor inventory {#act-inventory}

This is the canonical 20.2 inventory. Each persisted source field appears once; runtime
state appears once in the runtime table. A `none` alias means the legacy engine has no
stat global for the row. The ownership choices in this table (actor versus sprite versus
item definition versus inventory, and core-rule versus battle-rule) were approved by the
owner on 2026-10-20. `core-rule` means the actor store owns the
interpretation; `battle-rule` means Epic 7 owns it. “Writer” identifies the only layer
permitted to mutate the value (a script may request a mutation through that owner).

### Source fields

| Name | Source field | Type | Section owner (actor, or sprite where marked movement/presentation) | Legacy alias | Writer | Rule | Evidence | Builder |
|---|---|---|---|---|---|---|---|---|
| display name | character.name / enemy.name | string | identity | `Name$` | core/actor script | core-rule | [character layout](../formats/character.md#layout) 3; [enemy layout](../formats/enemy.md#layout) 3 | 20.3/20.5 |
| experience | character.experienceVar + initial experience | int | progression | `Experience!` | core/actor script | core-rule | [character](../formats/character.md#layout) 4,13 | 20.3/20.6 |
| defence | character.defenseVar + defense | int | stats | `DP!` | core/actor script | core-rule | [character](../formats/character.md#layout) 5,13 | 20.3/20.6 |
| fight power | character.fightVar + fight | int | stats | `FP!` | core/actor script | core-rule | [character](../formats/character.md#layout) 6,13 | 20.3/20.6 |
| current HP | character.healthVar + health / enemy.hp | int | stats | `HP!` | core/battle operation | core-rule | [character](../formats/character.md#layout) 7,13; [enemy](../formats/enemy.md#layout) 4 | 20.3/20.6/Epic 7 |
| maximum HP | character.maxHealthVar + maxHealth / enemy.hp | int | stats | `MaxHP!` | core/equipment/level-up | core-rule | [character](../formats/character.md#layout) 8,13; [enemy](../formats/enemy.md#layout) 4 | 20.3/20.6 |
| actor name variable | character.nameVar | string variable reference | identity | `NameVar$` | core | core-rule | [character](../formats/character.md#layout) 9 | 20.5 |
| current SMP | character.smVar + sm / enemy.smp | int | stats | `SMP!` | core/battle operation | core-rule | [character](../formats/character.md#layout) 10,13; [enemy](../formats/enemy.md#layout) 5 | 20.3/20.6/Epic 7 |
| maximum SMP | character.smMaxVar + smMax / enemy.smp | int | stats | `MaxSMP!` | core/equipment/level-up | core-rule | [character](../formats/character.md#layout) 11,13; [enemy](../formats/enemy.md#layout) 5 | 20.3/20.6 |
| level | character.levelVar + level | int | progression | `Level!` | core/level-up/script | core-rule | [character](../formats/character.md#layout) 12,13 | 20.3/20.6 |
| portrait | character.profilePic | asset reference | presentation | none | hydration/editor | core-rule | [character](../formats/character.md#layout) 14 | 20.5/20.10 |
| special-move slots | character specialMove.file/minExp/minLevel/condition variable/required value (×201) | array of records | abilities | none | core hydration/script | core-rule | [character](../formats/character.md#layout) 15a–e | 20.5/20.6 |
| special-move menu label | character.specialMoveName | string | abilities | none | hydration/editor | core-rule | [character](../formats/character.md#layout) 16 | 20.5 |
| special-move flag | character.smYN | byte | abilities | none | hydration | core-rule | [character](../formats/character.md#layout) 17 | 20.5 |
| accessory slots | character accessory slot name (×11) | array<string> | equipment | none | core/equipment script | core-rule | [character](../formats/character.md#layout) 18 | 20.5/20.6 |
| armour-slot usage | character armour slot used (×7) | array<boolean> | equipment | none | core/equipment | core-rule | [character](../formats/character.md#layout) 19 | 20.5/20.6 |
| first-level threshold | character.levelType | int | progression | `LevelType!` | core | core-rule | [character](../formats/character.md#layout) 20 | 20.6 |
| threshold increase | character.experienceIncrease | short | progression | `ExperienceIncrease!` | core | core-rule | [character](../formats/character.md#layout) 21 | 20.6 |
| maximum level | character.maxLevel | int | progression | `MaxLevel!` | core | core-rule | [character](../formats/character.md#layout) 22 | 20.6 |
| level HP increase | character.levelHp | short | progression policy | none | core/behaviour | core-rule | [character](../formats/character.md#layout) 23 | 20.6/20.7 |
| level DP increase | character.levelDp | short | progression policy | none | core/behaviour | core-rule | [character](../formats/character.md#layout) 23 | 20.6/20.7 |
| level FP increase | character.levelFp | short | progression policy | none | core/behaviour | core-rule | [character](../formats/character.md#layout) 23 | 20.6/20.7 |
| level SMP increase | character.levelSm | short | progression policy | none | core/behaviour | core-rule | [character](../formats/character.md#layout) 23 | 20.6/20.7 |
| level-up program | character.levelUpProgram | program reference | progression | none | editor conversion/script | core-rule | [character](../formats/character.md#layout) 25; [actor precedence](#progression) | 20.6/20.7 |
| level-up mode | character.levelUpType | byte | progression policy | `LevelUpType!` | core | core-rule | [character](../formats/character.md#layout) 26 | 20.6 |
| enemy run permission | enemy.canRun | byte | battle traits | `ENE_CANRUN` | Epic 7 | battle-rule | [enemy](../formats/enemy.md#layout) 8; [E-71](plugins-and-battle.md#e-71) | Epic 7 |
| offensive critical value | enemy.giveCrit (characters: none, -1) | short | stats | `ENE_GIVECRIT` | core/actor script | core-rule (data); battle-rule (resolution) | [enemy](../formats/enemy.md#layout) 10; [E-74](plugins-and-battle.md#e-74) | 20.3/20.5; Epic 7 resolves |
| defensive critical value | enemy.takeCrit (characters: none, -1) | short | stats | `ENE_TAKECRIT` | core/actor script | core-rule (data); battle-rule (resolution) | [enemy](../formats/enemy.md#layout) 9; [E-74](plugins-and-battle.md#e-74) | 20.3/20.5; Epic 7 resolves |
| enemy special moves | enemy.special moves | array<asset reference> | abilities | `ENE_SPC` | hydration/Epic 7 | battle-rule | [enemy](../formats/enemy.md#layout) 11 | 20.5/Epic 7 |
| weaknesses | enemy.weaknesses | array<asset reference> | battle traits | `ENE_WEAK` | Epic 7 | battle-rule | [enemy](../formats/enemy.md#layout) 12 | Epic 7 |
| strengths | enemy.strengths | array<asset reference> | battle traits | `ENE_STRONG` | Epic 7 | battle-rule | [enemy](../formats/enemy.md#layout) 13 | Epic 7 |
| AI level | enemy.ai | byte | battle traits | `ENE_AI` | Epic 7 | battle-rule | [enemy](../formats/enemy.md#layout) 14; [AI table](plugins-and-battle.md#enemy-ai) | Epic 7 |
| custom AI enabled | enemy.useCode | byte | battle traits | `ENE_USECOD` | Epic 7 | battle-rule | [enemy](../formats/enemy.md#layout) 15 | Epic 7 |
| custom AI program | enemy.prg | program reference | battle traits | `ENE_PRG` | Epic 7 | battle-rule | [enemy](../formats/enemy.md#layout) 16 | Epic 7 |
| experience reward | enemy.exp | int | rewards | `ENE_EXP` | Epic 7 | battle-rule | [enemy](../formats/enemy.md#layout) 17; [E-77](plugins-and-battle.md#e-77) | Epic 7 |
| gold reward | enemy.gp | int | rewards | `ENE_GP` | Epic 7 | battle-rule | [enemy](../formats/enemy.md#layout) 18 | Epic 7 |
| victory program | enemy.winPrg | program reference | battle traits | `ENE_WINPRG` | Epic 7 | battle-rule | [enemy](../formats/enemy.md#layout) 19 | Epic 7 |
| run-away program | enemy.runPrg | program reference | battle traits | `ENE_RUNPRG` | Epic 7 | battle-rule | [enemy](../formats/enemy.md#layout) 20 | Epic 7 |
| character/enemy animations | animation slots and custom stance pairs | arrays<asset reference/label> | presentation | none | hydration | core-rule | [character](../formats/character.md#layout) 28–35; [enemy](../formats/enemy.md#layout) 21–24 | 20.5/20.10 |
| movement timing | character.idleTime/speed; item.speed/idleTime | double | movement | none | core/movement | core-rule | [character](../formats/character.md#layout) 31–33; [item](../formats/item.md#layout) 25–27 | 20.10 |
| collision/activation hulls | character/item polygons | point arrays | movement | none | hydration/movement | core-rule | [character](../formats/character.md#layout) 36–40; [item](../formats/item.md#layout) 30–32 | 20.5/20.10 |
| item identity and description | item.itemName/description | string | item definition (asset; Epic 8 rules) | none | none (read-only asset) | core-rule | [item](../formats/item.md#layout) 3–4; [E-81](plugins-and-battle.md#e-81) | Epic 8 |
| item permissions | item.equipYN/menuYN/boardYN/fightYN/usedBy/allowed character | bytes/array<string> | item definition | none | none (read-only asset) | core-rule | [item](../formats/item.md#layout) 5–7 | Epic 8 |
| item prices/key flag | item.buyPrice/sellPrice/keyItem | int/int/byte | item definition | none | none (read-only asset) | core-rule | [item](../formats/item.md#layout) 8–9 | Epic 8 |
| item menu effect/program | item.menuHP/menuSM/prgMenuUse | ints/program reference | item definition | none | none (read-only asset) | core-rule | [item](../formats/item.md#layout) 14–15 | Epic 8 |
| item equipment slots/bonuses | item equip slot, accessory, equipHP/equipDP/equipFP/equipSM | array/strings/ints | item definition, interpreted by actor equipment rule | none | none (read-only asset); derived bonus written by actor owner | core-rule | [item](../formats/item.md#layout) 10–12; [E-82](plugins-and-battle.md#e-82) | 20.6 |
| item equip/remove programs | item.prgEquip/prgRemove | program references | item definition, executed by inventory/equipment script layer | none | none (read-only asset) | core-rule | [item](../formats/item.md#layout) 13 | Epic 8 |
| item battle effect/program | item.fightHP/fightSM/prgFightUse | ints/program reference | item definition | none | none (read-only asset); applied by Epic 7 | battle-rule | [item](../formats/item.md#layout) 16–17 | Epic 7 |
| item board animation/programs | item.animation/prgOnBoard/prgPickUp | asset/program references | sprite (movement/presentation) | none | hydration/board | core-rule | [item](../formats/item.md#layout) 18–20 | 20.5/20.10 |
| status identity and duration | `.ste` file name / status.rounds | string/short; the in-file status.name is display data only | statuses; identity is the `.ste` file name, compared ignoring ASCII case | none | core status owner | core-rule | [status](../formats/battle-data.md#status-effect) 3–4; [BAT-6](battle.md#bat-6) | 20.3/20.6 |
| status charge modifiers | status.speed/slow/disable | short flags | statuses | none | Epic 7 | battle-rule | [status](../formats/battle-data.md#status-effect) 5–7; [E-75](plugins-and-battle.md#e-75) | Epic 7 |
| status HP/SMP tick | status.hp/hpAmount/smp/smpAmount | flags/shorts | statuses | none | Epic 7 | battle-rule | [status](../formats/battle-data.md#status-effect) 8–11 | Epic 7 |
| status program | status.code/prg | flag/program reference | statuses | none | Epic 7 | battle-rule | [status](../formats/battle-data.md#status-effect) 12–13 | Epic 7 |

Item rows are asset definitions, hydrated by name and never saved. Inventory state (stacks, counts, and which actor has which item in which slot) belongs to the `inventory` section (AD-10) through `InventoryAction`, built by Epic 8. An actor holds only equipped item references and the bonuses derived from them by the core equipment rule (`equipmentChanged`); it never owns item records. The equipment operation receives a normalized catalog built deterministically from `.itm` `itemName`, `equipHP`, `equipDP`, `equipFP`, and `equipSM` fields. Its caller supplies an already validated, unique equipped-reference list after inventory/slot/character eligibility checks; the core operation only resolves references and derives bonuses. A reference matching zero or multiple catalog entries is rejected. Applying a bonus changes current and maximum HP/SMP and DP/FP by the bonus delta; removing a bonus subtracts it and clamps current HP/SMP to their maxima. If the resulting HP crosses the `HP <= 0` boundary, the operation returns `fallen` or `revived` with cause `script` and source `null`; it does not dispatch an event. Equip/remove program references remain item data and are executed by Epic 8's owning inventory/equipment script layer, not by this pure derivation operation. Item speed, idle time, hulls and board animation belong to the sprite that represents a board item.
The normalized catalog mapping is explicit: raw `.itm` `itemName` becomes `name`, and `equipHP`, `equipDP`, `equipFP`, and `equipSM` become the normalized `[hp, dp, fp, smp]` bonus tuple in that order. A supplied catalog `id` is a non-empty string; every bonus is a safe integer. The boundary rejects malformed entries and rejects a reference matching zero or more than one catalog entry. Inventory derives one stable actor-scoped reference for each equipment tuple `(actorId, slot, itemId)` and supplies that reference both as the catalog `id` and the equipped reference; it is not saved separately. The catalog `name` remains the item's `itemName`. Because matching accepts either `name` or `id`, derived ids must not collide with any catalog name or another reference; deterministically disambiguate against the finite catalog. This tuple-scoped identity lets two copies from one inventory stack be equipped in distinct slots without duplicate actor references and survives snapshot/restore because all tuple components are saved. The caller validates inventory writes, slot and character eligibility, and equip/remove program execution is owned by the calling operation, not this actor rule.

### Runtime state (actor)

| Name | Source field | Type | Actor-section owner | Legacy alias | Writer | Rule | Evidence | Builder |
|---|---|---|---|---|---|---|---|---|
| stable id | runtime actor.id | scalar | identity | none | actor store | core-rule | [ACT-1](#actor-contract-entries) | 20.3 |
| source asset/kind | runtime actor.source/kind | asset reference/enum | identity | none | hydration | core-rule | [actor data](#actor-data-and-identity) | 20.5 |
| current/max stats | runtime actor.stats | plain-data record | stats | aliases above | actor owner | core-rule | [actor data](#actor-data-and-identity) | 20.3/20.6 |
| statuses/counters | runtime actor.statuses | map<status, counter> | statuses | none | actor status operation | core-rule | [actor data](#actor-data-and-identity) | 20.6 |
| equipment-derived state | runtime actor.equipment/equipment bonuses | plain-data record | equipment | none | equipment owner | core-rule | [ACT-3](#actor-contract-entries) | 20.3/20.6 |
| progression state/policy | runtime actor.progression | plain-data record | progression | aliases above | actor/behaviour | core-rule | [Progression](#progression) | 20.6/20.7 |
| behaviour name | runtime actor.behaviour | string or absent | identity | none | hydration/registry | core-rule | [behaviours](#behaviours-and-hydration) | 20.7/20.8 |
| declared custom events | runtime actor.customEvents | array<string> | identity | none | hydration | core-rule | [custom events](#custom-actor-events) | 20.5/20.9 |
Progression state is saved as plain data. In addition to the compatibility policy fields, it contains `remainingExperience` (the unspent XP toward the next level), `nextRequirement` (the requirement used for the next threshold), and `legacyLevelUp` (`true` or `false` when source resolution is known, or `null` while a restored pre-version-2 actor still needs source resolution). The program source itself is resolved by the package/runtime and is never stored in the actor record. Hydration starts with `nextRequirement = firstLevelExp` and, when the source level is greater than one, applies the documented threshold recurrence once for each prior level while carrying the starting total experience into `remainingExperience`; it clamps a currently crossed threshold to zero. A restored record keeps its persisted values unchanged.
The actor section migration is part of the save/restore boundary: version 1 records retain their actor ids and all existing fields, receive only the missing persisted progression fields, and set the unavailable legacy-program flag to `null`; XP progression refuses to proceed until the owner resolves that flag from the referenced source asset. Version 2 snapshots preserve all progression fields exactly; versions newer than 2 are unsupported and rejected, not accepted as current. Neither path stores a program path or callable.

### Sprite state (sprites section, separate from actors)

These rows are owned by the sprites/presentation section, not the actor section. A sprite MAY reference an actor by `actorId`; no row below is copied into the actor record.

| Name | Source field | Type | Section owner | Writer | Rule | Evidence | Builder |
|---|---|---|---|---|---|---|---|
| sprite id / `actorId` | runtime sprite.id/actorId | scalar / scalar or null | sprites | sprite store/hydration | core-rule | [Sprites and board geometry](#sprites-and-board-geometry) | 20.10 |
| transform/facing | runtime sprite.transform | plain-data record | sprites | movement service | core-rule | Epic 5 unified actor and sprite plan | 20.10 |
| visual/animation playback | runtime sprite.visual | plain-data record | sprites/presentation | presentation service | core-rule | Epic 5 unified actor and sprite plan | 20.10 |
| geometry (occupancy, activation, hitbox) | runtime sprite.geometry | shape records or null | sprites | hydration/movement service | core-rule | [Sprites and board geometry](#sprites-and-board-geometry) | 20.10 |
| movement queue/waypoints | runtime sprite.movement | plain-data queue | sprites | movement service | core-rule | Epic 5 unified actor and sprite plan | 20.10 |
| board visibility/loading | runtime sprite.visible/loading | boolean/state | sprites | board/runtime | core-rule | Epic 5 unified actor and sprite plan | 20.10 |
| compact item handle | runtime item sprite index/handle | integer | sprites | hydration/runtime | core-rule | Epic 5 unified actor and sprite plan | 20.10 |

Source-field rows above whose owner is `movement` or `presentation` (portrait aside) hydrate into this sprite section, not the actor record.

### Deterministic equations

| Name | Source field | Type | Actor-section owner | Legacy alias | Writer | Rule | Evidence | Builder |
|---|---|---|---|---|---|---|---|---|
| derived stat | equipment/base stat | int | stats | corresponding stat alias | core | core-rule | [ACT-3](#actor-contract-entries), [E-82](plugins-and-battle.md#e-82) | 20.6 |
| next level threshold | levelType, experienceIncrease, levelUpType | int | progression | none | core | core-rule | [progression](progression-and-levels.md) | 20.6 |
| level-up growth | levelHp/levelDp/levelFp/levelSm + levelUpType | int | progression | none | core/behaviour | core-rule | [character](../formats/character.md#layout) 23,26; [progression](progression-and-levels.md) | 20.6/20.7 |
| damage taken | attacker FP, target DP, attacker offensive and target defensive critical values, variance | int | battle operation | none | Epic 7 | battle-rule | [E-74](plugins-and-battle.md#e-74) | Epic 7 |

Defaults are deterministic: missing numeric stats start at zero (except format-declared
defaults and the two critical values, which default to -1, "none"; see E-74), HP/SMP
mutations clamp to `[0,max]`, `fallen` is `HP <= 0`, and the core uses
the progression arithmetic in [progression-and-levels.md](progression-and-levels.md).
Behaviour hooks may replace derived-stat, level-up, revival, status, or equipment results;
the stock battle package may replace damage and charge rules. Random variance requires the
injected seeded RNG; no equation may read wall-clock time or an ambient RNG.
All progression policy fields, persisted threshold fields, actor level/experience values, equipment bonuses, and hook patches are safe integers at their validation boundaries. Arithmetic that would produce a non-safe result is rejected before the actor section is changed. The `statsChanged` hook is not a general XP observer: it runs for a level-up only when core stat growth is actually applied.
