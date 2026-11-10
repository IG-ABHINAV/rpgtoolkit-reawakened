// The `.gam` document of ADR 0022 D2 and D3: bytes plus a serialisable command stack over the reader and writer of
// `core`, saved through platform-services. Every case runs on real `.gam` bytes against the in-memory double.
import { test } from "node:test";
import { deepEqual, equal, notEqual, ok } from "node:assert/strict";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  createDocumentIdentity,
  createMainDocument,
  openMainDocument,
  type DocumentStorage,
  type MainDocument,
} from "../src/index.ts";
import { concat, exampleMain, exampleTextMain, exampleTk1Main, titleOf, trailingBlocks, withTitle } from "./fixtures.ts";

const PATH = "Main/example.gam";
const identity = createDocumentIdentity("memory-project", PATH);

function hostWith(bytes: Uint8Array): MemoryPlatformServices {
  return createMemoryPlatformServices({ files: { [PATH]: bytes } });
}

async function open(host: MemoryPlatformServices): Promise<MainDocument> {
  const opened = await openMainDocument(host.fs, identity);
  if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened.error)}`);
  return opened.document;
}

function stored(host: MemoryPlatformServices): Uint8Array {
  const bytes = host.bytesOf(PATH);
  if (bytes === undefined) throw new Error("the file is gone");
  return bytes;
}

for (const minor of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
  test(`minor ${minor}: edit the title, save and reopen; every other byte and the minor are kept`, async () => {
    const original = exampleMain(minor);
    const host = hostWith(original);
    const doc = await open(host);
    equal(doc.getSnapshot().readOnly, null, "the writer re-emits this minor, so the document is read-write");
    equal(doc.getSnapshot().minor, minor);
    equal(doc.getSnapshot().gameTitle, "Example Game");

    const edit = doc.apply({ type: "set-game-title", title: "Renamed Quest" });
    ok(edit.ok);
    const saved = await doc.save();
    ok(saved.ok);

    // The oracle splices the new title into the original bytes by hand; the document must have written exactly that.
    deepEqual(stored(host), withTitle(original, "Renamed Quest"));
    equal(titleOf(stored(host)), "Renamed Quest");

    const reopened = await open(host);
    equal(reopened.getSnapshot().gameTitle, "Renamed Quest");
    equal(reopened.getSnapshot().minor, minor);
    equal(reopened.getSnapshot().dirty, false);
  });
}

test("the title edited back to its first value writes the original bytes exactly", async () => {
  const original = exampleMain(9);
  const host = hostWith(original);
  const doc = await open(host);
  doc.apply({ type: "set-game-title", title: "Other" });
  await doc.save();
  doc.apply({ type: "set-game-title", title: "Example Game" });
  await doc.save();
  deepEqual(stored(host), original);
});

test("unknown trailing data survives: package list, audio block and opaque residue are written back untouched", async () => {
  const original = concat(exampleMain(9), trailingBlocks());
  const host = hostWith(original);
  const doc = await open(host);
  equal(doc.getSnapshot().readOnly, null);
  doc.apply({ type: "set-game-title", title: "A much longer title than the one the file had" });
  ok((await doc.save()).ok);
  deepEqual(stored(host), withTitle(original, "A much longer title than the one the file had"));
  const tail = stored(host).subarray(stored(host).length - trailingBlocks().length);
  deepEqual(tail, trailingBlocks(), "the blocks after the last documented row are byte for byte what they were");
});

test("opaque residue alone is kept at every minor that can carry it", async () => {
  for (const minor of [0, 3, 6, 9]) {
    const original = concat(exampleMain(minor), Uint8Array.from([1, 2, 3, 4, 5]));
    const host = hostWith(original);
    const doc = await open(host);
    doc.apply({ type: "set-game-title", title: "X" });
    ok((await doc.save()).ok);
    deepEqual(stored(host), withTitle(original, "X"), `minor ${minor}`);
  }
});

test("saving a document nobody edited writes nothing", async () => {
  const host = hostWith(exampleMain(9));
  let writes = 0;
  const counting: DocumentStorage = {
    read: (path) => host.fs.read(path),
    write: (path, bytes) => {
      writes += 1;
      return host.fs.write(path, bytes);
    },
  };
  const opened = await openMainDocument(counting, identity);
  ok(opened.ok);
  ok((await opened.document.save()).ok);
  equal(writes, 0);
});

test("dirty follows the applied commands, not the number of edits (ADR 0022 D3.2)", async () => {
  const host = hostWith(exampleMain(9));
  const doc = await open(host);
  const dirty = () => doc.getSnapshot().dirty;
  equal(dirty(), false, "a fresh document is clean");
  doc.apply({ type: "set-game-title", title: "One" });
  equal(dirty(), true);
  doc.undo();
  equal(dirty(), false, "undone back to what is on disk");
  doc.redo();
  equal(dirty(), true);
  await doc.save();
  equal(dirty(), false, "saved");
  doc.undo();
  equal(dirty(), true, "undoing a saved edit differs from the file");
  doc.redo();
  equal(dirty(), false, "redone to the saved state");
  // Undo, then a different edit: the saved state can never be reached again, so the document stays dirty.
  doc.undo();
  doc.apply({ type: "set-game-title", title: "Two" });
  equal(dirty(), true);
  doc.undo();
  equal(dirty(), true, "back at zero edits is not the saved state either: the file holds the first edit");
});

test("undo and redo walk the stack; an edit id from the host must name the edit it undoes (AD-19)", async () => {
  const doc = await open(hostWith(exampleMain(9)));
  const first = doc.apply({ type: "set-game-title", title: "One" });
  const second = doc.apply({ type: "set-game-title", title: "Two" });
  ok(first.ok && second.ok);
  notEqual(first.editId, second.editId);
  equal(doc.getSnapshot().canUndo, true);
  equal(doc.getSnapshot().canRedo, false);

  deepEqual(doc.undo(first.editId), { ok: false, reason: "stale-edit" }, "only the latest edit can be undone by id");
  equal(doc.getSnapshot().gameTitle, "Two");
  deepEqual(doc.undo(second.editId), { ok: true, editId: second.editId });
  equal(doc.getSnapshot().gameTitle, "One");
  equal(doc.getSnapshot().canRedo, true);
  deepEqual(doc.redo(first.editId), { ok: false, reason: "stale-edit" });
  deepEqual(doc.redo(second.editId), { ok: true, editId: second.editId });
  equal(doc.getSnapshot().gameTitle, "Two");
  doc.undo();
  doc.undo();
  equal(doc.getSnapshot().gameTitle, "Example Game");
  deepEqual(doc.undo(), { ok: false, reason: "nothing-to-undo" });
  doc.redo();
  doc.redo();
  deepEqual(doc.redo(), { ok: false, reason: "nothing-to-redo" });
});

test("a new edit after an undo discards what could have been redone", async () => {
  const doc = await open(hostWith(exampleMain(9)));
  doc.apply({ type: "set-game-title", title: "One" });
  doc.undo();
  doc.apply({ type: "set-game-title", title: "Other" });
  equal(doc.getSnapshot().canRedo, false);
  deepEqual(doc.redo(), { ok: false, reason: "nothing-to-redo" });
  equal(doc.getSnapshot().gameTitle, "Other");
});

test("the command stack is plain data: stored, parsed and replayed on a fresh document it gives the same bytes", async () => {
  const original = exampleMain(9);
  const hostA = hostWith(original);
  const docA = await open(hostA);
  docA.apply({ type: "set-game-title", title: "First" });
  docA.apply({ type: "set-game-title", title: "Second" });
  await docA.save();

  const edits = JSON.parse(JSON.stringify(docA.getSnapshot().edits)) as ReturnType<MainDocument["getSnapshot"]>["edits"];
  const hostB = hostWith(original);
  const docB = await open(hostB);
  for (const edit of edits) ok(docB.apply(edit.command).ok);
  await docB.save();
  deepEqual(stored(hostB), stored(hostA));
});

test("a refused command changes nothing: no new snapshot, no notification, no edit id spent", async () => {
  const doc = await open(hostWith(exampleMain(9)));
  let notified = 0;
  doc.subscribe(() => {
    notified += 1;
  });
  const before = doc.getSnapshot();
  for (const title of ["日本語", "has\u0000nul", "emoji \u{1f600}"]) {
    const result = doc.apply({ type: "set-game-title", title });
    equal(result.ok, false, title);
    if (!result.ok) {
      equal(result.rejection.reason, "invalid");
      ok(result.rejection.message.length > 0);
    }
  }
  equal(doc.getSnapshot(), before, "the same snapshot object: nothing changed");
  equal(notified, 0);
  const accepted = doc.apply({ type: "set-game-title", title: "Fine" });
  ok(accepted.ok);
  equal(accepted.editId, "edit-1", "refused commands did not take an id");
});

test("a Windows-1252 title that is not ASCII is stored as its code-page bytes", async () => {
  const host = hostWith(exampleMain(9));
  const doc = await open(host);
  ok(doc.apply({ type: "set-game-title", title: "Café Ñandú" }).ok);
  ok((await doc.save()).ok);
  deepEqual(stored(host), withTitle(exampleMain(9), "Caf\u00e9 \u00d1andú"));
});

test("a failed save keeps the model dirty, keeps every edit, names the document and can be retried (ADR 0022 D3.3)", async () => {
  const original = exampleMain(9);
  const host = hostWith(original);
  const doc = await open(host);
  doc.apply({ type: "set-game-title", title: "Unsaved" });
  host.failWrites({ code: "permission-denied", message: "the folder is read-only" });

  const result = await doc.save();
  ok(!result.ok);
  equal(result.failure.kind, "write");
  equal(result.failure.code, "permission-denied");
  equal(result.failure.document, PATH);
  ok(result.failure.message.includes(PATH), result.failure.message);
  ok(result.failure.message.includes("the folder is read-only"), result.failure.message);

  const snapshot = doc.getSnapshot();
  equal(snapshot.dirty, true, "not marked clean");
  equal(snapshot.gameTitle, "Unsaved", "the edit is still in the model");
  equal(snapshot.saving, false);
  deepEqual(snapshot.saveError, result.failure, "the error is exposed on the snapshot");
  equal(snapshot.canUndo, true, "the undo stack is intact");
  deepEqual(stored(host), original, "the file on disk was not touched");

  host.failWrites(null);
  ok((await doc.save()).ok);
  equal(doc.getSnapshot().dirty, false);
  equal(doc.getSnapshot().saveError, null, "a later successful save clears the error");
  deepEqual(stored(host), withTitle(original, "Unsaved"));
});

test("an edit made while a save is in flight stays dirty and is not lost", async () => {
  const host = hostWith(exampleMain(9));
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow: DocumentStorage = {
    read: (path) => host.fs.read(path),
    write: async (path, bytes) => {
      await gate;
      return host.fs.write(path, bytes);
    },
  };
  const opened = await openMainDocument(slow, identity);
  ok(opened.ok);
  const doc = opened.document;
  doc.apply({ type: "set-game-title", title: "First" });
  const saving = doc.save();
  equal(doc.getSnapshot().saving, true);
  doc.apply({ type: "set-game-title", title: "Second" });
  release();
  ok((await saving).ok);

  equal(titleOf(stored(host)), "First", "the revision that was captured is the one written");
  equal(doc.getSnapshot().gameTitle, "Second");
  equal(doc.getSnapshot().dirty, true, "the later edit is not marked saved by an earlier save");
  ok((await doc.save()).ok);
  equal(titleOf(stored(host)), "Second");
  equal(doc.getSnapshot().dirty, false);
});

test("an undo and a different edit during a save leave the written revision out of the history: still dirty", async () => {
  const host = hostWith(exampleMain(9));
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow: DocumentStorage = {
    read: (path) => host.fs.read(path),
    write: async (path, bytes) => {
      await gate;
      return host.fs.write(path, bytes);
    },
  };
  const opened = await openMainDocument(slow, identity);
  ok(opened.ok);
  const doc = opened.document;
  doc.apply({ type: "set-game-title", title: "Written" });
  const saving = doc.save();
  doc.undo();
  doc.apply({ type: "set-game-title", title: "Different" });
  release();
  ok((await saving).ok);
  equal(titleOf(stored(host)), "Written");
  equal(doc.getSnapshot().gameTitle, "Different");
  equal(doc.getSnapshot().dirty, true);
});

test("saves run one after another, in the order they were asked for", async () => {
  const host = hostWith(exampleMain(9));
  const order: string[] = [];
  const logging: DocumentStorage = {
    read: (path) => host.fs.read(path),
    write: (path, bytes) => {
      order.push(titleOf(bytes));
      return host.fs.write(path, bytes);
    },
  };
  const opened = await openMainDocument(logging, identity);
  ok(opened.ok);
  const doc = opened.document;
  doc.apply({ type: "set-game-title", title: "A" });
  const first = doc.save();
  doc.apply({ type: "set-game-title", title: "B" });
  const second = doc.save();
  await Promise.all([first, second]);
  deepEqual(order, ["A", "B"]);
  equal(doc.getSnapshot().dirty, false);
});

test("a main file the writer cannot reproduce opens read-only with the reason; it is never offered read-write (ADR 0022 D2.1)", async () => {
  const text = exampleTextMain();
  const host = hostWith(text);
  const doc = await open(host);
  const snapshot = doc.getSnapshot();
  ok(snapshot.readOnly !== null, "a Toolkit 2 text main file has no same-version writer");
  equal(snapshot.readOnly.code, "no-same-version-writer");
  ok(snapshot.readOnly.message.length > 0);
  equal(snapshot.gameTitle, "Example Game", "it can still be viewed");
  equal(snapshot.canUndo, false);
  equal(snapshot.canRedo, false);

  const applied = doc.apply({ type: "set-game-title", title: "Nope" });
  ok(!applied.ok);
  equal(applied.rejection.reason, "read-only");
  deepEqual(doc.undo(), { ok: false, reason: "read-only" });
  deepEqual(doc.redo(), { ok: false, reason: "read-only" });
  const saved = await doc.save();
  ok(!saved.ok);
  equal(saved.failure.kind, "read-only");
  ok(saved.failure.message.includes(PATH));
  equal(doc.getSnapshot().dirty, false);
  deepEqual(stored(host), text, "nothing was written");
});

test("open fails whole, with the reason, for a file the reader refuses or the host cannot read", async () => {
  const tk1 = await openMainDocument(hostWith(exampleTk1Main()).fs, identity);
  ok(!tk1.ok);
  equal(tk1.error.kind, "format");
  equal(tk1.error.document, PATH);
  if (tk1.error.kind === "format") {
    equal(tk1.error.error.offset, 0);
    ok(tk1.error.error.message.length > 0);
  }

  const future = exampleMain(9);
  future[0x10] = 10;
  const refused = await openMainDocument(hostWith(future).fs, identity);
  ok(!refused.ok);
  equal(refused.error.kind, "format");

  const missing = await openMainDocument(createMemoryPlatformServices().fs, identity);
  ok(!missing.ok);
  equal(missing.error.kind, "read");
  if (missing.error.kind === "read") equal(missing.error.error.code, "not-found");
});

test("getSnapshot is stable between changes and subscribe delivers each change until it is removed", async () => {
  const doc = await open(hostWith(exampleMain(9)));
  equal(doc.getSnapshot(), doc.getSnapshot());
  let calls = 0;
  const stop = doc.subscribe(() => {
    calls += 1;
  });
  const first = doc.getSnapshot();
  doc.apply({ type: "set-game-title", title: "One" });
  equal(calls, 1);
  notEqual(doc.getSnapshot(), first);
  doc.undo();
  doc.redo();
  equal(calls, 3);
  stop();
  doc.apply({ type: "set-game-title", title: "Two" });
  equal(calls, 3, "a removed listener hears nothing");
  stop();
});

test("identity: the handle and the ASCII-folded, slash-normalised path; Unicode case is not folded (ADR 0022 D1)", () => {
  const a = createDocumentIdentity("p", "Main/Example.gam");
  const b = createDocumentIdentity("p", "main\\EXAMPLE.GAM");
  equal(a.key, b.key, "a path that folds to an existing key names that document");
  equal(b.path, "main/EXAMPLE.GAM", "the path keeps its case and uses /");
  notEqual(a.key, createDocumentIdentity("q", "Main/Example.gam").key, "another project handle is another document");
  notEqual(
    createDocumentIdentity("p", "main/\u212Aey.gam").key,
    createDocumentIdentity("p", "main/key.gam").key,
    "U+212A KELVIN SIGN is not the letter k",
  );
  // The handle and the path cannot be re-split into one another.
  notEqual(createDocumentIdentity("a:1", "b").key, createDocumentIdentity("a", "1:b").key);
});

test("a document can be made over bytes already in hand", () => {
  const storage = createMemoryPlatformServices().fs;
  const made = createMainDocument(storage, identity, exampleMain(9));
  ok(made.ok);
  equal(made.document.getSnapshot().gameTitle, "Example Game");
  const bad = createMainDocument(storage, identity, new Uint8Array(0));
  ok(!bad.ok);
});
