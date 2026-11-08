import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import {
  BinaryReader,
  deriveGameId,
  derivePackageIdentity,
  loadPackage,
  readDistributionManifest,
  readMainFile,
  writeDistributionPackage,
  writeMainFile,
} from "@tk-reawakened/core";

type TestMobileFilesystem = {
  writeFile(options: { readonly path: string; readonly data: string; readonly encoding: "base64" | "utf8"; readonly directory?: "DATA"; readonly recursive?: boolean }): Promise<unknown>;
  readFile(options: { readonly path: string; readonly encoding?: "base64" | "utf8"; readonly directory?: "DATA" }): Promise<{ readonly data: string | Uint8Array }>;
  readdir(options: { readonly path: string; readonly directory?: "DATA" }): Promise<{ readonly files: readonly { readonly name: string; readonly type?: string }[] }>;
};

type FixtureWindow = Window & { Capacitor?: { Plugins?: { Filesystem?: TestMobileFilesystem } } };

declare global {
  interface Window {
    __inputListenerCounts?: () => Record<string, number>;
    __inputKeydownListeners?: () => readonly EventListenerOrEventListenerObject[];
  }
}

export type QuitFixture = {
  readonly name: string;
  readonly packageBytes: Uint8Array;
  readonly descriptor: Record<string, unknown>;
};

/** A package whose startup thread waits for one input change, then requests quit. */
export function createQuitFixture(name: string): QuitFixture {
  const loaded = loadPackage({ kind: "tpk", name: "demo.tpk", bytes: new Uint8Array(readFileSync("fixtures/packages/demo.tpk")) });
  if (!loaded.ok) throw new Error(loaded.error.message);
  const manifest = readDistributionManifest(loaded.value);
  if (!manifest.ok) throw new Error(manifest.error.message);
  const main = manifest.value.main;
  const files = loaded.value.files.filter((file) => file.path !== "manifest.json").map((file) => ({ path: file.path, bytes: file.bytes }));
  const mainFile = files.find((file) => file.path === main);
  if (mainFile === undefined) throw new Error(`the demo package has no ${main}`);
  const parsed = readMainFile(new BinaryReader(mainFile.bytes, main));
  if (!parsed.ok) throw new Error(parsed.error.message);
  const quitProgram = "quit-after-input.prg";
  const updatedMain = writeMainFile({ ...parsed.value, startupPrg: quitProgram });
  if (!updatedMain.ok) throw new Error(updatedMain.error.message);
  const tree = [
    ...files.map((file) => (file.path === main ? { path: file.path, bytes: updatedMain.value } : file)),
    { path: `Prg/${quitProgram}`, bytes: new TextEncoder().encode("waitInput()\nquitGame()\nend()\n") },
  ];
  const packaged = writeDistributionPackage({ files: tree, manifest: { schema: manifest.value.schema, main, index: tree.map((file) => file.path) } });
  if (!packaged.ok) throw new Error(packaged.error.message);
  const identity = derivePackageIdentity(tree);
  return {
    name,
    packageBytes: packaged.value,
    descriptor: {
      schema: 1,
      file: name,
      sha256: createHash("sha256").update(packaged.value).digest("hex"),
      size: packaged.value.length,
      gameId: deriveGameId(updatedMain.value, identity),
      title: "Quit restart probe",
      version: "1",
    },
  };
}

/** Serve a generated package and its descriptor; the browser source may request the package using ranges. */
export async function serveQuitFixture(page: Page, fixture: QuitFixture, root = "/fixtures/packages"): Promise<void> {
  await page.route(`**${root}/${fixture.name}`, (route) => {
    const bytes = fixture.packageBytes;
    const range = route.request().headers()["range"];
    const match = range === undefined ? null : /^bytes=(\d+)-(\d+)$/.exec(range);
    if (match === null) {
      return route.fulfill({ status: 200, contentType: "application/octet-stream", headers: { "content-length": String(bytes.length), "accept-ranges": "bytes" }, body: Buffer.from(bytes) });
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), bytes.length - 1);
    const slice = bytes.subarray(start, end + 1);
    return route.fulfill({ status: 206, contentType: "application/octet-stream", headers: { "content-range": `bytes ${start}-${end}/${bytes.length}`, "content-length": String(slice.length) }, body: Buffer.from(slice) });
  });
  await page.route(`**${root}/${fixture.name}.json`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.descriptor) }));
}

/** Track active input listeners on the player surfaces to detect per-restart accumulation. */
export async function trackInputListeners(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Listener = EventListenerOrEventListenerObject;
    type Entry = { readonly target: EventTarget; readonly type: string; readonly listener: Listener; readonly capture: boolean };
    const entries: Entry[] = [];
    const tracked: Record<string, true> = {
      keydown: true,
      keyup: true,
      blur: true,
      focus: true,
      visibilitychange: true,
      pointerdown: true,
      pointermove: true,
      pointerup: true,
      contextmenu: true,
      resize: true,
    };
    const captureOf = (options?: boolean | AddEventListenerOptions): boolean => typeof options === "boolean" ? options : options?.capture ?? false;
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (listener !== null && tracked[type] === true) {
        const capture = captureOf(options);
        if (!entries.some((entry) => entry.target === this && entry.type === type && entry.listener === listener && entry.capture === capture)) {
          entries.push({ target: this, type, listener, capture });
        }
      }
      add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      if (listener !== null && tracked[type] === true) {
        const capture = captureOf(options);
        const index = entries.findIndex((entry) => entry.target === this && entry.type === type && entry.listener === listener && entry.capture === capture);
        if (index >= 0) entries.splice(index, 1);
      }
      remove.call(this, type, listener, options);
    };
    window.__inputListenerCounts = () => {
      const screen = document.querySelector("#screen");
      const counts: Record<string, number> = {};
      for (const type of Object.keys(tracked)) {
        const target = type === "visibilitychange" ? document : ["pointerdown", "pointermove", "pointerup", "contextmenu"].includes(type) ? screen : type === "resize" || type === "keydown" || type === "keyup" || type === "blur" || type === "focus" ? window : null;
        counts[type] = entries.filter((entry) => entry.type === type && entry.target === target).length;
      }
      return counts;
    };
    window.__inputKeydownListeners = () => entries.filter((entry) => entry.target === window && entry.type === "keydown").map((entry) => entry.listener);
  });
}

/** Install a small in-memory Capacitor filesystem for the mobile player page. */
export async function installMobileFilesystemStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const files = new Map<string, string>();
    const fixtureWindow = window as FixtureWindow;
    fixtureWindow.Capacitor = {
      Plugins: {
        Filesystem: {
          async writeFile({ path, data }) {
            files.set(path, data);
          },
          async readFile({ path }) {
            const data = files.get(path);
            if (data === undefined) throw new Error(`absent ${path}`);
            return { data };
          },
          async readdir({ path }) {
            const children = new Map<string, "file" | "directory">();
            for (const filePath of files.keys()) {
              if (!filePath.startsWith(`${path}/`)) continue;
              const remainder = filePath.slice(path.length + 1);
              const slash = remainder.indexOf("/");
              const name = slash === -1 ? remainder : remainder.slice(0, slash);
              const kind = slash === -1 ? "file" : "directory";
              if (!children.has(name)) children.set(name, kind);
            }
            return { files: [...children.entries()].map(([name, type]) => ({ name, type })) };
          },
        },
      },
    };
  });
}
