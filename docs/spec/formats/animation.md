# Animation (`.anm`)

A sequence of frames with a fixed delay, used for every sprite stance (walking, idling, battle), for scripts and for battle effects. Animations live in `Misc\`. Animated GIFs can be used anywhere an animation is expected.

Header text: `RPGTLKIT ANIM`. The only accepted minor for the binary layout is **3**; the Toolkit 2 line-based text form is minor 0 ([legacy/text-formats.md](legacy/text-formats.md#animation)). Detection is the byte at offset 13: `00` = binary, non-zero = text.

## Layout

| # | Field | Type | Meaning |
|---|---|---|---|
| 1 | header | string | `RPGTLKIT ANIM` |
| 2 | major | short | 2; ignored |
| 3 | minor | short | must be 3 |
| 4 | width | int | frame width in pixels |
| 5 | height | int | frame height in pixels |
| 6 | frame UB | int | upper bound of the frame list |
| 7 | × (UB+1) frame | | |
| 7a | image | string | an image in `Bitmap\` (any common format or `.tbm`), or a [tile reference](README.md#tile-references) such as `char.tst5` or `x.gph` |
| 7b | transpColor | colour | transparent colour for an image frame (the samples use white, `ff ff ff 00`) |
| 7c | sound | string | sound in `Media\` played when the frame is shown; empty = none |
| 8 | delay | double | seconds between frames |

**Empty frames.** The editor keeps 51 frame slots and writes all of them (UB = 50), most empty. The engine drops frames whose image is empty when playing; a gap in the middle of the list therefore shortens the sequence. The editor counts only up to the last non-empty frame.

**Reawakened rule (frame canvas and picture source).** The header's `width` and `height` are the frame's **canvas**: they place and anchor the sprite, and a picture frame fills that canvas. They never size the source rectangle. A frame's picture — a PNG, JPEG, BMP, GIF frame or a [tile bitmap](tiles.md#tile-bitmap-tbm) — is sampled whole at its own pixel size, so a 64×32 canvas naming a 32×32 image draws the whole image into the 64×32 canvas instead of reading 32 pixels past the texture. A tile-reference frame samples its own cell only. For sprites the tile keeps its own size at the canvas origin; for script animations it fills the animation's destination rectangle, including an explicitly sized destination ([E-54](../engine/plugins-and-battle.md#e-54)).


## Older versions

Text animations (Toolkit 2) are still read by both original programs; see [legacy/text-formats.md](legacy/text-formats.md#animation).

## Animated GIF

When an animation name ends in `.gif`, the frames are the GIF's pages; the size comes from the first page, the delay from the first page's frame time, and the transparent colour from the first page's background colour (magenta `(255, 0, 255)` if absent). **Reawakened rule (R-10):** this is the ruled reading — one delay from the first page, size from the first page, colour from the background colour with the magenta fallback; the GIF decoder's owner is entry 16.12.

## Written by the engine

The engine itself writes animations when it converts legacy items, enemies and fight backgrounds (see [legacy/conversion.md](legacy/conversion.md)): minor 3, delay 0.167 s, transparent white.

## Native form

Reawakened's own animation clip is a native document, not a Toolkit 3.1 file: [native-animation-clip.md](native-animation-clip.md) says where each field above goes, or why it is dropped. A legacy `.anm` reaches it only through an importer.

## Example

[../examples/listings/hero_walk_s.anm.txt](../examples/listings/hero_walk_s.anm.txt) — a two-frame walk animation from the example game.
