/**
 * `runner-desktop` — the **player's** Electron main process (entry 9.11; ADR 0013 decisions 1 to 3).
 *
 * It is a shell around the `runner-web` build and nothing else: no window chrome, no launch resolution and no library
 * (the player application, entry 9.10, owns those), and no editor code or editor chrome at all (that is `host-desktop`).
 *
 * Two rules shape this file:
 *
 * 1. **Pages come over `app://`, never `loadFile`.** The scheme is registered **before `app.ready`** as `standard`,
 *    `secure`, `supportFetchAPI` and `corsEnabled`, so an `AudioWorklet` module loads and `fetch` works, which `file://`
 *    refuses (ADR 0013). **No service worker** is registered and `allowServiceWorkers` is never claimed: the PWA is the
 *    only artefact with one.
 * 2. **The host services live here, behind a narrow preload bridge.** A package is read as bytes from disk (a path or a
 *    drag-and-drop) and handed to the page's `packageFiles`; a save blob goes to AD-17's keys under the `GameId` the
 *    descriptor carries. The page keeps one asset source and one input path, exactly as in the browser.
 *
 * `guardrail-exception: G6 ADR-0013` — the Electron binary embeds a Chromium inventory with two licences our gate blocks;
 * the exception and its inventory check are recorded once for both applications in ADR 0013.
 */

import { app, BrowserWindow, ipcMain, protocol } from "electron";

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { quitWhenLastWindowCloses } from "./lifecycle.ts";

/** The privileged scheme. Registered at module load, which is before `app.ready` by construction. */
export const APP_SCHEME = "app";

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".sf2": "application/octet-stream",
  ".tpk": "application/octet-stream",
  ".wav": "audio/wav",
  ".mid": "audio/midi",
  ".ttf": "font/ttf",
  ".fnt": "application/octet-stream",
};

/** The directory pages and data are served from: `--serve <dir>`, defaulting to the app's own resources. */
function serveRoot(): string {
  const at = process.argv.indexOf("--serve");
  return resolve(at >= 0 ? process.argv[at + 1] ?? "." : join(app.getAppPath(), "resources"));
}

/** The package to open at start: `--package <file.tpk>`, or none (entry 9.10 resolves a launch target). */
function packageArgument(): string | null {
  const at = process.argv.indexOf("--package");
  return at >= 0 ? resolve(process.argv[at + 1] ?? "") : null;
}

/** Resolve one `app://player/<path>` request inside the served root, refusing anything that escapes it. */
export function resolveAppPath(root: string, url: string): string | null {
  const parsed = new URL(url);
  const relative = normalize(decodeURIComponent(parsed.pathname)).replaceAll("\\", "/").replace(/^\/+/, "");
  const full = resolve(root, relative);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

/** The blob areas AD-17 names, under the runner's own storage. */
function blobRoot(area: "saves" | "files"): string {
  return join(app.getPath("userData"), area);
}

function registerIpc(): void {
  ipcMain.handle("desktop:package", (): { name: string; bytes: Uint8Array; descriptor: unknown } | null => {
    const path = packageArgument();
    if (path === null) return null;
    try {
      const bytes = new Uint8Array(readFileSync(path));
      let descriptor: unknown = null;
      try { descriptor = JSON.parse(readFileSync(`${path}.json`, "utf8")) as unknown; } catch { /* The player reports an invalid or missing sidecar. */ }
      return { name: path.split(sep).at(-1) ?? "game.tpk", bytes, descriptor };
    } catch {
      return null;
    }
  });

  ipcMain.handle("desktop:blob.read", (_event, area: "saves" | "files", gameId: string, path: string): Uint8Array | null => {
    const full = resolve(join(blobRoot(area), gameId, path));
    if (!full.startsWith(blobRoot(area) + sep)) return null;
    try {
      return new Uint8Array(readFileSync(full));
    } catch {
      return null;
    }
  });

  ipcMain.handle("desktop:blob.write", (_event, area: "saves" | "files", gameId: string, path: string, bytes: Uint8Array): boolean => {
    const full = resolve(join(blobRoot(area), gameId, path));
    if (!full.startsWith(blobRoot(area) + sep)) return false;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
    return true;
  });

  ipcMain.handle("desktop:blob.list", (_event, area: "saves" | "files", gameId: string): string[] => {
    const root = join(blobRoot(area), gameId);
    if (!root.startsWith(blobRoot(area))) return [];
    try {
      return readdirSync(root, { recursive: true })
        .map((entry) => String(entry).replaceAll("\\", "/"))
        .filter((entry) => {
          try {
            return statSync(join(root, entry)).isFile();
          } catch {
            return false;
          }
        })
        .sort();
    } catch {
      return [];
    }
  });

  ipcMain.handle("desktop:report", (_event, report: unknown): boolean => {
    // The measurement harness reads this back; the player itself logs it.
    const at = process.argv.findIndex((argument) => argument === "--report");
    if (at >= 0 && process.argv[at + 1] !== undefined) writeFileSync(resolve(process.argv[at + 1]), `${JSON.stringify(report, null, 2)}\n`);
    return true;
  });
}

function serveAppProtocol(): void {
  const root = serveRoot();
  protocol.handle(APP_SCHEME, (request) => {
    const full = resolveAppPath(root, request.url);
    if (full === null) return new Response("not found", { status: 404 });
    try {
      const body = readFileSync(full);
      return new Response(body, { headers: { "content-type": TYPES[extname(full)] ?? "application/octet-stream" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 960,
    height: 720,
    backgroundColor: "#000000",
    // No chrome of our own: the page draws everything, and the menu bar is the OS's.
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The app directory is the built one, so the preload sits beside `main.js`.
      preload: join(app.getAppPath(), "preload.js"),
      // No service worker: the desktop application is already offline (ADR 0013 decision 3).
      devTools: process.argv.includes("--devtools"),
    },
  });
  const defaultPage = process.argv.includes("--report") ? "player-measure.html" : "player.html";
  const page = process.argv.includes("--page") ? process.argv[process.argv.indexOf("--page") + 1] : defaultPage;
  // Diagnostics: a page that fails to load, or a renderer error, is reported on stderr instead of disappearing.
  window.webContents.on("console-message", (event) => console.error(`renderer[${event.level}]: ${event.message}`));
  window.webContents.on("did-fail-load", (_event, code, description, url) => console.error(`load failed ${code} ${description} ${url}`));
  window.webContents.on("preload-error", (_event, path, error) => console.error(`preload error ${path}: ${error.message}`));
  window.loadURL(`${APP_SCHEME}://player/${page}`).catch((error: unknown) => console.error(`loadURL: ${String(error)}`));
  return window;
}

registerIpc();
app.whenReady().then(() => {
  serveAppProtocol();
  createWindow();
});

// One game, one window: closing it ends the player, so no `activate` handler recreates a window on macOS.
quitWhenLastWindowCloses(app);

export { blobRoot, packageArgument, serveRoot, pathToFileURL };
