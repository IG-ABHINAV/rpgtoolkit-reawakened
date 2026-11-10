/**
 * The file walk: read every native document under a folder into memory. This is
 * the only place that touches the file system, and it only reads (`readdir`,
 * `readFile`); nothing in this package opens a file for writing.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyExtension, extensionOf, foldId, type DocumentInput } from "@tk-reawakened/native-data";

const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([".git", "node_modules"]);

function compareNames(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Without `extensions`, a native document is a file whose extension the registry holds. */
function isDocument(name: string, extensions: readonly string[] | undefined): boolean {
  if (extensions === undefined) return classifyExtension(extensionOf(name)) === "native-registered";
  const folded = foldId(name);
  return extensions.some((extension) => name.length > extension.length && folded.endsWith(foldId(extension)));
}

/**
 * Every native document under `root`, as `{ path, text }` with `path` relative to `root`
 * and `/` separated, in name order. A native document is a file whose extension is in the
 * registry (matched with A to Z folded) or, when `extensions` is given, ends in one of
 * those. Any other file, a classic legacy file such as `walk.anm` among them, is not
 * opened at all. Symbolic links and other non-file entries are not followed. A file that
 * is not valid UTF-8 comes back as `unreadable`, so the checker can name it instead of the
 * walk guessing at its text.
 */
export function collectDocuments(root: string, extensions?: readonly string[]): DocumentInput[] {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const found: DocumentInput[] = [];
  const visit = (folder: string, prefix: string): void => {
    const entries = readdirSync(folder, { withFileTypes: true }).sort((left, right) => compareNames(left.name, right.name));
    for (const entry of entries) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) visit(join(folder, entry.name), path);
      } else if (entry.isFile() && isDocument(entry.name, extensions)) {
        const bytes = readFileSync(join(folder, entry.name));
        try {
          found.push({ path, text: decoder.decode(bytes) });
        } catch {
          found.push({ path, unreadable: "the file is not valid UTF-8 text" });
        }
      }
    }
  };
  visit(root, "");
  return found;
}
