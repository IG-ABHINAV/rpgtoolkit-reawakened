/**
 * Pure cache-readiness check for a TBM and every tile it draws
 * (`docs/spec/formats/tiles.md#tile-bitmap-tbm`). This deliberately reads
 * format metadata only: it does not request assets, mutate the injected caches,
 * emit diagnostics, or expand pixels into textures.
 */
import { BinaryReader } from "../formats/binary/reader.ts";
import { readTileBitmap, tileBitmapCell } from "../formats/tile-bitmap/index.ts";
import { readTileAnimation } from "../formats/tile-animation/reader.ts";
import { readSingleTile } from "../formats/single-tile/index.ts";
import { readTileset, tileDimensions } from "../formats/tileset/index.ts";
import type { FormatError } from "../formats/result.ts";
import { resolveTileReference } from "../formats/resolver/resolver.ts";
import type { AssetIndex, AssetRoot } from "../formats/resolver/model.ts";
import type { AssetKey } from "../ports/keys.ts";

/** Result of checking whether all drawable TBM tile dependencies are cached. */
export type TileBitmapReadiness =
  | { readonly status: "ready" }
  | { readonly status: "missing"; readonly asset: AssetKey }
  | { readonly status: "invalid"; readonly error: FormatError };

/**
 * Determine whether `tbm` and all of its drawable tile dependencies can be
 * decoded from `cache`. Missing index entries and malformed references/files
 * are invalid; an indexed asset absent from cache is missing. The TBM editor's
 * 1..40 dimension rule is intentionally not applied: file readers permit other
 * dimensions, and `readTileBitmap` enforces the file's structural bounds.
 *
 * Animated tiles depend on their first frame only. Cells are examined in the
 * compositor's x-outer/y-inner order and the TBM's padding row/column are not
 * considered drawable.
 */
export function checkTileBitmapReadiness(
  tbm: AssetKey,
  cache: ReadonlyMap<AssetKey, Uint8Array>,
  index: AssetIndex,
  root: AssetRoot,
): TileBitmapReadiness {
  const bytes = cache.get(tbm);
  if (bytes === undefined) return { status: "missing", asset: tbm };
  const bitmap = readTileBitmap(new BinaryReader(bytes, tbm));
  if (!bitmap.ok) return { status: "invalid", error: bitmap.error };

  const resolvedTiles = new Set<string>();
  const columns = Math.max(0, bitmap.value.width);
  const rows = Math.max(0, bitmap.value.height);
  if (columns === 0 || rows === 0) {
    return invalid(
      `tile bitmap has no drawn cells (width ${bitmap.value.width}, height ${bitmap.value.height})`,
      "docs/spec/formats/tiles.md#tile-bitmap-tbm",
    );
  }
  const outputWidth = columns * 32;
  const outputHeight = rows * 32;
  if (outputWidth * outputHeight > 100_000_000) {
    return invalid(
      `tile bitmap picture ${outputWidth} × ${outputHeight} is over the 100000000-pixel limit (docs/spec/formats/images.md#the-shared-decode-contract)`,
      "docs/spec/formats/tiles.md#tile-bitmap-tbm",
    );
  }
  for (let x = 0; x < columns; x += 1) {
    for (let y = 0; y < rows; y += 1) {
      const cell = tileBitmapCell(bitmap.value, x, y);
      if (cell === undefined || cell.tile === "" || resolvedTiles.has(cell.tile)) continue;
      resolvedTiles.add(cell.tile);
      const resolved = resolveTileReference(index, root, cell.tile);
      if (!resolved.ok) return { status: "invalid", error: resolved.error };
      let tile = resolved.value;
      if (tile.kind === "empty") {
        return invalid(`tile bitmap cell reference "${cell.tile}" is empty`, "docs/spec/formats/README.md#tile-references");
      }
      if (tile.kind === "animatedTile") {
        const animationBytes = cache.get(tile.asset);
        if (animationBytes === undefined) return { status: "missing", asset: tile.asset };
        const animation = readTileAnimation(new BinaryReader(animationBytes, tile.asset));
        if (!animation.ok) return { status: "invalid", error: animation.error };
        const first = animation.value.frames[0] ?? "";
        if (first === "") {
          return invalid(`animated tile "${tile.path}" has no first frame`, "docs/spec/formats/tiles.md#animated-tile-tan");
        }
        const frame = resolveTileReference(index, root, first);
        if (!frame.ok) return { status: "invalid", error: frame.error };
        if (frame.value.kind !== "tileset" && frame.value.kind !== "isometric" && frame.value.kind !== "singleTile") {
          return invalid(`animated tile "${tile.path}" names "${first}", which is not a tile`, "docs/spec/formats/tiles.md#animated-tile-tan");
        }
        tile = frame.value;
      }

      const tileBytes = cache.get(tile.asset);
      if (tileBytes === undefined) return { status: "missing", asset: tile.asset };
      if (tile.kind === "singleTile") {
        const parsed = readSingleTile(tileBytes, tile.asset);
        if (!parsed.ok) return { status: "invalid", error: parsed.error };
      } else {
        const parsed = readTileset(tileBytes, tile.asset);
        if (!parsed.ok) return { status: "invalid", error: parsed.error };
        const dimensions = tileDimensions(parsed.value.detail);
        const scale = parsed.value.detail.size === 16 ? 2 : 1;
        const stripHeight = dimensions.height * scale;
        const stripWidth = dimensions.width * scale * parsed.value.tiles.length;
        const tileWidth = tile.kind === "isometric" ? stripHeight * 2 : stripHeight;
        const left = (tile.tile - 1) * tileWidth;
        if (tile.tile < 1 || left + tileWidth > stripWidth) {
          return invalid(
            `tile "${cell.tile}" is out of range: ${tile.asset} holds ${stripWidth / tileWidth} tile(s)`,
            "docs/spec/formats/README.md#tile-references",
          );
        }
      }
    }
  }
  return { status: "ready" };
}

function invalid(message: string, section: string): TileBitmapReadiness {
  return { status: "invalid", error: { offset: 0, section, message } };
}
