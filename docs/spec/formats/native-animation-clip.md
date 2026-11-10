# Native animation clip contract (`animation-clip`, version `1.0.0-pre.1`)

**Status: proposed, pending owner approval** (ticket 27.3, [#1804](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1804)). This is a **Reawakened rule**: it describes TK Reawakened's own native animation clip document, not any Toolkit 3.1 behaviour. The contract is **pre-release**: it is free to change, and nothing on this page is a 1.0 promise ([versions](native-contracts.md#versions)). A legacy [`.anm`](animation.md) file reaches this contract only through an importer ([ADR 0009](../../adr/0009-compatibility-layer-not-the-model.md)). The stamp, the version form and the identity rules are those of [native-contracts.md](native-contracts.md) and [ADR 0023](../../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md); this page repeats none of them beyond what it needs. The optional key `pluginData`, the contract's one open key, was added in the same pre-release (2026-11-09), so the contract stays at `1.0.0-pre.1`: a pre-release contract is free to change ([ADR 0023](../../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md), decision 2).

## In plain words

A clip is a short flip-book for your game: a list of pictures shown one after another, with the same pause between each. A character's walk, a sword swing and an explosion are each a clip.

You list the pictures you actually use, in the order you want them shown. A clip has as many frames as you list: two, five or fifty. There are no empty slots to fill and no gaps to skip, and moving a frame in the list moves it in the animation. Each frame names its picture (an image file, or one tile of a tileset) and may name a sound that plays when that frame appears.

The clip also says how big the box is that the pictures are drawn into (the canvas), how many seconds pass between frames, and which colour should count as see-through (the colour key). One colour key can serve the whole clip, and a single frame can name its own when its picture needs a different one.

The clip does not say where it is shown, how big it is drawn, whether it repeats, or who uses it. Whatever plays the clip decides that. The first lines of the file say that it is a clip and which version of the clip contract it follows, so a person or a tool always knows what shape to expect.

The rules below are precise. The examples use YAML, the authored notation the owner accepted in [research #1799](../../findings/native-data-notations/README.md); the rules do not depend on YAML, and the layout of a document on lines and the YAML profile are not set here ([open items](#open-items)).

## A clip at a glance

This is the [example game's](../examples/listings/hero_walk_s.anm.txt) two-frame south walk, written as a native clip. The old file held 51 frame slots and filled two; the clip lists two frames.

```yaml
contract: animation-clip
version: 1.0.0-pre.1
tags: [imported]
metadata:
  source: hero_walk_s.anm
canvas:
  width: 32
  height: 32
delay: 0.15
colourKey: {r: 255, g: 255, b: 255}
frames:
  - image: tiles/village.tst14
  - image: tiles/village.tst15
```

More valid and invalid examples, with the exact failure of each invalid one, are in [../examples/native/animation-clip/](../examples/native/animation-clip/README.md). The schema is [../schemas/tkr-animation-clip.schema.json](../schemas/tkr-animation-clip.schema.json).

A clip that carries plugin data adds one key, `pluginData`, with a block for each plugin that has data on the clip. The block is the plugin's, and the clip's own fields are untouched:

```yaml
contract: animation-clip
version: 1.0.0-pre.1
canvas: {width: 32, height: 32}
delay: 0.15
frames:
  - image: tiles/village.tst14
pluginData:
  com.example.glow:
    version: 1.0.0
    data: {bloom: 0.4}
```

The examples folder does not yet hold a document with `pluginData`, because the [reference reader](#reference-reader-writer-and-importer) still refuses one.

## Fields

The contract area is closed: a key that is not in these tables is an error ([rule 9](#rules)). The exceptions are the contents of `tags` and `metadata`, which the engine never reads, and the one open key, `pluginData`, whose blocks belong to plugins.

### The clip

| Key | Required | Type | Meaning |
|---|---|---|---|
| `contract` | yes | text | The name of this contract. Always `animation-clip`. |
| `version` | yes | text | The contract version the document was written against. For this page, `1.0.0-pre.1`, with an optional `+build` suffix that does not change the version. |
| `tags` | no | list of non-empty text | Free-form labels for people and tools, such as `imported`. |
| `metadata` | no | mapping | Facts about where the document came from, such as `source`. |
| `canvas` | yes | mapping | The box each frame is drawn into: `width` and `height`, in pixels, each a whole number of at least 1. |
| `delay` | yes | number | Seconds between one frame being shown and the next. Zero or more. |
| `colourKey` | no | colour | The colour that counts as see-through in every frame that names no key of its own. Absent means the clip names no key. |
| `frames` | yes | list of frame | The frames in the order they are shown. At least one. |
| `pluginData` | no | mapping | Plugin blocks: one per plugin id, each with its own `version` and a `data` mapping the plugin owns. The one open key of the contract ([plugin blocks](native-contracts.md#plugin-blocks)). Absent means the clip carries no plugin data. |

### A frame

| Key | Required | Type | Meaning |
|---|---|---|---|
| `image` | yes | reference | The picture: the ID of an image asset, or a tile reference. |
| `sound` | no | reference | The ID of a sound asset, played once when this frame is shown. Absent means no sound. |
| `colourKey` | no | colour | This frame's own colour key. It wins over the clip's. |

A **reference** is text that names an asset by its ID; [rules 4 and 5](#rules) say how.

### A colour

A colour is a mapping of `r`, `g` and `b`, each a whole number from 0 to 255, for example `{r: 255, g: 0, b: 255}`. There is no alpha. The legacy colour is one number, `R + G·256 + B·65536` ([primitive encoding](README.md#primitive-encoding)); the native colour spells the three parts out so no reader has to know that order.

### A plugin block

A key of `pluginData` is a plugin id (lowercase ASCII segments separated by dots, such as `com.example.glow`, or one segment, such as `stock_battle`; [PKG-2](../engine/rpgcode-modules-and-objects.md#pkg-2)). It is never one of the reserved keys (`contract`, `version`, `tags`, `metadata`, `pluginData`) or a field of this contract (`canvas`, `delay`, `colourKey`, `frames`).

| Key | Required | Type | Meaning |
|---|---|---|---|
| `version` | yes | text | The version of that plugin's data on this contract, in the [version form](native-contracts.md#the-form-of-a-version-string). |
| `data` | yes | mapping | The plugin's data. The plugin owns every key inside it. An unknown key is tolerated, never reported and never dropped. |

## Rules

1. **Stamp.** The document starts with the stamp exactly as [native-contracts.md](native-contracts.md#stamp) defines it: `contract` and `version` are the first two keys, `tags` and `metadata` are optional, and neither is read by the engine nor changes how a clip plays. They hold no timestamps and no value that changes on every save. A missing, repeated or unreadable stamp is an error; a reader never guesses a contract or a version. *Reason:* the stamp is how a loader chooses the rules for the rest of the document.
2. **Frames and their order.** The order of `frames` is the order they are shown, first listed first. The list holds only frames that show a picture: there is no empty slot, no padding and no stored count, and the count is the length of the list. There is no upper limit, and a clip has at least one frame. *Reason:* the old editor kept 51 fixed slots and filled few of them (see [the census](#what-the-census-saw)); a clip that says only what it shows is shorter to read, to diff and to merge.
3. **Time.** `delay` is in **seconds**, a finite number of zero or more, and is the same after every frame; the clip has one timing and a frame has none of its own. How a delay in seconds is played on the engine's fixed tick is the engine's rule and is not changed here ([G3](../../guardrails.md#g3--determinism), [E-54](../engine/plugins-and-battle.md#e-54)). The pages read for this contract do not say what playback does with a delay of zero ([open items](#open-items)). A frame time of its own would be a new optional property.
4. **Pictures.** `image` is a **reference**. It names either an image asset by its ID, or one tile of a tileset by a [tile reference](README.md#tile-references) spelled with the tileset's ID and the tile number, such as `tiles/village.tst14`. The tile-reference spelling is provisional until the tile contract is written ([open items](#open-items)). A picture is sampled whole at its own pixel size; the canvas never picks which part of it is read, and a tile reference samples its own cell only. These are the rules of [animation.md](animation.md#layout) and apply to a native clip unchanged.
5. **IDs.** An `image` or `sound` reference is an ID in the sense of [native-contracts.md](native-contracts.md#identity): the lowercase path of the asset, compared without regard to ASCII case, resolved against the file system by the entry whose casing matches. A writer writes it lowercase. The schema checks only that the reference is one non-empty line with no space at either end; it does not check that the file exists. The ID of a native document includes its extension and its separator is `/` ([ruled](native-contracts.md#identity)); a picture or a sound is not a native document, and its reference is spelled the same way, with `/` and the file's own extension, as the examples and the importer spell it.
6. **Sound.** A frame's `sound` is played once, when that frame becomes visible; the routing and the one-voice rule are [R-59](../engine/audio-media.md#r-59-routing) and are not changed. Leaving the key out means no sound; an empty text is not accepted.
7. **Colour key.** Each frame has one colour key: its own `colourKey` if it has one, otherwise the clip's `colourKey`, otherwise none. The key is not stored in the picture file. It is tested against the picture's decoded pixels by whatever draws the frame ([images.md](images.md#the-shared-decode-contract)). A clip that writes the same key on every frame and a clip that writes it once at the clip level mean the same thing.
8. **Canvas.** `canvas.width` and `canvas.height` are the frame's canvas in the sense of [animation.md](animation.md#layout): they place and anchor the sprite, and a picture frame fills that canvas.
9. **A closed contract with one open door.** An unknown key in a clip or in a frame is an error, and so is a mistyped one (`colorKey`). *Reason:* an engine that ignores a key it does not know lets a typo pass for a setting. The exception is `pluginData` at the top level of the clip: data that a plugin wants to keep about a clip goes in a block there, under the plugin's id, and it is never an extra key of the clip ([plugin blocks](native-contracts.md#plugin-blocks)). The top level admits exactly the clip's fields, the stamp keys and `pluginData`. Inside a block's `data`, unknown keys are tolerated and preserved. A frame, a canvas and a colour have no door, so a plugin that needs per-frame data keeps its own structure inside its own block.
10. **Absence.** "No value" is written by leaving the key out. No key of the contract accepts `null`; the free-form contents of `metadata` are not contract keys. *Reason:* each optional thing then has exactly two states, present or absent, and an empty text or a null can never mean a third.
11. **Not part of a clip.** Position on the screen or board, drawing size, repetition and whether the clip runs once or until ended belong to whatever plays the clip (the `animation`, `sizedanimation` and `pinnedanimation` commands and the actor and skill contracts to come). The clip describes the pictures, not the use.
12. **Playback.** A loaded native clip is the same thing the engine plays today: ordered frames of picture, colour key and sound, at one delay, on one canvas. The playback rules of [E-54](../engine/plugins-and-battle.md#e-54) and [animation.md](animation.md) apply to it unchanged, with the step "drop frames whose picture is empty" already done by the list holding only real frames.
13. **File name.** A clip document is stored under the extension `.tkranm`, the one the [registry](native-contracts.md#the-registry) holds for `animation-clip`, and the extension and `contract: animation-clip` must agree ([file names](native-contracts.md#file-names)). A legacy [`.anm`](animation.md) is not a clip document; an `.anm` and a `.tkranm` with the same stem can sit in one folder. *Reason:* the extension lets a person and a tool tell a clip from a legacy file by its name alone.

## What checks what

The schema is a machine-checkable statement of these rules. Where the schema and this page disagree the page wins and the schema has a bug, fixed as a PATCH ([versions](native-contracts.md#versions)). The schema checks the JSON form a YAML document is read into; some rules belong to other checks.

| Rule | Schema | Other check |
|---|---|---|
| `contract` and `version` present; `contract` is `animation-clip`; `version` is text in the [version form](native-contracts.md#versions) and is `1.0.0-pre.1` | yes | |
| `contract` and `version` are the first two keys | no, JSON has no key order | the reader and the [checker](native-contracts.md#checker) |
| the extension is `.tkranm` and agrees with `contract: animation-clip` | no, the schema reads the JSON form, not the file name | the [checker](native-contracts.md#checker), for a file with the extension `.tkranm`: extension and contract disagree (proposed class) |
| a key repeated in a mapping | no, the value is already read | the YAML profile's parse check ([research profile](../../findings/native-data-notations/yaml-profile/README.md#proposed-yaml-profile-to-be-decided-not-adopted)) |
| unknown keys, in a clip, a frame, a canvas or a colour | yes | |
| `pluginData` is a mapping of blocks; each key is a plugin id of the PKG-2 grammar that is not a reserved key or a field of this contract; each block has exactly `version` (in the version form) and `data` (a mapping) | yes | |
| a plugin id appears once in `pluginData` | no, the value is already read | the [checker](native-contracts.md#checker): `plugin-block`, kind `duplicate` |
| a block's `data` has the keys and types its plugin declares | no, the schema leaves `data` open | the plugin's own schema, only when the plugin is installed ([checks that need the plugin](native-contracts.md#checks-that-need-the-plugin)) |
| every frame has an `image`; at least one frame | yes | |
| `canvas`, `delay`, colour parts and counts have the right type and range | yes | |
| `tags` is a list of non-empty text; `metadata` is a mapping | yes | |
| nothing in `tags` or `metadata` is a timestamp or changes on every save | no | review; a standard `metadata` vocabulary is open |
| a reference names a file that exists | no | not one of the checker's classes ([open items](#open-items)) |
| `delay` is finite | JSON cannot spell NaN or infinity | the YAML profile's number rule, still open |

## Field accounting

Every field of a legacy [`.anm`](animation.md) has a row below, in the order of the legacy layout: the binary minor 3, the Toolkit 2 text form, the animated GIF, and the values the engine writes when it converts items, enemies and fight backgrounds. A row says **mapped** to a native key, or **dropped** with the reason. Nothing is omitted without a row.

"Evidence" separates three things. **Observed** is a field of the decoded model in the [research census](../../findings/native-data-boundaries/README.md) of 194 decoded `.anm` files ([`data/fields.jsonl`](../../findings/native-data-boundaries/data/fields.jsonl)). **Documented only** is a physical field the format page describes that the decoded model does not carry, so the census cannot count it. **Writer default** is a value a legacy writer puts in, not a field.

### Binary minor 3 ([layout](animation.md#layout))

| # | Legacy field | Evidence | Native | Reason or note |
|---|---|---|---|---|
| 1 | `header`, text `RPGTLKIT ANIM` | observed: `magic`, all 194 files | **dropped** | The stamp's `contract: animation-clip` says what the document is. |
| 2 | `major` (short, `2`, ignored by readers) | observed: `major` is 2 in all 194 | **dropped** | The legacy layout's own version. Readers ignore it, so it carries no information. The native `version` is the contract's version, not a translation of this. |
| 3 | `minor` (short, must be `3`) | observed: `minor` is 0 in the 118 text files; the other 76 are binary, whose only accepted minor is 3 | **dropped** | It only selects the legacy layout. An importer reads it and does not carry it; whether it records the source in `metadata` is an importer choice ([open items](#open-items)). |
| 4 | `width` (int, pixels) | observed: whole numbers from 32 to 400 | `canvas.width` | Kept: it is behaviour, the frame's canvas. |
| 5 | `height` (int, pixels) | observed: from 32 to 400 | `canvas.height` | As `width`. |
| 6 | frame UB (int, the upper bound of the frame list) | documented only; editor-written files have 50 | **dropped** | The count is the length of `frames`. The number 50 is the capacity of the old editor (51 slots), not a property of a clip. |
| 7 | one frame record per slot, UB + 1 of them | observed: 9,894 slots, 852 with an image | **mapped** to `frames[]`: one entry per slot that has an image, in slot order | Empty slots are **dropped**, with whatever colour or sound they stored: the engine drops a frame with no image when it plays, so a clip made only of real frames plays the same sequence. Fixed-capacity padding is not data. |
| 7a | `image` (string) | observed: 852 non-empty values | `frames[].image` | The legacy name is folded to a lowercase ID and resolved from its type folder to a project path by the importer ([open items](#open-items)). A tile reference such as `village.tst14` becomes the tileset's ID plus the tile number, as in `tiles/village.tst14`. |
| 7b | `transpColor` (colour) | observed: three channels per slot | `colourKey` (the clip default) or `frames[].colourKey` (an override) | The legacy colour is stored per frame; the native clip keeps that meaning and lets one key at the clip level stand for the frames that share it ([rule 7](#rules)). The legacy high byte is zero in every value and is not carried. |
| 7c | `sound` (string) | observed: 120 non-empty slots in 96 files | `frames[].sound` | An empty string, which means no sound, becomes an absent key. |
| 8 | `delay` (double, seconds) | observed: all 194, from 0 to 0.333…; 0 in 62 files | `delay` | The value is carried unchanged, zero included. |
| – | bytes after the last documented field | observed: `residue` is zero bytes in all 194 | **dropped** | The legacy binary rule keeps such bytes so that a re-save is byte for byte ([residue](README.md#bytes-after-the-last-documented-field)); none exist in the census, and a native clip is not saved through a legacy writer. The 1:1 oracle keeps them. |

### Toolkit 2 text, minor 0 ([layout](legacy/text-formats.md#animation))

118 of the 194 census files are this form.

| Line(s) | Legacy field | Evidence | Native | Reason or note |
|---|---|---|---|---|
| 1 | header `RPGTLKIT ANIM`, compared without regard to case | observed: `magic` | **dropped** | As binary 1. |
| 2, 3 | major and minor (ignored) | observed: decoded as 2 and 0 | **dropped** | As binary 2 and 3. |
| 4, 5 | width and height | observed | `canvas.width`, `canvas.height` | As binary 4 and 5. |
| 6 | the frame-count line | documented only | **dropped** | The editor ignores it; the engine trusts it, and all 17 text files in the original corpus write `0` while 51 frames follow ([R-17](legacy/text-formats.md#animation)). The reading rule (take 51 by position) is a legacy-reader concern; the list length replaces the count. |
| 7–159 | 51 × (image, transparent colour, sound) | observed | `frames[]`, as binary 7 to 7c | Empty slots dropped as above. |
| 160 | delay (seconds) | observed | `delay` | As binary 8. |
| – | binary or text, told apart by the byte at offset 13 | documented only | **dropped** | A detection rule for the legacy reader, not a field. |

### Animated GIF ([rule R-10](animation.md#animated-gif))

When an animation name ends in `.gif`, the legacy engine takes an animation from the picture file. These values are decoded from that file; none is a field of an `.anm`, so the census of `.anm` files has no row for them.

| Legacy value | Source | Native | Reason or note |
|---|---|---|---|
| the frames | the GIF's pages | not represented | A page of a GIF has no ID, so a frame cannot name it. |
| size | the first page | not represented | A property of the GIF, read by its decoder. |
| delay | the first page's frame time | not represented | As size. |
| transparent colour | decided per [images.md](images.md#an-animated-gif-adopted-as-an-animation) | not represented | As size. |

A GIF stays an animated image asset. How a consumer names an animated image as opposed to a clip, and whether an importer converts a GIF into a clip with page assets, are open ([open items](#open-items)).

### Written by the engine

When the engine converts legacy items, enemies and fight backgrounds it writes an animation with minor 3, delay 0.167 s and transparent white ([animation.md](animation.md#written-by-the-engine)). These are **writer defaults**: values in the converter's output, not defaults of the native contract. The native contract has no defaults: `delay` is required, and `colourKey` absent means no key. Writing 0.167 or white is a choice an author or an importer makes, visibly, in the document.

### What the census saw

The 194 decoded files come from 20 collections of the research corpus; the labels are not a claim of 20 distinct games. The figures below are sums over [`data/fields.jsonl`](../../findings/native-data-boundaries/data/fields.jsonl) and the `frames[].image` and `frames[].sound` rows of [`data/relationships.jsonl`](../../findings/native-data-boundaries/data/relationships.jsonl).

- **Slots.** 9,894 slots (194 × 51); 852 hold an image (about 9%), 9,042 do not. Every file holds at least one image, and the fullest holds 50. The census cannot say where the empty slots sit inside a file.
- **Pictures.** 708 of the 852 name an image file (319 GIF, 242 BMP, 87 PNG, 60 JPEG) and 144 name a tile of a `.tst` tileset. No file names a tile of an isometric tileset, a single `.gph` tile or an animated tile. Of the 447 distinct reference values, 131 contain an upper-case letter, so the ID rule folds them; none has a path separator, and none has a space or line break at either end.
- **Sounds.** 120 slots in 96 files name a sound: 116 `.wav` and 4 `.mid`.
- **Delay.** 0 in 62 files, otherwise up to 0.333… seconds.
- **Canvas.** Whole numbers from 32 to 400 on both sides.
- **Not established.** Whether any file gives different colour keys to its filled frames, and whether a stored sound or key ever sits in an empty slot, because the census records colours only as channel counts and the sounds without their slot number.
- **Refused.** The decoders refuse 2 further animation files ([coverage](../../findings/native-data-boundaries/coverage.md#refused-and-absent-data)); this contract says nothing about them.

## Importer output as test oracle

The 1:1 importer output is the legacy decoder's model of an `.anm`: 51 slots in order, each with image, colour and sound, the delay, the size, the legacy header fields and any residue. It is a **test oracle**: it is never the native format and is never published as 1.0 ([ADR 0023](../../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md), decision 9). It exists so a test can say whether a native clip made from a legacy file is the same animation.

A native clip **equals** a legacy animation when all of these hold:

1. `canvas.width` and `canvas.height` equal the legacy `width` and `height`.
2. `delay` equals the legacy delay, as the same number.
3. `frames` has one entry for each legacy slot with an image, in slot order, and no others.
4. Each entry's `image` is the legacy name resolved to the same asset (compared after ASCII folding), its `sound` is the slot's sound or absent where the slot's is empty, and its colour key (rule 7) is the slot's colour.

How an importer resolves names, where it writes a key at the clip level instead of on every frame, and what it reports when it drops a slot that held a sound or a colour are story 27.4's ([#1805](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1805)). This page fixes only what has to be equal.

## Schema

[../schemas/tkr-animation-clip.schema.json](../schemas/tkr-animation-clip.schema.json) is a [JSON Schema](https://json-schema.org/draft/2020-12) (draft 2020-12) for the JSON form of a clip document. It describes version `1.0.0-pre.1` of the contract only; it is replaced when the contract's version changes, and how older versions' schemas are kept once a MAJOR is published is open. It names its dialect in `$schema`, closes every contract object (the clip, the canvas, a frame and a colour) with `additionalProperties: false`, opens exactly one key, `pluginData`, whose envelope it checks and whose `data` it leaves open, and uses neither `$dynamicRef` nor `unevaluatedProperties`, because the notation research found a validator that mis-evaluates the first and ignores the second when the dialect is not named ([research](../../findings/native-data-notations/README.md#6-schema-validation-is-notation-independent-error-locations-are-not)).

## Reference reader, writer and importer

Story 27.4 ([#1805](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1805)) added a reference reader, writer and legacy importer. They implement this page and decide nothing in it; this note records the choices the page left open, so that a later change of any of them is a visible decision. **Everything below is provisional**: the owner has not set the layout contract or the YAML profile, and none of it is a 1.0 promise.

- **Where.** `readClip`, `writeClip`, `setClipProperty` and `removeClipProperty` are in `packages/native-data` (pure text in, text or model out, no file access). The importer, `importAnimation`, is in `packages/native-data-import`: it needs the legacy decoder's model from `@tk-reawakened/core`, and `native-data` may not depend on another workspace package.
- **Validation is hand-written**, not run through the schema, so no validator is a dependency. It was checked against the schema (Ajv 8.20.0, `ajv/dist/2020`, strict) on the 3 valid and 5 invalid examples and on 99 further documents (21 documents accepted, 86 refused in all): the two agreed on every one. That check is a throwaway script, not part of the repository. The reader is deliberately stricter than the schema where the schema cannot see: it refuses a stamp that is missing, repeated or not first, a key repeated anywhere, and a `delay` that is not finite ([what checks what](#what-checks-what)). It also reads only version `1.0.0-pre.1` (any `+build`), as the schema does; what a loader does with another version is [open item 10](#open-items).
- **Layout of a written document.** The stamp first, then `tags`, `metadata`, `canvas`, `delay`, `colourKey`, `frames`; block mappings with a two-space indent; `tags` and every colour in flow style (`{r: 255, g: 0, b: 255}`); one frame per list entry, its keys in the order `image`, `sound`, `colourKey`; no line folding. The same clip always gives the same text, and `delay` is written with the shortest digits that read back as the same number.
- **Editing in place.** `setClipProperty` replaces only the text of the value it sets, so every other byte of the document, every comment and the spacing before a trailing comment stay as written: a one-property edit of an existing property changes exactly one line. A property that is absent is added as one new line after the entry that precedes it in the key order above (or as one `, key: value` in a flow mapping). `removeClipProperty` removes a key's line with any comment on that line. A colour is set through its three parts. Not supported: adding, removing or reordering frames and tags, and adding `tags` or `metadata` to a document without them. A document the reader refuses is not edited, and an edit that would leave a document the reader refuses is not made. (The `yaml` package's own re-print of a parsed document does not keep unrelated lines as written: it changes the spacing before comments, so it is not used to produce the edited text.)
- **How the importer spells IDs** ([open item 3](#open-items)): a legacy name has `\` changed to `/` and A to Z folded to lowercase, then a folder is put in front: `tiles/` for a tile reference (`.tst`, `.iso` with a tile number, or `.gph`), so `Village.TST14` becomes `tiles/village.tst14`; `bitmap/` for every other picture, `.tbm` included; `media/` for a sound. The extension is kept. The importer does not check that a file exists ([open item 8](#open-items)). It names no file for the clip it returns; a document made from the clip takes the extension `.tkranm`.
- **How the importer spells keys** ([open item 9](#open-items)): when every kept frame has the same colour it writes one clip-level `colourKey` and none on the frames; when they differ it writes no clip-level key and a `colourKey` on every frame. It reports, and does not keep, a dropped slot that held a sound. `tags` is `[imported]` and `metadata` is `source: <legacy file name>` as the caller gives it, with case kept; nothing else is recorded, so importing the same file twice gives the same text.
- **What the importer refuses**, with the contract's rule named, rather than repairing: no frame with an image, a size under 1, a negative or non-finite delay, and a name with a space or line break at either end.
- **The oracle.** The tests' oracle is the decoder's model slot for slot (51 slots, with image, colour and sound, the delay, the size, the header and the residue), and the four-point equality of the section above is a test utility that names the point that fails. Across the 51 decoded `.anm` files of `docs/spec/examples` (9) and the fetched legacy sample games (42) every import, written and read back, equals its oracle, 18 of them with a delay of 0.
- **`pluginData` is not yet read or written by this code.** The reader still refuses it as an unknown key, and `writeClip` cannot carry a block, because the code was written before the 2026-11-09 plugin-block rulings. Story 27.10 ([#1822](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1822)) makes the reader accept it, the editing paths leave every block byte for byte, and the writer and importer carry blocks as verbatim text ([preservation](native-contracts.md#preservation)). The examples folder is test data that `packages/native-data/test/clip.test.ts` reads, so it gains its plugin-bearing cases in that same story.

## Open items

This page does not choose the layout contract (how a document is laid out on lines), the YAML profile rules, or any reader, writer or importer: those are [#1799](../../findings/native-data-notations/README.md) and story 27.4 ([#1805](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1805)). The examples show one authored layout and decide nothing about it. Also open:

1. **Layout and notation rules.** How a clip is laid out on lines (block or flow, one frame per line), the YAML profile, how a delay's digits are kept so a read-write round trip gives the same number, and whether the project needs one rule for an absent key against a `null`. This contract accepts no `null`.
2. **Standard `metadata` keys and the `tags` vocabulary**, as in [native-contracts.md](native-contracts.md#not-decided-here). The `source` and `notes` keys in the examples are not standard.
3. **Spelling of IDs.** The ID of a native document includes its extension and uses `/` ([native-contracts.md](native-contracts.md#identity)); that part is settled. Still open: the project folder names, how an importer turns a legacy name (relative to `Bitmap\`, `Tiles\` or `Media\`) into a project path, and whether the asset contracts say anything more about the spelling of a picture's or a sound's ID. The example paths are illustrative.
4. **Tile references.** The spelling `tiles/village.tst14` carries the legacy form. The tile contract decides how a tile region is identified; a change then is a change to this contract's version.
5. **Animated GIF.** A page has no ID, so a clip cannot name one. How a consumer refers to an animated image as against a clip, and whether the importer turns a GIF into a clip plus page assets.
6. **Zero delay.** 62 of the 194 census files carry 0, and the pages read for this contract do not say what playback does with it. Whether the contract should require more than zero, or an engine page should say what zero means, is open.
7. **Colour key on a tile frame.** [animation.md](animation.md#layout) names the colour for "an image frame" and does not say whether a frame that names a tile uses it. The contract carries it for every frame unchanged and decides nothing.
8. **Missing assets.** A frame can name a file that does not exist. That is not one of the [checker's classes](native-contracts.md#checker); which tool reports it, and when, is open.
9. **How an importer spells keys.** One `colourKey` at the clip level or one on every frame when all frames share a colour, and what it writes when they differ. Also whether it reports a dropped slot that held a sound or a colour.
10. **Schemas of older versions**, how a loader picks a schema from the stamp, and what a loader does with a newer MINOR or PATCH it does not know within the same MAJOR ([native-contracts.md](native-contracts.md#not-decided-here)).
11. **Schema technology.** A JSON Schema is published here because the ticket asks for one; the project-wide choice of schema technology is still open in [ADR 0023](../../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md#open-questions).
12. **Later properties.** A frame time of its own, a frame offset or anchor, and a sound that is not tied to a frame are not in this version and are not decided. Each would be a new optional property.
13. **Plugin blocks on a clip.** Which plugins extend clips, and what their blocks hold, belong to those plugins' own contributions ([ADR 0024](../../adr/0024-plugin-data-contributions.md)) and are not decided here. A frame has no door; whether a nested object may ever carry one is the decision of the scene contract ([native-contracts.md](native-contracts.md#not-decided-here)). Whether a host shows an unknown key inside `data` as a hint is open.
