# Item (`.itm`)

An item: inventory behaviour (equip, use from the menu, use in battle), prices, which characters may use it, and — because items can also be placed on boards as walking sprites — animations, programs and collision polygons. Items live in `Item\`.

**TKR engineering rule (#589).** The `usedBy` and allowed-character fields retain their stored format meaning below and constrain equipment eligibility. The [menu-use action](../engine/plugins-and-battle.md#epic-85-item-action-proposal) deliberately does not apply that restriction to its party target; battle targeting follows its own rules. This is an engine decision, not a change to the file format or an additional owner ruling.

Header text: `RPGTLKIT ITEM`. Newest minor: **7**. No minimum version; the engine converts minor < 4.

**Accepted `minor`: 0-7 — Reawakened rule.** The conditional rows above span that range (`i32` prices at `minor ≥ 3`, movement at `≥ 4`, idle and speed/idleTime at `≥ 5`, bases at `≥ 7`, legacy walk frames at `minor < 4`), so a reader accepts 0-7 and refuses `minor` 8 or higher and a negative version field rather than guessing a neighbouring layout ([README.md](README.md#header-and-version)); the 2.x **text** form is a separate layout in [legacy/text-formats.md](legacy/text-formats.md#item). <!-- OWNER: chose 0–7 for §6.2 (the range the conditional rows span and the reader hard-codes) over 3–7, because the minor<4 legacy walk-frame row is part of the layout and must be addressable. -->

## Layout

| # | Field | Type | Present when | Meaning |
|---|---|---|---|---|
| 1 | header | string | | `RPGTLKIT ITEM` |
| 2 | major, minor | short, short | | |
| 3 | itemName | string | | name / handle used by scripts and the inventory |
| 4 | description | string | | one line |
| 5 | equipYN, menuYN, boardYN, fightYN | byte × 4 | | 0/1: can be equipped, used from the menu, placed on boards, used in battle |
| 6 | usedBy | byte | | 0 = any character, 1 = only those listed in field 7 |
| 7 | × 51 allowed character | string | | slots 0..50; the editor uses 1..50 |
| 8 | buyPrice, sellPrice | int × 2 (short × 2 if minor < 3) | | |
| 9 | keyItem | byte | | 1 = key item (a flag for menus and plugins; the engine itself attaches no rule to it) |
| 10 | × 8 equip slot | byte | | slots 0..7 (0/1); the editor uses 1..7: head, neck, left hand, right hand, body, legs, accessory |
| 11 | accessory | string | | accessory slot name it fits |
| 12 | equipHP, equipDP, equipFP, equipSM | int × 4 (short if minor < 3) | | stat bonus while equipped |
| 13 | prgEquip, prgRemove | string × 2 | | programs run when equipped / removed |
| 14 | menuHP, menuSM | int × 2 (short if minor < 3) | | HP / SMP change when used from the menu (negative reduces) |
| 15 | prgMenuUse | string | | program run when used from the menu |
| 16 | fightHP, fightSM | int × 2 (short if minor < 3) | | HP / SMP change on the target in battle |
| 17 | prgFightUse | string | | program run when used in battle |
| 18 | animation | string | | one field shared by "animation when held" and "battle animation" |
| 19 | prgOnBoard | string | | default program run continuously while the item is on a board |
| 20 | prgPickUp | string | | default program run when the player activates it on a board |
| 21 | sizeType | byte | | legacy (0 = 32×32, 1 = 64×32); ignored |
| 22 | walk animations × 8 | string | minor ≥ 4 | order **S, N, E, W, NW, NE, SW, SE** |
| 23 | rest animation | string | minor ≥ 4 | deprecated; for minor < 6 it becomes the south idle animation |
| 24 | (unused) | string | minor ≥ 4 | |
| 25 | idle animations × 8 | string | minor ≥ 5 | |
| 26 | speed | double | minor ≥ 5 | seconds per frame — **speed first, then idleTime (characters store the opposite order)** |
| 27 | idleTime | double | minor ≥ 5 | seconds before idling |
| 28 | custom stance UB | int | minor ≥ 4 | |
| 29 | × (UB+1): animation, name | string, string | minor ≥ 4 | |
| 30 | vector count | short | minor ≥ 7 | the editor writes 1; ignored |
| 31 | collision polygon: points UB; points | short; (int x, int y) × (UB+1) | minor ≥ 7 | as for characters |
| 32 | activation polygon: points UB; points | short; (int x, int y) × (UB+1) | minor ≥ 7 | |
| 22′ | walk tiles × 16 × 2, rest tiles × 2 | string × 34 | minor < 4 | legacy tile names (order: frame 0..15 outer, upper/lower tile inner), instead of fields 22-29 |

Items with minor < 7 get the default polygons described in [character.md](character.md#defaults-and-fall-backs).

## Board items vs inventory items

When an item is placed on a board, the board entry ([board.md](board.md#items-placed-on-the-board-sprites)) supplies its position and can override `prgOnBoard`/`prgPickUp`; the item file supplies the sprite (animations, speed, polygons). In the inventory only fields 3-18 matter.

## Older versions

Items before minor 7 are covered in [legacy/older-binary-versions.md](legacy/older-binary-versions.md#item-before-minor-7). Minor < 4 items store tile names instead of animations (row 22′); both original programs convert them, writing tile bitmaps and animations ([legacy/conversion.md](legacy/conversion.md#items)). Text items are in [legacy/text-formats.md](legacy/text-formats.md#item).

## Example

[../examples/listings/chest.itm.txt](../examples/listings/chest.itm.txt) — a complete minor-7 item built by the example generator.
