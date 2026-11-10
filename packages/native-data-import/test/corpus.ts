/**
 * Every decoded `.anm` the repository can reach: the example games and version
 * examples under docs/spec/examples (always present) and, when `pnpm fixtures:fetch`
 * has run, every `.anm` of the fetched legacy sample games under fixtures/legacy.
 * Nothing here is committed or copied; the files are read where they are.
 */

import { BinaryReader, readAnimation, type Animation } from "@tk-reawakened/core";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));

export type CorpusFile = { readonly path: string; readonly name: string; readonly origin: "docs/spec/examples" | "fixtures/legacy"; readonly animation: Animation };

function walk(directory: string, found: string[]): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, found);
    else if (/\.anm$/i.test(entry.name)) found.push(path);
  }
  return found;
}

export function corpus(): CorpusFile[] {
  const origins = [
    ["docs/spec/examples", join(root, "docs", "spec", "examples")],
    ["fixtures/legacy", join(root, "fixtures", "legacy")],
  ] as const;
  return origins.flatMap(([origin, directory]) =>
    (existsSync(directory) ? walk(directory, []) : []).map((path) => {
      const decoded = readAnimation(new BinaryReader(new Uint8Array(readFileSync(path)), path));
      if (!decoded.ok) throw new Error(`${path} did not decode: ${decoded.error.message}`);
      return { path: path.slice(root.length), name: path.slice(path.lastIndexOf("/") + 1), origin, animation: decoded.value };
    }),
  );
}
