# Plugins and battles

The engine has **no built-in menu and no built-in battle screen**. Both are plugins: DLLs in the project's `Plugin\` folder, named in the main file. A third kind of plugin adds new RPGCode commands. Plugins call back into the engine through a 140-method callback interface. This page specifies that contract and the battle model the engine provides to the battle plugin. Plugin compatibility only matters if Reawakened wants to run existing plugin DLLs (Windows-only by nature); otherwise it describes what the built-in menu and battle replacements must do.

## Plugin roles

| Role | Type flag | Named by | Called when |
|---|---|---|---|
| RPGCode commands | 1 | main file plugin list | a script calls a command that is neither built-in nor a method of the script |
| Menu | 2 | main file `menuPlugin` (default `tk3menu.dll`) | the menu key is pressed while the player is idle, or a script calls `InternalMenu(n)` |
| Battle | 4 | main file `fightPlugin` (default `tk3fight.dll`) | a random encounter or `Fight` / `FightEnemy` in a script |

Without a menu plugin the menu key does nothing; without a battle plugin battles end immediately.

<a id="e-99"></a>
**E-99 Plugins (extension point).** Legacy native plugins could add script functions, replace the menu, or replace the battle UI, and they were offered every unknown function call. The two stock plugins (menu and battle) have no other home and must be re-implemented natively.

**Reawakened rule (rewritten by entry 19.1, 2026-10-19; OWNER).** *What it means for a game author:* extending the engine is done with a **package**. A package is written in RPGCode unless RPGCode cannot do the job or is too slow, and it is safe to use because the engine runs it inside its own sandbox. You choose which packages a game uses in an editable list, and a package's manifest says which outside things it uses so a runner can show them. *Precisely:* the rebuild provides **one plugin contract**, used by the engine's own packs and by third parties alike, selected by **one editable manifest** (the packages of [PKG-1](rpgcode-modules-and-objects.md#pkg-1) share it with native plugins), with every external effect going out through **host requests**. The earlier "not trust-gated for now" is replaced by a **trust baseline** ([ADR 0008](../../adr/0008-rpgcode-packages-and-trust-baseline.md)):

* **RPGCode packages are trusted because the VM contains them.** A package's code runs on the step machine under the step budget (G1), cannot reach the DOM, Node, files, timers or the network except through host requests (G2), and cannot read a clock or an unseeded random number (G3); file input and output goes through the AD-17 sandbox. There is no trust gating of RPGCode and no prompt before a package runs. A manifest **declares** the host requests the package uses; that declaration is informational (a runner may show it like app permissions) and refuses nothing.
* **Native TypeScript plugins stay author-installed only.** A native plugin is code the host loads, so it is trusted only because the author who installs it chose it; a game file cannot install one. Native plugins inherit the host and harness detection, feature sniffing, the G2 and G3 obligations, their own host requests and versioning against the core API, which an RPGCode package gets for free.
* **There is no capability model yet.** A less-trusting model may be added later by extending the manifest entry; it needs no change to the plugin contract.
* **Legacy native plugin binaries are not supported.**

**Choosing the plugin language (the decision tree handed to the plugin guide).** Use **TypeScript only when RPGCode cannot do the job or is too slow.** Ask in order: (1) can RPGCode do it, through the object, emitter and package rules of [rpgcode-modules-and-objects.md](rpgcode-modules-and-objects.md)? Write an RPGCode package. (2) If it can, is it too slow, measured as VM steps per tick against the step budget (R-33; the spike of entry 19.2 measures the stock tick)? Move only the hot part to a native TypeScript plugin and keep the rest in RPGCode. (3) If RPGCode cannot do it at all (a host effect the host-request set does not carry), write a native plugin and declare it in the manifest with its own host requests. The plugin guide (Epic 17's documentation) takes this tree as written; no Epic 17 entry changes. <!-- OWNER: E-99 — Jensen, 2026-10-19 (epic-rpgcode-platform Notes: E-99 re-evaluated; RPGCode is trusted already because the VM contains it, G2; manifest host-request declarations are informational only, no trust gating of RPGCode; native TypeScript plugins stay author-installed; no capability model yet; plugin-language guidance: TypeScript only when RPGCode cannot do it or is too slow). Rejected alternative: keep "not trust-gated for now" as written, which stated neither why RPGCode is safe nor where the line for native code is. -->

> **Open conflict R-61 — plugin contract and API shape.** the legacy feature inventory (E-99) records only the unknown-call back-off and native plugins; this page, `docs/spec/engine/plugins-and-battle.md:167`, specifies the 140-method callback interface, the native and COM export shapes, the menu and battle protocols and the loader rules. Owner epics: **rpgcode-vm** (entries 3.23 and 3.24 hold the evidence) and **battle**. Landed code: the port contracts already carry the plugin and request shapes (`packages/core/src/ports/input.ts:79`, `packages/core/src/ports/requests.ts:52`). The owners settle the boundary at inception; this page rules nothing.

## Two plugin kinds

**Native ("old") plugins** export plain functions (`__stdcall`, ANSI strings):

| Export | Signature | Use |
|---|---|---|
| `TKPlugInit` | `int (int *callbacks, int count)` | **required**; receives the callback table (see below) |
| `TKPlugVersion` | `long ()` | optional; its *presence* means "give me 133 callbacks" instead of 45 |
| `TKPlugBegin`, `TKPlugEnd` | `void ()` | called after init and before unload (the original engine calls them without checking they exist) |
| `TKPlugType` | `int (int type)` | return non-zero if the plugin supports role *type*; absent = RPGCode commands only |
| `TKPlugQuery` | `int (char *name)` | non-zero if this plugin implements command *name* |
| `TKPlugExecute` | `int (char *commandLine)` | run a command (cannot return a value) |
| `TKPlugMenu` | `int (int request)` | open menu *request* |
| `TKPlugFight` | `int (int enemyCount, int skillLevel, char *background, int canRun)` | run a battle; returns an outcome |
| `TKPlugFightInform` | `int (int srcParty, int srcFighter, int tgtParty, int tgtFighter, int srcHpLost, int srcSmpLost, int tgtHpLost, int tgtSmpLost, char *message, int code)` | battle event notification |
| `TKPlugInputRequested` | `int (int type)` | optional; non-zero = send this plugin keyboard (0) / mouse-down (1) events |
| `TKPlugEventInform` | `int (int keyCode, int x, int y, int button, int shift, char *key, int type)` | optional; receives those events |

**COM plugins** (ActiveX DLLs, e.g. written in VB6) are recognised by exporting `DllRegisterServer`. The engine registers the DLL, creates the first creatable class in its type library and calls these members by name:

| Member | Shape |
|---|---|
| `SetCallbacks` | property, set to the engine's callback object (required) |
| `Plugin_Initialize`, `Plugin_Terminate` | methods |
| `PlugType(type) → bool` | as `TKPlugType` |
| `RPGCode_Query(name) → bool` | as `TKPlugQuery` |
| `RPGCode_Execute(line, &dataType, &text, &number, usingReturn) → bool` | runs a command and may return a value (`dataType` selects text or number) |
| `Menu(request) → int` | |
| `Fight(enemyCount, skill, background, canRun) → int` | |
| `FightInform(…10 args…) → int` | |
| `GetFighterLocation(party, index, &x, &y) → bool` | screen position of a fighter, for scripts that draw battle effects |

COM plugins cannot receive keyboard and mouse events.

**Load order:** load the DLL, initialise it, then ask `PlugType` for the role. A plugin that answers "no" is unloaded (the original engine skips its terminate call).

## RPGCode command plugins

At compile time each unknown command name is offered to every RPGCode plugin's *query*. At run time the engine rebuilds the call as **source text** — numbers formatted, strings in quotes (no escaping), variables by name — and passes it to *execute*. The plugin reads and writes script variables through the callbacks; during the call those resolve to the calling program's locals first.

<a id="e-95"></a>
**E-95 Source/target context.** Each running program has a *source* and a *target* entity (player, item or enemy), set by whatever triggered it, and functions resolve the `"source"` and `"target"` handles against that pair ([rpgcode-language.md](rpgcode-language.md#threads), [rpgcode-functions.md](rpgcode-functions.md)). The engine sets the same pair for a plugin call, which is what callbacks 79 and 80 below are for.

**Legacy (R12).** In 3.1 `source` and `target` are two engine-wide values shared by everything, not stored per program (R2-Q24; [facts-round-12.md](../../provenance/facts-round-12.md), reviewed and fact-checked against `2f986f3e` and `9191b919`). What each starter puts there, and which starters restore them afterwards, is the use table under [`executeProgram`](rpgcode-functions.md#reawakened-executeprogram).

**Reawakened rule (OWNER; Jensen, 2026-10-25).** The pair is stored per thread ([THR-2](rpgcode-errors-and-threads.md#thr-2)). A nested [`executeProgram(file, [context])`](rpgcode-functions.md#reawakened-executeprogram) call exposes the optional `context` dictionary (viewbag, default `{}`) in the called program's root scope, sets the thread's `source` and `target` slots for the call when `context.source` / `context.target` (or its positional `(file, source, target)` convenience) are supplied, inherits any omitted slot from the caller, and restores the caller's slots when the call ends. [`replaceProgram`](rpgcode-functions.md#reawakened-replaceprogram) (legacy alias `run`) uses the same object-valued payload and handle bridge but not that positional convenience; it discards the calling frame chain, so there is no caller or old pair to restore. *Rejected:* two engine-wide slots left set across returning calls, which cannot be replayed ([THR-2](rpgcode-errors-and-threads.md#thr-2)), or limiting `executeProgram` to two fixed positional parameters instead of a generic `context` dictionary.

## Menu plugin

Legacy plugin entry point: `menu(request)`: 1 main menu, 2 inventory, 4 equipment, 8 abilities. The legacy plugin draws its own UI and returns when closed.

**Reawakened rule (OWNER; Epic 8.1 menu ownership and interface).** Core owns authoritative party, inventory, equipment, gold and menu state; each state section validates and applies its own actions. The `stock_menu` package owns replaceable menu navigation and presentation. TypeScript and RPGCode menu implementations receive the same object-valued, read-only context plus named owner-action capabilities; action requests are validated and committed by the relevant core owner, not by menu code. Both languages MUST expose the same semantic queries, actions, arguments, results, replacement behavior, and blocking semantics, using language-appropriate provider declarations and calls. Menu presentation contributes to the core draw list; menu code does not mutate section state or draw directly to a host window. E-81–E-85 define the canonical owner surfaces; the entry 7/#588 contract below defines menu invocation and provider replacement.

<a id="menu-navigation"></a>
**Reawakened rule (OWNER; menu navigation on every device; ruled 2026-11-01).** In plain terms: the menu, the shop, the save and load picker and the message box all work with a keyboard, with a controller or with a mouse, and the row that will be chosen is always visibly marked.

Technically, for every engine-owned surface:

1. **One cursor.** The screen's `selection` in the `menu` section is the cursor. It is plain data, it is saved with a menu frame, and it is drawn as the focus indicator of [A11Y-5](accessibility.md#a11y-5) as part of the draw list.
2. **Keyboard and controller are the same path.** `up`, `down`, `left` and `right` move the cursor, `confirm` activates the focused row, `cancel` leaves the screen, `menu` closes the outermost menu. The default bindings of [ACT-5](display-input-audio.md#act-5) therefore give the controller the same menu as the keyboard with no configuration. The per-screen order and wrapping rules of [E-80](#e-80) and the stock menu's item list are unchanged.
3. **The pointer is a second way, not a mode.** Hovering a row moves the cursor to it; a press followed by a release over the same row activates it; moving off the row before release cancels ([A11Y-6](accessibility.md#a11y-6)). A surface never needs the pointer and never requires a drag.
4. **A provider receives actions.** The native and RPGCode provider event `{ type: "input", key }` carries the **action name** (`up`, `down`, `left`, `right`, `confirm`, `cancel`, `menu`) for engine navigation, so a provider written in either language navigates identically. A provider that wants a legacy key name reads the key queue instead ([E-110](display-input-audio.md#e-110)); the two surfaces do not share a cursor.
5. **Game actions on a menu.** A menu screen MAY host bars, grids or paged lists of game-defined actions ([ACT-8](display-input-audio.md#act-8)); each slot is a pointer target and an accessibility-tree node, and its activation is the same `confirm` the cursor uses.
6. **Nothing traps the player.** `cancel` always closes the current screen, including the innermost nested provider; a Quit confirmation is its own screen ([A11Y-10](accessibility.md#a11y-10)).

<a id="e-80"></a>
**E-80 Default menu.** Opened with the menu key or `InternalMenu(n)`; in legacy the presentation came from a plugin and the rules from the engine:
* main screen: party members with portraits and stats, gold and play time;
* **Items:** use (on a chosen member; consumes), info, drop (not key items);
* **Equip:** choose member, slot, then item; remove;
* **Abilities:** use board-usable special moves, info;
* **Save** (disabled when the board forbids it), **Load**, **Quit**.

A custom menu image can be set (`MenuGraphic`), cursor sounds come from the main file, and the main menu, inventory, equip and abilities screens can each be opened directly.
**Reawakened rule (OWNER; #588 menu facade and provider replacement).** The modern RPGCode facade is four direct, parameterless, blocking, void commands: `MainMenu()`, `ItemMenu()`, `EquipmentMenu()`, and `AbilitiesMenu()`. Each immediately invokes the provider for its screen and returns only when that provider closes normally; no menu object, factory, `.open()` method, selection result, or separate menu-session thread is part of this facade. The command executes as a nested call on the calling script thread, preserving its source/target and call stack. A provider's ordinary RPGCode wait parks that thread under G1; the existing `menu.screen` wait represents menu input/session suspension, and the thread resumes through the normal wait resolver. The command's result is always void: any provider return value is ignored.

The same plugin contract adds optional `menuProviders`, a dictionary keyed only by the canonical screen tokens `main`, `items`, `equipment`, and `abilities`. RPGCode providers are callable dictionary values; native TypeScript packages expose the same `menuProviders` property and keys on `PluginDefinition`, with the explicit resumable transition contract below. A provider is called with exactly one argument, the read-only menu context; screen identity comes from its registration key, not an extra positional argument. The context exposes the canonical E-81–E-85 owner queries and actions, including `inventory.addItem({ source, handle, amount })`, `inventory.removeItem({ entryId, amount })`, `inventory.equip({ actorId, slot, entryId })`, `inventory.unequip({ actorId, slot })`, `inventory.addGold({ amount })`, `inventory.removeGold({ amount })`, `shop.stock`, `inventory.buyItem({ source, amount })`, `inventory.sellItem({ entryId, amount })`, and `party.inn()`, plus the E-85 party operations. Existing argument, result, validation and event semantics remain those owner contracts; menu providers do not mutate owner state directly. `menuProviders` is a separate registration facet from `commands`: it does not participate in command-name dispatch and providers receive no `next`.

Each non-empty `menuProviders` registration replaces the whole screen handler for each key it contains; providers do not compose or delegate. Native TypeScript providers enter the shared per-screen registry in resolved manifest order before package RPGCode startup programs run; RPGCode `registerPlugin` calls append at the point they execute. One monotonically ordered registry covers both provider kinds, so the most recently loaded/registered non-empty entry wins for direct entry and nested `open` alike. An omitted key or empty `menuProviders` dictionary adds no entry. Removing an RPGCode registration removes its entries and reveals the preceding provider of either kind. Menu-only registrations and RPGCode registration handles remain session-scoped. The default stock screen implementation is provided by the `stock_menu` package in #585; this replacement seam does not ship an inert fallback. Until a provider is registered for a requested screen, the facade fails catchably with `menu.provider-missing` without changing the screen stack.

`InternalMenu(n)` is a compatibility adapter only: `0` calls `MainMenu()`, `1` calls `ItemMenu()`, `2` calls `EquipmentMenu()`, and `4` calls `AbilitiesMenu()`. Other values (including `3`) are rejected as a catchable invalid-argument runtime error; they MUST NOT fall through to another screen. These `InternalMenu` arguments are not the legacy native menu-plugin `menu(request)` values in the section above, whose values are `1` main, `2` inventory, `4` equipment, `8` abilities.

The `MenuSection.screens` array is the ordered navigation stack. Entering a facade command pushes one frame using that canonical token; a nested screen command pushes a child, whose normal return pops only its frame and resumes the parent on the same thread. A TypeScript parent resumes once with `child.closed` after either a TypeScript or RPGCode child closes; an RPGCode provider is an ordinary VM call frame, so after a nested facade call returns its RPGCode caller continues at the next instruction. Closing the outermost provider empties the stack and returns to its caller. The core owns stack writes through the menu owner port; providers may read the read-only stack but MUST NOT mutate it directly. Each frame's `actorId` and non-negative `selection` obey the existing saved-state contract; no general screen-specific selection upper bound is imposed by `MenuSection`.

**Reawakened rule — active menu-frame updates (#588).** `context.menu.updateCurrent({ actorId, selection })` is the named owner action for the current stack frame. It validates `actorId` as a live actor id or `null` and `selection` as a non-negative safe integer, atomically commits both fields, and returns the menu owner's standard `MenuStateResult`. When `MenuSection.screens` is empty it returns `{ ok: false, error: { path: "menu.screens", message: "no active menu frame" } }` and changes no state. Nested entry and return remain facade operations.
**Reawakened contract — native TypeScript menu-provider continuation (#588).** `PluginDefinition.menuProviders` is a partial record keyed by `"main" | "items" | "equipment" | "abilities"`. A provider has the exact synchronous signature `(input: MenuProviderInput) => MenuProviderResult`, with `input` containing `{ providerId, context, state, event }`. `providerId` is `<plugin-id>@<plugin-version>:menu:<screen>`; `context` is read-only; `state` is G1 plain data (initially `null`); events are `{ type: "enter" }`, `{ type: "input", key }`, or `{ type: "child.closed", screen }`. Results are `{ kind: "wait", state, wait }`, `{ kind: "open", state, screen }`, or `{ kind: "complete" }`. `wait` is a plain-data `menu.screen` request with `global: true`; there is no wall-clock timeout. `open` is the explicit nested-entry signal; the child is pushed and invoked on the same VM thread, and normal child completion resumes the parent transition with `child.closed`. `complete` closes only the current frame. The VM persists only providerId, state, event/input and wait/frame data; executable provider functions remain in the session registry.
**Stable restore rule.** RPGCode registrations use deterministic registration ids rebuilt in startup order; TypeScript provider ids are `<plugin-id>@<plugin-version>:menu:<screen>`. On restore, every active identity—including the current provider and each saved parent continuation—must resolve before any saved thread resumes. Missing registration or changed plugin version is a fatal located `restore.menu-provider` load error; the engine MUST NOT silently switch provider, restart the menu, or resume using a fallback. Removing an RPGCode registration removes it from future winner selection but does not cancel an already-entered provider frame during the current runtime; that ordinary VM frame may finish. Runtime removal is not saved: restore rebuilds registrations from startup, and a saved current or parent continuation whose identity is absent from that rebuilt registry fails with `restore.menu-provider`, whether or not its provider frame had already been entered.
**Compute and exception rule.** RPGCode transitions are ordinary VM instructions and obey R-33's per-thread `STEP_BUDGET`; the VM preempts at instruction boundaries. Native TypeScript callbacks are trusted author-installed host code, cannot be preempted or instruction-metered by the VM, and may hang indefinitely if they do not return. The “one bounded transition” expectation is advisory, not an enforced ceiling. Core dispatches exactly one native callback for one `enter`, `input`, or `child.closed` event on a ready thread and never loops callbacks internally. This limits core dispatch count, not callback execution time. No timer or wall-clock timeout is used. A callback exception that actually throws is routed through the calling VM operation's ordinary catchable error path; menu frames created by that operation are rolled back before a caller handler runs. Exceptions are not converted to completion or wait.
**Exact provider execution and restore policy (#588).** The native transition is exactly `MenuProvider(input: MenuProviderInput) => MenuProviderResult`; core invokes exactly one callback per provider event (`enter`, `input`, or `child.closed`) on a ready thread, never in a callback loop. There is no enforced native compute ceiling: a synchronous callback that never returns can hang the host, and exception handling only applies to callbacks that throw. RPGCode providers execute as ordinary VM frames and consume the calling thread's existing `STEP_BUDGET` (currently 1,000 instructions per thread turn), with instruction-boundary preemption. No provider-specific budget or wall-clock timeout is added. Menu continuation state is saved only as plain data on the thread: screen, provider identity, provider state, and continuation phase; provider functions and closures remain session-only.

Native provider identity is exactly `<plugin-id>@<plugin-version>:menu:<screen>`; RPGCode identity is its deterministic registration id plus screen. These identities resolve against the package startup registrations rebuilt for the loaded manifest. Restore MUST validate every active saved identity before any thread resumes; an absent identity or mismatched plugin version is fatal `restore.menu-provider`, never a fallback or implicit restart. Source changes without a plugin-version change cannot be detected and remain the package author's versioning responsibility.

Nested entry is an explicit native provider result `{ kind: "open", state, screen }`. It pushes a child `MenuSection.screens` frame and a serialized child continuation on the same thread. The shared ordered registry resolves the child regardless of provider kind. A TypeScript child resumes as a plain-data continuation; an RPGCode child is pushed as a callable VM frame, never invoked as a host callback. On normal child return, a TypeScript parent receives exactly one `{ type: "child.closed", screen }` dispatch; an RPGCode caller resumes after its blocking facade operation. A thrown native callback exception, RPGCode provider runtime error, malformed transition, missing nested provider, or refused menu-owner transition removes all menu frames/continuations opened by the failing operation before normal VM exception dispatch; the resulting located `ScriptError` is catchable by the caller's ordinary `try/catch`. It MUST NOT bypass or replace that handler.

Before any provider continuation is stored in a wait, the complete returned transition (including provider state and wait payload) MUST pass the shared plain-data validation; a closure, Promise, cycle, class instance, or other non-plain value produces catchable `menu.provider-result` and rolls back frames opened by the operation. No native function or provider closure is serialized.


The `stock_menu` package implementation in #585 handles each of the four screen types for which no non-empty custom provider is registered. Once that package is loaded, a direct facade call or menu-key request for an unoverridden type invokes its default provider. The #588 replacement seam does not ship an inert fallback implementation.


**Owner ruling — menu-only registration.** `registerPlugin` retains its `commands` dictionary field, but it MAY be empty. A menu-only RPGCode registration supplies `commands: {}` and a non-empty `menuProviders` dictionary. An empty `commands` or `menuProviders` dictionary is ignored and installs no entries; in particular, an empty menu-provider dictionary does not shadow any default. The existing `{ name, remove }` return shape is retained.

<a id="e-81"></a>
**E-81 Inventory.** Inventory is a list of stacks identified by `(source, handle, quantity)`. `source` identifies the `.itm` asset; `handle` is its script/display name. There is one stack per `(source, handle)`. The saved numeric stack `id` (exposed to operations as `entryId`) is distinct from the item-definition identity, allocated monotonically from `nextId`, and never reused. `quantity` is the unequipped/available count. Partial removal retains the stack id. A zero-quantity stack remains while an equipment record references it; retire it only when it has neither available quantity nor equipment references. `GiveItem` and `TakeItem` add and remove. The E-80 stock-menu drop affordance MUST exclude key items; this is a menu affordance ruling only and does not make `keyItem` a general engine restriction ([../formats/item.md](../formats/item.md#layout), field 9) or constrain RPGCode `takeitem`. Menu item use applies HP/SMP, then runs its use program, then consumes one copy. Battle item use applies HP/SMP, consumes one copy, then runs its animation and program ([../formats/item.md](../formats/item.md#board-items-vs-inventory-items), [R12 order](rpgcode-functions.md#legacy-call-contexts-and-order)).

**TKR design choice (Epic 8.5 battle consumption; amended for stack identity, PR #702 follow-up).** The `battleconsume(item, target, hp, smp [, handle])` plain effect is `{ kind: "inventory.consume", item, target, hp, smp, handle }`, where `handle` is the chosen stack's handle or `null` when the caller does not name a stack. The battle script has already applied the stat changes and the inventory owner MUST NOT apply them again. **A named stack is exact:** when `handle` is a string the owner consumes from the one `(source, handle)` stack [E-81](#e-81) defines, whatever the item definition's own name is and whatever other stacks share the source, and refuses (no inventory or event change) when that stack does not exist or has no available unit; it never falls back to another stack. When `handle` is `null` (a script that knows only the item file) the owner resolves the canonical item source and definition name to the unique `(source, handle)` stack; if no canonical-name stack matches but exactly one stack has the source, the owner may use that sole stack; if several non-canonical stacks match, it refuses rather than selecting arbitrarily. Either way the owner removes one available unit through the existing `inventory.removeItem({ entryId, amount: 1 })` action, using the resolved stack's stable `entryId`. A missing definition, invalid target, missing stack, or insufficient available quantity refuses without an inventory/event mutation. A committed consume emits one `itemRemoved` event with the stack id and before/after quantities. The `handle` field was added because the stack a player picks in the battle item list is a `(source, handle)` stack, and a request that names only the file could consume a different stack or none. This choice keeps the rest of the effect shape and uses the stack identity already defined by E-81; it is not an owner/engineer ruling.

Both TypeScript and RPGCode replacement menus receive the same object-valued, read-only context and named inventory action capabilities, using language-appropriate calling syntax. Its `inventory` member exposes read-only `items`, `equipment`, and `gold` views, and actions `inventory.addItem({ source, handle, amount })`, `inventory.removeItem({ entryId, amount })`, `inventory.equip({ actorId, slot, entryId })`, `inventory.unequip({ actorId, slot })`, `inventory.addGold({ amount })`, `inventory.removeGold({ amount })`, `inventory.buyItem({ source, amount })`, and `inventory.sellItem({ entryId, amount })`. These are menu capabilities, not new global RPGCode built-ins. The shop actions use the active `CallShop` context and are specified under E-83. Each action returns exactly `{ ok: true, error: null }` on commit/no-op or `{ ok: false, error: { path, message } }` on refusal. A refusal is atomic: no inventory, actor, gold, event-queue or derived-bonus mutation occurs. Item quantities and amounts are positive safe integers for add/remove operations. Add identifies a definition by source+handle and merges into its unique stack; removal addresses the stable entry id and refuses if the available quantity is insufficient. Read views expose `id` under its saved name; action arguments call it `entryId`.

<a id="e-82"></a>
**E-82 Equipment and gold.** Body slots: head, neck, left hand, right hand, body, legs and named accessories. An item lists the slots it fits and which characters may use it. Equipping validates actor, slot, item eligibility and available quantity, consumes one available unit, and applies HP/DP/FP/SMP bonuses through the actor equipment rule; unequipping returns one available unit and reverses the derived bonuses, caps HP and SMP. Equip/remove program execution is outside this operation contract. Multiple copies of one stack item MAY be equipped in distinct slots. Each equipment tuple `(actorId, slot, itemId)` derives a deterministic actor-scoped opaque reference, used as the actor catalog `id` and equipped reference; it is not saved separately. Catalog name remains the `.itm` `itemName`. The derived reference MUST be unambiguous and stable through snapshot/restore, and MUST avoid collision with every catalog name and every other reference, deterministically disambiguating against the finite catalog (the actor rule matches a reference against `name` OR `id`).

**Reawakened rule (OWNER; Epic 8.6 menu shop and inn operation surface).** Both menu implementations receive the same read-only `shop.stock` ordered list of canonical item asset sources for the active `CallShop` invocation (empty outside a shop), `inventory.buyItem({ source, amount })`, `inventory.sellItem({ entryId, amount })` and `party.inn()` actions using language-appropriate syntax. `party.inn()` is owned by the party operation boundary and coordinates actor changes through actor operations; it is distinct from `PartyAction.restore`, which restores roster membership. All actions return the same `MenuStateResult` defined above. RPGCode `CallShop` and `Inn` map to these operations as specified under [E-83](rpgcode-functions.md#e-83) and [E-84](rpgcode-functions.md#e-84); they remain existing built-ins, not new menu globals.

**Owner/engineer compatibility ruling (trans3 runtime answer supplied for Epic 8.6; not inferred from repository extraction).** `CallShop` requires at least one parameter; calling with 0 parameters raises a script error immediately and the shop fails to open entirely. Parameters resolve strictly as filenames relative to the Item asset directory (appending `.itm` if missing, case-insensitively); item handles are NOT resolved. If any listed item file is missing or invalid on disk, the engine raises a script error and the shop fails to open entirely (no partial opening, no skipping). `Inn()` sets current HP to max HP and current SMP to max SMP for all active party members immediately; fallen party members (HP <= 0) are restored unconditionally (`revived`). `Inn()` does not clear status effects, charges 0 GP, and is a pure headless stat restoration with no UI or audio. An item price of 0 GP is permitted for buying and selling (0 GP added or deducted).

**TKR design choice (Epic 8.6).** Item definition prices are signed integers on disk, but TKR cleanly rejects negative prices with atomic refusal (`MenuStateResult` error). Buy and sell quantities are positive safe integers.

**Owner/engineer compatibility ruling (trans3 runtime answer supplied for Epic 8.4; not inferred from repository extraction).** RPGCode `equip`/`remove` `location` is 1-based and clamped to 1–16. Locations 1–6 map to Head, Neck accessory, Right hand, Left hand, Body, and Legs respectively; locations 7–16 map to ten distinct custom-accessory slots, preserving the clamped location identity. Thus 0 maps to Head, and any value above 16 maps to location 16.

**TKR design choice (Epic 8.4).** The `inventory` action's string `slot` represents those ten distinct custom accessory locations with canonical TKR tokens `accessory-7` through `accessory-16`, preserving the corresponding clamped trans3 location number. These identifiers are a new inventory-action contract choice, not trans3 names or a fact supplied by the owner/engineer.

Gold actions take a non-negative safe-integer `amount`; zero is a successful no-op and emits nothing. Negative amounts, insufficient funds, or a result outside the safe-integer range refuse atomically. Existing RPGCode signatures are unchanged: `giveitem(string itm)`, `takeitem(string itm)`, `equip(variant handle,int location,string item)`, `remove(variant handle,int location)`, `givegp(int gp)`, `takegp(int gp)`, `getgp([int &ret])`, and `itemcount(string fileName[,int &ret])`. **Owner/engineer compatibility ruling (trans3 runtime answer supplied for Epic 8.4; not inferred from repository extraction):** `giveitem(item)` and `takeitem(item)` resolve `item` as a filename, append `.itm` if needed, then call `addItem` or `removeItem`; they do not resolve by handle. `itemcount(item)` compares case-insensitive inventory filenames when the argument has the `.itm` extension, otherwise it compares case-insensitive item handles. `equip(handle, location, item)` and `remove(handle, location)` call `equip` and `unequip`; `equip` accepts its item argument as either handle or filename ([rpgcode-functions.md](rpgcode-functions.md#items-inventory-shop--gold-28)), and `location` uses the E-82 mapping above. Examples: `giveitem("sword")`, `takeitem("sword.itm")`, `itemcount("Iron Sword")`, `equip("Hero", 3, "sword.itm")`. `givegp`/`takegp`/`getgp` adapt to `addGold`/`removeGold`/the gold read. This story adds no public RPGCode built-ins.

<a id="e-18"></a>
**E-18 Saving permission per board.** The board carries a disable-saving flag, and the default menu's Save option is disabled on such a board ([../formats/board.md](../formats/board.md#threads-constants-and-settings)).

<a id="e-123"></a>
**E-123 Save gating.** The default menu respects that flag, so the Save option and `Save()` behave as the board allows; the file itself is [../formats/save-game.md](../formats/save-game.md).

**Reawakened rule (OWNER; Epic 8.11 dialogue completion).** `dialogue(text)` is one complete interaction per call: it applies the message window's `<var>` splicing, displays the resulting string using the existing `mwin` surface, then waits for the next unclaimed input key using the existing `wait()` semantics. It returns the consumed key name. After that wait resolves normally, it queues exactly one game-level `dialogue.completed` event with plain-data detail `{ actorId, targetId, text }`. `actorId` is resolved from the running VM's source and MUST identify a live actor; `targetId` is resolved from the target and is an actor ID or `null`; `text` is the exact displayed string after splicing. A thread killed or failed before the key resumes it queues no event. Epic 4.21 does not gain actor metadata, and the wrapper does not draw directly to the host window. The stock RPG package consumes the event and emits actor-scoped `talked` with the same detail.

## Battle protocol

The engine keeps the battle **model**; the plugin owns the **loop and the UI**.

<a id="e-70"></a>
**E-70 Battle start.** *Random:* after each whole-tile step on a board that allows battles, and with fighting enabled globally, roll 1-in-`chances` (type 0) or check every `chances` tiles (type 1); if the main file names a custom battle program it runs instead; otherwise 1-4 enemies are drawn at random from the main file's pool among those whose skill level equals the board's, and the board's battle background is used. *Scripted:* `Fight(skill, bkg)` or `FightEnemy(e1, e2, …, bkg)`.

**Reawakened rule (OWNER; Jensen, 2026-10-26).** A random encounter draws its enemies at random from the main file's list; a custom encounter is spelled out. When the main file names a custom battle program, the encounter runs it in place of the draw: the engine draws no enemy and passes none, and the program names the fighters itself, in the order it writes them, with `FightEnemy(e1, e2, …, bkg)`. See [BAT-9](battle.md#bat-9).

<a id="e-71"></a>
**E-71 Battle setup.** Two parties (enemies and the player's), the battle background's music replacing the board music, the background image and menu sounds loaded, and running away allowed unless an enemy forbids it.

1. The engine sets up two parties: party 0 = enemies, party 1 = the player's party. It switches to the battle music.
2. The original engine calls `fight(enemyCount, skill, background, canRun)` and waits. The `skill = -1` sentinel is a legacy callback argument only; it is not part of the Reawakened package/start contract, whose request carries the board record and its own skill value.
3. The plugin loops: it calls `CBFightTick` regularly. On each tick the engine charges every fighter, applies status effects and lets enemies whose charge is full act (AI), reporting each event back through `fightInform`. The plugin performs the players' actions with `CBFightDoAttack`, `CBFightUseItem`, `CBFightUseSpecialMove` and releases charge with `CBReleaseFighterCharge`, and draws everything itself (canvas callbacks), calling `CBDoEvents` to keep the window alive.
4. The plugin returns an outcome:

| Value | Outcome | Engine then |
|---|---|---|
| 0 | ran away (automatic) | runs the enemy's run program |
| 1 | ran away (plugin handled it) | nothing |
| 2 | won (automatic) | gives the enemies' gold and experience and runs their defeat programs |
| 3 | won (plugin handled it) | nothing |
| 4 | lost | runs the main file's game-over program, or shows "Game over." and resets the game |

5. The engine restores the board music and redraws.

**Reawakened rule (Epic 7.1).** Steps 1 to 5 above are the legacy plugin protocol. In the rebuild the core sets up the parties and the `battle` section, and the `stock_battle` package (or a main-file fight program) performs steps 3 and 4 itself, on one battle thread, using the operations of [battle.md](battle.md#bat-3); `CBFightTick` has no rebuild counterpart ([BAT-4](battle.md#bat-4)). The outcome table is applied by the compatibility adapter of [BAT-8](battle.md#bat-8).

<a id="e-79"></a>
**E-79 Battle-facing script API.** The fight plugin interface exposes fighter queries (HP, SMP, FP, DP, name, animation, charge %), actions (attack, use item, use special, release charge, add or remove a status effect) and a `fightTick` — callbacks 114 to 132 below.

**Reawakened rule (OWNER; Epic 7.1).** The default battle UI, charge, turn order, damage, AI, status rounds and the sequence after an outcome are package scripts, not core rules. The core owns actor data, the `battle` section and the one outcome adapter of [BAT-8](battle.md#bat-8). The legacy `fightTick` callback remains documented above, but it is not a Reawakened core operation: the package loop is [BAT-4](battle.md#bat-4). See [battle.md BAT-1](battle.md#bat-1).

**Reawakened rule.** **RPGCode-written battle systems** must be able to drive the same core operations as that default UI (they replace it through the main file's custom fight program), so a script can build its own battle screen without a second rules engine.

`fightInform` codes: 0 HP removed, 1 SMP removed, 2 source attacked, 3 source used a special move, 4 source used an item, 5 source fully charged, 6 source died, 7 party defeated. **The original engine never sends 6 or 7**: the plugin must detect deaths and the end of the battle itself.

### Battle model

- **Charge:** every fighter has a charge counter; each tick adds the fighter's speed (3, ±2 per speed/slow status effect). Players act at 75, enemies at 123. A "disable" status effect freezes charge.
- **Attacks and special moves:** HP and SMP changes are clamped at 0; critical-hit chances come from the enemy's `takeCrit`/`giveCrit` ("1 in N"). Special-move effects are described in [../formats/battle-data.md](../formats/battle-data.md#special-move-spc).
- **Status effects** apply each round until their `rounds` run out ([../formats/battle-data.md](../formats/battle-data.md#status-effect-ste)).

<a id="e-72"></a>
**E-72 Charge-bar turns ("active time").** Each fighter's charge fills by *speed* per tick — players' maximum 75, enemies' maximum 123, both starting at a random value. A charged **player** stops charging and waits for a menu choice; a charged **enemy** acts immediately and resets. Disabled fighters do not charge.
**Reawakened rule (Epic 7.1; R11-Q1 to Q4).** Initial charge is a random whole number from 0 to the threshold minus 1. In 3.1 nobody charges while any turn (menu, animation, message) is in progress, an enemy's charge resets right after it acts, and a fighter crossing its threshold acts in the next pass. See [BAT-4](battle.md#bat-4).

<a id="e-73"></a>
**E-73 Player actions.** Fight (physical attack), Special Move (named per character, e.g. "Magic"), Item (a battle-usable item; consumes one), Run.

**Reawakened rule (Epic 7.1).** See [BAT-5](battle.md#bat-5) for the stock package's and custom programs' shared action semantics.

<a id="e-74"></a>
**E-74 Damage rules.** A physical attack uses the attacker's FP ±10 % random variance; the target's DP is subtracted **unless a critical hit happens** (enemies define 1-in-N crit chances for being hit and for hitting); minimum 1 damage; damage can be applied to SMP instead of HP. A special move removes its *FP* from the target's HP and its *target SMP drain* from the target's SMP, costs the user SMP, and may apply a status effect and play an animation. HP and SMP are clamped at 0.

**Reawakened rule (OWNER; E-74 physical attack, from owner-relayed [round 10](../../provenance/facts-round-10.md)).** *What it does for a game author:* a normal attack hits for the attacker's fight power, give or take a little luck, minus the target's defence. Now and then it is a critical hit, which ignores the target's defence. Every actor can have two critical-hit values: how often its own attacks are critical (its **offensive** value) and how often attacks on it are critical (its **defensive** value). A value of -1 means "never from this side". In the legacy enemy file these are `giveCrit` (offensive) and `takeCrit` (defensive); legacy characters have neither, so both are -1. Damage is never less than 1. *Precisely:* the built-in physical attack takes an attacker, a target, a supplied amount (the stock fight plugin supplies the attacker's FP; a plugin or script may supply any amount and apply the result itself) and whether the damage goes to SMP instead of HP. It runs these steps, in this order, and reports the damage dealt.

1. **Nothing to do.** If there is no attacker, no target, or the attacker's HP is below 1, nothing changes and the reported damage is 0. The order of these three checks cannot be observed, because each leaves everything unchanged.
2. **Luck.** If the supplied amount is above 0, draw one whole percentage *p* from -10 to +9 with `random(20) - 11`, and replace the amount with `amount × (100 + p) ÷ 100` with the fraction dropped (towards zero). The swing is not symmetrical. This is worked in exact arithmetic, a Reawakened determinism choice; the original used floating-point arithmetic and may differ by 1 at a rounding boundary (not verified).
3. **Defence and critical hit.** If the supplied amount was above 0, the attack is critical if either side's draw hits. Take the attacker's offensive value as a limit *n*; if *n* is 0 or more, draw one whole number from 0 to *n* inclusive with `random(n + 1) - 1`, and a draw of 0 is a critical hit. If that did not make it critical, do the same with the target's defensive value. A side whose value is -1 makes no draw and consumes no random number. If the attack is critical the target's DP is not subtracted; otherwise the target's DP is subtracted from the amount. Thus the nominal chance from that side is 1-in-(*n* + 1), subject to the small modulo bias below, and **a limit of 0 always skips DP**. The luck draw comes first, then the offensive draw, then the defensive draw; none of these happen when the supplied amount is 0 or less, so such an amount consumes no random numbers. A stored value below -1 is a located load diagnostic and is treated as -1.
4. **Floor.** If the amount is now below 1 it becomes 1. This includes a supplied amount of 0 or less.
5. **Apply.** Subtract the amount from the target's HP, or from its SMP when the damage goes to SMP, never going below 0.

**Random draw precision (OWNER; Jensen, 2026-10-29; issue #746).** The existing seeded `random(max)` mapping stays as it is: `1 + (draw % max)`, where `draw` is an unsigned 32-bit value ([Ruling 3](rpgcode-functions.md)). When `max` does not divide 2³², the buckets differ by one possible draw; the outcomes are treated as equally likely for game design, not promised exactly equal. For `random(20)`, values 1–16 each have 214,748,365 possible draws and values 17–20 each have 214,748,364. The owner considers this normal and chose to correct the wording, not change the RNG.

**Rejected alternative (issue #746).** Requiring exactly equal probabilities by changing `random(max)` to rejection sampling was rejected: it would change random draw sequences and the existing `random(max)` contract for a very small bias. The owner chose to retain the mapping and correct the wording instead; see the [decision and alternatives](../../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/spike-rule-e-74-equal-probability-wording-against-random-plan.md#rejected-alternative).

Legacy battles are one-sided, so each attack has exactly one side with a value and makes one draw, in the same random sequence as the original. Only the value for the direction of the attack is used: an enemy being hit uses its defensive value, an enemy attacking uses its offensive value, and its other value takes no part. Every legacy enemy file stores both values, so the enemy's side is always present; a stored 0 therefore means every attack in that direction skips DP, exactly as in the original. An actor created without a value (a character, or a new enemy) has -1 for it, never 0.

| Attacker | Target | Value used |
| --- | --- | --- |
| player | enemy | the enemy's defensive value (`takeCrit`); the player's offensive value is -1 |
| enemy | player | the enemy's offensive value (`giveCrit`); the player's defensive value is -1 |

*Departures from the original.* (1) For an enemy attacking a player, the original read the limit from a record the player target does not have, which gave an invalid result; the rebuild uses the attacking enemy's offensive value, which is what the two field names and [`enemy.md`](../formats/enemy.md#layout) rows 9 and 10 describe. (2) The original fixed the limit at 0 for a player attacking a player, so DP was always skipped; in the rebuild both values are -1 unless a game gives them, so DP is subtracted. (3) For an enemy attacking an enemy the original used only the attacker's `giveCrit`; the rebuild also applies the target's `takeCrit`. Pairings (2) and (3) are not normal battle arrangements. *Special moves* do not use these steps: a special move takes its own flat FP value off the target's HP, its own target-SMP value off the target's SMP and its own source-SMP value off the user's SMP, each kept at 0 or above, with no luck and no DP subtraction. *Evidence:* [facts-round-10.md](../../provenance/facts-round-10.md) D1 to D8; `enemy.md` rows 9 and 10. *Rejected alternatives:* a single value shared by both directions, which cannot say how often an enemy lands a critical hit apart from how often it suffers one; defaulting characters to 1, which would be a 50 % chance rather than neutral; `null` instead of -1 for "none", which the owner declined (-1 is the legacy "none" convention). DP derivation from stats and equipment and the defaults of `takeCrit`/`giveCrit` on enemies are not ruled here (facts D9).
**Reawakened rule (Epic 7.1; R11-Q7).** Special moves and items do not use the steps above: a special has no luck, critical, DP or floor of 1; an item adds its values and is kept between 0 and the maximum. See [BAT-5](battle.md#bat-5).

<a id="e-75"></a>
**E-75 Status effects.** Applied by moves or by script and keyed by file (re-applying restarts it). Each round while the fighter is charged: apply ±HP and ±SMP and optionally run a program (with `source`/`target` = the fighter); it lasts a number of rounds. **Speed up / slow down** change the charge rate; **disable** freezes charging and is reference-counted when several disables are active.

**Reawakened rule (Epic 7.1; R11-Q5, Q6).** A status ticks once per turn of its fighter, effect first and then the round count; statuses sum without a floor or ceiling; a disable never ends by itself. See [BAT-6](battle.md#bat-6).

<a id="e-77"></a>
**E-77 Outcome.** **Win:** the total gold and experience of all enemies, a "Gained N experience / GP" message, the experience given to every party member (which may level them up), and the enemy defeat program. **Run:** the run-away program and no rewards. **Lose:** the game-over program, or `reset()` when there is none. The board music resumes afterwards.

**Reawakened rule (Epic 7.1; R11-Q11 to Q13).** Running succeeds 2 times in 5 and a failed attempt costs the turn; rewards go to every party member in a ruled order; one run program and one win program (the last enemy's that has one) run. See [BAT-8](battle.md#bat-8).

> **Historical conflict R-57 (settled by entry 7.1).** The earlier disagreement concerned charge thresholds, damage variance and critical hits, legacy callback wording and notification codes. The owner resolved it at the Epic 7.1 checkpoint; the ruling below and [battle.md](battle.md) are authoritative.
> **Ruled — R-57.** The adopted legacy facts are that players act at 75, enemies at 123, physical-attack variance is a whole percentage from −10% to +9% (not symmetric; see [E-74](#e-74)), and critical hits bypass DP; the original engine never sent `fightInform` codes 6 and 7 (the rebuild detects deaths and battle end, [BAT-12](battle.md#bat-12)). The `skill = -1` sentinel belongs only to the legacy callback; it is not part of the rebuilt package/start contract.

### Enemy AI

| AI level | Behaviour |
|---|---|
| 0 | random target; 50/50 physical attack or special move |
| 1 | special moves until SMP runs out |
| 2 | the weakest target; 50/50 |
| 3 | the weakest target; special moves first |
| any, with `useCode` | runs the enemy's AI program instead |

<a id="e-76"></a>
**E-76 Enemy AI.** The four built-in levels are the table above. An enemy can instead use a **custom AI program** (with `source` = enemy and `target` = a random player). Enemies use only specials they can afford, and curative specials target allies.

**Reawakened rule (Epic 7.1; R11-Q8 to Q10).** "Weakest" is the lowest current HP; healing specials go to a random ally at levels 0 and 1 and to the lowest-HP ally at levels 2 and 3. See [BAT-7](battle.md#bat-7).

### Random encounters

Tested at most once per tile the player moves, on boards that allow battles, when the main file enables fighting (`fightGameYn = 0`). Type 0: a fight starts with probability 1 / `chances`. Type 1: a fight starts every `chances` tiles walked. If the main file's custom-fight flag is set, its fight program runs instead. Otherwise 1-4 enemies (random count) are drawn from the main file's encounter table among those whose skill level matches the board's battle skill, and the board's battle background is used. If no enemy has that skill level the message "No enemies of skill level N found." is shown.

**Reawakened rule (Epic 7.1; R11-Q14).** The number of enemies is 1 to 4, each equally likely, and each is drawn independently. See [BAT-9](battle.md#bat-9).

**Reawakened rule (OWNER; Jensen, 2026-10-26).** If the main file's custom-fight flag is set and names a program, the chance is rolled as above but the draw above never happens: the program runs in its place, receives the board, the player and its own name as its `context`, and names the enemies itself with `FightEnemy`. A set flag with a blank name names no program, so the encounter is drawn as above. See [BAT-9](battle.md#bat-9).


## Callback interface

Plugins reach the engine through the 140 methods below. Native plugins receive the first 45 or 133 as an array of function pointers (in this order; methods 133-139 are COM only). COM plugins get an automation object (`Trans3.Callbacks`). All methods return success; failures show only in their results. Canvas, animation and other "handles" are numbers issued by the engine. `→T` marks the return value. Info codes for the `Get…`/`Set…` families are listed in [plugin-constants.md](plugin-constants.md).

Notable conventions: `CBCanvasDrawText` positions text in **character cells**, `CBDrawTextAbsolute` in pixels; `CBGetBracketElement` is **1-based**; the element-value callbacks only work during an RPGCode plugin call.

<a id="e-54"></a>
**E-54 Animations.** `.anm` files and animated GIFs: a per-frame image (a picture, a tile or a tile bitmap), a per-frame transparent colour, a per-frame sound and a frame delay in seconds. They are used for sprites, battle effects and stand-alone screen animations (`Animation`, `SizedAnimation`, and persistent ones that keep running until `EndAnimation`; the Reawakened [`pinnedanimation`](rpgcode-functions.md#reawakened-pinnedanimation) is the same animation drawn above the render-now canvas that holds its last frame), and frames are shared and cached between sprites that use the same file ([../formats/animation.md](../formats/animation.md)). Callbacks 105 to 113 below create, draw and query them.

| # | Method | Purpose |
|---|---|---|
| 0 | `CBRpgCode(BSTR cmd)` | Compile and run an RPGCode string in a fresh program |
| 1 | `CBGetString(BSTR var) →BSTR` | Read a string variable (strips trailing `$`; uses the current program's locals during a plugin command call, else globals) |
| 2 | `CBGetNumerical(BSTR var) →double` | Read a numeric variable (strips `!`) |
| 3 | `CBSetString(BSTR var, BSTR val)` | Set a string variable |
| 4 | `CBSetNumerical(BSTR var, double val)` | Set a numeric variable |
| 5 | `CBGetScreenDC() →int` | `GetDC(host window)`; stores it for CBReleaseScreenDC |
| 6 | `CBGetScratch1DC() →int` | Obsolete, returns 0 |
| 7 | `CBGetScratch2DC() →int` | Obsolete, returns 0 |
| 8 | `CBGetMwinDC() →int` | Obsolete, returns 0 |
| 9 | `CBPopupMwin() →int` | Show the message window |
| 10 | `CBHideMwin() →int` | Hide the message window |
| 11 | `CBLoadEnemy(BSTR file, int slot)` | Load `Enemy\file` into the plugin enemy slot `the battle enemy list[slot]` |
| 12 | `CBGetEnemyNum(int code, int slot) →int` | Read a numeric enemy field (`ENE_*`) |
| 13 | `CBGetEnemyString(int code, int slot) →BSTR` | Read a string enemy field (sound codes 5-8 return "") |
| 14 | `CBSetEnemyNum(int code, int val, int slot)` | Write a numeric enemy field |
| 15 | `CBSetEnemyString(int code, BSTR val, int slot)` | Write a string enemy field |
| 16 | `CBGetPlayerNum(int code, int arrayPos, int slot) →int` | Read a numeric player field (`PLAYER_*`) |
| 17 | `CBGetPlayerString(int code, int arrayPos, int slot) →BSTR` | Read a string player field (sound fields obsolete) |
| 18 | `CBSetPlayerNum(int code, int arrayPos, int val, int slot)` | Write a numeric player field |
| 19 | `CBSetPlayerString(int code, int arrayPos, BSTR val, int slot)` | Write a string player field |
| 20 | `CBGetGeneralString(int code, int arrayPos, int slot) →BSTR` | Read global string state (`GEN_*`: party, inventory, equipment, music, board...). Codes 2-3 are "TBD" |
| 21 | `CBGetGeneralNum(int code, int arrayPos, int slot) →int` | Read global numeric state (GP, position, resolution, time, steps, `GEN_ENE_RUN`...). Several codes obsolete |
| 22 | `CBSetGeneralString(int code, int arrayPos, int slot, BSTR val)` | Write global string state |
| 23 | `CBSetGeneralNum(int code, int arrayPos, int slot, int val)` | Write global numeric state (including whether the player can run from the current fight) |
| 24 | `CBGetCommandName(BSTR cmd) →BSTR` | Lower-cased text before `(` |
| 25 | `CBGetBrackets(BSTR cmd) →BSTR` | Text between the first `(` and the last `)` |
| 26 | `CBCountBracketElements(BSTR cmd) →int` | Count comma-separated arguments (quote-aware) |
| 27 | `CBGetBracketElement(BSTR cmd, int n) →BSTR` | Get argument `n` (**1-based**) |
| 28 | `CBGetStringElementValue(BSTR elem) →BSTR` | Evaluate `"literal"` or `var$` (derefs `the calling program` without a NULL check) |
| 29 | `CBGetNumElementValue(BSTR elem) →double` | Evaluate a number or `var!` (derefs `the calling program` without a NULL check) |
| 30 | `CBGetElementType(BSTR elem) →int` | `PLUG_DT_LIT` or `PLUG_DT_NUM` by syntax |
| 31 | `CBDebugMessage(BSTR msg)` | Send to the RPGCode debugger window |
| 32 | `CBGetPathString(int code) →BSTR` | Game sub-folder name (`PATH_*`), save path or project path |
| 33 | `CBLoadSpecialMove(BSTR file)` | Load the global scratch special move `the plugin special-move slot` |
| 34 | `CBGetSpecialMoveString(int code) →BSTR` | Read a `SPC_*` string from `the plugin special-move slot` |
| 35 | `CBGetSpecialMoveNum(int code) →int` | Read a `SPC_*` number from `the plugin special-move slot` |
| 36 | `CBLoadItem(BSTR file, int slot)` | Load an item. A negative slot means the plugin scratch list `the plugin item slots[-slot]`; a positive slot replaces board item `slot` |
| 37 | `CBGetItemString(int code, int arrayPos, int slot) →BSTR` | Read an `ITM_*` string |
| 38 | `CBGetItemNum(int code, int arrayPos, int slot) →int` | Read an `ITM_*` number |
| 39 | `CBGetBoardNum(int code, int a1, int a2, int a3) →int` | Read a numeric board field (`BRD_*`) |
| 40 | `CBGetBoardString(int code, int a1, int a2, int a3) →BSTR` | Read a string board field |
| 41 | `CBSetBoardNum(int code, int a1, int a2, int a3, int val)` | Write a numeric board field (size/border/start position are ignored) |
| 42 | `CBSetBoardString(int code, int a1, int a2, int a3, BSTR val)` | Write a string board field |
| 43 | `CBGetHwnd() →int` | Host window HWND as int |
| 44 | `CBRefreshScreen() →int` | Flip the back buffer, or the RPGCode screen while a program runs (the return value is not set in that case) |
| 45 | `CBCreateCanvas(int w, int h) →int` | Allocate an offscreen canvas. **The handle is the raw `canvas*`** |
| 46 | `CBDestroyCanvas(int cnv) →int` | Free a canvas |
| 47 | `CBDrawCanvas(int cnv, int x, int y) →int` | Blit a canvas to the back buffer |
| 48 | `CBDrawCanvasPartial(cnv, xd, yd, xs, ys, w, h) →int` | Partial blit to the back buffer |
| 49 | `CBDrawCanvasTransparent(cnv, x, y, crTransp) →int` | Colour-keyed blit to the back buffer |
| 50 | `CBDrawCanvasTransparentPartial(cnv, xd, yd, xs, ys, w, h, crTransp) →int` | Partial colour-keyed blit |
| 51 | `CBDrawCanvasTranslucent(cnv, x, y, double intensity, crUnaffected, crTransp) →int` | Alpha-style blit to the back buffer |
| 52 | `CBCanvasLoadImage(int cnv, BSTR file) →int` | Draw `Bitmap\file` at its natural size |
| 53 | `CBCanvasLoadSizedImage(int cnv, BSTR file) →int` | Draw `Bitmap\file` stretched to the canvas |
| 54 | `CBCanvasFill(int cnv, int cr) →int` | Fill the canvas with a colour |
| 55 | `CBCanvasResize(int cnv, int w, int h) →int` | Resize a canvas |
| 56 | `CBCanvas2CanvasBlt(src, dst, xd, yd) →int` | Canvas-to-canvas blit |
| 57 | `CBCanvas2CanvasBltPartial(src, dst, xd, yd, xs, ys, w, h) →int` | Partial canvas-to-canvas blit |
| 58 | `CBCanvas2CanvasBltTransparent(src, dst, xd, yd, crTransp) →int` | Colour-keyed canvas-to-canvas blit |
| 59 | `CBCanvas2CanvasBltTransparentPartial(src, dst, xd, yd, xs, ys, w, h, crTransp) →int` | Partial colour-keyed canvas-to-canvas blit |
| 60 | `CBCanvas2CanvasBltTranslucent(src, dst, xd, yd, double intensity, crUnaff, crTransp) →int` | Translucent canvas-to-canvas blit |
| 61 | `CBCanvasGetScreen(int dst) →int` | Copy the screen into a canvas |
| 62 | `CBLoadString(int id, BSTR default) →BSTR` | Localisation stub: always returns `default` |
| 63 | `CBCanvasDrawText(cnv, BSTR text, BSTR font, int size, double x, double y, cr, bold, italic, underline, centred, [opt] outlined) →int` | Draw text. **x and y are in text-cell units** (`x*size-size`) |
| 64 | `CBCanvasPopup(int cnv, int x, int y, int step, int type) →int` | Animated reveal of a canvas on screen (`POPUP_*`). Blocking; pumps messages |
| 65 | `CBCanvasWidth(int cnv) →int` | Canvas width |
| 66 | `CBCanvasHeight(int cnv) →int` | Canvas height |
| 67 | `CBCanvasDrawLine(cnv, x1, y1, x2, y2, cr) →int` | Draw a line |
| 68 | `CBCanvasDrawRect(cnv, x1, y1, x2, y2, cr) →int` | Draw a rectangle outline |
| 69 | `CBCanvasFillRect(cnv, x1, y1, x2, y2, cr) →int` | Draw a filled rectangle |
| 70 | `CBCanvasDrawHand(cnv, px, py) →int` | Draw the pointer cursor onto a canvas (offset −42, −10) |
| 71 | `CBDrawHand(px, py) →int` | Draw the pointer cursor onto the back buffer |
| 72 | `CBCheckKey(BSTR key) →int` | Is this key held down right now? By name: LEFT, RIGHT, UP, DOWN, SPACE, ESC, ENTER, NUMPAD0-9, or a character |
| 73 | `CBPlaySound(BSTR file) →int` | Play a sound effect (the caller supplies the path, without `Media\`) |
| 74 | `CBMessageWindow(BSTR text, int textCr, int bgCr, BSTR bgPic, int type) →int` | Modal message box (`MW_*` in, `MWR_*` out) |
| 75 | `CBFileDialog(BSTR initPath, BSTR filter) →BSTR` | In-game file picker |
| 76 | `CBDetermineSpecialMoves(BSTR playerHandle) →int` | Build the learned-move list for a player and return its count |
| 77 | `CBGetSpecialMoveListEntry(int idx) →BSTR` | Entry from that list |
| 78 | `CBRunProgram(BSTR prg)` | Run `Prg\file` |
| 79 | `CBSetTarget(int idx, int type)` | Set the RPGCode `target` entity (`TYPE_*`) |
| 80 | `CBSetSource(int idx, int type)` | Set the RPGCode `source` entity |
| 81 | `CBGetPlayerHP(int idx) →double` | Party member HP |
| 82 | `CBGetPlayerMaxHP(int idx) →double` | Party member max HP |
| 83 | `CBGetPlayerSMP(int idx) →double` | Party member SMP |
| 84 | `CBGetPlayerMaxSMP(int idx) →double` | Party member max SMP |
| 85 | `CBGetPlayerFP(int idx) →double` | Party member FP (attack) |
| 86 | `CBGetPlayerDP(int idx) →double` | Party member DP (defence) |
| 87 | `CBGetPlayerName(int idx) →BSTR` | Party member name |
| 88 | `CBAddPlayerHP(int amt, int idx)` | Add HP (no clamp here) |
| 89 | `CBAddPlayerSMP(int amt, int idx)` | Add SMP |
| 90 | `CBSetPlayerHP(int amt, int idx)` | Set HP |
| 91 | `CBSetPlayerSMP(int amt, int idx)` | Set SMP |
| 92 | `CBSetPlayerFP(int amt, int idx)` | Set FP |
| 93 | `CBSetPlayerDP(int amt, int idx)` | Set DP |
| 94 | `CBGetEnemyHP(int idx) →int` | Plugin enemy slot HP (the return value is not set if the slot is empty) |
| 95 | `CBGetEnemyMaxHP(int idx) →int` | Max HP |
| 96 | `CBGetEnemySMP(int idx) →int` | SMP |
| 97 | `CBGetEnemyMaxSMP(int idx) →int` | Max SMP |
| 98 | `CBGetEnemyFP(int idx) →int` | FP |
| 99 | `CBGetEnemyDP(int idx) →int` | DP |
| 100 | `CBAddEnemyHP(int amt, int idx)` | Add HP, clamped to max |
| 101 | `CBAddEnemySMP(int amt, int idx)` | Add SMP, clamped to max |
| 102 | `CBSetEnemyHP(int amt, int idx)` | Set HP, clamped to 0..max |
| 103 | `CBSetEnemySMP(int amt, int idx)` | Set SMP. **Bug:** compares against current SMP, not max |
| 104 | `CBCanvasDrawBackground(int cnv, BSTR bkg, int x, int y, int w, int h)` | Draw a `.bkg` background's image onto a canvas |
| 105 | `CBCreateAnimation(BSTR file) →int` | Create a shared animation. **The handle is the raw pointer** |
| 106 | `CBDestroyAnimation(int idx)` | Free an animation |
| 107 | `CBCanvasDrawAnimation(cnv, idx, x, y, forceDraw, forceTransp)` | Tick and draw the current frame (timing is tick-count based, commented "a bit dubious") |
| 108 | `CBCanvasDrawAnimationFrame(cnv, idx, frame, x, y, forceTranspFill)` | Draw a specific frame (plays the frame sound on change) |
| 109 | `CBAnimationCurrentFrame(int idx) →int` | Current frame |
| 110 | `CBAnimationMaxFrames(int idx) →int` | `frameCount-1` (the pre-3.1 UBound convention) |
| 111 | `CBAnimationSizeX(int idx) →int` | Pixel width |
| 112 | `CBAnimationSizeY(int idx) →int` | Pixel height |
| 113 | `CBAnimationFrameImage(int idx, int frame) →BSTR` | Frame image filename |
| 114 | `CBGetPartySize(int party) →int` | Fighters in a battle party (`ENEMY_PARTY` = 0, `PLAYER_PARTY` = 1) |
| 115 | `CBGetFighterHP(int party, int idx) →int` | Fighter HP |
| 116 | `CBGetFighterMaxHP(int party, int idx) →int` | Fighter max HP |
| 117 | `CBGetFighterSMP(int party, int idx) →int` | Fighter SMP |
| 118 | `CBGetFighterMaxSMP(int party, int idx) →int` | Fighter max SMP |
| 119 | `CBGetFighterFP(int party, int idx) →int` | Fighter FP |
| 120 | `CBGetFighterDP(int party, int idx) →int` | Fighter DP |
| 121 | `CBGetFighterName(int party, int idx) →BSTR` | Fighter name |
| 122 | `CBGetFighterAnimation(int party, int idx, BSTR stance) →BSTR` | Animation file for a stance name |
| 123 | `CBGetFighterChargePercent(int party, int idx) →int` | Charge 0..100 |
| 124 | `CBFightTick()` | Advance battle time one tick: charge, status effects, enemy AI (see §4) |
| 125 | `CBDrawTextAbsolute(BSTR text, BSTR font, int size, int x, int y, cr, bold, italic, underline, centred, [opt] outlined) →int` | Draw text on the back buffer at pixel coordinates |
| 126 | `CBReleaseFighterCharge(int party, int idx)` | Reset charge to 0 and unfreeze (the player's turn is over) |
| 127 | `CBFightDoAttack(sP, sI, tP, tI, int amount, int toSMP) →int` | Engine-resolved physical attack. Returns the damage dealt |
| 128 | `CBFightUseItem(sP, sI, tP, tI, BSTR item)` | Apply an item's fight HP/SMP to the target, remove it from inventory, inform the plugin |
| 129 | `CBFightUseSpecialMove(sP, sI, tP, tI, BSTR move)` | Engine-resolved special move |
| 130 | `CBDoEvents()` | Handle one pending window message (keeps the window responsive during a plugin's own loop) |
| 131 | `CBFighterAddStatusEffect(int party, int idx, BSTR file)` | Apply a `.ste` status effect |
| 132 | `CBFighterRemoveStatusEffect(int party, int idx, BSTR file)` | Remove a status effect |
| 133 | `CBCheckMusic()` | Obsolete no-op. **COM only** |
| 134 | `CBReleaseScreenDC()` | Release the screen drawing context obtained with #5. **COM only** |
| 135 | `CBCanvasOpenHdc(int cnv) →int` | Open a GDI HDC on a canvas. **COM only** |
| 136 | `CBCanvasCloseHdc(int cnv, int hdc)` | Close that HDC. **COM only** |
| 137 | `CBFileExists(BSTR file) →short (VARIANT_BOOL)` | Does `projectPath + file` exist? **COM only** |
| 138 | `CBCanvasLock(int cnv)` | Lock a canvas surface. **COM only** |
| 139 | `CBCanvasUnlock(int cnv)` | Unlock a canvas surface. **COM only** |
