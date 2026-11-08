# Engagement user-flow rehearsals

**Status:** Research-only paper rehearsals. They elaborate the existing ten flow studies; they are not usability findings, feature commitments, specifications, architecture decisions, or ticket changes. The numbered scenario inventory supplies invented composites and strategic lenses, not real-user evidence. Existing flows are also proposals, not shipped behavior. The accepted direction for this round is **game maker first, not IDE setup first**: RPG Maker clarity of purpose, VS Code workspace flexibility, and Figma-like direct visual editing. Game and Files navigation should be available separately or together. VSCodium/Code-OSS remains a candidate, not a selected host.

**Evidence boundary:** References to legacy behavior below are limited to `docs/editor-features.md` and the existing research flows. No legacy source is used. The status-effect screenshot supplied in this session confirms the visible fields listed in F-09 only; it does not establish runtime interpretation or execution. No synthetic scenario is represented as a real observed user.

Read alongside the [engagement-area map](engagement-area-map.md) and [continuation prompt](engagement-design-prompt.md). Named screens such as Database, World, Atmosphere, and Blocks are candidate destinations inherited from earlier sketches, not selected information architecture. Older research's open runtime questions are not reopened here: check current normative specs before designing detailed explanations.

## How to read these rehearsals

Each flow names a starting state and intent; what the paper flows already cover; the extension explored this round; interaction steps; surfaces and context that should travel; cancellation/recovery; observable proposed success; and unresolved decisions. “Success” is a future observable to test, not a result already achieved. A missing behavior or provider is shown as unavailable/conditional, not simulated as if real.

### F-01 — Find and safely change project input, cursor, startup, and movement settings (SC-33)

**Starting state / intent.** A mostly working project; creator wants to change a key, cursor, movement style, or start behavior without living in configuration or guessing which setting owns it.

**Paper coverage / extension.** Flow 07 covers conventions, contextual settings, and host shell; flow 08 hides the main game file by convention and exposes resolved values. `docs/editor-features.md` T-10–T-14 inventories settings. This rehearsal adds a continuous path from a gameplay question to the setting's owner, including input conflicts and undo/cancel; it does not decide storage or host.

1. From **Game**, choose “Change how movement works” or open **Settings**; see default/convention/imported/override and a plain-language explanation.
2. Choose a key by keyboard, accessible key list, or direct value; view all bindings and any conflict before applying. Select cursor asset and hotspot with preview; inspect startup owner links.
3. Apply the change, see a named pending change and affected preview, then save; re-open **Files** or **Open as text** only if desired.

**Surfaces/context:** Game settings entry and owner-jump; complete controls form; project tree/files and text inspection remain reachable. Carry project identity, setting owner, effective value, pending edit, and originating view. Accessible keyboard route is required; no assistant is needed.

**Failure / cancel / recovery:** Escape/Cancel leaves the old value; conflict offers choose another, explicitly resolve, or cancel. Unsupported host input/cursor picker is labeled unavailable. A failed save must not report success or start stale Play. Host draft/backup limits stay explicit.

**Proposed success:** Creator can locate the owner, identify resolved value and source, change one setting without losing other bindings, and verify the result in the intended host. **Open:** input capture contract; setting ownership/resolution and local-vs-project preferences; save and host capability details. **Trace:** SC-33; T-10–T-14; [flow 07](flows/07-project-shell-and-sharing.md), [flow 08](flows/08-project-file-by-convention.md).

### F-02 — Connect boards into a journey and test entry/return (SC-38)

**Starting state / intent.** Two decorated boards but no tested journey; creator wants a doorway to reach the inn and return at the intended point, with entry programs and board threads understood.

**Paper coverage / extension.** Flow 01 covers world view, connections, threads, board properties, and doors; flow 07 covers Play from current board versus game start. This rehearsal makes arrival, return, entry program, threads, and properties one inspectable travel task without assuming transition semantics beyond the documented links.

1. Open **Game > World** or **Files > Boards**; choose the source doorway and destination board/arrival marker. Inspect the reciprocal route separately; choose/repair the return link.
2. Open **Board Settings** from the board canvas. Review directional links, entry program and board threads (programs started on entry); open a thread in Code or Blocks without losing the board selection.
3. Save, test from a safe point adjacent to the doorway, travel, and test return. Inspect destination marker and Problems if the route fails.

**Surfaces/context:** World map, board canvas/Outline, Properties > Board Settings, program editor, Play and Problems. Carry source board/object, destination/arrival, return route, entry context, selected thread, and test location. Accessible route uses tree/list navigation and named link controls; no assistant.

**Failure / cancel / recovery:** Missing destination is kept unresolved and offered Choose/Create/Keep; cancellation returns to the original board without silently creating a replacement. Do not claim dynamic script destinations are fully mapped. Failed save blocks test; entry program and threads are not treated as equivalent. Restore from available host recovery only.

**Proposed success:** Test demonstrates the chosen travel and return behavior, and creator can identify which board link, entry program, or thread owns any failure. **Open:** exact arrival/return semantics, dynamic reference coverage, and context preservation across nested program visits. **Trace:** SC-38; T-26/T-27/T-29; [flow 01](flows/01-board-editor.md), [flow 02](flows/02-scripts-and-blocks.md), [flow 07](flows/07-project-shell-and-sharing.md).

### F-03 — Shape atmosphere and export the intended image (SC-13)

**Starting state / intent.** A composed room needs image placement, shading/light and audio context; creator wants the player-facing image without baking away editable work or exporting editor guides.

**Paper coverage / extension.** Flow 01 covers Images, Atmosphere, shading/light distinction and board export; flow 03 covers importing art. This round follows source → preview → export, identifying content versus editor overlays.

1. From the board canvas, add/select an image; inspect top-left pixel anchor, layer and transparency. Open **Atmosphere** to paint shade or place a light; compare editable source with any proposed bake result.
2. Preview the board composition and hide/show editor-only handles and collision overlays. Cancel any conversion or use undo to return to editable light/source.
3. Export **Current view** or **Entire board**; review included layers/sprites/shading and overlay choices before writing.

**Surfaces/context:** Board canvas, image inspector, Atmosphere controls, export preview/file list. Carry board, selected image/light, source-vs-baked state, visibility, export scope and output format. Keyboard-accessible controls and explicit numeric color/value fields; no assistant.

**Failure / cancel / recovery:** Missing media stays diagnosed; no silent placeholder substitution in output. Cancel leaves source unchanged. Bake is never implied by preview; undo only where the host/document model supports it. Unsupported image mode/format is called unavailable, not approximated.

**Proposed success:** Export preview corresponds to the intended game composition and excludes editor overlays unless explicitly selected; source remains editable if bake was cancelled. **Open:** bake reversibility/storage; image modes by runtime; output formats per host. **Trace:** SC-13; T-23/T-26/T-32/T-36/T-80; [flow 01](flows/01-board-editor.md), [flow 03](flows/03-tiles-and-art-sources.md).

### F-04 — Edit a pixel seam, curate tiles, and reconcile external edits (SC-08/09/10/30/44)

**Starting state / intent.** An image sheet or shared tile set is in use; creator needs to repair a seam, import/replace tiles, or bring back an external edit without changing unrelated boards.

**Paper coverage / extension.** Flow 03 covers sheet import, pixel editing, set curation, use counts and external review; flow 10 covers sheet-first drawing and in-context seams. This rehearsal traces replacement through unknown references and unsaved work, including old numeric ordering.

1. From a board tile or **Files > Tiles**, open pixel edit in board-neighbor context. Review **Used in** and choose Shared edit, Make unique here, or Cancel.
2. Draw or apply a previewed adjustment. For an image sheet, use Grabber/import grid, adjust margins/gaps/transparency, review selected cells and destination set; do not commit guessed cells.
3. Reorder/replace/merge a set only after a reference-impact preview. Preserve legacy index as provenance; unknown/raw script references are marked uncertain.
4. If the source changed externally while local pixels are dirty, compare before/after and choose keep local, accept external, review/merge manually, or cancel. Reopen the board context to inspect changed use.

**Surfaces/context:** Board canvas, tile-sheet pixel workspace, grabber/import review, tileset list, Problems/reference impact, external conflict comparison. Carry source identity, tile identity/legacy index, selected cell, shared/unique scope, reference set, dirty state, and originating board.

**Failure / cancel / recovery:** Cancel/failed import never overwrites source; preserve both sides of an unresolved external conflict. Missing/uncertain references block declaring reorder safe; offer replace/relink/cancel and retain original files. Unavailable source editor permits download/reimport, not pretend-live editing. Keyboard route must reach selection, tools and decisions without pointer; no assistant.

**Proposed success:** Seam is visibly improved in the selected board and repeat preview; other uses remain unchanged after unique edit; external changes are knowingly reconciled. **Open:** stable tile identity/persistence, transaction across source and generated tiles, raw-string reference certainty, merge workflow. **Trace:** SC-08/09/10/30/44; T-36/T-37/T-38; [flow 03](flows/03-tiles-and-art-sources.md), [flow 10](flows/10-tile-making-without-the-grind.md), [flow 07](flows/07-project-shell-and-sharing.md).

### F-05 — Compose a visual stamp and animate a multi-cell fountain (SC-11/12/50)

**Starting state / intent.** Creator has a tileset or adjacent source region and wants a reusable visual composition plus a moving fountain/waterfall whose cells remain coupled.

**Paper coverage / extension.** Flow 03 distinguishes stamps, tile animations, region animation and components; flow 10 details sheet drawing, frame duplication and synchronized region channels. This rehearsal makes the handoff from bitmap-like composition to board use explicit without assuming native region/channel support.

1. In **Artwork**, select/draw a multi-cell region, inspect cell boundaries and choose **Make Stamp**; preview anchor and placement. Confirm it is visual-only, not a behavior-bearing Component.
   Include per-cell shading in the composition. Explain whether placement writes constituent tiles or retains a live assembly link: editing the brush need not update prior painted arrangements.
2. Select a multi-cell fountain region and choose **Animate region**. Review frame order and whole-region preview, duplicate/edit frames, scrub timing, then preview in board context.
3. Inspect whether cells share one animation clock/phase. If the provider supports region channels, show the supported coupling; otherwise leave source independent/editable and state that synchronized placement is unavailable rather than faking it.
4. Paint/place the stamp or animation, then inspect other uses before changing shared frames; use Make unique when only one use should diverge.

**Surfaces/context:** Artwork sheet, optional timeline, shared tileset palette, stamp preview, board canvas and use graph. Carry source region, cell selection, frame order/timing, placement anchor, use scope and board context. Keyboard-accessible timeline and alternative frame list required; no assistant.

**Failure / cancel / recovery:** Cancel does not create partial assets. Missing region-channel provider leaves ordinary source art intact and marks coupled playback unavailable. Delete/reorder requires reference review; recover through undo/host backup only where available.

**Proposed success:** A reusable stamp preserves editable tile references; a fountain's intended multi-cell motion can be inspected and its synchronization status stated truthfully. **Open:** storage/runtime representation for region channels, synchronized vs independent phases, multi-document undo. **Trace:** SC-11/12/50; T-24/T-36/T-39/T-62; [flow 03](flows/03-tiles-and-art-sources.md), [flow 10](flows/10-tile-making-without-the-grind.md).

### F-06 — Assign animation frames, stances, geometry, timing, and sound (SC-14/40)

**Starting state / intent.** A person or character has a sprite sheet or animation; creator needs it to look right while walking/acting and to understand collision/talk geometry and sound timing.

**Paper coverage / extension.** Flow 05 covers timeline, frame-associated sound, stance compass, geometry and distinct timing units. Flow 04 links character graphics to Database. This rehearsal checks continuity from imported source to the placed sprite, rather than treating a preview as proof of gameplay.

1. Open Graphics from a placed Person or Database; import a sheet and label directions/stances after seeing the grid. Preview cardinal walks and any optional idle/battle/custom stance.
2. Open timeline; assign frames, timing and sound marker. Reorder a frame and confirm its sound follows the frame identity. Audition audio beside the marker.
3. Edit collision and activation bases over the sprite and a board sample; adjust movement speed, animation frame timing, and idle delay as separate controls with units.
4. Return to placement and test in a saved project; inspect missing-look/fallback warnings and the actual interaction range.

**Surfaces/context:** Database Graphics, shared image import, animation timeline, board placement inspector, Problems and Play. Carry selected definition vs placed instance, stance, frame identity, source, sound, geometry and origin. Keyboard-only direction/frame/vertex controls and screen-reader labels; no assistant.

**Failure / cancel / recovery:** Import cancel retains prior assignment; missing animation/sound produces located diagnostic, not silent completion. Frame reorder is undoable and keeps its markers with it. Test saves first; local animation preview is not called a game run. Failed save blocks launch.

**Proposed success:** Character's look, activation shape and timing preview agree across timeline and board test; a moved frame retains its sound. **Open:** exact runtime preview and stance loop/one-shot behavior; legacy timing conversion; save contract. **Trace:** SC-14/40; T-52/T-60/T-61; [flow 04](flows/04-characters-items-database.md), [flow 05](flows/05-animation-and-looks.md).

### F-07 — Configure progression, unlocks, equipment and stat bindings (SC-15)

**Starting state / intent.** A hero concept with growth and abilities; creator wants to see how values change and connect the right character to the starting party without corrupting legacy bindings.

**Paper coverage / extension.** Flow 04 covers character stats, growth chart, special-move unlocks, equipment capability and party setup. This rehearsal adds explicit review of unlock alternatives and runtime variable bindings as separate concerns.

1. Open **Database > Characters**; inspect imported values, provenance and runtime variable bindings before changing display name or regenerating defaults.
2. Edit growth using plain units and inspect curve/table; set ability eligibility using experience, level or variable conditions. Explain the combination rule from the current specification/selected system rather than guessing from the form layout.
3. Compare character equipment slots with an item; inspect missing/incompatible slots. Use **Add to game** to open Party setup and choose player/starting member explicitly.
4. Save and test a named scenario; verify the selected character and progression inputs in the test setup.

**Surfaces/context:** Database character detail, growth graph/table, move list, item comparison, Party setup, test scenario. Carry stable character/move IDs, imported binding names, party destination, and selected test state. Keyboard/table controls, chart values available textually; no assistant.

**Failure / cancel / recovery:** Cancel retains imported values. Default binding regeneration requires a diff; script references not proven by analysis are manual review. Mismatch warns without inventing equipment compatibility. Legacy `.gam` single `initChar` does not imply multi-party storage; native/generated setup remains conditional.

**Proposed success:** Test scenario uses intended member, bindings remain explainable, growth and unlock outcomes match configured rule inputs. **Open:** party persistence, exact legacy arithmetic, OR/unlock mapping, cross-file rename transactions. **Trace:** SC-15; T-50/T-51/T-53/T-54; [flow 04](flows/04-characters-items-database.md), [flow 08](flows/08-project-file-by-convention.md).

### F-08 — Define an item across contexts and test acquisition/shop/equipment/cancel (SC-16)

**Starting state / intent.** A potion, key, equipment piece or reward must be defined once and deliberately used in inventory, board pickup/chest, shop stock and equipment contexts.

**Paper coverage / extension.** Flow 04 distinguishes item definitions from placed Chest/Pickup Things, covers four use cards, key-item/drop behavior, Party setup, and notes shop stock is separate from price. This rehearsal tests the full path and cancellation, not just the item form.

1. Create/select item in **Database**; configure name, price, access and only intended Menu/Battle/Board/Equipment cards. Check summary sentence and linked programs.
2. From board, place a Pickup or Chest Thing and select the item reference; configure placement/activation separately from shared item definition. For a chest reward, review its persistent/run-once trigger and item contents.
3. Set up shop stock separately from item price using documented `callshop` route where supported; add starting inventory/equipment through Party setup only where provider exists.
4. Test menu/battle use and acquisition with an explicit fixture; inspect item count, equipment fit and persistence state. Try full health, an ineligible character, cancellation and removal of equipment; observe consumption and program effects rather than assuming them.

**Surfaces/context:** Database item card, board Things/instance inspector, program builder/code, shop/stock owner if available, Party setup, test scenario. Carry item ID, definition-vs-placement scope, acquisition route, price vs stock, party state and originating board.

**Failure / cancel / recovery:** Canceling picker leaves link unchanged; missing plugin/provider means the relevant card is preserved and marked unavailable, not silently dropped. A key-item flag only affects documented default-menu drop behavior; it does not invent quest rules. No assumption that price means shop stock or acquisition. Unsaved edits and failed saves remain visible.

**Proposed success:** Test proves how the selected item is acquired and used in its intended context; shared definition and placement overrides are visibly distinct. **Open:** dedicated shop editor, chest model vs trigger template, party inventory persistence and transaction semantics. **Trace:** SC-16; T-26/T-55; [flow 04](flows/04-characters-items-database.md), [flow 02](flows/02-scripts-and-blocks.md).

### F-09 — Author an enemy/status chain, tactics, rewards, and actual selected battle rules (SC-18/28)

**Starting state / intent.** A boss or enemy has moves/status chain and rewards; creator wants a fair, reproducible test under the selected battle system, not assumptions from a stock formula applied to a plugin.

**Paper coverage / extension.** Flow 06 covers enemy/move/effect/background data, encounter settings, seeded test fixture and trace; flow 09 covers provider-owned fields and specialist panels. The supplied status-effect screenshot confirms visible labels/controls: name, rounds (shown as 0), speed/slow charge, disable, HP/SMP removal (negative value restores), and program. That visual evidence confirms field visibility only, not duration semantics, charge execution, or program behavior.

1. Begin in **Effects** with Poison: name it, configure duration and health change, and inspect known uses before editing a shared effect. Do not interpret `rounds = 0` from its displayed default; obtain semantics from current authoritative docs.
2. Create/select Venom Bite from **Moves**, link Poison and its animation/program as applicable, then assign the move to an enemy. Inspect tactics, weaknesses/strengths, escape behaviour and rewards. Review the selected battle system and which fields it owns; unavailable provider data stays preserved/inspectable.
3. Configure global encounter pool and board battle allowance/skill/background separately. Confirm actual eligible rows under the documented matching rules; no invented weight or multiplier.
4. Run **Test battle** with a named party, level, seed and selected system; inspect trace. If custom rules are selected, report measured events and custom rules rather than stock formula predictions.
   Inspect application, per-round changes and removal. Repeat with reapplication and another effect present; record the selected system's actual behaviour. Return from the trace to the responsible effect/move field without losing the fixture.

**Surfaces/context:** Database records, status effect detail, plugin/system selection, global and board battle settings, test fixture/trace. Carry enemy/move/effect IDs, provider identity/version if available, party, seed, selected rules, and origin. All fields reachable by keyboard; status values named and no color-only meaning; no assistant.

**Failure / cancel / recovery:** Invalid or unsupported data is retained with a located issue; do not recast 0 rounds as infinite. Missing providers block/mark dependent tests; do not silently fall back to another ruleset. Cancel leaves definitions unchanged. Ordinary Play without recorded starting state/seed is not presented as a repeatable fixture; this does not mean the engine itself is nondeterministic.

**Proposed success:** Trace identifies the selected system, inputs and observed outcomes; the creator can follow effect → move → enemy → encounter and return to change the responsible definition. **Open design work:** selected-rule explanations, custom-rule trace support, test-to-editor return context and provider lifecycle. Verify current duration, combination, damage and outcome rules rather than copying old research's unresolved-runtime list. **Trace:** SC-18/28; T-12/T-56–T-58/T-63; session screenshot (visible-field evidence only); [flow 06](flows/06-battle-and-effects.md), [flow 09](flows/09-plugin-editors.md).

### F-10 — Audition and carry background/audio through play (SC-40)

**Starting state / intent.** A scene or battle feels wrong by ear; creator needs to audition music and effects in place, then check continuity in play.

**Paper coverage / extension.** Flow 03 places audio audition next to pickers; flow 05 ties sounds to frames; flow 06 gives battle background music and four sound roles; flow 01/07 own board audio and Play. This round follows the asset across contexts and makes no MIDI/audio compatibility claims beyond the docs.

1. From board Properties, open music/background asset picker; audition/stop/loop candidate and select. From battle Backgrounds, audition music and each labeled menu sound; inspect missing links.
2. From an animation timeline, audition the sound marker on its frame. Keep frame association distinct from board/battle loops.
3. Save, run the scene and battle through the chosen host/provider, compare expected handoff and stop behavior, and inspect Problems.

**Surfaces/context:** Board settings, audio picker/preview, animation timeline, battle background detail, runtime audio output. Carry source file, role (loop/effect/menu/frame), target context, loop/volume settings if offered, and current document. Keyboard play/stop controls and textual labels; no assistant; audio-free/null-output test path should remain available.

**Failure / cancel / recovery:** Unsupported format/host audio capability is explicit; missing audio can be skipped for a battle test but not claimed audible. Cancel leaves prior reference. Audio preview does not change the saved link. External file permission/copy failures are located; source is not silently replaced.

**Proposed success:** Creator can hear selected assets in their intended role and verify the effect in a real run when supported. **Open design work:** expose the actual project audio configuration, clearly distinguish audition from game playback, and disclose host capability limits. Check current specs for formats, SoundFont and transition semantics rather than reopening settled rules. **Trace:** SC-40; T-27/T-60/T-63/T-80; [flow 01](flows/01-board-editor.md), [flow 03](flows/03-tiles-and-art-sources.md), [flow 05](flows/05-animation-and-looks.md), [flow 06](flows/06-battle-and-effects.md), [flow 07](flows/07-project-shell-and-sharing.md).

### F-11 — Switch between visual events and code, preserve fixtures/copies (SC-17/19/20/21/37/43)

**Starting state / intent.** Creator adapts a chest/door behavior or snippet, needs a variable/state change and test fixture; common steps should not demand code, but code remains first-class and authoritative when needed.

**Paper coverage / extension.** Flow 02 covers Blocks/Code, show-as-code, ownership choice, saved fixtures, migration and reference pickers; flow 01 covers board triggers; flow 04 links item acquisition. This rehearsal connects visual event, program, fixture and copy without promising round-trip conversion or multi-document transactions.

1. Select event on a board object and open Blocks or Code. Copy/adapt an example; inspect source ownership, variables, conditions, branch ordering and item references.
2. Use **Show as code** to inspect generated lines. For handwritten edits choose import-supported edits, keep code-only, or cancel; an unsupported fragment remains exact code. Migration of older syntax shows diff and keeps original text available.
3. Duplicate chest/example behavior; choose which asset/program stays shared and which instance state becomes independent. Change required key/state and inspect reference use; do not infer every dynamic string edge.
4. Run **Test this program** with a named fixture (board, position, party, variables, inventory); inspect output and resulting state. Then test attached behavior from actual board activation.

**Surfaces/context:** Board event inspector, Blocks/Code split, Variables page, asset picker, fixture editor, Problems/debug output. Carry selected board instance, program/source ownership, generated mapping, fixture, source copy identity and return target. Full keyboard path via command palette/tree/editor; no assistant required.

**Failure / cancel / recovery:** Cancel preserves program and references. Rebuild/convert requires a diff; unsupported code is never overwritten. Missing item/board is not silently recreated; choose/create/keep unresolved. Cross-document rename/undo remains conditional; per-document review is honest fallback. Do not claim event preview proves complete gameplay.

**Proposed success:** Creator can run the intended code/blocks path from a named starting fixture, see what changed, and return to visual placement with code intact. **Open:** authoritative representation after editing, block lowering coverage, fixture format, persistent state and cross-document atomicity. **Trace:** SC-17/19/20/21/37/43; T-26/T-41/T-43–T-46; [flow 01](flows/01-board-editor.md), [flow 02](flows/02-scripts-and-blocks.md), [flow 04](flows/04-characters-items-database.md), [flow 07](flows/07-project-shell-and-sharing.md).

### F-12 — Distinguish skin from full layout; use plugin editor and handle provider/update gaps (SC-22/24/25/54)

**Starting state / intent.** Creator changes a game's interface or selects an extension; must know whether they are editing a legacy skin, a full screen/layout, or plugin-owned data, and what happens when provider is absent/updated.

**Paper coverage / extension.** Flow 02 proposes a visual screen designer; flow 09 proposes plugin contribution levels, specialist panels, layout previews, version/migration and missing-provider preservation; flow 08 covers plugin review/order. `docs/editor-features.md` T-64 is specifically a legacy window/button skin editor, not a general screen designer. This rehearsal keeps those meanings separate.

1. From **Game > Interface**, choose **Skin** (window/button graphics only) or **Screen layout** (text, images, buttons and behavior bindings, where supported). Preview representative data; layout is not battle logic.
2. Add a plugin pack and review origin, capabilities, ownership, version, host support and order; explicitly add/enable. Open its contributed fields or specialist panel only when a provider declares them.
3. If the provider is missing or update changes schema, compare affected data and migration; keep data, add provider, review migration, or cancel. Test in selected host only when actual provider/runtime exists.

**Surfaces/context:** Interface/skin editor, layout designer, plugin manager, Database extension sections, update diff, Problems, host capability panel. Carry project, selected screen/data kind, plugin owner/version/order, pending migration and originating task. Keyboard-accessible layout tree/field controls; no assistant.

**Failure / cancel / recovery:** File presence never auto-enables code. Missing plugin-owned data remains inspectable/read-only; never delete or reinterpret it. Unsupported host/panel or absent preview provider is clearly unavailable. Cancel preserves order/data; failed migration does not half-upgrade. Legacy native DLL is not presented as supported.

**Proposed success:** Creator can state whether the change is skin-only or a full layout, identify which provider owns added data, and retain that data across disable/update. **Open:** contribution API/ownership/version contract, specialist-panel hosting/trust/CSP, shared layout scope, skin semantics and provider migration. **Trace:** SC-22/24/25/54; T-14/T-45/T-64; [flow 02](flows/02-scripts-and-blocks.md), [flow 07](flows/07-project-shell-and-sharing.md), [flow 08](flows/08-project-file-by-convention.md), [flow 09](flows/09-plugin-editors.md).

### F-13 — Preserve legacy project, organize assets, and hand off the right artifact (SC-04/31/32/49/50/51/53)

**Starting state / intent.** Returning steward has a legacy/partial project; later may organize it, share editable ingredients, send a playable build, or deliver a release fix without destroying originals or player progress.

**Paper coverage / extension.** Flow 07 covers legacy import, project tree/search, preflight and export profiles; flow 08 covers hidden main file and conventions; flow 03 covers editable tileset packs; flow 10 covers source/generated ownership. This rehearsal separates legacy preservation, project/game/files navigation, source organization, pack vs game vs asset handoff, and recipient verification.

1. Start at **Open/Import project**. Select Toolkit root, explicit main/assets pair, or supported package; inspect import inventory, unresolved dependencies and conversion report before authoring. Preserve originals and stop safely if required main/plugin is absent.
2. Choose **Game**, **Files**, or both. In Game view inspect playable boards/settings and owner links; in Files view search folders/types, inspect references, source/generated labels and open text. Organize/rename only after proven/uncertain-reference review.
3. Choose output by intent: editable project handoff, curated asset pack (sources, dependencies, attribution/rights), playable Web build/distribution package, or setup ZIP where supported. Do not conflate a tileset pack, project archive, and player game. Shareable hosted link is unavailable absent a configured service.
4. Run preflight: reachable files, plugins/host support, unresolved destinations, licenses, output list and warnings. Build to a disclosed destination; keep original project and release identity distinct.
5. Open the output in a clean recipient context or host-supported test route; verify startup and representative play. For release fix, use reported state/fixture and identify exact build; do not imply save migration compatibility unless verified.

**Surfaces/context:** Welcome/import report, Game and Files navigation (separately or together), search/Problems/reference graph, pack export, Share/Export profile, preflight, recipient/test host. Carry source root/main, original-copy status, project identity, asset provenance/rights, selected output profile, recipient capability and release/version. Keyboard traversal through file tree, profile, report and destination; offline path can author/import locally, save, export/download packages and test locally where runner exists. No assistant or cloud upload required; hosted link stays unavailable when offline/unconfigured.

**Failure / cancel / recovery:** Missing Toolkit main asks for it instead of guessing; unsupported plugin/data stays listed and preserved. Uncertain dynamic references block “safe rename/delete” certainty. Rights are not inferred from file presence. Export cancel leaves source project unchanged; failed/partial build is not called complete. Host/runner capability gaps are named; recipient test records what was not checked.

**Proposed success:** Original remains untouched; creator can explain the difference between editable project, asset pack and playable build; preflight output reaches the named recipient path and a clean-open/play check records actual limitations. **Open:** import rollback/report contract, native project/pack format and rights metadata, hosted publishing service, host compatibility matrix, recipient test automation and save compatibility. **Trace:** SC-04/31/32/49/50/51/53; T-03–T-07/T-70–T-74/T-82; [flow 03](flows/03-tiles-and-art-sources.md), [flow 07](flows/07-project-shell-and-sharing.md), [flow 08](flows/08-project-file-by-convention.md), [flow 10](flows/10-tile-making-without-the-grind.md).

## Cross-cutting checks

- **Accessible route:** Each flow must be completable without pointer-only actions: visible focus, keyboard navigation and activation, labelled controls, keyboard-reachable canvas/timeline operations, non-color cues, and text equivalents for charts, previews, and diagnostics. Pointer gestures may speed work but are not the only path. Screen-reader labels expose selection, type, dirty state, warning/error and scope. These are proposed checks, not claims of conformance.
- **Offline/no-assistant route:** Core authoring, local references, save, import from local files, diagnostics, local test where runner exists, and downloadable package/export should not require an assistant or account/network service. If a feature genuinely needs a provider, network, or host capability (plugin UI, external editor, hosted link), label that dependency and leave the ordinary no-assistant route intact where possible. Never fabricate generated guidance or hidden cloud behavior.
- **Context continuity:** Preserve subject, source/instance scope, selected asset/field, pending edits, test origin and return destination across specialist editors. Context changes presentation/focus, not field meaning or storage ownership. Shared-vs-local is visible; missing local storage must not masquerade as a local override.
- **Cancellation and recovery:** Every import, conversion, migration, provider update, shared edit, replacement and export offers a clear cancel before irreversible action. State host guarantees accurately; undo, drafts, atomicity and multi-document recovery remain conditional when not specified.
- **Evidence:** All action/results above are paper proposals. A later study should record completion, error detection, cancel/recovery, keyboard path, and whether creator can accurately explain actual scope/provider—not preference claims from synthetic personas.

## Prototype checks: Code-based vs custom shell

Compare the same tasks in a **Code-based** host and a **custom shell** prototype; this is an evaluation plan, not a host decision. Begin with F-09, F-04, F-01 and F-13 as proposed in the engagement map, then add F-06/F-11 for visual and code-specific stress. Use the same project snapshot and tasks across hosts, plus a keyboard-only run and an offline/no-assistant run.

- **Code-based prototype:** test project/workspace open, Game/Files navigation, existing editor tabs, focus restoration, file search/open-as-text, keyboard shortcuts, extension/provider availability, external file conflict, save failure behavior, and export destination/capability reporting. VSCodium/Code-OSS is only a candidate; make no claim that it supplies the required editor host APIs until checked.
- **Custom-shell prototype:** test whether game-oriented entry and direct visual manipulation reduce setup ambiguity while preserving the Files view, code-first entry, project transparency, and equivalent keyboard access. Check whether adding shell navigation creates duplicate document instances or divergent save/undo state.
- **Compare evidence:** task completion and recovery, steps to find the owning surface, lost/duplicated context, discoverability of cancel/undo, accessibility blockers, host capability gaps, and ability to distinguish proposed preview from real execution. Do not choose by aesthetics or assume either prototype implements current proposals.

## Key source files

- [Creator scenario inventory](creator-scenario-inventory.md)
- [Creator journey workspace rehearsal](creator-journey-workspace-rehearsal.md)
- [Editor feature inventory](../../../docs/editor-features.md)
- [Board editor flow](flows/01-board-editor.md)
- [Program editor and blocks flow](flows/02-scripts-and-blocks.md)
- [Tiles and art sources flow](flows/03-tiles-and-art-sources.md)
- [Characters and items flow](flows/04-characters-items-database.md)
- [Animation and looks flow](flows/05-animation-and-looks.md)
- [Battle and effects flow](flows/06-battle-and-effects.md)
- [Project shell and sharing flow](flows/07-project-shell-and-sharing.md)
- [Project file by convention flow](flows/08-project-file-by-convention.md)
- [Plugin-defined editors flow](flows/09-plugin-editors.md)
- [Tile-making flow](flows/10-tile-making-without-the-grind.md)
- Session-provided status-effect screenshot (visible labels only; no execution evidence)
