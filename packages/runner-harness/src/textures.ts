/**
 * Host-side texture decoding for a runner that has to draw a draw list itself.
 *
 * `core` decodes game pictures (AD-28) and, for the browser runner, a tileset is a horizontal strip of tiles — the same
 * shape the reference rasteriser consumes. Decoding belongs on the host side of the seam: a runner receives bytes through
 * AD-5 and hands `render-webgl2` pixels, never a path.
 *
 * A kind this function does not decode returns `null` and the caller reports it as a deferred command rather than drawing
 * a wrong pixel. Today that is `.tan` (animated tiles, whose frame comes from the tick) and `.tbm` (a tile bitmap composed
 * from other tiles); a draw naming either takes its pixels from the core (`engine.picturePixels`,
 * docs/spec/engine/runners.md#picture-pixels), because composition is the core's rule and a host must not reproduce it.
 */

import { decodeTexture, expandSingleTileToRgba, expandTileToRgba, readSingleTile, readTileset, tileDimensions, type AssetKey, type DecodedTexture } from "@tk-reawakened/core";

/** Decode one draw-list texture asset, or `null` when this entry's decoder does not cover its kind. */
export function decodeAssetTexture(key: AssetKey, bytes: Uint8Array): DecodedTexture | null {
  if (key.endsWith(".tst") || key.endsWith(".iso")) {
    const parsed = readTileset(bytes, key);
    if (!parsed.ok) return null;
    const model = parsed.value;
    const { width: storedWidth, height: storedHeight } = tileDimensions(model.detail);
    const scale = model.detail.size === 16 ? 2 : 1;
    const tileWidth = storedWidth * scale;
    const tileHeight = storedHeight * scale;
    const rgba = new Uint8Array(tileWidth * model.tiles.length * tileHeight * 4);
    for (let tile = 1; tile <= model.tiles.length; tile += 1) {
      const expanded = expandTileToRgba(model, tile - 1);
      if (!expanded.ok) return null;
      for (let y = 0; y < tileHeight; y += 1) {
        for (let x = 0; x < tileWidth; x += 1) {
          const from = ((Math.floor(x / scale) * storedHeight + Math.floor(y / scale)) * 4);
          const to = (y * tileWidth * model.tiles.length + (tile - 1) * tileWidth + x) * 4;
          rgba.set(expanded.value.subarray(from, from + 4), to);
        }
      }
    }
    return { w: tileWidth * model.tiles.length, h: tileHeight, rgba };
  }
  if (key.endsWith(".tan") || key.endsWith(".tbm")) return null;
  if (key.endsWith(".gph")) {
    // A single tile is text, not a picture signature; the tile decoder expands it and the draw names it whole.
    const parsed = readSingleTile(bytes, key);
    if (!parsed.ok) return null;
    const rgba = expandSingleTileToRgba(parsed.value, "row-major");
    if (!rgba.ok) return null;
    return { w: parsed.value.width, h: parsed.value.height, rgba: rgba.value };
  }
  const decoded = decodeTexture(bytes, key);
  return decoded.ok ? decoded.value : null;
}
