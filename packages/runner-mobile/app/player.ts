/**
 * The mobile player page (entry 9.12): the **same** live page as the desktop shell, run against the mobile host.
 *
 * The wrapper adds no renderer, input path or asset source of its own; on a device the host is Capacitor's `Filesystem`,
 * and the package is the one the app carries or the player picked. Nothing here knows it is on a phone.
 */

import { interactivePackage, type InputRecord } from "@tk-reawakened/runner-web";
import { pointerEventToLogical } from "@tk-reawakened/runner-web/pointer";
import { createLiveSession, fitCanvas, type LiveSession } from "@tk-reawakened/runner-web/live-session";
import { createMobileHost, type MobileFilesystem } from "../src/storage.ts";

type LiveReport = {
  readonly tick: number;
  readonly stateHash: string;
  readonly drawHash: string;
  readonly board: string | null;
  readonly player: { readonly x: number; readonly y: number } | null;
  readonly moved?: boolean;
  readonly save?: { readonly path: string; readonly written: boolean; readonly blobPresent: boolean };
  readonly error?: string;
};

declare global {
  interface Window {
    __live?: LiveReport;
    __mobile?: LiveReport;
    Capacitor?: { Plugins?: { Filesystem?: MobileFilesystem } };
  }
}

function setReport(report: LiveReport): void {
  window.__live = report;
  window.__mobile = report;
  document.title = `mobile: ${report.error ?? `${report.board ?? "booting"} ${report.tick} ${report.stateHash}`}`;
}

function fail(message: string): void {
  setReport({ tick: 0, stateHash: "", drawHash: "", board: null, player: null, error: message });
}

const BUNDLED_PACKAGE = "demo.tpk";

async function readPackage(filesystem: MobileFilesystem): Promise<{ readonly name: string; readonly bytes: Uint8Array } | null> {
  try {
    const response = await fetch(`/public/${BUNDLED_PACKAGE}`);
    if (response.ok) return { name: BUNDLED_PACKAGE, bytes: new Uint8Array(await response.arrayBuffer()) };
  } catch {
    // fall through to the filesystem stub used in browser tests
  }
  try {
    const file = await filesystem.readFile({ path: `public/${BUNDLED_PACKAGE}`, encoding: "base64", directory: "DATA" });
    const text = typeof file.data === "string" ? file.data : "";
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { name: BUNDLED_PACKAGE, bytes };
  } catch {
    return null;
  }
}

async function readDescriptor(filesystem: MobileFilesystem, name: string): Promise<unknown> {
  const jsonName = `${name}.json`;
  try {
    const response = await fetch(`/public/${jsonName}`);
    if (response.ok) return response.json();
  } catch {
    // fall through
  }
  try {
    const file = await filesystem.readFile({ path: `public/${jsonName}`, encoding: "utf8", directory: "DATA" });
    const text = typeof file.data === "string" ? file.data : new TextDecoder().decode(file.data);
    return JSON.parse(text);
  } catch {
    throw new Error(`no descriptor for ${name}`);
  }
}

void start().catch((error: unknown) => {
  fail(String(error));
});

async function start(): Promise<void> {
  const filesystem = window.Capacitor?.Plugins?.Filesystem;
  if (filesystem === undefined) {
    fail("the Capacitor Filesystem plugin is absent; this page runs inside the wrapper");
    return;
  }
  const host = createMobileHost({ filesystem, readPackage: () => readPackage(filesystem) });
  const canvas = document.querySelector<HTMLCanvasElement>("#screen");
  const status = document.querySelector<HTMLElement>("#live-status");
  if (canvas === null || status === null) throw new Error("mobile player page is missing its canvas or status element");

  const opened = await host.openPackage();
  if (opened === null) throw new Error("no package was available");
  const descriptor = await readDescriptor(filesystem, opened.name);
  const pkg = await interactivePackage(opened.name, new Uint8Array(opened.bytes), descriptor);

  const listed = (await (await fetch("/apps/bundled.json")).json()) as { readonly files: readonly string[] };
  const bundled = new Map<string, Uint8Array>();
  for (const name of listed.files) {
    const response = await fetch(`/${name}`);
    if (response.ok) bundled.set(name, new Uint8Array(await response.arrayBuffer()));
  }

  const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (gl === null) throw new Error("no WebGL2 context for the visible player");

  const session = await createLiveSession({
    interactive: true,
    mainFile: pkg.main,
    gameIdentity: pkg.gameIdentity,
    files: pkg.files,
    bundled,
    gl,
    blobs: {
      read: (area, gameId, path) => host.readBlob(area, gameId, path),
      write: (area, gameId, path, bytes) => host.writeBlob(area, gameId, path, bytes),
      list: (area, gameId) => host.listBlobs(area, gameId),
    },
  });
  const view = session.viewSize();
  const fit = (): void => {
    fitCanvas(canvas, view.width, view.height, { width: window.innerWidth, height: Math.max(80, window.innerHeight - 80) });
  };
  fit();
  window.addEventListener("resize", fit);
  run(session, canvas, status, host);
}

async function run(
  session: LiveSession,
  canvas: HTMLCanvasElement,
  status: HTMLElement,
  host: ReturnType<typeof createMobileHost>,
): Promise<void> {
  const stepMs = 1000 / 60;
  let previous = performance.now();
  let accumulator = 0;
  let pending: InputRecord[] = [];
  let disposed = false;
  let startPlayer = session.playerPosition();
  let moved = false;

  const gameId = session.gameId;
  const savePath = "slot-1.json";
  const saveBytes = (): Uint8Array => new TextEncoder().encode(JSON.stringify({ gameId, tick: session.tick() }));
  const saveBlobPresent = await host.readBlob("saves", gameId, savePath) !== null;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    pending.push({ tick: session.tick(), event: { kind: "key", name: event.key.toUpperCase(), code: event.code, char: event.key.length === 1 ? event.key : null, down: true, ...(event.repeat ? { repeat: true } : {}) } });
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    pending.push({ tick: session.tick(), event: { kind: "key", name: event.key.toUpperCase(), code: event.code, char: event.key.length === 1 ? event.key : null, down: false } });
  };
  const focus = (state: "lost" | "gained"): void => {
    pending.push({ tick: session.tick(), event: { kind: "focus", state } });
  };
  const onBlur = (): void => focus("lost");
  const onFocus = (): void => focus("gained");
  const onVisibility = (): void => focus(document.hidden ? "lost" : "gained");
  const viewSize = session.viewSize();
  const onPointer = (event: PointerEvent): void => {
    const { x, y } = pointerEventToLogical(event, canvas, viewSize);
    pending.push({ tick: session.tick(), event: { kind: "pointer", x, y, buttons: event.buttons } });
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointerdown", onPointer);
  canvas.addEventListener("pointermove", onPointer);
  canvas.addEventListener("pointerup", onPointer);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("pointerdown", onPointer);
    canvas.removeEventListener("pointermove", onPointer);
    canvas.removeEventListener("pointerup", onPointer);
    session.close();
  };
  window.addEventListener("pagehide", dispose, { once: true });

  const draw = (now: number): void => {
    if (disposed) return;
    accumulator += Math.max(0, now - previous);
    previous = now;
    const ticks = Math.floor(accumulator / stepMs);
    accumulator -= ticks * stepMs;
    const inputs = pending;
    pending = [];
    void session.advance(ticks, inputs).then(async () => {
      if (disposed) return;
      const frame = session.draw(accumulator / stepMs);
      const player = session.playerPosition();
      const board = session.boardKey();
      if (!moved && startPlayer !== null && player !== null && (player.x !== startPlayer.x || player.y !== startPlayer.y)) {
        moved = true;
      }
      if (startPlayer === null) startPlayer = player;

      // Prove the save path works on this host.
      const written = await host.writeBlob("saves", gameId, savePath, saveBytes());
      const saveLabel = `${saveBlobPresent ? "host blob present; " : ""}${written ? "written" : "write failed"}`;
      setReport({ tick: session.tick(), stateHash: session.stateHash(), drawHash: frame.drawHash, board, player, moved, save: { path: savePath, written, blobPresent: saveBlobPresent } });
      status.textContent = [
        `tick ${session.tick()}`,
        `state ${session.stateHash()}`,
        `draw ${frame.drawHash}`,
        board === null ? "board: booting" : `board: ${board}`,
        player === null ? "player: unavailable" : `player ${player.x}, ${player.y}`,
        moved ? "moved: yes" : "moved: no",
        `save ${savePath}: ${saveLabel}`,
        "Move: arrows or WASD; tap/click to walk.",
      ].join("\n");
      requestAnimationFrame(draw);
    }).catch((error: unknown) => {
      setReport({ tick: session.tick(), stateHash: session.stateHash(), drawHash: "", board: session.boardKey(), player: session.playerPosition(), error: String(error) });
      status.textContent = `player: ${String(error)}`;
      dispose();
    });
  };
  requestAnimationFrame(draw);
}
