# Field catalogue: compatibility, runtime state and package records

This page inventories documented supporting records. Authored game definitions, runtime continuation, player save data and distribution metadata are different ownership domains; listing them together does not propose a unified file or schema. `short` = signed 16-bit, `int` = signed 32-bit, `uint` = unsigned 32-bit, colour and strings use [format conventions](../../spec/formats/README.md#primitive-encoding). Counts below are exact unless identified as an upper bound. Standard image/audio payload codecs are not expanded into their compression algorithms.

## Legacy binary `.sav` minor 4: physical records

| Record or field | Stored type and meaning |
|---|---|
| header, major, minor | string `RPGTLKIT SAVE`, shorts 3 and 4. |
| numeric globals | int count; `(name string, value double)` per global; load strips a trailing `!` or `"` from name. |
| object globals | int count; `(name string, value double)` object handles. |
| string globals | int count; `(name string, value string)`; load strips `$` and `"`. |
| redirects | int count; `(from string, to string)` pairs. |
| party | int party size; `(name string, file string)` per member; file relative to `Chrs`. |
| inventory | **short** count; `(file string, name string, quantity int)` per item; stored file includes project path, loader keeps path after `Item`. |
| equipment | 16 slots × party members `(file string, name string)`, slot-major; then for each party member int bonuses `hp`, `sm`, `dp`, `fp`. |
| unused, selected player, gold | three ints; unused is 0; invalid selected index falls back to 0. |
| message window colour, message window background, debug messages, text colour | colour, string, int, colour; debug flag controls script warnings. |
| font name, font size, bold, underline, italic | string, int size, three int style flags. |
| game time, steps | ints in seconds and tiles, respectively. |
| main file, board | strings naming `.gam` and current `.brd`; board is reloaded without starting new threads because threads restore separately. |
| per party member | `(x,y)` doubles in pixels; layer int; active int; four ints for path vector, cycles, next node, attributes; two ints `nextLevel`, `levelProgression`. |
| other players | 26 `(string,string)` pairs, unused and written empty. |
| menu graphic, fight menu graphic, unused, replacement graphics | two strings, int 0, string for selected player's `NewPlayer` graphics. |
| board items | int count; each `file` string, empty meaning no further data for that slot; otherwise strings `prgActivate`, `prgMultitask`, `initialVar`, `initialValue`, `finalVar`, `finalValue`; shorts `activate`, `activationType`; doubles `x`, `y` pixels; ints `layer`, `active`, path vector, cycles, next node, attributes. `loadingVar` and `loadingValue` are **not saved**. |
| threads | int thread UB (count − 1); each name string is a `Prg` path or inline code, `persistent` int; persistent minor-4 threads have `isItemThread` int and, when true, item-index int; `sleeping` int, sleep-remaining double milliseconds; a non-empty name carries program state below. |
| movement size, objects, game speed offset | double (0 pixel / 1 tile movement); int object count and `(handle uint, class string)` pairs; int speed offset. |

### Legacy program continuation within a thread

`stack index` int (−1 ends this record); stack-frame count int; per frame item count int and `(number double, text string, type flags int)` items; local-scope count int and per-scope variable count int plus `(name string, number double, text string, type flags int)` entries; call count int and `(returns int, return position uint, closing brace position uint, object uint, reference count int)` calls; each reference has parameter index uint, frame uint (0 global), variable name string; then program position int, scope mode int (0 global-first, 1 local-first), include count int and name strings. The program text is recompiled from its name; per-call error handlers are not saved. Instruction positions refer to the original compiler, not portable source locations. [Program state](../../spec/formats/save-game.md#program-state-inside-each-thread-field-46).

**Earlier minors 0–3:** five fixed party slots and folder-prefixed character/board paths; party positions in tiles; no party active/path state or board-item section. Thread position int is ignored, sleep is seconds, and local-variable heaps `(name,double)` / `(name,string)` replace program state and are ignored on load. Minor 0 lacks objects; minors 0–1 lack game-speed offset. These are physical variants, not evidence that a given game contains all save sections. [Earlier saves](../../spec/formats/legacy/older-binary-versions.md#saved-game-before-minor-4).

## Reawakened JSON save: documented state, not authored asset fields

| Section or carrier | Documented persisted fields and scope |
|---|---|
| `schema` | Section shape versions including `vm`, `actors`, `audio` and schema version; `ir` independently versions instruction positions. Older `compiler` is migrated; `ProgramRef.ir` mirrors instruction identity. Older IR restarts affected threads from source, newer IR refuses load. |
| `actors` | `version`, `nextId`, `actors`; each actor `id`, `kind` (`party`, `enemy`, `npc`), `source`, `name`, `stats`, `statuses`, `equipment`, `progression`, `behaviour` (string/null), `customEvents` (string array). Asset references and current values are state; callbacks and compiled programs are not serialized. |
| `party` | `version`, ordered `members` actor IDs, `selected` ID/null, `steps`, `stepRemainder` (1/256 board-pixel units). |
| `inventory` | `version`, `nextId`, `items`, `equipment`, `gold`; each item `{ id, source, handle, quantity }`, each equipment assignment `{ actorId, slot, itemId }`. Equipment assignments are authoritative; actor bonuses/references are derived consistently. |
| `menu` | `version`, `screens`, `graphic`; each screen `{ screen, actorId, selection }`, where actor ID and graphic may be null. |
| `battle` | null or `{ id, boardKey, background, canRun, outcome, parties }`; each fighter `{ party, actorId, charge }`; engine section separately stores `nextBattleId`. Status and stats belong to actors. |
| `audio` playback projection | `{ tick, cueId, tracks }`; each track carries name and playback state, active voice positions, loop/priority, pause state and fade descriptors. Configured track definitions, voice count/cap, default SoundFont, player mix and host handles are not in this game-save projection. Music restarts on load; non-music resumes at saved position. |
| `input` | binding table, effective table, registry order, held actions and player overrides `{ added, removed }`; queued/held transient input and pointer/button state are separately identified by the reset section. On-disk `.gam` input defaults are a different block. |
| `vm` | script globals, redirects, running threads, waits, frames, locals, program references, closure `cells` and `cellSeq`, object records, callable/definition references; per-frame `itemActions` continuation when present. Saved frame positions include `ip` and `operands`; source and IR compatibility govern restoration. |
| `engine` | lifecycle state, pending effect/request state, request-id counter, `nextBattleId`, and `cacheKeys` (sorted acquired asset keys; null in migrated older saves means readiness unknown). Cache bytes and decoded textures are not stored by `cacheKeys`. |
| `world`, `sprites`, `triggers` | active board and runtime board changes; player/item placements and path-related state; trigger armed/repeat/gone state. Save ledger also identifies board identity, board edits and trigger progress. |
| `ui`, `camera`, `events`, `fx` | message/UI state including font and colour settings, cursor maps and buttons; camera follow target and transform; listener table, queued events and delivery; fades, wipes, zoom, animations and pending screen effects. |
| `surfaces` | surface `entries`, including presented screen `"0"`, script screen `"-1"`, positive script-owned `cnvX` canvases; slots, colour table, `nextId` and render-now overlay fields. Presented surface and script-owned canvases have different hash treatment; reconstruction of history-dependent presentation remains open. |
| `rng`, `time` | random seed/state and elapsed tick/play-time counters; save ledger also includes encounter progress. |

The listed domains are the persisted sections and named fields actually documented in the cited pages, not a claim to enumerate unnamed nested implementation members. The game ledger is an accepted progress classification with unresolved traversal/identity proofs, not a claim that a separate complete ledger already exists. Ordinary save retains full VM continuation. [Save contract](../../spec/formats/save-game.md#reawakened-canonical-actor-state); [reset section owners](../../spec/engine/main-loop-and-startup.md#reawakened-reset-sections); [battle](../../spec/engine/battle.md#bat-2); [audio save](../../spec/engine/audio-media.md#audio-save-load); [input](../../spec/engine/display-input-audio.md#act-7).

## Package records and paths

| Carrier | Documented fields and distinctions |
|---|---|
| Legacy `.tpk` | ZIP entries: project-relative entry name, method (legacy writer deflate 8), compressed and uncompressed sizes, CRC-32; DOS date/time zero; no encryption or comments from legacy writer. Root `main.gam` plus project files; no directory entries or saved games. Name, method and both sizes must agree between local header and central directory. ZIP's other general-purpose container fields/payloads remain standard ZIP metadata, not authored game properties. |
| Reawakened `manifest.json` | Exactly `schema` (non-negative project schema integer), `main` (in-package `.gam` path), `index` (each game-file path once; writer's code-unit order). It is not a legacy PAK field. |
| Sibling `<package>.tpk.json` install descriptor | Exactly `schema` (descriptor version), `file` (basename), `sha256` (lowercase hex package digest), `size` (bytes), `gameId` (library identity), `title` (display string), `version` (author's game version string). This descriptor is outside the package; documented as a proposal without sample-package evidence. |
| Appended-ZIP standalone EXE | Engine bytes, ZIP bytes, 12-byte trailer: ASCII magic `CMP1`, little-endian signed int engine length / ZIP start offset, signed int ZIP length. There is no trailer checksum/version. Private Toolkit 2 Professional packed executables are not this format and are refused. |
| Loose folder / setup ZIP | Loose folder entries have file/directory/link kind and path; links refused. Setup ZIP includes `Main/` and `Game/`, unlike project-root PAK. Stored `projectPath` is ignored for package-root loading. |

Nested archives remain opaque files; accepting a ZIP entry is not treating its bytes as a native data contract. [Packaging layouts](../../spec/formats/packaging-and-paths.md#pak-archive-tpk), [distribution manifest](../../spec/formats/packaging-and-paths.md#distribution-package-this-projects-own), [install descriptor](../../spec/formats/packaging-and-paths.md#install-descriptor).

## Font, image and media metadata

| Carrier | Named stored fields, units and boundaries |
|---|---|
| Toolkit 2 `.fnt` | Magic `RPGTLKIT FONT`, version 2, subversion 0, then 2048 decimal row values 0–255: 256 glyphs × 8 top-first rows, bit 7 left. No palette, glyph-width metadata or atlas. `.ttf` font files in `Font/` are standard font assets, not this layout. |
| BMP file header | `bfType` (`BM`), `bfSize` bytes, `bfReserved1`, `bfReserved2`, `bfOffBits` byte offset. |
| BMP DIB | `biSize`, `biWidth`, `biHeight` pixels and row direction, `biPlanes`, `biBitCount`, `biCompression`, `biSizeImage` bytes, `biXPelsPerMeter`, `biYPelsPerMeter`, `biClrUsed`, `biClrImportant`; optional palette entries `(B,G,R,reserved)` and pixel rows with four-byte-alignment padding. Resolution hints and important-colour value are ignored; 32-bit BI_RGB's fourth byte is not treated as alpha. RLE8 is a payload encoding. |
| GIF screen | signature `GIF87a` / `GIF89a`, logical-screen `width`, `height`, `packed` (global colour-table flag, colour resolution, sort, table size), `background` palette index, `aspect`; optional global RGB table. |
| GIF page and control | image descriptor `left`, `top`, `width`, `height`, `packed` (local palette, interlace, sort, reserved, palette size); optional local RGB table; LZW minimum code size and data sub-blocks. Graphic control extension: block size, `packed` (disposal, user input, transparency flag), `delay` in hundredths of a second, `transparent` index, terminator. Other extension labels and sub-blocks, including loop metadata, are skipped; trailer ends file. |
| PNG/JPEG and media | PNG/JPEG, audio formats and SoundFont are external asset bytes; these cited format pages do not define a universal game-authored metadata record for their tags or codec internals. Game references, `.gam` audio track names/voice counts/cap/default SoundFont, and animation-frame sound references are enumerated in the other catalogue pages. An asset length supplied to the core as ticks is runtime metadata, not a proven field of every media file. |

Image decoder output is normalized straight RGBA and dimensions, not additional physical fields in the referring `.anm`, board or fight background; colour-key transparency belongs to the reference. No sample occurrence proves the full extent of codec or asset-format support. [Image layouts](../../spec/formats/images.md#the-windows-bitmap-layout), [GIF](../../spec/formats/images.md#gif), [font](../../spec/formats/legacy/text-formats.md#font-toolkit-2-text), [audio timing](../../spec/engine/audio-media.md).

## Key source files

- [Saved game](../../spec/formats/save-game.md), [older binaries](../../spec/formats/legacy/older-binary-versions.md), [engine reset sections](../../spec/engine/main-loop-and-startup.md#reawakened-reset-sections).
- [Battle state](../../spec/engine/battle.md#bat-2), [audio playback save](../../spec/engine/audio-media.md#audio-save-load), [input state](../../spec/engine/display-input-audio.md#act-7).
- [Packaging and paths](../../spec/formats/packaging-and-paths.md), [images](../../spec/formats/images.md), [legacy font](../../spec/formats/legacy/text-formats.md#font-toolkit-2-text).
