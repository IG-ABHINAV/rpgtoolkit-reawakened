# Field catalogue: presentation and supporting families

This inventory records documented physical fields and separately names derived values. It is not a proposed native schema. `short` = signed 16-bit, `int` = signed 32-bit, UB = last index; strings and colour encoding are defined in [format conventions](../../spec/formats/README.md#primitive-encoding). Referenced art and media remain assets, not fields duplicated into each consumer.

## `.anm` animation

| Stored field(s) | Type and meaning |
|---|---|
| `header`, `major`, `minor` | string, two shorts; binary minor 3. |
| `width`, `height`, frame UB | three ints: pixel canvas dimensions, frame upper bound. |
| each `image`, `transpColor`, `sound` | image or tile-reference string, colour, media string. Empty image slots exist on disk; playback drops them. |
| `delay` | double seconds per frame. |

Text minor 0 stores the same dimensions and frame fields but a nominal frame-count line is ignored and 51 frame triples are read by position, followed by delay. Animated GIF may substitute for `.anm`: page images and first-page timing/size plus transparency/background fallback are decoded properties of the GIF, not `.anm` fields. [Animation](../../spec/formats/animation.md#layout); [text variant](../../spec/formats/legacy/text-formats.md#animation).

## Tile families

| Family | Stored field(s) | Type, distinctions and references |
|---|---|---|
| `.tst`, `.iso` | `version`, `tileCount`, `detail`, tile pixel data | three unsigned shorts followed by exactly `tileCount` tile blocks. Version 20/30; detail 1–6 is 32×32 or 16×16 RGB or palette pixels, 150 is `.iso` diamond RGB. Pixels are column-major; 16×16 tiles can draw doubled. The diamond mask is regenerated, not stored. |
| `.gph` version 2 | header, major, minor, detail, compression, pixel values or `(count,value)` runs | line-oriented text; detail selects dimensions and interpretation, compression selects literal or run-length stream. `-1` is transparent. Details 4/6 differ between original editor and engine. Version 1 is a headerless 16×16 character grid with palette index = character code minus 33, unsupported in initial release. |
| `.tan` | header, major, minor, `speed`, `frameCount`, frames | string, two shorts, two ints, `frameCount` tile-reference strings. Speed's delay is 1000/speed ms; count is exact, not UB, and empty middle frames persist. |
| `.tbm` | header, major, minor, `width`, `height`, cells `(tile,r,g,b)` | string, two version shorts, two tile-dimension shorts; each cell string and three signed tint shorts. Physical cells are `(width+1) × (height+1)`, including an extra undrawn row and column; only the visible grid composes the picture. |

Tile references such as `set.tst12` point to indexed content, so tile reordering changes consumers. Dimensions of rendered tiles or bitmaps and decoded RGBA are not extra disk fields. [Tile layouts](../../spec/formats/tiles.md); [v1 text tile](../../spec/formats/legacy/text-formats.md#single-tile-version-1-toolkit-1).

## Fight background `.bkg`

Physical binary fields are header string; `major`, `minor` shorts; and six strings `image`, `music`, `selectSound`, `chooseSound`, `readySound`, `cantDoSound`. The image is a `Bitmap` reference, possibly `.tbm`; sounds and music are media references. Text minor 0 instead stores 19×11 tile names, the five media strings, one reserved line of unknown original meaning and 19×11 triples of tint values. The reserved line is not an image or known setting merely because it is empty in the observed files. [Battle background](../../spec/formats/battle-data.md#fight-background-bkg); [text background](../../spec/formats/legacy/text-formats.md#fight-background).

## Programs, fonts, media, saves and packages

| Family | Documented physical data or boundary | Important distinction |
|---|---|---|
| `.prg` | Plain ANSI/Windows-1252 text source, no header/version/checksum; comments, statements and line endings as in the language spec. Compiled form starts `00`, then NUL-terminated function names; class names, base names, member names/visibility, method names/parameter counts/instruction indices/visibility; instructions with type flags and type-dependent number, text, function ID/count or empty payload. | Inline board code can be source too. A referenced file and inline source must not be silently conflated; [program-bearing fields](fields-world-project.md#program-bearing-fields-evidence-and-ambiguity) lists documented sites and ambiguity. |
| `.fnt` | Toolkit 2 text: `RPGTLKIT FONT`, version, subversion, 2048 decimal bytes, eight top-first rows for each of 256 character codes; bit 7 is left. | Fixed 8×8 glyphs; no per-glyph width, palette or atlas. This legacy font is distinct from the optional SoundFont asset reference in `.gam` audio settings. |
| BMP/GIF/PNG/JPEG | Referenced image bytes carry their own format metadata; BMP describes dimensions, depth, compression and palette; GIF describes logical screen, colour tables, page position/dimensions, delay, transparency and disposal. PNG/JPEG are read as third-party formats. | Normalized width/height and straight RGBA are decoder results; colour key typically belongs to the referencing field, not the image. File bytes are retained as held by the game under the documented image policy. |
| Audio/media | Asset names appear in board music, cursor sounds, animations, fight backgrounds and game audio settings. | The cited file-family pages do not establish a universal physical media metadata schema; do not invent track duration, codec or tags as game-file fields. |
| `.sav` | Legacy binary captures globals, party, inventory/equipment, board placements, threads and execution state. Reawakened canonical save is JSON, with independently versioned sections and instruction identity. | Runtime continuation and game progress are not authored actor definitions. Legacy import is deferred. Detailed fields and old-minor variations belong to the save spec; neither absence of a legacy writer nor a sample proves absence of data support. |
| PAK/project paths | `.gam` references project-relative assets; package root contains `main.gam`, while unpackaged `projectPath` locates the project. Archive records and path rules are documented separately. | Packaging is distribution/storage, not evidence that logically related definitions must inhabit one physical file. |

No claim of occurrence in a specific game follows from this field catalogue; the separate measured census establishes its own corpus and limits. Format pages explicitly document variants that are absent in their cited samples.

## Key source files

- [Animation](../../spec/formats/animation.md), [tiles](../../spec/formats/tiles.md), [battle data](../../spec/formats/battle-data.md).
- [Program](../../spec/formats/rpgcode-program.md), [legacy text including font](../../spec/formats/legacy/text-formats.md), [images](../../spec/formats/images.md).
- [Save](../../spec/formats/save-game.md), [packaging and paths](../../spec/formats/packaging-and-paths.md), [main file](../../spec/formats/main-file.md).
