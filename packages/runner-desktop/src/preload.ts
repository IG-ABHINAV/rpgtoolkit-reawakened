/**
 * The desktop host bridge (entry 9.11): four calls and no more, so the page keeps one asset source and one input path as
 * it has in the browser (runners.md#mobile's "must not fork" rule binds every wrapper).
 */

import { contextBridge, ipcRenderer } from "electron";

export type DesktopHost = {
  /** The package named by `--package`, as bytes; `null` when the launch names none. */
  openPackage(): Promise<{ readonly name: string; readonly bytes: Uint8Array; readonly descriptor: unknown } | null>;
  readBlob(area: "saves" | "files", gameId: string, path: string): Promise<Uint8Array | null>;
  writeBlob(area: "saves" | "files", gameId: string, path: string, bytes: Uint8Array): Promise<boolean>;
  listBlobs(area: "saves" | "files", gameId: string): Promise<string[]>;
  /** Hand a measurement report to the main process, which writes it where `--report` names. */
  report(value: unknown): Promise<boolean>;
  /** Close the desktop player through Electron's ordered application teardown. */
  quit(): Promise<boolean>;
};

contextBridge.exposeInMainWorld("desktop", {
  openPackage: () => ipcRenderer.invoke("desktop:package"),
  readBlob: (area, gameId, path) => ipcRenderer.invoke("desktop:blob.read", area, gameId, path),
  writeBlob: (area, gameId, path, bytes) => ipcRenderer.invoke("desktop:blob.write", area, gameId, path, bytes),
  listBlobs: (area, gameId) => ipcRenderer.invoke("desktop:blob.list", area, gameId),
  report: (value) => ipcRenderer.invoke("desktop:report", value),
  quit: () => ipcRenderer.invoke("desktop:quit"),
} satisfies DesktopHost);
