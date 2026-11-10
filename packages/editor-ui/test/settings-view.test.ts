// The settings view of ADR 0025 over the real model and the in-memory platform-services double, rendered under the
// DOM shim of the toolchain (`@happy-dom/global-registrator`, dev-only). Assertions are on the DOM and on bytes, not on
// Preact internals.
import { after, before, test } from "node:test";
import { deepEqual, equal, match, notEqual, ok } from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentIdentity, openMainDocument, type MainDocument } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { exampleMain, exampleTextMain, titleOf, withTitle } from "./fixtures.ts";

const PATH = "Main/example.gam";
const identity = createDocumentIdentity("memory-project", PATH);

type Mount = typeof import("../src/index.ts").mount;
let mount: Mount;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  // Preact reads the DOM when it renders, so it is imported once the shim is in place.
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});

after(() => GlobalRegistrator.unregister());

interface Setup {
  readonly host: MemoryPlatformServices;
  readonly doc: MainDocument;
  readonly el: HTMLElement;
}

async function setup(bytes: Uint8Array = exampleMain(9)): Promise<Setup> {
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes } });
  const opened = await openMainDocument(host.fs, identity);
  if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened.error)}`);
  const el = document.createElement("div");
  document.body.append(el);
  return { host, doc: opened.document, el };
}

function show(s: Setup) {
  let handle: ReturnType<Mount> | undefined;
  void act(() => {
    handle = mount(s.el, { document: s.doc, services: s.host });
  });
  if (handle === undefined) throw new Error("mount returned nothing");
  return handle;
}

const input = (el: HTMLElement): HTMLInputElement => {
  const found = el.querySelector("input");
  if (found === null) throw new Error("no <input>");
  return found;
};
const button = (el: HTMLElement): HTMLButtonElement => {
  const found = el.querySelector("button");
  if (found === null) throw new Error("no <button>");
  return found;
};
const alerts = (el: HTMLElement): string[] => [...el.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");
const status = (el: HTMLElement): string => el.querySelector('[role="status"]')?.textContent ?? "";

/** Type `text` into the title field and leave it, as a person does. */
async function type(el: HTMLElement, text: string): Promise<void> {
  const field = input(el);
  await act(() => {
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

test("the view shows the title, a labelled field, a clean state and a disabled Save", async () => {
  const s = await setup();
  show(s);
  const field = input(s.el);
  equal(field.value, "Example Game");
  const label = s.el.querySelector("label");
  equal(label?.textContent, "Game title");
  equal(label?.getAttribute("for"), field.id, "the label names the field");
  equal(status(s.el), "All changes saved");
  equal(button(s.el).disabled, true);
  deepEqual(alerts(s.el), []);
});

test("typing a title edits the document, marks it unsaved and tells the host about the edit", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "Renamed Quest");
  equal(s.doc.getSnapshot().gameTitle, "Renamed Quest");
  equal(s.doc.getSnapshot().dirty, true);
  equal(status(s.el), "Unsaved changes");
  equal(button(s.el).disabled, false);
  const [event, ...rest] = s.host.editedEvents;
  equal(rest.length, 0, "one command, one document.edited message");
  equal(event?.document, identity.key);
  equal(event?.editId, "edit-1");
  match(event?.label ?? "", /Renamed Quest/);
  equal(input(s.el).value, "Renamed Quest");
});

test("Save writes the document's bytes through the host and returns to a clean state", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "Renamed Quest");
  await act(async () => {
    button(s.el).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  deepEqual(s.host.bytesOf(PATH), withTitle(exampleMain(9), "Renamed Quest"));
  equal(status(s.el), "All changes saved");
  equal(button(s.el).disabled, true);
});

test("a failed save keeps the edit visible, keeps the document dirty and shows an error that names the document (ADR 0022 D3.3)", async () => {
  const original = exampleMain(9);
  const s = await setup(original);
  show(s);
  await type(s.el, "Renamed Quest");
  s.host.failWrites({ code: "permission-denied", message: "the folder is read-only" });
  await act(async () => {
    button(s.el).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const shown = alerts(s.el);
  equal(shown.length, 1);
  ok(shown[0]?.includes(PATH), `the error names the document: ${shown[0]}`);
  ok(shown[0]?.includes("the folder is read-only"), shown[0]);
  equal(input(s.el).value, "Renamed Quest", "the edit is still on screen");
  equal(status(s.el), "Unsaved changes");
  equal(button(s.el).disabled, false, "Save can be tried again");
  equal(s.doc.getSnapshot().dirty, true);
  deepEqual(s.host.bytesOf(PATH), original, "nothing was written");

  s.host.failWrites(null);
  await act(async () => {
    button(s.el).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  deepEqual(alerts(s.el), [], "the error goes away once a save succeeds");
  equal(status(s.el), "All changes saved");
  equal(titleOf(s.host.bytesOf(PATH) ?? new Uint8Array(0)), "Renamed Quest");
});

test("a title the file cannot hold is refused whole and the reason is shown beside the field", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "日本語");
  equal(s.doc.getSnapshot().gameTitle, "Example Game", "the document did not change");
  equal(s.doc.getSnapshot().dirty, false);
  equal(s.host.editedEvents.length, 0, "no document.edited for a refused command");
  const shown = alerts(s.el);
  equal(shown.length, 1);
  match(shown[0] ?? "", /The title was not changed/);
  equal(input(s.el).getAttribute("aria-invalid"), "true");
});

test("an undo from the host replaces the field's text with the document's", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "One");
  await act(() => {
    s.doc.undo();
  });
  equal(input(s.el).value, "Example Game");
  equal(status(s.el), "All changes saved");
});

test("a read-only document shows its reason and offers no editing and no Save", async () => {
  const s = await setup(exampleTextMain());
  show(s);
  equal(input(s.el).readOnly, true);
  equal(button(s.el).disabled, true);
  const note = s.el.querySelector('[role="note"]');
  match(note?.textContent ?? "", /Read only/);
  equal(input(s.el).value, "Example Game");
});

test("disposing the view removes its listener and its DOM and leaves the document and its undo stack as they were (ADR 0022 D3.7)", async () => {
  const s = await setup();
  // A document that counts the listeners the view adds and removes.
  let live = 0;
  const counted: MainDocument = {
    identity: s.doc.identity,
    getSnapshot: () => s.doc.getSnapshot(),
    subscribe: (listener) => {
      live += 1;
      const stop = s.doc.subscribe(listener);
      let stopped = false;
      return () => {
        if (!stopped) live -= 1;
        stopped = true;
        stop();
      };
    },
    apply: (command) => s.doc.apply(command),
    undo: (editId) => s.doc.undo(editId),
    redo: (editId) => s.doc.redo(editId),
    save: () => s.doc.save(),
  };
  let handle: ReturnType<Mount> | undefined;
  await act(() => {
    handle = mount(s.el, { document: counted, services: s.host });
  });
  equal(live, 1, "the view subscribed once");
  await type(s.el, "Edited in the view");

  await act(() => {
    handle?.dispose();
  });
  equal(live, 0, "dispose removed the listener");
  equal(s.el.childElementCount, 0, "dispose removed the view");

  // The document is untouched by the disposal: still dirty, edit kept, undo works, and changing it updates no stale view.
  equal(s.doc.getSnapshot().gameTitle, "Edited in the view");
  equal(s.doc.getSnapshot().dirty, true);
  equal(s.doc.getSnapshot().canUndo, true);
  await act(() => {
    s.doc.undo();
  });
  equal(s.doc.getSnapshot().gameTitle, "Example Game");
  equal(s.el.childElementCount, 0, "a disposed view does not come back");
  await act(() => {
    handle?.dispose();
  });
  equal(live, 0, "disposing twice is harmless");
});

test("the rendered view carries no style attribute and no inline handler attribute (strict CSP, ADR 0025 decision 6)", async () => {
  const s = await setup();
  show(s);
  await type(s.el, "x");
  s.host.failWrites({ code: "io-error", message: "disk full" });
  await act(async () => {
    button(s.el).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  equal(alerts(s.el).length, 1, "the error state is part of what is checked");
  const all = [s.el, ...s.el.querySelectorAll("*")];
  for (const node of all) {
    for (const name of node.getAttributeNames()) {
      notEqual(name, "style", `<${node.tagName.toLowerCase()}> has a style attribute`);
      ok(!name.startsWith("on"), `<${node.tagName.toLowerCase()}> has the handler attribute ${name}`);
    }
  }
});

test("no source file of the package writes a style attribute or raw HTML into the page", () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const files = readdirSync(src).filter((name) => /\.(?:ts|tsx)$/.test(name));
  ok(files.length >= 3, "the scan sees the package's sources");
  for (const name of files) {
    const text = readFileSync(join(src, name), "utf8");
    ok(!/\bstyle\s*=/.test(text), `${name} sets a style attribute`);
    ok(!/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|setAttribute\(\s*["']style/.test(text), `${name} writes raw markup`);
    ok(!/<style[\s>]/.test(text), `${name} injects a <style> element`);
  }
});
