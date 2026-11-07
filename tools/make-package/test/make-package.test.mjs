// make-package (entry 9.7): the tool writes a distribution package and its install descriptor, and a host can prove one
// against the other. These tests build their own game tree so they need no fetched fixture — the same helper the tool
// uses to materialise a closing-plan main gives them a genuinely valid `Main/<game>.gam`.

import { deepEqual, equal, ok } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BinaryReader, createEmptyMainFile, deriveGameId, derivePackageIdentity, loadPackage, readMainFile, writeMainFile } from "@tk-reawakened/core";
import { checkDescriptor, makePackage, packageManifest, readFolder, synthesisedMain, writePackage } from "../run.mjs";

/** A minimal, valid game tree: one main file, one bitmap, one board folder (an entry that must be counted, not served). */
function gameTree() {
  const root = mkdtempSync(join(tmpdir(), "make-package-"));
  mkdirSync(join(root, "Main"), { recursive: true });
  mkdirSync(join(root, "Bitmap"), { recursive: true });
  const written = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9 });
  ok(written.ok, "a valid main file writes");
  writeFileSync(join(root, "Main", "Tree.gam"), written.value);
  writeFileSync(join(root, "Bitmap", "tile.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return root;
}

test("a synthesized playable main names the standard stock packages", () => {
  const plan = JSON.stringify({ games: [{ name: "demo", main: { synthesised: { startupPrg: "start.prg", initBoard: "start.brd", initChar: "hero.tem" } } }] });
  const generated = synthesisedMain(plan, "demo");
  const parsed = readMainFile(new BinaryReader(generated.bytes, generated.path));
  ok(parsed.ok);
  deepEqual(parsed.value.packagePlugins, ["stock_battle", "stock_menu"]);
  equal(parsed.value.startupPrg, "start.prg");
});

test("a written package reloads to identical bytes and a manifest with exactly schema, main and index", () => {
  const made = makePackage(gameTree(), { title: "Tree", version: "1.2.3" });
  const loaded = loadPackage({ kind: "tpk", name: "Tree.tpk", bytes: made.bytes });
  ok(loaded.ok, loaded.ok ? "" : loaded.error.message);
  const files = loaded.value.files;
  const manifestFile = files.find((file) => file.path === "manifest.json");
  ok(manifestFile !== undefined, "the manifest is at the archive root");
  const manifest = JSON.parse(new TextDecoder().decode(manifestFile.bytes));
  deepEqual(Object.keys(manifest).sort(), ["index", "main", "schema"], "the manifest has exactly three fields");
  equal(manifest.main, "Main/Tree.gam");
  equal(manifest.schema, 1);
  // Every game file is indexed, the main included, in code-unit order — and a reload keeps those bytes.
  deepEqual(manifest.index, ["Bitmap/tile.png", "Main/Tree.gam"]);
  deepEqual(manifest.index, [...manifest.index].sort());
  const first = files.find((file) => file.path === "Main/Tree.gam");
  const written = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9 });
  deepEqual([...(first?.bytes ?? [])], [...written.value], "the main file's bytes are exactly what was written");
});

test("the descriptor names that package's file, SHA-256 and byte size, and an unchanged package passes", () => {
  const made = makePackage(gameTree(), { title: "Tree", version: "1.2.3" });
  equal(made.descriptor.file, "Tree.tpk");
  equal(made.descriptor.size, made.bytes.length);
  equal(made.descriptor.sha256.length, 64);
  equal(made.descriptor.title, "Tree");
  equal(made.descriptor.version, "1.2.3");
  ok(made.descriptor.gameId.length > 0, "the descriptor carries a gameId");
  deepEqual(Object.keys(made.descriptor).sort(), ["file", "gameId", "schema", "sha256", "size", "title", "version"]);
  deepEqual(checkDescriptor(made.bytes, "Tree.tpk", made.descriptor), []);
});

test("a tampered package fails the descriptor check, with the reason", () => {
  const made = makePackage(gameTree(), { title: "Tree" });
  const tampered = new Uint8Array(made.bytes);
  tampered[tampered.length - 40] ^= 0xff;
  const problems = checkDescriptor(tampered, "Tree.tpk", made.descriptor);
  ok(problems.some((problem) => problem.includes("hashes to")), problems.join("; "));
  // A wrong file name is refused too: the descriptor is about *that* file.
  ok(checkDescriptor(made.bytes, "Other.tpk", made.descriptor).some((problem) => problem.includes("names")));
  // And a descriptor with a field the set does not name is refused.
  ok(checkDescriptor(made.bytes, "Tree.tpk", { ...made.descriptor, extra: 1 }).some((problem) => problem.includes("outside")));
});

test("two exports of one asset tree are byte-identical", () => {
  const root = gameTree();
  const first = makePackage(root, { title: "Tree", version: "1.0.0" });
  const second = makePackage(root, { title: "Tree", version: "1.0.0" });
  equal(first.bytes.length, second.bytes.length);
  ok(first.bytes.every((value, index) => value === second.bytes[index]), "the same tree writes the same bytes");
  equal(first.descriptor.sha256, second.descriptor.sha256);
});

test("the descriptor gameId uses the canonical package identity, not the title", () => {
  const root = gameTree();
  const first = makePackage(root, { title: "First title" });
  const renamed = makePackage(root, { title: "Different title" });
  const loaded = loadPackage({ kind: "tpk", name: "First title.tpk", bytes: first.bytes });
  ok(loaded.ok, loaded.ok ? "" : loaded.error.message);
  const files = loaded.value.files.filter((file) => file.path !== "manifest.json");
  const identity = derivePackageIdentity(files.map(({ path, bytes }) => ({ path, bytes })));
  const main = files.find((file) => file.path === first.manifest.main);
  ok(main !== undefined, "the manifest main is one of the distribution files");
  equal(first.descriptor.gameId, deriveGameId(main.bytes, identity));
  equal(renamed.descriptor.gameId, first.descriptor.gameId, "title does not affect game identity");
  const rebuiltFiles = loaded.value.files.filter((file) => file.path !== "manifest.json");
  equal(
    derivePackageIdentity(rebuiltFiles.map(({ path, bytes }) => ({ path, bytes }))),
    identity,
    "rebuilding the identical distribution files gives the same package identity",
  );
});

test("a changed non-main distribution file changes the descriptor gameId", () => {
  const root = gameTree();
  const first = makePackage(root, { title: "Tree" });
  writeFileSync(join(root, "Bitmap", "tile.png"), Buffer.from([0x89, 0x50, 0x4e, 0x45]));
  const changed = makePackage(root, { title: "Tree" });
  equal(first.manifest.main, changed.manifest.main);
  ok(first.descriptor.gameId !== changed.descriptor.gameId, "non-main content contributes to package identity");
});

test("the tool emits no executable and nothing but the package and its descriptor", () => {
  const root = gameTree();
  const out = join(root, "dist", "Tree.tpk");
  const made = writePackage(root, { out, title: "Tree", version: "1.0.0" });
  const names = readFolder(join(root, "dist")).map((entry) => entry.path).sort();
  deepEqual(names, ["Tree.tpk", "Tree.tpk.json"], "only the package and its descriptor are written");
  ok(!made.bytes.subarray(0, 2).some((byte) => byte === 0x4d && byte === 0x5a), "the package does not begin with an MZ header");
});

test("the folder limits are the spec's: a path that escapes is refused and named", () => {
  const root = mkdtempSync(join(tmpdir(), "make-package-"));
  mkdirSync(join(root, "Main"), { recursive: true });
  const written = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9 });
  writeFileSync(join(root, "Main", "Tree.gam"), written.value);
  mkdirSync(join(root, "..", "escape"), { recursive: true });
  writeFileSync(join(root, "..", "escape", "secret.txt"), Buffer.from("no"));
  // The tool only reads the folder the host named, so an escaping path has to come from the folder's own entries.
  const entries = readFolder(root);
  const loaded = loadPackage({ kind: "folder", name: "Tree", entries: [...entries, { kind: "file", path: "../escape/secret.txt", bytes: new Uint8Array([1]) }] });
  equal(loaded.ok, false, "a path that escapes the folder is refused");
  ok(loaded.ok ? false : loaded.error.message.includes("L9"), `the refusal names L9: ${loaded.ok ? "" : loaded.error.message}`);
});

test("a folder with no main file, or two, is refused with the reason", () => {
  const root = mkdtempSync(join(tmpdir(), "make-package-"));
  mkdirSync(join(root, "Main"), { recursive: true });
  let message = "";
  try {
    makePackage(root);
  } catch (error) {
    message = String(error);
  }
  ok(message.includes("exactly one Main/<game>.gam"), message);
  const written = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9 });
  writeFileSync(join(root, "Main", "One.gam"), written.value);
  writeFileSync(join(root, "Main", "Two.gam"), written.value);
  message = "";
  try {
    makePackage(root);
  } catch (error) {
    message = String(error);
  }
  ok(message.includes("exactly one Main/<game>.gam"), message);
});

test("the manifest builder indexes every file but the manifest itself, in code-unit order", () => {
  const manifest = packageManifest(
    [{ path: "Tiles/b.tst" }, { path: "Main/Tree.gam" }, { path: "Bitmap/a.png" }, { path: "manifest.json" }],
    "Main/Tree.gam",
  );
  deepEqual(manifest.index, ["Bitmap/a.png", "Main/Tree.gam", "Tiles/b.tst"]);
  equal(manifest.main, "Main/Tree.gam");
});

test("the package keeps its own bytes through a file round trip", () => {
  const made = writePackage(gameTree(), { title: "Tree", version: "1.0.0" });
  const onDisk = new Uint8Array(readFileSync(made.packagePath));
  ok(onDisk.every((value, index) => value === made.bytes[index]), "what was written is what was returned");
  const descriptorOnDisk = JSON.parse(readFileSync(made.descriptorPath, "utf8"));
  deepEqual(checkDescriptor(onDisk, "Tree.tpk", descriptorOnDisk), []);
});
