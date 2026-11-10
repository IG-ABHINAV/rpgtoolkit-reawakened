# File formats: conventions and index

Every RPG Toolkit 3 game is a folder of small binary files plus RPGCode text, all written by the editor and read by the engine. This page defines the encoding rules they share; each format then has its own page. The layouts were checked by parsing every sample file shipped with the Toolkit and by rendering boards and tilesets from the parsed data (see [../tools/README.md](../tools/README.md)).

## Index

| Format | Extension | Folder | Page |
|---|---|---|---|
| Main game file | `.gam` | `Main\` (outside the project) | [main-file.md](main-file.md) |
| Board (map) | `.brd` | `Boards\` | [board.md](board.md) |
| Character | `.tem` | `Chrs\` | [character.md](character.md) |
| Item | `.itm` | `Item\` | [item.md](item.md) |
| Enemy | `.ene` | `Enemy\` | [enemy.md](enemy.md) |
| Animation | `.anm` (or `.gif`) | `Misc\` | [animation.md](animation.md) |
| Tileset, isometric tileset | `.tst`, `.iso` | `Tiles\` | [tiles.md](tiles.md) |
| Single tile | `.gph` (text) | `Tiles\` | [tiles.md](tiles.md#single-tile-gph) |
| Animated tile | `.tan` | `Tiles\` | [tiles.md](tiles.md#animated-tile-tan) |
| Tile bitmap | `.tbm` | `Bitmap\` | [tiles.md](tiles.md#tile-bitmap-tbm) |
| Fight background, status effect, special move | `.bkg`, `.ste`, `.spc` | `Bkrounds\`, `StatusE\`, `SpcMove\` | [battle-data.md](battle-data.md) |
| Saved game | `.sav` | `Saved\` | [save-game.md](save-game.md) |
| RPGCode program | `.prg` | `Prg\` | [rpgcode-program.md](rpgcode-program.md) |
| Project layout, PAK archive, standalone EXE | folder, `.tpk`, `.exe` | — | [packaging-and-paths.md](packaging-and-paths.md) |
| **Native authoring formats** (scenes, tile recipes, scene asset packs) | `.tkrscn`, `.tkrtile`, `.tkrpack` (YAML) | `Boards\`, `Tiles\`, `Assets\` | [tkr-authoring.md](tkr-authoring.md) ([ADR 0019](../../adr/0019-tkr-authoring-formats.md)) |
| **Legacy files** (Toolkit 1-2 text, older 3.0 binary versions, conversion) | various | — | [legacy/](legacy/README.md) |
| Images | `.bmp`, `.png`, `.jpg`, `.gif` | `Bitmap\`, `Misc\` | [images.md](images.md) (BMP and GIF layouts; PNG and JPEG: [images.md](images.md#the-shared-decode-contract)) |
| Audio, fonts, plugins | `.wav/.mid/.mp3/.ogg`, `.ttf`, `.dll` | `Media\`, `Font\`, `Plugin\` | third-party formats, used as-is |

## Primitive encoding

All binary formats use the same primitives, in the byte order of a 32-bit x86 PC:

| Name used in these pages | Size | Encoding | Notes |
|---|---|---|---|
| `byte` | 1 | signed 8-bit | The engine reads it as a C `char`; the editor writes a VB `Byte` (0..255). Values above 127 only appear in `gameSpeed`, which is read unsigned. |
| `short` | 2 | signed 16-bit little-endian | Most counts, sizes and flags |
| `int` | 4 | signed 32-bit little-endian | |
| `double` | 8 | IEEE-754 binary64, little-endian | Times in seconds, positions in saves |
| `string` | n+1 | the text in the Windows ANSI code page (Windows-1252 on Western systems), then one `00` byte | **No length prefix.** Strings cannot contain `00`. Read byte by byte until the first `00`. |
| `colour` | 4 | Windows `COLORREF`: `R + G·256 + B·65536` as an `int` | e.g. red = `ff 00 00 00` |
| `bool` | 2 or 4 | stored as `short` or `int`; the editor writes `-1` (VB `True`) or `0`; the engine treats any non-zero as true | |

There is no padding, alignment, checksum or compression inside these files.

**Code-page round trip — Reawakened rule.** The five byte values Windows-1252 leaves undefined (`0x81`, `0x8D`, `0x8F`, `0x90`, `0x9D`) carry no character there. Each decodes to the character with the same numeric value (U+0081 and so on) and is written back as that same byte, so reading and re-writing a string never changes it. A `string` whose bytes reach the end of the file with no `00` terminator is invalid and is reported as a read error at the offset where the string began; an empty string is a single `00`. A `colour`'s high byte is zero in every legacy value; a reader ignores it and a writer emits `00`. The code-page decoder is `packages/core/src/formats/binary/cp1252.ts:28-58` and the primitives are `packages/core/src/formats/binary/reader.ts:226-247`.

## Header and version

Every binary game file begins with:

| Field | Type | Meaning |
|---|---|---|
| header | string | Fixed text such as `RPGTLKIT BOARD` (each page gives the exact text) |
| major | short | Always `2` in files from the 3.x editor (`3` for tile bitmaps and save games). Readers ignore it, except the editor's board reader, which refuses anything but 2. |
| minor | short | The real version. Fields are only ever **appended**; readers branch on the minor to know which fields exist. |

A reader must accept every older minor version listed on each page. A writer for 3.1.0 compatibility writes the newest minor.

Tilesets (`.tst`/`.iso`) are the exception: a 6-byte numeric header with no text.

## Counts are usually upper bounds

Most lists are stored as `short UB` followed by **UB + 1** entries, so `-1` means "empty" and `0` means one entry. The exceptions, which store an exact count, are the animated-tile frame list and the save-game lists (except the save game's thread list). Each table says which kind it uses.

**Bounds checks — Reawakened rule.** The bound is untrusted input, so a reader checks it against the bytes that remain before it loops or reserves anything, rather than trusting it; a damaged or hostile file must not make the reader run past the end or reserve a huge block up front. A bound below `-1` is invalid and is reported, and a negative version field is invalid too. "None" is not the same as an empty entry: a board's look-up table keeps index 0 for the empty "no tile" reference even when later slots are emptied ([board.md](board.md#vector-layout-minor-4-and-later)). The checks are in `packages/core/src/formats/binary/reader.ts:226-247`.

## Bytes after the last documented field

**Residue — Reawakened rule.** Bytes after the last documented field of a binary file are not an error. A reader keeps them as they are (the file's *residue*), reports a warning, and a writer puts them back, so a file that is read and saved without changes is written back byte for byte. *Reason:* dropping bytes the reader does not understand would silently change a file its author never edited. Rows the format marks reserved are different: they are part of the layout and stay in their place. The readers keep residue in `packages/core/src/formats/actor/character.ts` and `packages/core/src/formats/actor/item.ts`.

## Legacy files

Files from Toolkit 1 and 2 (line-based text) and older 3.0 binary versions are documented separately in [legacy/](legacy/README.md), including how to tell them apart from current files and how the original programs converted them. The pages in this folder describe the current layouts, plus small older-minor differences in their "Present when" columns. [../examples/versions/](../examples/versions/README.md) has an example file of every version.

## Tile references

Anything that names a tile uses a string:

| Form | Meaning |
|---|---|
| `name.tstN` | tile *N* (1-based) of tileset `Tiles\name.tst` |
| `name.isoN` | tile *N* of isometric tileset `Tiles\name.iso` |
| `name.gph` | single-tile file `Tiles\name.gph` |
| `name.tan` | animated tile `Tiles\name.tan` (boards only) |

Sub-folders are allowed (`village\houses.tst12`) and use `\` only. **Compatibility note:** the original engine parses the tile number from 4 characters after the *first* `.` in the full path, so a `.` in a folder name breaks tile lookup.

## Directions

Two different orders are in use:

| Where | Order |
|---|---|
| Character and item walk / idle graphics | **S, N, E, W, NW, NE, SW, SE** |
| Engine movement, movement keys in the main file | E, SE, S, SW, W, NW, N, NE (values 1..8) |

## Paths inside files

File names stored inside files are relative to the folder for that type (a board stores `start.tem`, meaning `Chrs\start.tem`). Sub-folders below the type folder are preserved. Absolute paths are not expected; the save game is the exception (it stores some project-relative paths). See [packaging-and-paths.md](packaging-and-paths.md).

**The ASCII case fold — Reawakened rule.** A stored name is matched case-insensitively because the legacy file system was. The fold rewrites `\` as `/`, then folds `A`–`Z` to `a`–`z` and leaves **every other code point exactly as it is**: a name containing `U+212A` (KELVIN SIGN) keeps that character and is a **different** name from the same name written with ASCII `k`, and `U+0130` stays one code point instead of becoming `i` plus `U+0307`. The same fold covers a leading type-folder prefix, the `Game` first segment of a stored project path, and a three-character extension. A reference and an index entry match when their folded forms are equal; two index entries with one folded form are one file, and a package holding such a pair is refused (L10). The one helper is `foldPath` in `packages/core/src/formats/main-file/layout.ts:70-102`. *Consequence:* a reference that differs from the stored name only in the case of a letter above `0x7F` (`Café.brd` for `CAFÉ.BRD`) resolved on the legacy platform and does not here; it is reported as a missing asset, never as a different file. No reference in the sample corpus needs such a match. <!-- OWNER: chose an ASCII-only fold over a full-Unicode fold because the legacy fold is the upper-case table (U+212A maps to itself, so Unicode lower-casing invents a collision Windows never had), because G3 wants one fold on every runner, and because folding bytes above 0x7F rests on an assumed code page. Revisit if the corpus ever ships a non-ASCII path. -->

## Images

An image is resolved as an ordinary asset and decoded in one place, so the rasteriser, every runner and the editor cannot disagree about what the file contains.

**Decoding — Reawakened rule.** The reader's result is **straight** (non-premultiplied) 8-bit RGBA of exactly `width × height × 4` bytes, row-major, top row first: the file's own colours and its own alpha, nothing added. The colour key is **not** in the file (it is stored with whatever references the image), so the reader never applies one; the key is tested against the decoded pixels by whatever blits the image. The kind is chosen by signature: PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, Windows bitmap `BM`, GIF `GIF87a`/`GIF89a` (`47 49 46 38`); any other signature is an error at offset 0. Every defect is a located error carrying the path, the offending byte offset and `docs/spec/formats/images.md#the-shared-decode-contract` — never a throw and never a plausible wrong picture. Every reader refuses a zero dimension and an image of more than **100,000,000 pixels**, so the allocation is never attempted past that limit (the largest image in the legacy sample games is 640×480); a GIF holds every page at once, so for it the limit also covers `pages × screen`. The decoders are `packages/core/src/formats/image/png.ts`, `image/jpeg.ts`, `image/bmp.ts`, `image/gif.ts` and `image/crc32.ts`.

* **PNG** (`image/png.ts`): the chunk walk checks a CRC-32 per chunk (`0xEDB88320`, over the type and data), keeps `IHDR` first and read alone, and stops at `IEND`. The concatenated `IDAT` data is one zlib stream inflated into the exact size `IHDR` fixes, so it cannot allocate past the declared layout. Every scanline filter (0–4, including Paeth) is undone in place, and the seven Adam7 passes are reassembled. `PLTE`/`tRNS` give palette alpha or a 2/6-byte colour key; sub-byte depths (1, 2, 4) are widened by ×255/×85/×17 and depth 16 is reduced by `floor(v / 257)`. Errors found in the inflated bytes are reported at the first `IDAT` payload.
* **JPEG** (`image/jpeg.ts`): the baseline sequential (`SOF0`) and 8-bit extended sequential (`SOF1`) processes only, sample precision 8, greyscale or three-component YCbCr, per-component sampling 1×1 to 4×4, Huffman entropy data with optional restart intervals, a separable inverse DCT, chroma upsampled to full resolution by nearest neighbour, then YCbCr→RGB. Partial MCUs carry **dummy blocks** past a component's own grid; each is decoded to keep the reader in step and then dropped. Progressive and every other frame type, other precisions, other component counts (CMYK/YCCK) and a non-baseline scan are refused. The inverse-DCT basis is stored as literal double constants, never `Math.cos`/`Math.PI`, so the same bytes give the same pixels on every JavaScript engine.
* **Windows bitmap** (`image/bmp.ts`): a 40-byte `BITMAPINFOHEADER`, one plane, uncompressed `BI_RGB` at 1, 4, 8, 24 and 32 bits plus the 8-bit `RLE8` stream; rows are stored bottom-up and padded to a 4-byte stride, and 32-bit `BI_RGB` is opaque. Every other header size, bit count, compression, a short palette and an RLE escape that leaves the image are refused. The full layout is in [images.md#windows-bitmap-bmp](images.md#windows-bitmap-bmp).
* **GIF** (`image/gif.ts`): GIF87a and GIF89a in full — global and local colour tables, the block walk (image `2C`, extension `21`, trailer `3B`), a hand-written LZW decompressor whose code width grows to 12 bits and whose table freezes at 4096 (the deferred clear), the four-pass interlace, and the graphic control extension (transparency, delay, disposal 0–3). A **still** image is the first page; the animation path takes every page with its own delay. Frames are the logical screen size, uncovered area and a disposal-2 rectangle are transparent, and a missing `3B` trailer is a warning. The full layout is in [images.md#gif](images.md#gif).

**The image kinds — Reawakened rule.** Archive use was counted inside the game and tool archives and across the archived `.prg` scripts:

| Kind | Ruling |
|---|---|
| PNG | **Decoded** |
| JPEG | **Decoded** |
| BMP | **Decoded** ([images.md#windows-bitmap-bmp](images.md#windows-bitmap-bmp)) — the dominant TK2-era picture format, chosen by the `BM` signature |
| GIF | **Decoded** ([images.md#gif](images.md#gif)) — both versions, still and animated; the reader yields every page and its delay, because an animated GIF stands in for an `.anm` ([animation.md](animation.md#animated-gif)) |
| ICO | **dropped** as a game format; it belongs to the editor's import path, not to a game-image reader |
| WMF | **dropped**; no game file is a Windows metafile |

The legacy Windows image library loaded more kinds than this project does; anything else is refused with a located error rather than approximated. Audio, video, fonts and plugin DLLs are third-party and used as-is (see the index above).

## Cross-format test checklist

The quirks a reader must exercise across formats, each a candidate test:

* `speed`/`idleTime` order differs: `.tem` stores idle-then-speed, `.itm` stores speed-then-idle.
* Custom stances serialize as `animation, handle` in `.tem`, `.itm` and `.ene` alike (legacy C++ inverted the map read in `.ene` only).
* `.ene` custom-stance count is an `int` on disk, while the standard-stance bound is `5` (six slots 0..5, slot 5 an unused editor boundary).
* `.tem` body slots are 7 bytes: byte 0 is padding, then head, neck, left hand, right hand, body, legs; `maxLevel == 0` disables levelling entirely.
* `.tem`/`.itm` vector-base count is stored as `1`, meaning two bases (collision then activation).
* `.brd` `closed` is `-1` (legacy `CInt(True)`) or `0`; coordinate types are a bitmask (0 2D, 1 iso-stacked, 2 iso-rotated, 4 pixel-absolute), isometric when `(coordType & 1) || (coordType & 2)`, and only bit 2 expands the stored matrix to `(sizeX + sizeY)²`.
* `.brd` a run marker's following index must be `≥ 0`; an over-long run and a shade layer covering more cells than the grid are warnings, kept and re-emitted verbatim.
* `.bkg`/`.spc`/`.ste` share `string magic, short major, short minor`, with binary/text detection at byte 12 (`.bkg`) or 16 (`.spc`, `.ste`).
* A standalone EXE's `CMP1` trailer stores `offsetOfZip` and `zipLength` as little-endian `int`.
* The main file lives at `<root>/Main/<game>.gam`, outside the project folder, and the engine cannot boot without it.
* Tile bitmaps store an extra padding row and column.
* The `.gam` fighting flag is inverted (0 = fighting on).
* Shade-layer run records always carry an explicit count; the tile matrix uses negative counts.
* The board look-up table reserves index 0 for "no tile" when the table exists; `-1` means no table at all.
* A program/sprite program field falls back to inline RPGCode when the named file is missing.
