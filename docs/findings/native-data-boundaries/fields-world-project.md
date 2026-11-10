# Field catalogue: project and world

Documented disk fields, not a native schema or corpus frequency claim. `short` = signed 16-bit, `int` = signed 32-bit; UB is an upper bound, with UB + 1 entries. Lists below describe storage; normalized defaults and runtime-generated objects are labelled separately. Sources preserve exact order and version dispatch.

## Main game `.gam`

| Stored field(s) | Type, role and conditions |
|---|---|
| `header`, `major`, `minor`, `registered`, registration code | string, three shorts, string; registration fields ignored, editor writes 1 and `NOCODE`. |
| `projectPath`, `gameTitle`, `mainScreenType`, `extendToFullScreen`, `mainResolution` | strings then three shorts; path is project location, title is window title, screen type ignored, fullscreen flag, resolution enum (0 640×480, 1 800×600, 2 1024×768, otherwise custom). |
| unused short, `mainDisableProtectReg`, language file | unused short only minor <3; protection short and language string ignored. |
| `startupPrg`, `initBoard`, `initChar`, `runTime`, `runKey`, `menuKey`, `key` | four strings for startup program, initial board, initial character and keyed runtime program; three short ASCII key codes. |
| runtime keys UB and `(key, program)` | short UB, pairs short ASCII code/string; editor writes 51 slots, empty programs ignored. |
| `menuPlugin`, `fightPlugin`; unused fields | strings from minor 3; older form instead contains a discarded short, plus discarded int and short for minor ≤2. |
| `fightGameYn`, enemy list UB and `(enemy, skill)`, `fightType`, `chances`, `fprgYn`, `fightPrg` | shorts for enabled-inverted flag, UB, skill and encounter mode; enemy/program strings; int chance denominator or step count; short custom-battle flag. Editor stores 501 enemy slots. |
| unused short, `gameOverPrg`, `skinButton`, `skinWindow` | unused before minor 3; program string; two ignored legacy skin strings. |
| plugin list UB and entries | short UB; minor ≤2 uses short enabled flags for numbered DLLs; ≥3 uses strings. These are legacy names, not the native extension package list. |
| `mainUseDayNight`, `mainDayNightType`, `mainDayLength` | two shorts, int minutes; stored, not implemented by legacy runtime. |
| `cursorMoveSound`, `cursorSelectSound`, `cursorCancelSound`, `useJoystick`, `colorDepth` | three media strings, two bytes, minor ≥3. |
| `gameSpeed`, `pixelMovement` | bytes from minor 4; speed storage bias differs before minor 8; absent defaults 0. |
| cursor enabled; `mouseCursor`, `hotSpotX`, `hotSpotY`, `transpColor` | minor 5 byte only; from 6 image/built-in-cursor string, two pixel bytes and colour; old missing cursor defaults to built-in. |
| `resX`, `resY`, `bFpsInTitleBar` | two int pixel dimensions from minor 7; byte from minor 8. |
| `pfHeuristic`, `drawVectors`, `pathColor`, `movementControls`, `movementKeys` | minor ≥9: short mode, int debug bit mask, colour, int control bit mask, eight short DirectInput scan codes in E, SE, S, SW, W, NW, N, NE order. Absent defaults are documented in source. |

**Native extension blocks**, optional and physically independent after legacy rows: `TKRPLUG\0` marker, u16 count and ordered NUL-terminated package-name strings; `TRKAUD\0` marker, u16 track count, ordered `(track name string, voice count u16)`, u16 voice cap, u8 font-present and optional SoundFont AssetKey string; `TRKINP\0` marker, u8 schema, u8 controller enabled, u16 action count, ordered action name string, u8 flags, u16 control count and control ID strings. Blocks may occur independently in that order; unrecognized trailing bytes are opaque residue. Decoder `audioSettings` and `inputSettings` are nullable model properties, not physical fields with null bytes. Native packages and legacy plugin fields are not derived from each other. [Main layout and blocks](../../spec/formats/main-file.md#layout).

Toolkit 2 text also stores ignored built-in-menu, multitask-speed, memory-protection, fighting-style, target-platform and parallax values; fixed 501 enemy and 51 key records; its tail from fullscreen onward can be absent. Its plugin count/flag discrepancy remains open. Toolkit 1 separately stores a fight-file name and character run key; the fight file has 251 enemy/skill pairs. [Legacy main](../../spec/formats/legacy/text-formats.md#main-file-toolkit-2-text).

## Board `.brd`, vector layout

| Stored field(s) | Type, role and distinctions |
|---|---|
| header, major, minor; `sizeX`, `sizeY`, `sizeL`, `coordType` | header string, version shorts, four shorts: logical tile dimensions, layer count and grid/coordinate flag. Rotated isometric tile and shade streams use an effective square grid, not the logical dimensions directly. |
| tile LUT UB and entries; tile stream | short UB and strings (tile references, `.tan` allowed), then short cell indices and run records. UB −1 means no table; existing index 0 is empty, and empty unused slots retain indices. |
| shade UB; each layer and cells | short UB; per layer int top layer and runs of four shorts `(count,r,g,b)`, signed RGB offsets. |
| light UB; each `layer`, `type`, nodes UB and `(x,y)`, colours UB and `(r,g,b)` | short UBs, int layer/type and pixel node coordinates, short signed colour components. Lights are editable source objects; runtime bakes them into shading. |
| vector UB; each point UB and `(x,y)`, `attributes`, `closed`, `layer`, `type`, `handle` | short UBs, int pixel points, four shorts, optional string; type distinguishes solid, under, deprecated one-way, stairs and waypoint; attributes depend on type. |
| program UB; each `file`, `graphic`, `initialVar`, `initialValue`, `finalVar`, `finalValue`, `activate`, `activationType`, `distanceRepeat`, `layer`, point UB, `(x,y)`, `closed`, reserved | short UBs; strings for program, graphic, condition and assignment; shorts for flags, pixel repeat distance and layer; int pixel points; short closed and reserved string. `file` can be an external program or inline source when no matching file exists. Empty program slots persist. |
| item UB; each `file`, `prgActivate`, `prgMultitask`, `initialVar`, `initialValue`, `finalVar`, `finalValue`, `loadingVar`, `loadingValue`, `activate`, `activationType`, `x`, `y`, `layer`, reserved | short UB; `.itm` and program/condition strings, shorts for activation, pixel position and layer, reserved short (editor writes −1). This is placement and override data, distinct from item definition; stored empty slots and runtime-compacted numbering differ. |
| image UB; each `file`, `x`, `y`, `layer`, `type`, `transpColor`, reserved | short UB, image string, int pixel top-left, short layer and drawing type, colour, reserved short (100). Dimensions come from referenced image, not the board. |
| thread UB and entries; constant UB and entries | short UBs and strings; thread strings can name program or inline code; constants are script-readable strings. |
| layer titles, links | `sizeL + 1` strings with unused index 0; four strings N, S, E, W, referring to a board or program. |
| background image, background image type, `bkgColor`, `bkgMusic`, `enterPrg` | string, int, colour, two strings; image/media/program references. |
| `battleBackground`, `battleSkill`, `bAllowBattles`, `bDisableSaving` | background reference string and three shorts. |
| ambient `r`, `g`, `b`, `startX`, `startY`, `startL` | six shorts; signed whole-board RGB, start pixels and layer; nonpositive start axes default individually to 64, layer to 1. |

[Board layout](../../spec/formats/board.md#vector-layout-minor-4-and-later) also specifies flag meanings and storage order. Pre-vector binary minors 2–3 instead physically store registration pair; dimensions and start in **tiles**; disable-saving; LUT and tile records `(index,r,g,b,tiletype)`; background, foreground, border image and two colours; ambient preset; links; battle skill/background/flag; day/night flag, night battles, night skill/background; 11 numeric short constants; music; nine titles; program and item records with tile coordinates and different string order; enter program plus reserved string; optional minor-3 int thread UB and strings; and conditional trailing byte `coordType`. Their converted vectors, synthesized trigger areas and decimal-string constants are decoder/conversion results, not stored fields. [Pre-vector details](../../spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector).

Toolkit 2 text stores eight fixed layers with `(tile name, red, green, blue, tile type)` per cell; background/border images and colours; ambient preset; N/S/E/W links; battle skill/background/flag; ten numeric constants and music; eight layer titles; 51 fixed program records `(file, x, y, layer, graphic, activation mode, activation variable, end variable, initial value, end value, activation type)`; 11 fixed item records `(file, x, y, layer, activate, initialVar, finalVar, initialValue, finalValue, activationType)`; start x/y/layer; 11 item activation programs; save flag; 11 multitask programs; and an optional four-field day/night tail `(flag, night battle override, night skill, night background)`. Minor 0 defaults to 19×11 without stored dimensions. [Text board](../../spec/formats/legacy/text-formats.md#board-toolkit-2-text).

## Program-bearing fields: evidence and ambiguity

`.gam`: `startupPrg`, `runTime`, runtime-key programs, `fightPrg`, `gameOverPrg`. `.brd`: trigger `file`, item `prgActivate`/`prgMultitask`, threads, `enterPrg`, and edge links that may instead name a program. `.tem`: `levelUpProgram`. `.itm`: `prgEquip`, `prgRemove`, `prgMenuUse`, `prgFightUse`, `prgOnBoard`, `prgPickUp`. `.ene`: `prg`, `winPrg`, `runPrg`. `.spc` and `.ste`: `prg`. In particular, the program page explicitly documents file-or-inline resolution for board programs, board threads and script `Thread()`; the other field descriptions identify programs but do **not** individually settle identical fallback behavior. A missing file can therefore be ambiguous with source where that fallback applies. Do not infer that programs must be extracted into files. Source path, scope and debug location need preservation if a future logical representation distinguishes inline source from a reference; a tagged inline/reference construction is a candidate, not an approved schema. [Program text](../../spec/formats/rpgcode-program.md#text-form).

## Key source files

- [Main file](../../spec/formats/main-file.md), [board](../../spec/formats/board.md), [program](../../spec/formats/rpgcode-program.md).
- [Older binary layouts](../../spec/formats/legacy/older-binary-versions.md), [legacy text](../../spec/formats/legacy/text-formats.md), [format conventions](../../spec/formats/README.md).
