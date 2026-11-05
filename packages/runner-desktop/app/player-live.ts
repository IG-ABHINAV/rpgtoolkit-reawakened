import type { InputRecord } from "@tk-reawakened/core";
import { interactivePackage } from "@tk-reawakened/runner-web";
import { createFallbackTouchControls, isFallbackTouchControlTarget } from "@tk-reawakened/runner-web/touch-controls";
import { attachPointerInput } from "@tk-reawakened/runner-web/pointer";
import { soundFontDecoderReady } from "@tk-reawakened/synth";
import { createLiveSession, type LiveSession } from "@tk-reawakened/runner-web/live-session";
import { createObservedHostGeometry, observeHostState, stampPendingInputs, type HostViewport, type PendingInput } from "@tk-reawakened/runner-web/host-state";

type Host = {
  openPackage(): Promise<{ readonly name: string; readonly bytes: Uint8Array; readonly descriptor: unknown } | null>;
  readBlob(area: "saves" | "files", gameId: string, path: string): Promise<Uint8Array | null>;
  writeBlob(area: "saves" | "files", gameId: string, path: string, bytes: Uint8Array): Promise<boolean>;
  listBlobs(area: "saves" | "files", gameId: string): Promise<string[]>;
  quit(): Promise<boolean>;
};
declare global { interface Window { desktop?: Host; __live?: { tick: number; stateHash: string; drawHash: string; board: string | null; player: { x: number; y: number } | null; error?: string }; __session?: LiveSession } }

void start().catch((error: unknown) => {
  const status = document.querySelector<HTMLElement>("#live-status");
  if (status !== null) status.textContent = `player: ${String(error)}`;
  window.__live = { tick: 0, stateHash: "", drawHash: "", board: null, player: null, error: String(error) };
});

async function start(): Promise<void> {
  await soundFontDecoderReady;
  const host = window.desktop;
  const canvas = document.querySelector<HTMLCanvasElement>("#screen");
  const status = document.querySelector<HTMLElement>("#live-status");
  const viewport = document.querySelector<HTMLElement>("#viewport");
  if (host === undefined || canvas === null || status === null || viewport === null) throw new Error("desktop player host or attached canvas is absent");
  const opened = await host.openPackage();
  if (opened === null) throw new Error("no package was named on the command line");
  const pkg = await interactivePackage(opened.name, new Uint8Array(opened.bytes), opened.descriptor);
  const files = pkg.files;
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
    files,
    bundled,
    gl,
    hostViewport: { canvas, viewport },
    blobs: {
      read: (area, gameId, path) => host.readBlob(area, gameId, path),
      write: (area, gameId, path, bytes) => host.writeBlob(area, gameId, path, bytes),
      list: (area, gameId) => host.listBlobs(area, gameId),
    },
    onQuit: () => { void host.quit(); },
  });
  window.__session = session;
  run(session, canvas, status, { canvas, viewport });
}

function run(session: LiveSession, canvas: HTMLCanvasElement, status: HTMLElement, hostViewport: HostViewport): void {
  const stepMs = 1000 / 60;
  let previous = performance.now();
  let accumulator = 0;
  let pending: PendingInput[] = [];
    const fallbackControlKeys = new Set<string>();
  let disposed = false;
  const onKeyDown = (event: KeyboardEvent): void => {
      if (isFallbackTouchControlTarget(event.target)) {
        fallbackControlKeys.add(event.code);
        return;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
      pending.push({ tick: session.tick(), event: { kind: "key", name: event.key.toUpperCase(), code: event.code, char: event.key.length === 1 ? event.key : null, down: true, ...(event.repeat ? { repeat: true } : {}) } });
    };
  const onKeyUp = (event: KeyboardEvent): void => {
      if (fallbackControlKeys.delete(event.code)) return;
      pending.push({ tick: session.tick(), event: { kind: "key", name: event.key.toUpperCase(), code: event.code, char: event.key.length === 1 ? event.key : null, down: false } });
    };
  const focus = (state: "lost" | "gained"): void => pending.push({ tick: session.tick(), event: { kind: "focus", state } });
  const onBlur = (): void => focus("lost");
  const onFocus = (): void => focus("gained");
  const onVisibility = (): void => focus(document.hidden ? "lost" : "gained");
  const viewSize = session.viewSize(),
      observedGeometry = createObservedHostGeometry(session.displayGeometry());
  const touchControls = createFallbackTouchControls(
    hostViewport.viewport,
    () => observedGeometry.current(),
    (action, down) => pending.push({ tick: session.tick(), event: { kind: "action", action, down, source: "runner.fallback" } })
  );
  const stopObservingHost = observeHostState(
      hostViewport,
      viewSize,
      (event) => {
        observedGeometry.observe(event);
        pending.push({ tick: null, event });
      },
      session.hostState ?? undefined,
    );
  const stopPointerInput = attachPointerInput(
      hostViewport,
      viewSize,
      observedGeometry.current,
      ({ x, y }, buttons) => pending.push({ tick: session.tick(), event: { kind: "pointer", x, y, buttons } }),
      () => pending.push({ tick: session.tick(), event: { kind: "pointer.cancel" } }),
    );
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    stopObservingHost();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    stopPointerInput();
    touchControls.close();
    session.close();
  };
  window.addEventListener("pagehide", dispose, { once: true });
  const draw = (now: number): void => {
    if (disposed) return;
    accumulator += Math.max(0, now - previous);
    previous = now;
    const ticks = Math.floor(accumulator / stepMs);
    accumulator -= ticks * stepMs;
    touchControls.update(session.engine.hostFeatures().touch && !session.engine.customTouchControlsDeclared());
    const inputs = stampPendingInputs(pending, session.tick());
    pending = [];
    void session.advance(ticks, inputs).then(() => {
      if (disposed) return;
      const frame = session.draw(accumulator / stepMs);
      const player = session.playerPosition();
      const result = { tick: session.tick(), stateHash: session.stateHash(), drawHash: frame.drawHash, board: session.boardKey(), player };
      window.__live = result;
      status.textContent = [`tick ${result.tick}`, `state ${result.stateHash}`, `draw ${result.drawHash}`, player === null ? "player position unavailable" : `player ${player.x}, ${player.y}`, "Move: arrows or WASD; click to walk."].join("\n");
      requestAnimationFrame(draw);
    }).catch((error: unknown) => {
      window.__live = { tick: session.tick(), stateHash: session.stateHash(), drawHash: "", board: session.boardKey(), player: session.playerPosition(), error: String(error) };
      status.textContent = `player: ${String(error)}`;
      dispose();
    });
  };
  requestAnimationFrame(draw);
}
