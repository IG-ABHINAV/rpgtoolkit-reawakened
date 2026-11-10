// The in-memory double of platform-services (AD-20, AD-22 `./testing`) behaves as a host's file system, project,
// settings and edit stream would, because every other package's tests lean on it.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import type { FileChange } from "../src/index.ts";
import { createMemoryPlatformServices } from "../src/testing.ts";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

test("write, read, stat and list agree, and the caller's arrays are copies", async () => {
  const host = createMemoryPlatformServices();
  const input = bytes(1, 2, 3);
  const written = await host.fs.write("Main/game.gam", input);
  equal(written.ok, true);
  input[0] = 99;

  const read = await host.fs.read("Main/game.gam");
  ok(read.ok);
  deepEqual([...read.value], [1, 2, 3], "a later change to the input must not reach the stored file");
  read.value[1] = 99;
  deepEqual([...(host.bytesOf("Main/game.gam") ?? [])], [1, 2, 3], "a change to the read bytes must not reach the file");

  const stat = await host.fs.stat("Main/game.gam");
  ok(stat.ok);
  equal(stat.value.kind, "file");
  equal(stat.value.size, 3);

  const folder = await host.fs.list("Main");
  ok(folder.ok);
  deepEqual(folder.value, [{ name: "game.gam", kind: "file" }]);
  const root = await host.fs.list("");
  ok(root.ok);
  deepEqual(root.value, [{ name: "Main", kind: "directory" }]);
  const dirStat = await host.fs.stat("Main");
  ok(dirStat.ok);
  equal(dirStat.value.kind, "directory");
});

test("paths compare ASCII-folded and keep the stored case (ADR 0022 D1.1)", async () => {
  const host = createMemoryPlatformServices({ files: { "Main/Game.GAM": bytes(7) } });
  const read = await host.fs.read("main/game.gam");
  ok(read.ok, "a differently cased path names the same file");
  await host.fs.write("MAIN/GAME.gam", bytes(8));
  const listed = await host.fs.list("main");
  ok(listed.ok);
  deepEqual(listed.value, [{ name: "Game.GAM", kind: "file" }], "one file, under its first spelling");
  // U+212A KELVIN SIGN is not the ASCII letter k: the fold is not Unicode case folding.
  const kelvin = await host.fs.read("main/game\u212A.gam");
  equal(kelvin.ok, false);
});

test("failures are values with a code: missing, wrong kind, invalid path, existing destination", async () => {
  const host = createMemoryPlatformServices({ files: { "a/b.txt": bytes(1), "a/c.txt": bytes(2) } });
  const code = async (result: Promise<{ readonly ok: boolean; readonly error?: { readonly code: string } }>) => {
    const settled = await result;
    return settled.ok ? "ok" : settled.error?.code;
  };
  equal(await code(host.fs.read("a/missing.txt")), "not-found");
  equal(await code(host.fs.read("a")), "is-a-directory");
  equal(await code(host.fs.list("a/b.txt")), "not-a-directory");
  equal(await code(host.fs.write("a", bytes(1))), "is-a-directory");
  for (const bad of ["", "/a", "a//b", "a/../b", "./a", "a\\b"]) {
    equal(await code(host.fs.read(bad)), "invalid-path", bad);
  }
  equal(await code(host.fs.rename("a/b.txt", "a/c.txt")), "already-exists");
  equal(await code(host.fs.delete("nope")), "not-found");
  deepEqual([...(host.bytesOf("a/c.txt") ?? [])], [2], "a refused rename changes nothing");
});

test("rename and delete move and remove files and folders", async () => {
  const host = createMemoryPlatformServices({ files: { "a/b.txt": bytes(1), "a/sub/c.txt": bytes(2) } });
  equal((await host.fs.rename("a", "z")).ok, true);
  equal(host.bytesOf("a/b.txt"), undefined);
  deepEqual([...(host.bytesOf("z/sub/c.txt") ?? [])], [2]);
  equal((await host.fs.delete("z/sub")).ok, true);
  equal(host.bytesOf("z/sub/c.txt"), undefined);
  deepEqual([...(host.bytesOf("z/b.txt") ?? [])], [1]);
});

test("watch reports changes below its path and stops when disposed", async () => {
  const host = createMemoryPlatformServices();
  const seen: FileChange[] = [];
  const watch = await host.fs.watch("Main", (change) => seen.push(change));
  ok(watch.ok);
  equal(host.watchCount(), 1);
  await host.fs.write("Main/a.gam", bytes(1));
  await host.fs.write("Main/a.gam", bytes(2));
  await host.fs.write("Other/b.gam", bytes(3));
  await host.fs.delete("Main/a.gam");
  deepEqual(seen, [
    { kind: "created", path: "Main/a.gam" },
    { kind: "changed", path: "Main/a.gam" },
    { kind: "deleted", path: "Main/a.gam" },
  ]);
  watch.value.dispose();
  equal(host.watchCount(), 0);
  await host.fs.write("Main/c.gam", bytes(4));
  equal(seen.length, 3, "a disposed watch hears nothing");
});

test("a host without the fileWatch capability answers unavailable", async () => {
  const host = createMemoryPlatformServices({ capabilities: ["folderWrite"] });
  equal(host.capabilities.has("fileWatch"), false);
  const watch = await host.fs.watch("", () => undefined);
  equal(watch.ok, false);
  if (!watch.ok) equal(watch.error.code, "unavailable");
});

test("failWrites makes writes fail and change nothing until it is cleared", async () => {
  const host = createMemoryPlatformServices({ files: { "m.gam": bytes(1) } });
  host.failWrites({ code: "permission-denied", message: "the folder is read-only" });
  const refused = await host.fs.write("m.gam", bytes(2));
  equal(refused.ok, false);
  if (!refused.ok) {
    equal(refused.error.code, "permission-denied");
    equal(refused.error.message, "the folder is read-only");
  }
  deepEqual([...(host.bytesOf("m.gam") ?? [])], [1]);
  equal((await host.fs.read("m.gam")).ok, true, "reads still work");
  host.failWrites(null);
  equal((await host.fs.write("m.gam", bytes(2))).ok, true);
  deepEqual([...(host.bytesOf("m.gam") ?? [])], [2]);
});

test("project, settings and the edit stream keep what they are given", async () => {
  const host = createMemoryPlatformServices({ project: { id: "p1", name: "Demo" } });
  const opened = await host.project.open();
  ok(opened.ok);
  deepEqual(opened.value, { id: "p1", name: "Demo" });
  const recent = await host.project.recent();
  ok(recent.ok);
  equal(recent.value.length, 1);

  const before = await host.settings.get("user", "editor.autosave");
  ok(before.ok);
  equal(before.value, null);
  await host.settings.set("user", "editor.autosave", true);
  const user = await host.settings.get("user", "editor.autosave");
  const project = await host.settings.get("project", "editor.autosave");
  ok(user.ok && project.ok);
  equal(user.value, true);
  equal(project.value, null, "layers are kept apart");
  await host.settings.set("user", "editor.autosave", null);
  const after = await host.settings.get("user", "editor.autosave");
  ok(after.ok);
  equal(after.value, null, "null resets the layer");

  host.document.edited({ document: "d", editId: "edit-1", label: "Set game title" });
  deepEqual(host.editedEvents, [{ document: "d", editId: "edit-1", label: "Set game title" }]);
});
