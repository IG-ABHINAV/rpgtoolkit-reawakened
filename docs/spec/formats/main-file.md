# Main game file (`.gam`)

One per game. It holds the game-wide settings: title, the first program, board and character, key bindings, the random-encounter table, plugins, display mode, game speed and movement options. The engine reads it once at start-up and again when a saved game is loaded. It lives in the Toolkit's `Main\` folder, **outside** the project folder, and its `projectPath` field says where the project is. Inside a PAK archive it is `main.gam` at the archive root.

Header text: `RPGTLKIT MAIN`. Newest minor: **9** (Toolkit 3.1.0). The editor always writes every field of minor 9.

## Layout

Types and conventions are defined in [README.md](README.md#primitive-encoding). "UB" = upper bound (entries = UB + 1).

| # | Field | Type | Present when | Meaning and values |
|---|---|---|---|---|
| 1 | header | string | always | `RPGTLKIT MAIN` |
| 2 | major | short | always | 2; ignored |
| 3 | minor | short | always | selects which fields follow |
| 4 | registered | short | always | legacy shareware flag; the editor writes `1`; ignored |
| 5 | registration code | string | always | the editor writes `NOCODE`; ignored. See the alignment note below. |
| 6 | projectPath | string | always | project folder relative to the Toolkit folder, with trailing `\`, e.g. `Game\demo\`. Ignored when running from a PAK. |
| 7 | gameTitle | string | always | window title |
| 8 | mainScreenType | short | always | historic display API choice; new projects store 1; **ignored** by the engine |
| 9 | extendToFullScreen | short | always | 0 windowed, 1 full screen |
| 10 | mainResolution | short | always | 0 = 640×480, 1 = 800×600, 2 = 1024×768, any other value (the editor writes 4) = custom `resX`×`resY` |
| 11 | (unused) | short | minor < 3 | discarded. See the R-18 note below. |
| 12 | mainDisableProtectReg | short | always | legacy; ignored |
| 13 | language file | string | always | editor UI language, e.g. `0english.lng`; ignored by the engine |
| 14 | startupPrg | string | always | program in `Prg\` run at start |
| 15 | initBoard | string | always | first board in `Boards\` |
| 16 | initChar | string | always | first character in `Chrs\` |
| 17 | runTime | string | always | "run-time" program, run when `runKey` is pressed; empty = none |
| 18 | runKey | short | always | ASCII code of the run-time key |
| 19 | menuKey | short | always | ASCII code of the menu key (13 = Enter in new projects) |
| 20 | key | short | always | ASCII code of the general activation key (the demo game uses 32, space) |
| 21 | runTimeKeys UB | short | always | the editor writes 50 |
| 22 | × (UB+1): key, program | short, string | always | extra run-time keys (ASCII) and their programs; entries with an empty program are ignored |
| 23 | menuPlugin | string | minor ≥ 3 | menu plugin DLL in `Plugin\` |
| 24 | fightPlugin | string | minor ≥ 3 | battle plugin DLL in `Plugin\` |
| 23′ | (unused) | short | minor < 3 | discarded; plugins default to `tk3menu.dll` and `tk3fight.dll`. See the R-18 note below. |
| 25 | (unused) | int, short | minor ≤ 2 | discarded |
| 26 | fightGameYn | short | always | **0 = random battles enabled, 1 = disabled** (the name is inverted) |
| 27 | enemy list UB | short | always | the editor writes 500 |
| 28 | × (UB+1): enemy, skill | string, short | always | random-encounter enemy file (`Enemy\`) and its skill level |
| 29 | fightType | short | always | 0 = random chance per step, 1 = every *chances* steps |
| 30 | chances | int | always | the "1 in N" chance, or the step count |
| 31 | fprgYn | short | always | 1 = run `fightPrg` instead of the normal battle |
| 32 | fightPrg | string | always | custom battle program |
| 33 | (unused) | short | minor < 3 | discarded |
| 34 | gameOverPrg | string | always | program run when the party loses; empty = built-in "Game over" and reset |
| 35 | skinButton | string | always | legacy; ignored |
| 36 | skinWindow | string | always | legacy; ignored |
| 37 | plugin list UB | short | always | RPGCode command plugins |
| 38a | × (UB+1): enabled | short | minor ≤ 2 | non-zero adds `tkplug<i>.dll` |
| 38b | × (UB+1): plugin | string | minor ≥ 3 | plugin DLL names; empty entries ignored |
| 39 | mainUseDayNight | short | always | day/night cycle flag; stored only (not implemented by the engine) |
| 40 | mainDayNightType | short | always | 0 real-world clock, 1 fixed day length; stored only |
| 41 | mainDayLength | int | always | minutes; stored only |
| 42 | cursorMoveSound | string | minor ≥ 3 | menu sound effects (`Media\`) |
| 43 | cursorSelectSound | string | minor ≥ 3 | |
| 44 | cursorCancelSound | string | minor ≥ 3 | |
| 45 | useJoystick | byte | minor ≥ 3 | 0/1 |
| 46 | colorDepth | byte | minor ≥ 3 | 0 = 16-bit, 1 = 24-bit, 2 = 32-bit (bits = 16 + 8 × value) |
| 47 | gameSpeed | byte (unsigned) | minor ≥ 4 | speed + 128; see Game speed below. Absent → 0. |
| 48 | pixelMovement | byte | minor ≥ 4 | 0 = tile movement, 1 = pixel movement with tile-sized pushes, 2 = pixel movement with pixel pushes. Absent → 0 |
| 49 | cursor enabled | byte | minor = 5 only | non-zero → `mouseCursor = "TK DEFAULT"`, else no cursor |
| 50 | mouseCursor | string | minor ≥ 6 | image in `Bitmap\`, `TK DEFAULT` for the built-in arrow, or empty. Minor < 5 → `TK DEFAULT`. |
| 51 | hotSpotX | byte | minor ≥ 6 | cursor hot spot, pixels |
| 52 | hotSpotY | byte | minor ≥ 6 | |
| 53 | transpColor | colour | minor ≥ 6 | cursor transparent colour; forced to red `RGB(255,0,0)` when the cursor is `TK DEFAULT` |
| 54 | resX | int | minor ≥ 7 | custom width |
| 55 | resY | int | minor ≥ 7 | custom height |
| 56 | bFpsInTitleBar | byte | minor ≥ 8 | show frames per second in the title bar |
| 57 | pfHeuristic | short | minor ≥ 9 | path-finding mode: 0 previous, 1 axial (4-way grid), 2 diagonal (8-way grid), 3 vector (any angle). Absent → 2 |
| 58 | drawVectors | int | minor ≥ 9 | debug drawing bit mask: 1 board vectors, 2 sprite vectors, 4 paths, 8 destination circles, 16 selected player's path, 32 selected player's destination |
| 59 | pathColor | colour | minor ≥ 9 | colour for path debug drawing; absent → white |
| 60 | movementControls | int | minor ≥ 9 | bit mask: 1 keyboard, 2 mouse, 4 allow diagonals. Absent → 1 + 4 |
| 61 | movementKeys × 8 | short each | minor ≥ 9 | DirectInput keyboard scan codes in the order E, SE, S, SW, W, NW, N, NE; 0 = unbound. Absent → arrow keys (E `0xCD`, S `0xD0`, W `0xCB`, N `0xC8`), diagonals 0 |

The file ends after the last field present.

**Version-dependent fields (legacy fact).** Twelve logical rows are conditional, and the "Present when" column above is the whole of it: the unused `short` at row 11 (`minor < 3`); the menu/fight plugins at rows 23-24 against the reserved `short` at row 23′; rows 25 and 33 (`minor ≤ 2`); the plugin-slot form at rows 38a/38b (`minor ≤ 2` uses `enabled` flags named `tkplug<i>.dll`, `minor ≥ 3` uses names); and, in order, rows 42-46 (`minor ≥ 3`), 47-48 (`≥ 4`), 49 (`= 5`), 50-53 (`≥ 6`), 54-55 (`≥ 7`), 56 (`≥ 8`) and 57-61 (`≥ 9`). Every row carries a unique number 1-61 in storage order across the file's lifetime, so it can be cited. The minor history is in [legacy/older-binary-versions.md](legacy/older-binary-versions.md#main-file-minor-history).

## TKR package-list extension

TK Reawakened may append a native package list after the last documented row. This extension is not part of the legacy TK3 layout; a legacy reader therefore sees it as trailing residue. The extension begins with the eight-byte marker `TKRPLUG\0` (seven ASCII bytes followed by NUL), then an unsigned little-endian `u16` true count. Each package name is a NUL-terminated Windows-1252 string in authored order. A count of zero is an explicit empty list. The list is bounded to 256 names and each encoded name to 255 bytes; names must be non-empty and unique under ASCII case-folding. An optional [TKR audio-settings extension](#tkr-audio-settings-extension) may follow the final name; any bytes after the last recognised block remain opaque residue.

The package list is the only part of the main file the plugin manifest reads: the engine appends one manifest entry per name, in the stored order, after the engine default manifest ([E-02 step 3](../engine/main-loop-and-startup.md#reawakened-boot-sequence)). The legacy plugin rows (23-24, 38a and 38b) stay data: they round-trip byte for byte, and the writer never derives them from the package list or the package list from them. On load the boot sequence maps the stock names in memory — `tk3menu.dll` to the `stock_menu` package and `tk3fight.dll` to the `stock_battle` package ([step 3 of the boot sequence](../engine/main-loop-and-startup.md#reawakened-boot-sequence)) — and reports any other name once as `plugin.legacy-unmapped` while keeping it as data. A new-project template names both stock packages in the package list instead, so a project saved from the editor states them explicitly. A file older than minor 3 carries neither legacy row, so nothing maps: a stock package then installs only from an explicit package-list name.

<a id="tkr-audio-settings-extension"></a>
## TKR audio-settings extension

TK Reawakened may append a native audio-settings block after the package-list block. It is a separate tagged block, not a field inside `TKRPLUG`, so a reader that knows only one of the two keeps the other as residue. It begins with the seven-byte marker `TRKAUD\0` (six ASCII bytes followed by NUL), then an unsigned little-endian `u16` true track count, then that many tracks in authored order:

| Field | Type | Meaning |
|---|---|---|
| track name | NUL-terminated Windows-1252 string | 1–32 bytes matching `[A-Za-z0-9_.-]+` after ASCII case-folding |
| voice count | `u16` | a positive integer, 1–32 |

After the tracks come an unsigned little-endian `u16` voice cap (1–32), then one `u8` font-present flag. A flag of `1` is followed by a NUL-terminated Windows-1252 `AssetKey` of 1–255 bytes; a flag of `0` means the game supplies no default bank and the decoded setting is `null`. Any byte other than `0` or `1` is malformed.

The block is the full ordered track list: the five built-in names `music`, `sfx`, `ambience`, `voice` and `ui` must be the first five entries, in that order after ASCII case-folding, and may not appear again. Track names must be unique under ASCII case-folding. The count is therefore 5–16. The voice cap (1–32) limits the configuration applied at boot, not the aggregate that the reader or writer may represent; an over-cap aggregate is accepted and recovers as described below. Their Epic 6 defaults are `{ music: 1, sfx: 1, ambience: 4, voice: 2, ui: 4 }`; a block may override any of them. Without a block the Epic 6 tracks and counts apply and the default cap is 32. The game-file tracks, counts, cap and default SoundFont are game configuration, never playback-save data ([MEDIA-4](../engine/audio-media.md#media-4)).

The block order is fixed: the package list, when present, comes first; the audio block, when present, comes next; the [input block](#tkr-input-extension), when present, comes last; any remaining bytes are residue. Each block may be present without the others. The writer emits the audio block when the model carries audio settings and never derives it from, or into, the package list or the legacy rows.

The decoded model always carries `audioSettings`: it is `null` when the block is absent, otherwise `{ tracks, voiceCap, defaultSoundFont }`, with `defaultSoundFont: null` when the font flag is zero. These required nullable fields make absence explicit across serialization boundaries; the binary reader validates the envelope before returning this typed model.

Structural violations — a truncated block, a count or voice count out of range, an unknown font flag, an oversized or empty name, a duplicate name, or built-in names missing, out of order or repeated — are located format errors and no model is produced. A structurally valid block whose total voice count exceeds its cap is accepted as data; at load the engine reports one located `media.voice-cap` diagnostic at the first track whose cumulative count crosses the cap, replaces the track configuration with the Epic 6 default tracks and cap 32, and still applies the block's independent `defaultSoundFont`. The game therefore boots with the defaults rather than refusing the file.

<a id="tkr-input-extension"></a>
## TKR input extension

TK Reawakened may append a native input-settings block after the audio-settings block. It is a separate tagged block, so a reader that knows only some of the three keeps the rest as residue. It begins with the marker `TRKINP\0` (six ASCII bytes followed by NUL), then a `u8` schema number (`1` in this version), then:

| Field | Type | Meaning |
|---|---|---|
| controller enabled | `u8` | `1` the game offers controllers, `0` it does not. Any other value is malformed |
| action count | `u16` | 0–512 actions with a stored binding |
| × count: action name | NUL-terminated ASCII string | 1–64 bytes, `up`, `down`, `left`, `right`, `confirm`, `cancel`, `menu`, or `game.` followed by `[a-z][a-z0-9]*` segments joined by dots |
| flags | `u8` | bit 0: the action is **locked** (the game fixes it, [ACT-6](../engine/display-input-audio.md#act-6)); bits 1–7 reserved, must be 0 |
| control count | `u16` | 0–8 controls for this action |
| × control count: control id | NUL-terminated ASCII string | 1–32 bytes, `key:<code>`, `pad:<0-16>` or `pad:axis<0\|1><-\|+>` ([ACT-3](../engine/display-input-audio.md#act-3)) |

The block is the game's **default** binding table, not the player's ([ACT-6](../engine/display-input-audio.md#act-6)). The block order after the last legacy row is fixed: the package list, then the audio block, then this block; any remaining bytes are residue. Each block may be present without the others.

**Absent block.** The model's `inputSettings` is `null`, and the engine uses the defaults of [ACT-5](../engine/display-input-audio.md#act-5): arrows for directions, Enter and Space for `confirm`, Escape for `cancel`, Enter for `menu`, and a standard-layout controller on. The legacy input rows (18–22, 45, 60–61) keep their 3.1 meaning for the legacy layer and are **not** re-derived into control ids: a 3.1 game's movement scan codes and its ASCII activation, menu and run-time keys still drive the key queue exactly as [E-110](../engine/display-input-audio.md#e-110) describes, and the action defaults above are what the engine's own surfaces use.

**Why a new block rather than new rows.** The legacy rows cannot express a controller button, a second binding for one action, a locked action or a game-defined action, and extending the numbered row list would change what a 3.1 reader sees at every subsequent row. A tagged block is invisible to a legacy reader, is versioned on its own, and follows the same record rules the package list and the audio block already established.

**Validation.** A truncated block, an unknown schema, an action count above 512, a control count above 8, an empty or oversized name, a name that is neither a reserved engine action nor a valid `game.*` name, a reserved flag bit, an invalid control id, or the same control twice within one action is a located format error and no model is produced. A structurally valid block naming a `game.*` action the running game never registers is accepted: the binding stays as data and the engine reports `input.unknown-action` once ([ACT-7](../engine/display-input-audio.md#act-7)).

**Writer.** The writer emits the block when `inputSettings` is non-null and never derives it from, or into, the legacy rows, the package list or the audio block. A round-trip through reader and writer is byte-identical, including an empty action list, which is written as a block with the controller flag and a zero count rather than omitted.

## Compatibility notes

- **Rows 11 and 23′ are `short`, not `int` (R-18, legacy fact with corpus evidence).** Both `minor < 3` reserved fields are 2 bytes. Read as `short`, all **15** binary minor-2 `.gam` files in the corpus read to the last byte (FinalDestiny 2, LittleMan 1, BusDriver 10, School2Demo 1, ChimeranEmpire 1); read as `int`, BusDriver's ten files leave 1506 bytes unread and FinalDestiny's two run off the end. The original 3.1 engine reads 4 bytes at both places, so it misreads every minor-2 file; the editor reads 2 and is correct. This is the reading a new reader takes (round 5 `Q2`). The regeneration of the version-example files that used the old width, and the tool change that produces them, are out of this page's scope.
- **Alignment accident in fields 4-5.** The editor writes a 2-byte `registered` and then the string `NOCODE`. The original engine reads a 4-byte int and then a string, so it sees `CODE`. Both are discarded and the total length is the same, so the following field lines up either way. A new reader should read *short + string*.
- **Game speed.** The byte is `speed + 128`; the decoded speed is `byte − 128` (the editor offers −4..+4). Files with minor < 8 stored the signed value directly and are re-biased on load (`stored + 128`). The decoded value is used as a per-frame step offset (see [../engine/movement-and-collision.md](../engine/movement-and-collision.md#speed)).
- **Keys** in fields 18-22 are ASCII character codes; the engine converts them to keyboard scan codes with the current keyboard layout when loading. Movement keys (field 61) are already scan codes.
- **Default path-finding mode differs.** The engine defaults to 2 (diagonal) for files older than minor 9. The editor's "new project" default is 1 (axial). A re-saved file always carries an explicit value. A value of 0 or out of range probably crashed the original engine when path-finding was first used (inferred from the code; not observed).
- **Fields stored but unused by the engine:** `mainScreenType`, `mainDisableProtectReg`, the language file, both skins, the three day/night fields.
- **Array sizes.** The editor always writes 51 run-time key slots and 501 enemy slots, so an empty project's `.gam` is about 1.9 KB.
- **Plugins are capabilities, not code (legacy fact; §12).** The main file lists its menu, battle and RPGCode-command plugins by name only (`Plugin/*.dll`). These legacy plugins are native Windows libraries of three kinds — an RPGCode extension, a menu and a battle system — and cannot be loaded by a cross-platform rebuild, which must instead supply each named plugin's capability natively. The menu and battle systems are the two that matter, because 3.1 has no built-in ones (see [../engine/plugins-and-battle.md](../engine/plugins-and-battle.md)). When the original editor opens a minor ≤ 2 main file it copies the shared `Plugin\` folder's files into the project's `Plugin\` folder.

## Validation in the original programs

Missing file → message "File not found"; wrong header → "Unrecognised File Format!"; both abort loading the game. No value is range-checked.

## Older versions

The minor-version history and the Toolkit 1 and 2 text main files are in [legacy/older-binary-versions.md](legacy/older-binary-versions.md#main-file-minor-history) and [legacy/text-formats.md](legacy/text-formats.md#main-file-toolkit-2-text).

## Example

[../examples/listings/main.gam.txt](../examples/listings/main.gam.txt) is an annotated byte listing of a complete minor-9 file built by the example generator.
