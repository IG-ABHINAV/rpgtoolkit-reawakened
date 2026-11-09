/**
 * The registry of native document file extensions
 * (docs/spec/formats/native-contracts.md#file-names).
 *
 * Pure data and pure lookups: no file is read and nothing here depends on the host (G2).
 * Extensions are compared with only the letters A to Z folded to a to z, never with
 * `toLowerCase` (G3, docs/spec/formats/native-contracts.md#identity).
 *
 * The table below and the spec's registry table are one table written twice; a test
 * reads the spec and fails when they differ.
 */

import { foldId } from "./fold.ts";

export type RegistryEntry = {
  /** Lowercase, with the leading dot: `.tkr` and a three-letter kind code. */
  readonly extension: string;
  /** The `contract` a document with this extension must name in its stamp. */
  readonly contract: string;
};

export type Registry = readonly RegistryEntry[];

/**
 * Every registered native extension. A kind is added here, and to the spec's table, in the
 * same change that writes its contract (docs/spec/formats/native-contracts.md#file-names).
 */
export const REGISTRY: Registry = [{ extension: ".tkranm", contract: "animation-clip" }];

/** The form of every registered extension: `.tkr` and three lowercase ASCII letters. */
const EXTENSION_FORM = /^\.tkr[a-z]{3}$/;

/**
 * The extension of a path: the text from the last dot of the last `/` part, dot included, as
 * written. A name with no dot, or whose only dot is the first character (`.tkranm`, a hidden
 * name with no stem), has none.
 */
export function extensionOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? null : name.slice(dot);
}

/** The registry row of an extension, compared with only A to Z folded; `undefined` when none. */
export function lookupExtension(extension: string, registry: Registry = REGISTRY): RegistryEntry | undefined {
  const folded = foldId(extension);
  return registry.find((entry) => entry.extension === folded);
}

/**
 * Tells native documents from every other file by extension alone: `native-registered` for an
 * extension the registry holds (a native document of that kind), `other` for everything else,
 * the classic legacy extensions (`.anm`, `.brd`, ...) included. `extension` is as
 * {@link extensionOf} returns it; `null` (no extension) is `other`.
 */
export function classifyExtension(extension: string | null, registry: Registry = REGISTRY): "native-registered" | "other" {
  return extension !== null && lookupExtension(extension, registry) !== undefined ? "native-registered" : "other";
}

/** Throws a `RangeError` naming the first problem when a registry cannot be used. */
export function validateRegistry(registry: Registry): void {
  const extensions = new Set<string>();
  const contracts = new Set<string>();
  for (const entry of registry) {
    if (!EXTENSION_FORM.test(entry.extension)) {
      throw new RangeError(`\`${entry.extension}\` is not a native extension: it must be \`.tkr\` and three lowercase ASCII letters`);
    }
    if (entry.contract.trim() === "") throw new RangeError(`the extension \`${entry.extension}\` has no contract name`);
    if (extensions.has(entry.extension)) throw new RangeError(`the extension \`${entry.extension}\` is registered twice`);
    if (contracts.has(entry.contract)) throw new RangeError(`the contract \`${entry.contract}\` has more than one extension`);
    extensions.add(entry.extension);
    contracts.add(entry.contract);
  }
}
