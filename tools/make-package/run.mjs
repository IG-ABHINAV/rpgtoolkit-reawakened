// make-package: turn one game folder into the project's single-file package and its install descriptor
// (docs/spec/formats/packaging-and-paths.md#distribution-package and #install-descriptor; entry 9.7).
//
//   node tools/make-package/run.mjs <folder> [--out <file.tpk>] [--title <name>] [--version <string>]
//   node tools/make-package/run.mjs <folder> --closing-plan <plan.json> --game <name>   (materialise a synthesised main)
//   node tools/make-package/run.mjs --verify <file.tpk>
//   node tools/make-package/run.mjs --check-descriptor <file.tpk>
//
// What it writes is a `.tpk`-compatible ZIP whose root is the game folder, with `manifest.json` at the archive root
// holding exactly `schema`, `main` and `index`, plus the sibling `<file>.tpk.json` descriptor a library registers from.
// It emits **no executable**: installing is registering, and nothing here builds or wraps a launcher.
//
// The folder is untrusted input like any package, so the tree is read through `loadPackage({ kind: "folder" })`, which
// applies the loose-folder limits L22–L26 and rejects a link or a path that escapes; the writer then applies the same
// archive limits L1–L21, so this tool cannot emit a package the reader would refuse.
//
// Determinism is a guard-rail (G3): the manifest's `index` is sorted in code-unit order and the writer orders entries and
// compresses them deterministically, so two exports of one asset tree are byte-identical.

import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  newProjectMainFile,
  deriveGameId,
  derivePackageIdentity,
  loadPackage,
  writeMainFile,
  writeDistributionPackage,
} from "@tk-reawakened/core";

const here = dirname(fileURLToPath(import.meta.url));

/** The descriptor's own schema version, independent of the package's `manifest.schema`. */
export const DESCRIPTOR_SCHEMA = 1;

/** The manifest file's name at the archive root. */
export const MANIFEST_FILE = "manifest.json";

/** The project schema version this tool stamps into a package's manifest. */
export const PACKAGE_SCHEMA = 1;

/**
 * The main file a closing-plan entry describes when it synthesises one (the `demo` and `Basic` sample games carry no
 * `Main/<game>.gam`; their main is built from a startup program, board and character). Unlike the headless closing
 * suite, a playable package uses new-project defaults so its stock menu and battle providers are named.
 */
export function synthesisedMain(planText, gameName) {
  const plan = JSON.parse(planText);
  const game = (plan.games ?? []).find((candidate) => candidate.name === gameName);
  if (game === undefined) throw new Error(`the closing plan does not list ${gameName}`);
  const synthesised = game.main?.synthesised;
  if (synthesised === undefined) throw new Error(`${gameName} has no synthesised main; package its folder directly`);
  const model = { ...newProjectMainFile(), major: 2, ...synthesised };
  const written = writeMainFile(model);
  if (!written.ok) throw new Error(`${written.error.message} (main-file writer)`);
  return { path: `Main/${gameName}.gam`, bytes: written.value };
}

/**
 * Every file under `root`, as `loadPackage`'s folder input. Symlinks and reparse points are reported, never followed, so
 * the core can refuse them (L23).
 */
export function readFolder(root) {
  const entries = [];
  const walk = (directory, prefix) => {
    for (const name of readdirSync(directory).sort()) {
      const full = join(directory, name);
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const stats = lstatSync(full);
      if (stats.isSymbolicLink()) {
        entries.push({ kind: "link", path });
        continue;
      }
      if (stats.isDirectory()) {
        entries.push({ kind: "directory", path });
        walk(full, path);
        continue;
      }
      if (stats.isFile()) entries.push({ kind: "file", path, bytes: new Uint8Array(readFileSync(full)) });
    }
  };
  walk(root, "");
  return entries;
}

/** The game's main file: the single `.gam` under `Main/`, or `null` when there is not exactly one. */
export function mainFile(files) {
  const games = files.filter((file) => /^Main\/[^/]+\.gam$/i.test(file.path));
  if (games.length !== 1) return null;
  return games[0].path;
}

/** The manifest for a tree: `schema`, `main`, and every game file's path — the main included — in code-unit order. */
export function packageManifest(files, main) {
  const index = files
    .map((file) => file.path)
    .filter((path) => path !== MANIFEST_FILE)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return { schema: PACKAGE_SCHEMA, main, index };
}

/** Lower-case hex SHA-256 of a byte array. */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Write the package and its descriptor. Returns the package bytes, the descriptor and both paths, or throws with the
 * reason a folder or the writer refused (a located rule, e.g. "L2" or "L9").
 */
export function makePackage(folder, options = {}) {
  const root = resolve(folder);
  const entries = readFolder(root);
  if (options.synthesised !== undefined) {
    // A plan-synthesised main joins the tree at the path a package keeps it at; a folder that already has one keeps it.
    const hasMain = entries.some((entry) => entry.kind === "file" && /^Main\/[^/]+\.gam$/i.test(entry.path));
    if (!hasMain) entries.push({ kind: "file", path: options.synthesised.path, bytes: options.synthesised.bytes });
  }
  const loaded = loadPackage({ kind: "folder", name: basename(root), entries });
  if (!loaded.ok) throw new Error(`${loaded.error.message} (${loaded.error.rule ?? "folder"})`);
  const files = loaded.value.files;
  const main = mainFile(files);
  if (main === null) throw new Error("the folder must hold exactly one Main/<game>.gam (main file, AD-6)");
  const mainBytes = files.find((file) => file.path === main)?.bytes;
  if (mainBytes === undefined) throw new Error(`${main} is not among the folder's files`);
  const manifest = packageManifest(files, main);
  const written = writeDistributionPackage({ files: files.map((file) => ({ path: file.path, bytes: file.bytes })), manifest });
  if (!written.ok) throw new Error(`${written.error.message} (${written.error.rule ?? "writer"})`);

  const title = options.title ?? basename(root);
  const version = options.version ?? "0.0.0";
  if (typeof title !== "string" || title.trim() === "") throw new Error("the title must be a non-empty string");
  const out = options.out ?? join(root, `${title}.tpk`);
  const file = basename(out);
  const descriptor = {
    schema: DESCRIPTOR_SCHEMA,
    file,
    sha256: sha256(written.value),
    size: written.value.length,
    // The package's content identity is independent of its display title.
    gameId: deriveGameId(mainBytes, derivePackageIdentity(files.map(({ path, bytes }) => ({ path, bytes })))),
    title,
    version,
  };
  return { packagePath: out, descriptorPath: `${out}.json`, bytes: written.value, descriptor, manifest };
}

/** Write both files to disk. */
export function writePackage(folder, options = {}) {
  const made = makePackage(folder, options);
  mkdirSync(dirname(made.packagePath), { recursive: true });
  writeFileSync(made.packagePath, made.bytes);
  writeFileSync(made.descriptorPath, `${JSON.stringify(made.descriptor, null, 2)}\n`);
  return made;
}

/**
 * Validate a descriptor against the package it names: the `file` must be the package's own name, and the `sha256` and
 * `size` must describe its bytes. A mismatch is the refusal a host reports.
 */
export function checkDescriptor(bytes, fileName, descriptor) {
  const problems = [];
  if (typeof descriptor !== "object" || descriptor === null || Array.isArray(descriptor)) return ["the descriptor is not an object"];
  const fields = ["schema", "file", "sha256", "size", "gameId", "title", "version"];
  for (const field of fields) if (!(field in descriptor)) problems.push(`the descriptor lacks ${field}`);
  if (Object.keys(descriptor).some((key) => !fields.includes(key))) problems.push("the descriptor has a field outside schema, file, sha256, size, gameId, title, version");
  if (descriptor.file !== fileName) problems.push(`the descriptor names ${String(descriptor.file)}, not ${fileName}`);
  const actual = sha256(bytes);
  if (descriptor.sha256 !== actual) problems.push(`the package hashes to ${actual}, not ${String(descriptor.sha256)}`);
  if (descriptor.size !== bytes.length) problems.push(`the package is ${bytes.length} bytes, not ${String(descriptor.size)}`);
  if (typeof descriptor.gameId !== "string" || descriptor.gameId === "") problems.push("the descriptor has no gameId");
  if (typeof descriptor.title !== "string" || descriptor.title.trim() === "") problems.push("the descriptor has no title");
  if (typeof descriptor.version !== "string") problems.push("the descriptor has no version string");
  return problems;
}

function parseArguments(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out") options.out = argv[++index];
    else if (argument === "--title") options.title = argv[++index];
    else if (argument === "--version") options.version = argv[++index];
    else if (argument === "--verify") options.verify = argv[++index];
    else if (argument === "--check-descriptor") options.check = argv[++index];
    else if (argument === "--closing-plan") options.plan = argv[++index];
    else if (argument === "--game") options.game = argv[++index];
    else if (argument.startsWith("--")) throw new Error(`unknown option ${argument}`);
    else positional.push(argument);
  }
  return { positional, options };
}

function main(argv) {
  const { positional, options } = parseArguments(argv);
  try {
    if (options.verify !== undefined) {
      // Round trip: the package reloads to its own files and a three-field manifest.
      const path = resolve(options.verify);
      const loaded = loadPackage({ kind: "tpk", name: basename(path), bytes: new Uint8Array(readFileSync(path)) });
      if (!loaded.ok) throw new Error(`${loaded.error.message} (${loaded.error.rule ?? "reader"})`);
      const manifest = JSON.parse(new TextDecoder().decode(loaded.value.files.find((file) => file.path === MANIFEST_FILE)?.bytes ?? new Uint8Array()));
      const keys = Object.keys(manifest).sort().join(",");
      if (keys !== "index,main,schema") throw new Error(`the manifest holds ${keys}, not index,main,schema`);
      console.log(`${basename(path)}: ${loaded.value.files.length} files, main ${manifest.main}, manifest schema ${manifest.schema}`);
      console.log(`index order matches the archive: ${packageManifest(loaded.value.files, manifest.main).index.join(",") === manifest.index.join(",")}`);
      return 0;
    }
    if (options.check !== undefined) {
      const path = resolve(options.check);
      const descriptor = JSON.parse(readFileSync(`${path}.json`, "utf8"));
      const problems = checkDescriptor(new Uint8Array(readFileSync(path)), basename(path), descriptor);
      if (problems.length > 0) {
        for (const problem of problems) console.error(`${basename(path)}: ${problem}`);
        return 1;
      }
      console.log(`${basename(path)}: descriptor ${descriptor.gameId} (${descriptor.title} ${descriptor.version}) matches the file`);
      return 0;
    }
    const folder = positional[0];
    if (folder === undefined) throw new Error("usage: make-package <folder> [--out <file.tpk>] [--title <name>] [--version <string>]");
    const synthesised = options.plan === undefined || options.game === undefined
      ? undefined
      : synthesisedMain(readFileSync(resolve(options.plan), "utf8"), options.game);
    const made = writePackage(folder, { ...options, ...(synthesised === undefined ? {} : { synthesised }) });
    console.log(`${made.packagePath}: ${made.bytes.length} bytes, ${made.manifest.index.length + 1} files, main ${made.manifest.main}`);
    console.log(`${made.descriptorPath}: ${made.descriptor.gameId} (${made.descriptor.title} ${made.descriptor.version}), sha256 ${made.descriptor.sha256}`);
    return 0;
  } catch (error) {
    console.error(`make-package: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

