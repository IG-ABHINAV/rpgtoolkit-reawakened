# RPG Toolkit 3 compatibility specification

This is a behaviour and file-format specification of **RPG Toolkit 3.1** (the editor `toolkit3.exe` and the engine `trans3.exe`), written for the *RPG Toolkit Reawakened* rebuild. It describes what the original programs do and the bytes they read and write, so that a new engine and editor can load existing games and run them the same way.

**What this is not.** It contains no source code from the original programs and no references into it. It describes behaviour, data layouts and interface contracts. Where the original programs had bugs that existing games may depend on, they are listed as **compatibility notes** with a recommendation.

## How to read it

| Part | Contents |
|---|---|
| [formats/](formats/README.md) | Every current game file format, byte by byte: conventions, main file, board, character, item, enemy, animation, tiles (tilesets, isometric, single tiles, animated tiles, tile bitmaps), battle data, saved game, RPGCode programs, project layout, PAK and standalone EXE |
| [formats/legacy/](formats/legacy/README.md) | Legacy files: Toolkit 1-2 text formats, older 3.0 binary versions, how to detect them, and how the original programs converted them |
| [engine/main-loop-and-startup.md](engine/main-loop-and-startup.md) | Command line, start-up, the frame loop, timing, drawing order, shutdown |
| [engine/movement-and-collision.md](engine/movement-and-collision.md) | Positions, speed, sprite states, collision, activation of programs and items, board links, path-finding |
| [engine/display-input-audio.md](engine/display-input-audio.md) | Window modes, transparency, input mapping, music and sound, video, fonts |
| [engine/rpgcode-language.md](engine/rpgcode-language.md) | The scripting language: syntax, semantics, execution, threads, objects, virtual variables, quirks |
| [engine/rpgcode-functions.md](engine/rpgcode-functions.md) | All 282 built-in commands with signatures |
| [engine/plugins-and-battle.md](engine/plugins-and-battle.md) | Menu, battle and command plugins; the battle model and enemy AI; the 140-method callback interface |
| [engine/battle.md](engine/battle.md) | The Reawakened battle rules: boundary, state, loop, damage, status, AI, outcomes and starts (BAT-1 to BAT-15) |
| [engine/plugin-constants.md](engine/plugin-constants.md) | Info codes and enumerations used by the callback interface |
| [engine/accessibility.md](engine/accessibility.md) | The Reawakened accessibility contract: WCAG 2.2 AA for engine chrome, focus, contrast, target size, motion, the accessibility tree, projection of script-drawn content, the custom-UI insertion point, the port tiers and the harness report (A11Y-1 to A11Y-17) |
| [engine/rpgcode-tooling.md](engine/rpgcode-tooling.md) | The tooling contract: language server and debug adapter, one diagnostic model, the linter rules, formatting, the spec API, the index schema, the CI job, the debug view and `tkr script` with its exit codes |
| [engine/runners.md](engine/runners.md) | The runner contract: what a runner must do, what it may decide, the draw-list and audio obligations, the desktop applications, install and the library, load modes, prefetch, offline, mobile, build shape and the conformance kit |
| [engine/parity-checklist.md](engine/parity-checklist.md) | What "plays legacy games" requires, area by area: the reference the headless golden tests hold the engine to |
| [tools/](tools/README.md) | Python readers and writers for every format, a renderer, and the example-game builder |
| [examples/](examples/) | A small complete game in every format, with annotated byte listings and renders, built from original placeholder art |
| [examples/versions/](examples/versions/README.md) | One example file for every version of every asset format (older binary minors, Toolkit 1/2 text, every tile detail level), for testing an importer that upgrades files on the fly |
| [glossary.md](glossary.md) | Terms |

Start with [formats/README.md](formats/README.md) for the shared encoding rules; every other format page assumes them.

## Conventions used in this spec

- **"The original engine" / "the original editor"** mean Toolkit 3.1 as shipped. Behaviour that only one of them has is labelled.
- **Compatibility note** marks a quirk or bug of the original that matters for loading or running existing games.
- **Inferred** marks behaviour reasoned from the original program's logic but not observed by running it.
- **Unknown** marks something not established.
- Byte layouts use the type names defined in [formats/README.md](formats/README.md#primitive-encoding).

## How the formats were verified

- A reader implementing these layouts parses **every game file shipped with Toolkit 3.1** (40 binary files across the two sample games) to exactly the last byte.
- Boards, tilesets and animations were rendered from the parsed data and produce the expected maps and sprites, which checks the meaning of the fields as well as their sizes.
- Formats with no shipped sample were checked by comparing the original editor's writing logic with the original engine's reading logic field by field; the example files in [examples/](examples/) were built in that layout and read back.
- Engine behaviour was compared with the original engine's logic, not observed by running it on Windows.
- Not exercised by any real file: the legacy layouts in [formats/legacy/](formats/legacy/README.md) (documented from the original programs' reading logic only; no Toolkit 1-2 sample files were available), palette (8-bit) tiles, compiled RPGCode programs, and saved games containing running script threads.

## Biggest compatibility points

1. **Upper-bound counts.** Most lists store "number of entries − 1"; a few store exact counts. Each table says which.
2. **Enemy custom stances** are written with a 4-byte count but the original programs read 2 bytes; read what is on disk ([formats/enemy.md](formats/enemy.md#the-custom-stance-mismatch)).
3. **Column-major pixels** in tilesets and single tiles, and the fixed isometric diamond ([formats/tiles.md](formats/tiles.md)).
4. **Movement speed** is frame-rate based in the original; this spec gives the time-based equivalent ([engine/movement-and-collision.md](engine/movement-and-collision.md#speed)).
5. **RPGCode quirks** existing scripts rely on: `~=` for "not equal", no short-circuit evaluation, values truncated to integers when read from variables, inline code accepted wherever a program name is expected ([engine/rpgcode-language.md](engine/rpgcode-language.md)).
6. **No built-in menu or battle system.** Both were plugins; the engine supplies the battle model through callbacks ([engine/plugins-and-battle.md](engine/plugins-and-battle.md)).

## Assets

The example game and every render in this spec use art drawn by [tools/build_example_game.py](tools/build_example_game.py). No tiles, sprites, music or other assets from the Toolkit's own sample games are included.
