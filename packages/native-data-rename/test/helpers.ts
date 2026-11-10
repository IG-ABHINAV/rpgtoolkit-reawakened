import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectDocuments } from "@tk-reawakened/native-data-cli";
import { planRename, type DocumentInput, type RenameConfig, type RenamePair, type RenamePlan } from "@tk-reawakened/native-data";
import type { FileInfo, RenameFs } from "../src/index.ts";
import { nodeFs } from "../src/index.ts";

/**
 * The shipped registry holds only `.tkranm`, so the placeholder owner and plugin kinds are
 * read through the document-extension override, exactly as `--ext` does on the command line.
 * The clip keeps its registered contract. Nothing here is a real kind.
 */
export const EXTENSIONS = [".tkranm", ".tkract", ".tkrwth", ".tkrrai"] as const;
export const CONFIG: RenameConfig = { documentExtensions: EXTENSIONS, ownerField: "owner", pluginsField: "plugins" };
export const FIELD_ARGS = ["--owner-field", "owner", "--plugins-field", "plugins", ...EXTENSIONS.flatMap((extension) => ["--ext", extension])];

export const CLIP = [
  "contract: animation-clip",
  "version: 1.0.0-pre.1",
  "canvas: {width: 32, height: 32}",
  "delay: 0.15",
  "frames:",
  "  - image: tiles/village.tst14",
  "",
].join("\n");

/** An owner with comments, an unrelated line that holds the old ID as plain text, and two plugin documents. */
export const OWNER = [
  "# The guard. Keep this comment.",
  "contract: actor",
  "version: 1.0.0",
  "",
  "plugins:",
  "  - actors/guard.tkrwth   # weather rules",
  "  - actors/guard.tkrrai",
  'notes: "keep actors/guard.tkract out of this"   # not a reference field',
  "",
].join("\n");

export const WEATHER = ["contract: actor-weather", "version: 1.0.0", 'owner: "actors/guard.tkract"   # back-link', "rain: heavy", ""].join("\n");

/** CRLF line endings: only the reference may change. */
export const RAIN = ["contract: actor-rain", "version: 1.0.0", "owner: actors/guard.tkract  # back-link", "mm: 12", ""].join("\r\n");

export const PROJECT: Readonly<Record<string, string>> = {
  "clips/walk.tkranm": CLIP,
  "actors/guard.tkract": OWNER,
  "actors/guard.tkrwth": WEATHER,
  "actors/guard.tkrrai": RAIN,
  "notes.txt": "not a document: actors/guard.tkract\n",
  "legacy/walk.anm": "RPGTLKIT ANIM",
};

export function makeProject(files: Readonly<Record<string, string | Uint8Array>> = PROJECT): string {
  const root = mkdtempSync(join(tmpdir(), "tkr-native-rename-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

export function withProject<T>(files: Readonly<Record<string, string | Uint8Array>>, run: (root: string) => T): T {
  const root = makeProject(files);
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * A hash of everything a rename could change in a project: every folder and file name, every
 * file's bytes, permission bits and modification time. Folder times are left out because adding
 * and removing an entry changes them by itself.
 */
export function fingerprint(root: string): string {
  const hash = createHash("sha256");
  const visit = (folder: string, prefix: string): void => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        hash.update(`${prefix}${name}/\0d\0`);
        visit(path, `${prefix}${name}/`);
      } else {
        hash.update(`${prefix}${name}\0f\0${stat.mode}\0${stat.mtimeMs}\0${stat.size}\0`);
        hash.update(readFileSync(path));
      }
    }
  };
  visit(root, "");
  return hash.digest("hex");
}

/** Every file below the root, `/` separated and sorted. */
export function listFiles(root: string): string[] {
  const found: string[] = [];
  const visit = (folder: string, prefix: string): void => {
    for (const name of readdirSync(folder).sort()) {
      if (statSync(join(folder, name)).isDirectory()) visit(join(folder, name), `${prefix}${name}/`);
      else found.push(`${prefix}${name}`);
    }
  };
  visit(root, "");
  return found;
}

export const read = (root: string, path: string): string => readFileSync(join(root, path), "utf8");

/** Plan a rename of the project on disk, as the command does: read the documents, then plan. */
export function planOf(root: string, pairs: readonly RenamePair[], config: RenameConfig = CONFIG): { documents: DocumentInput[]; plan: RenamePlan } {
  const documents = collectDocuments(root, config.documentExtensions);
  const result = planRename(documents, pairs, config);
  if (!result.ok) throw new Error(`expected a plan, got: ${result.refusals.map((refusal) => refusal.message).join(" | ")}`);
  return { documents, plan: result.plan };
}

export type Operation = { readonly kind: "create" | "rename" | "remove" | "makeFolder" | "removeFolder"; readonly detail: string };

/**
 * The real file system, with every operation that changes something counted, and the one
 * numbered `failAt` (1-based) made to fail. `alsoFailAfter` makes every later operation of the
 * kinds listed fail as well, so that the undo fails too.
 */
export function faultyFs(failAt: number | null, alsoFailAfter: readonly Operation["kind"][] = []): { readonly fs: RenameFs; readonly operations: Operation[] } {
  const operations: Operation[] = [];
  let failed = false;
  const guard = <A extends unknown[]>(kind: Operation["kind"], run: (...args: A) => void, detail: (...args: A) => string) =>
    (...args: A): void => {
      const operation = { kind, detail: detail(...args) };
      operations.push(operation);
      if (operations.length === failAt) {
        failed = true;
        throw new Error(`injected failure at operation ${operations.length}: ${kind} ${operation.detail}`);
      }
      if (failed && alsoFailAfter.includes(kind)) throw new Error(`injected failure after the first: ${kind} ${operation.detail}`);
      run(...args);
    };
  const fs: RenameFs = {
    info: (path): FileInfo | null => nodeFs.info(path),
    read: (path) => nodeFs.read(path),
    create: guard("create", nodeFs.create, (path) => path),
    rename: guard("rename", nodeFs.rename, (from, to) => `${from} -> ${to}`),
    remove: guard("remove", nodeFs.remove, (path) => path),
    makeFolder: guard("makeFolder", nodeFs.makeFolder, (path) => path),
    removeFolder: guard("removeFolder", nodeFs.removeFolder, (path) => path),
  };
  return { fs, operations };
}
