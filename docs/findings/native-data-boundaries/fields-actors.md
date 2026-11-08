# Field catalogue: actors, items and battle actions

This is an inventory of documented **physical** fields, not a proposed schema or a census. `short` is signed 16-bit, `int` signed 32-bit, strings and colours follow the [format conventions](../../spec/formats/README.md#primitive-encoding); UB means last index, so UB + 1 entries, and −1 can mean none. Where an old sample lacks a field this does not establish that the family cannot carry it. See the sources for full storage order and conversions.

## Character `.tem`

| Stored field(s) | Type, ownership and distinctions |
|---|---|
| `header`, `major`, `minor` | string, short, short; version selects layout. |
| `name` | string; display name. |
| `experienceVar`, `defenseVar`, `fightVar`, `healthVar`, `maxHealthVar`, `nameVar`, `smVar`, `smMaxVar`, `levelVar` | strings naming script globals; these are references, not the stat values themselves. |
| `experience`, `health`, `maxHealth`, `defense`, `fight`, `sm`, `smMax`, `level` | eight ints, starting values. |
| `profilePic` | image or tile reference string. |
| special-move slots: `file`, `minExp`, `minLevel`, condition variable, required value | 201 records; string `.spc` reference, two ints, two strings. Slot 0 exists physically; editor uses 1–200. Eligibility belongs to this character's relationship to the move. |
| `specialMoveName`, `smYN` | string menu label; byte where 0 means moves available, 1 none. |
| accessory slot names; armour slot used | 11 strings and seven bytes; editor uses 1–10 and 1–6 respectively. Armour names: head, neck, left hand, right hand, body, legs. |
| `levelType`, `experienceIncrease`, `maxLevel`, `levelHp`, `levelDp`, `levelFp`, `levelSm`, `levelUpType` | first threshold int (byte in minor 3), increase short, maximum int, four short stat increments, mode byte (0 percentage, 1 fixed); progression values and formulas are distinct. |
| swipe, defend, special, die sounds; `levelUpProgram` | four legacy ignored strings only below minor 5; level-up program string is separately stored. |
| `sizeType` | legacy byte, 0 = 32×32, 1 = 64×32. |
| walk animations; FIGHT, DEFEND, SPECIAL MOVE, DIE, REST animations; unused string | minor ≥5: eight direction references in S, N, E, W, NW, NE, SW, SE order, five battle stances, then one empty/reserved string. |
| idle animations, `idleTime`, `speed` | eight strings from minor 6; doubles from minor 7, seconds before idle then seconds/frame, defaults 3.0 and 0.05 when absent. |
| custom stance UB, `(animation, name)` | int UB and string pairs from minor 5; both must be non-empty to keep a stance. |
| vector count, collision polygon, activation polygon | minor ≥8: ignored short vector count, then for each polygon short point UB and int `(x,y)` pixel pairs relative to bottom-centre. Earlier files get defaults, including different isometric bases. |

Binary <5 instead stores 16 walking upper/lower tile pairs, 64 interleaved fight/defend/special/death battle tiles, four rest tiles and ten upper/lower custom pairs after size type. Text forms can instead embed pixels; text minor 0 omits size type, minor 1 and ≥2 differ in battle grids. Character text has no item-style `-2` empty-picture marker. Minor 3/4 residual bytes and one unusual size byte are unresolved, not invented fields. [Character layout](../../spec/formats/character.md#layout); [binary variants](../../spec/formats/legacy/older-binary-versions.md#character-before-minor-8); [text character](../../spec/formats/legacy/text-formats.md#character).

## Item `.itm`

| Stored field(s) | Type, ownership and distinctions |
|---|---|
| `header`, `major`, `minor`, `itemName`, `description` | string, short pair, two strings; name is script/inventory handle. |
| `equipYN`, `menuYN`, `boardYN`, `fightYN`, `usedBy` | five bytes; capabilities and eligibility policy; `usedBy` selects any character or listed characters. |
| allowed characters | 51 strings; slot 0 physically present, editor uses 1–50. |
| `buyPrice`, `sellPrice`, `keyItem` | two ints (short before minor 3), byte. Key item is a flag, not an engine-enforced rule. |
| equip slots, `accessory` | eight bytes (editor uses 1–7: head, neck, left hand, right hand, body, legs, accessory); named accessory slot string. |
| `equipHP`, `equipDP`, `equipFP`, `equipSM`; `prgEquip`, `prgRemove` | four ints and two program strings; stat values are shorts before minor 3. |
| `menuHP`, `menuSM`, `prgMenuUse`; `fightHP`, `fightSM`, `prgFightUse` | each pair is two signed ints (shorts before minor 3) and a program string; menu and battle are separate actions. |
| `animation` | one string shared by held and battle animation, not two independent physical fields. |
| `prgOnBoard`, `prgPickUp` | program strings: continuous board default and activation default; board placement can override them. |
| `sizeType`, walk animations, rest animation, unused string | byte; from minor 4 eight direction references, deprecated rest reference, reserved string. Before minor 4: 16 upper/lower walking tile pairs and two rest tile strings instead. |
| idle animations, `speed`, `idleTime` | minor ≥5: eight strings, seconds/frame double then idle seconds double. Before minor 6 rest becomes south idle; defaults 0.05 and 3 seconds when absent. The speed/idle order is opposite `.tem`. |
| custom stance UB and `(animation, name)` | int UB, string pairs, minor ≥4. |
| vector count, collision polygon, activation polygon | minor ≥7 ignored short count; two short point UBs with int pixel coordinate pairs; earlier files get character/item default polygons. |

Text items use seven equipment flags and 50 allowed characters without binary padding slots; their graphics can be tile references or 17 pixel images, each represented by `-2` for empty or 1024 pixel values. [Item layout](../../spec/formats/item.md#layout); [older items](../../spec/formats/legacy/older-binary-versions.md#item-before-minor-7); [text item](../../spec/formats/legacy/text-formats.md#item).

## Enemy `.ene`

| Stored field(s) | Type and role |
|---|---|
| `header`, `major`, `minor`, `name` | string, two shorts, string; binary minor 1; text minor 0. |
| `hp`, `smp`, `fp`, `dp` | ints; HP and SMP are both starting and maximum values. |
| `canRun`, `takeCrit`, `giveCrit` | byte and two shorts; critical chances are 1 in N. |
| special moves, weaknesses, strengths | each short UB and string references to `.spc`; strength list exists even without an editor UI. |
| `ai`, `useCode`, `prg` | two bytes and program string; `useCode` selects custom AI over built-in level. |
| `exp`, `gp`, `winPrg`, `runPrg` | two int rewards and two program strings for defeat and escape. |
| animations UB and entries | short UB and strings; REST, FIGHT, DEFEND, SPECIAL MOVE, DIE, spare. |
| custom stance UB, `(animation, name)` | editor writes int UB and string pairs; original readers use short and reversed names, a documented incompatibility. |

Text adds width and height in tiles and a fixed 19×7 tile grid, 101 interleaved `(special move, weakness)` pairs, four ignored sound-like lines and four battle-animation strings; no strength list or custom stance in that layout. [Enemy layout](../../spec/formats/enemy.md#layout); [text enemy](../../spec/formats/legacy/text-formats.md#enemy).

## Special move `.spc` and status `.ste`

| Family | Stored field(s) | Type and role |
|---|---|---|
| `.spc` | header, major, minor, `name` | string, short pair, string. |
| `.spc` | `fp`, `smp`, `prg`, `targetSmp` | int target HP subtraction, int user SMP cost, program string, int target SMP subtraction; signed values matter. |
| `.spc` | `battle`, `menu` | bytes; 0 usable, 1 not usable. Separate surfaces; editor load checkbox disagrees with save semantics. |
| `.spc` | `statusEffect`, `animation`, `description` | strings: `.ste` reference, `.anm` reference, description. |
| `.ste` | header, major, minor, `name` | string, short pair, string. |
| `.ste` | `rounds`, `speed`, `slow`, `disable` | shorts: duration, faster/slower charge flags, frozen-action flag. |
| `.ste` | `hp`, `hpAmount`, `smp`, `smpAmount`, `code`, `prg` | five shorts and program string; two flags and signed periodic quantities, then per-round code flag/reference. |

Binary minors 2–3 and text minor 0 are documented; text `.ste` layout is not verified against a real corpus file. No occurrence is not proof of unsupported capability. [Battle data](../../spec/formats/battle-data.md); [text status and move](../../spec/formats/legacy/text-formats.md#status-effect).

## Candidate declarative opportunities — not existing fields or approved schema

When corpus investigation finds substantial repeated RPGCode around an asset, inspect whether the repetition expresses a missing reusable property or relationship rather than assuming code is the only authoring surface. Candidates grounded in the fields above include **item-granted skills** (distinct from a character's stored move eligibility and menu label), richer **conditional activation** (alongside board condition variables), **stat effects** (alongside item bonuses and status amounts), and contextual **animation bindings** (alongside stance and action references). These are questions for real examples, not claims that these exact fields exist today or that the scripts observed necessarily implement them.

Declarative features would complement rather than automatically replace RPGCode: preserve inline or separately referenced code, its scope and location where behavior still needs it. Inheritance versus composition and physical grouping remain open.

## Key source files

- [Character](../../spec/formats/character.md), [item](../../spec/formats/item.md), [enemy](../../spec/formats/enemy.md), [battle data](../../spec/formats/battle-data.md).
- [Legacy text layouts](../../spec/formats/legacy/text-formats.md), [older binaries](../../spec/formats/legacy/older-binary-versions.md), [conversion](../../spec/formats/legacy/conversion.md).
