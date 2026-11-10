# Repeated RPGCode: possible missing capabilities

**A repetition is a lead, not a specification.** A frequently repeated command may be a perfectly adequate built-in. Repeated surrounding setup, conditions, data literals and cleanup are more useful evidence of a missing property, reusable action, authoring affordance or abstraction. Narrative variation is not boilerplate merely because it uses the same commands.

## Screening method

The census screens standalone `.prg` source and candidate embedded hooks without executing either. It masks documented comments and double-quoted strings, counts call-shaped names, and hashes the remaining text after whitespace normalization. String contents are intentionally removed for the structural fingerprint; numbers, names and ordering remain. The fingerprint is **not semantic equivalence**. It does not prove which functions are built-ins, distinguish every declaration from a call, cover all TK2 trailing-comment quirks or unquoted arguments, or establish runtime reachability.

The source-file hash and origin in [assets.jsonl](data/assets.jsonl) identify the original bytes. [scripts.jsonl](data/scripts.jsonl) records each screen's field, source kind, line count, call candidates and exact/normalized decoded-text hashes. The decoded-text digest is UTF-8 after Windows-1252 decoding; it is not the raw asset-byte digest. Shared templates and duplicate library files are **not independent game-design votes**.

## Findings checked against source examples

| Pattern | Observed evidence | Candidate capability | Confidence and limit |
|---|---|---|---|
| Pickup/reward ceremony | Twelve Chimeran Empire programs share a structural fingerprint: sound, message, wait, then item grant. `Give Apple.prg` and `Give Potion.prg`, lines 1–4, differ in item/message strings. | A reusable reward/pickup action with item/quantity, feedback and activation policy; a creator-facing preset may suffice without a new core primitive. | **Strong template evidence within one game.** `giveItem` already exists. One-shot persistence is not implemented by those four lines; inspect the owning board condition before claiming it is part of the script. |
| Chest grants with presentation | Final Destiny `Basic Armor chest.prg`, lines 2–5: item grant, message, sound, then `system.pause`. Four screened programs across Final Destiny and JoD3 share a related structural fingerprint. | Same reward construction, but ordering/wait policy must remain explicit rather than normalizing all pickups to one order. | **Strong small-pattern evidence; weak independence.** Some games reuse templates. Source line 1 identifies the board, not a portable persistent identity. |
| Stateful pickup/empty appearance | Chickit Hunt `Get medikit.prg`: condition branches, pickup/empty animations and five repeated grants of the same item. | Declarative reward quantity plus a persistent interaction state and visual-state binding. | **Candidate from a concrete example**, not a claim that its legacy comparison/assignment spelling is correct. Imported behavior needs dialect-aware verification; do not silently repair it while converting data. |
| Dialogue ceremony | Mystical Quest has an 11-member fingerprint group with include, message-window clear, one message and pause; a second 10-member group has two messages. | A conversation/interaction resource or editor action that owns text and standard presentation while permitting conditions and hooks. | **Structural-screening lead.** It does not prove every line is dialogue rather than a sign, tutorial or scripted scene. Reusing a function may be enough. |
| Inn/service plus story events | Chimeran Empire `Inn 3.prg`, lines 1–27, combines a price/prompt/payment/rest sequence; lines 28–69 add a bespoke dream sequence and staging. `Inn 1.prg` and `Inn 2.prg` have related service setup but different story content. | A rest/service action with configurable price, destination and hooks. Keep the dream sequence as authored behavior, not a giant collection of inn properties. | **Strong boundary example.** `inn()` already supplies restoration. The proposed improvement is reusable surrounding authoring/data, not a claim that healing is missing. |
| Wander/intercept | Demo `man_wander.prg`, lines 11–49, defines range and intercept distance, observes player/item locations, waits for path movement, rechecks the target, chooses random movement and sleeps. | A reusable behaviour with range/proximity parameters and an event hook, attached to an actor. | **Concrete but single-example evidence**, not a repeated corpus pattern. Its relative wandering, rectangular proximity test and post-move recheck matter; a generic radius/chase toggle would not automatically be equivalent. |
| UI/minigame programs | Several Crystal Immortality programs exceed 1,000 lines; its menu and bar-fight programs are among them. | Investigate reusable UI/action constructs and authoring tools separately from actor schema. | **Size is only a lead.** No conclusion that a long custom game should be turned into an item property. |

## Association matters more than frequency alone

To assign a pattern to an asset type, follow the incoming declared-field relationship in [relationships.jsonl](data/relationships.jsonl): an item activation hook, a board trigger, a character level-up hook and an enemy AI hook have different context even when their scripts contain the same command. Script-literal edges are weaker evidence than explicit stored references. A common `giveItem` call does not mean the script belongs inside the item; it may be a chest's reward, a quest outcome or initial party setup.

The field catalogue already exposes useful partial declarative support: item menu/battle HP and SMP amounts, equipment bonuses, status duration and periodic effects, character move eligibility, and board activation/loading conditions. Before proposing a new feature, ask whether a usable existing field is hidden, too narrow, or needs a better editor workflow.

No repeated item-grants-skill idiom was established in this pass. That remains an owner-requested design possibility, not a corpus-derived claim. Dynamic RPGCode can express relationships that this screen does not discover; lack of a named call or file field is not evidence of impossibility.

## Preventing a false inference about inline code

An initial punctuation screen incorrectly treated three Chickit Hunt program references as embedded source. Direct decoding showed filenames: `HERE COME THE ARMY(INTRO).prg`, `#swipecard!=1.prg`, and `attackall (70).prg`. The corrected helper leaves these as unresolved file candidates. The three demo snippets remain inline candidates and were inspected as actual `send`/`itemPath` source.

This correction is tracked in [#1773](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1773). It is a research-classifier fix, not a change to legacy runtime fallback. It also illustrates the reason to make inline/file source explicit in a native contract.

## Promotion rule for a new property or feature

A candidate should show multiple real examples where possible, the owning logical object/event, which values vary, existing primitives that already do part of the job, and the exact behavior that must remain programmable. Then choose the smallest useful intervention: editor preset, reusable RPGCode function/behaviour, declarative property/relation, or core capability. Check wait/order, state lifetime, save identity and compatibility before promoting it.

Do not auto-rewrite scripts based on these fingerprints. They are a research aid, not a migration equivalence proof.

## Key source files

- [Field catalogue](fields-actors.md), [world/program sites](fields-world-project.md#program-bearing-fields-evidence-and-ambiguity), [candidate constructions](candidate-constructions.md).
- [Raw-byte provenance](data/assets.jsonl), [script screens](data/scripts.jsonl), [reference candidates](data/relationships.jsonl).
- [Program text forms](../../spec/formats/rpgcode-program.md#text-form), [language lexical rules](../../spec/engine/rpgcode-language.md#lexical-rules), [older dialects](../../spec/engine/rpgcode-dialects.md).
- External game-data examples named above remain in Ludotheque and the fetched demo. Their paths and SHA-256 digests are in the asset ledger; no game source is copied into this research package.
