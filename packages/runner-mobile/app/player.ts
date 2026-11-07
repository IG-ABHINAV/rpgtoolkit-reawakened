/*
 * The mobile player page (entry 9.12): the **same** live page as the desktop shell, run against the mobile host.
 *
 * The wrapper adds no renderer, input path or asset source of its own; on a device the host is Capacitor's `Filesystem`,
 * and the package is the one the app carries or the player picked. Nothing here knows it is on a phone.
 */

import { interactivePackage, type InputRecord } from "@tk-reawakened/runner-web";
import { createFallbackTouchControls, isFallbackTouchControlTarget, shouldSuppressGameplayKey } from "@tk-reawakened/runner-web/touch-controls";
import { attachPointerInput } from "@tk-reawakened/runner-web/pointer";
import { createLiveSession, type LiveSession } from "@tk-reawakened/runner-web/live-session";
import { createObservedHostGeometry, observeHostState, reapplyObservedGeometryBeforePointer, reconcileObservedGeometryAfterAdvance, reconcileObservedHostFeaturesAfterAdvance, stampPendingInputs, type HostViewport, type PendingInput } from "@tk-reawakened/runner-web/host-state";
import { createMobileHost, type MobileFilesystem } from "../src/storage.ts";

type LiveReport = {
  readonly tick: number;
  readonly stateHash: string;
  readonly drawHash: string;
  readonly board: string | null;
  readonly player: { readonly x: number; readonly y: number } | null;
  readonly moved?: boolean;
  readonly save?: { readonly path: string; readonly written: boolean; readonly blobPresent: boolean };
  readonly render?: {
    readonly drawn: number;
    readonly deferred: number;
    readonly deferredByKind: Readonly<Record<string, number>>;
    readonly diagnostics: readonly string[];
  };
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
  const viewport = document.querySelector<HTMLElement>("#viewport");
  if (canvas === null || status === null || viewport === null) throw new Error("mobile player page is missing its viewport, canvas, or status element");
  const hostViewport: HostViewport = { canvas, viewport };
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

  let stopped = false;
  let generation = 0;
  let activeSession: LiveSession | null = null;
  let disposeRun: (() => void) | null = null;
  const pagehide = (): void => {
    if (stopped) return;
    stopped = true;
    generation += 1;
    const cleanup = disposeRun;
    disposeRun = null;
    const session = activeSession;
    activeSession = null;
    if (cleanup !== null) cleanup();
    else session?.close();
  };
  window.addEventListener("pagehide", pagehide, { once: true });

  const restart = (sessionGeneration: number, session: LiveSession): void => {
    if (stopped || sessionGeneration !== generation || activeSession !== session) return;
    generation += 1;
    const cleanup = disposeRun;
    disposeRun = null;
    activeSession = null;
    if (cleanup !== null) cleanup();
    else session.close();
    setReport({ tick: 0, stateHash: "", drawHash: "", board: null, player: null });
    status.textContent = "restarting…";
    void launch();
  };

  const launch = async (): Promise<void> => {
    if (stopped) return;
    const sessionGeneration = ++generation;
    let created: LiveSession | null = null;
    let quitBeforeReady = false;
    try {
      const session = await createLiveSession({
        interactive: true,
        mainFile: pkg.main,
        gameIdentity: pkg.gameIdentity,
        files: pkg.files,
        bundled,
        gl,
        hostViewport,
        blobs: {
          read: (area, gameId, path) => host.readBlob(area, gameId, path),
          write: (area, gameId, path, bytes) => host.writeBlob(area, gameId, path, bytes),
          list: (area, gameId) => host.listBlobs(area, gameId),
        },
        onQuit: () => {
          if (stopped || sessionGeneration !== generation) return;
          if (created === null) {
            quitBeforeReady = true;
            return;
          }
          restart(sessionGeneration, created);
        },
      });
      created = session;
      if (stopped || sessionGeneration !== generation) {
        session.close();
        return;
      }
      activeSession = session;
      if (quitBeforeReady) {
        restart(sessionGeneration, session);
        return;
      }
      disposeRun = run(session, canvas, status, host, () => !stopped && sessionGeneration === generation && activeSession === session, hostViewport);
    } catch (error) {
      if (!stopped && sessionGeneration === generation) fail(String(error));
    }
  };

  void launch();
}

function run(
  session: LiveSession,
  canvas: HTMLCanvasElement,
  status: HTMLElement,
  host: ReturnType<typeof createMobileHost>,
  isCurrent: () => boolean,
  hostViewport: HostViewport,
): () => void {
  const stepMs = 1000 / 60;
  let previous = performance.now();
  let accumulator = 0;
  let pending: PendingInput[] = [];
    const fallbackControlKeys = new Set<string>();
      let fallbackActionSequence = 0;
  let disposed = false;
  let frameId: number | null = null;
  let startPlayer = session.playerPosition();
  let moved = false;
  let saveBlobPresent = false;
  let saveWritten = false;
  let lastSaveTick = -1;
  let saveWriting = false;

  const gameId = session.gameId;
  const savePath = "slot-1.json";
  const saveBytes = (): Uint8Array => new TextEncoder().encode(JSON.stringify({ gameId, tick: session.tick() }));
  const onKeyDown = (event: KeyboardEvent): void => {
    if (shouldSuppressGameplayKey(event.code, event.repeat, true, isFallbackTouchControlTarget(event.target), fallbackControlKeys)) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    pending.push({ tick: session.tick(), event: { kind: "key", name: event.key.toUpperCase(), code: event.code, char: event.key.length === 1 ? event.key : null, down: true, ...(event.repeat ? { repeat: true } : {}) }, pointerGeometry: null });
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (shouldSuppressGameplayKey(event.code, event.repeat, false, isFallbackTouchControlTarget(event.target), fallbackControlKeys)) return;
    pending.push({ tick: session.tick(), event: { kind: "key", name: event.key.toUpperCase(), code: event.code, char: event.key.length === 1 ? event.key : null, down: false }, pointerGeometry: null });
  };
  const focus = (state: "lost" | "gained"): void => {
    pending.push({ tick: session.tick(), event: { kind: "focus", state }, pointerGeometry: null });
  };
  const onBlur = (): void => {
      fallbackControlKeys.clear();
      focus("lost");
    };
  const onFocus = (): void => focus("gained");
  const onVisibility = (): void => focus(document.hidden ? "lost" : "gained");
  const viewSize = session.viewSize();
  const observedGeometry = createObservedHostGeometry(session.displayGeometry());
  const hostObserver = observeHostState(hostViewport, viewSize, (event) => {
    observedGeometry.observe(event);
    pending.push({ tick: null, event, pointerGeometry: null });
  }, session.hostState ?? undefined);
  session.setHostRestoreSnapshotProvider(() => {
    const snapshot = hostObserver.snapshotForRestore(pending);
    for (const event of snapshot.observations) observedGeometry.observe(event);
    return snapshot;
  });
  const stage = hostViewport.viewport;
  const dispatchFallbackAction = (action: "up" | "down" | "left" | "right" | "confirm" | "cancel", down: boolean, modalId: number | null = null): number => {
    let event: InputRecord["event"];
    if (modalId === null) {
      event = { kind: "action", action, down, source: "runner.fallback", modalId: null };
    } else if (action === "confirm" || action === "cancel") {
      event = { kind: "action", action, down, source: "runner.fallback", modalId };
    } else {
      throw new Error("only confirm or cancel may target a modal");
    }
    pending.push({ tick: null, event, pointerGeometry: null });
    fallbackActionSequence += 1;
    return fallbackActionSequence;
  };
  const touchControls = createFallbackTouchControls(stage, observedGeometry.current, dispatchFallbackAction);
  const stopPointerInput = attachPointerInput(
    stage,
    viewSize,
    observedGeometry.current,
    ({ x, y }, buttons) => {
      const geometry = observedGeometry.current();
      reapplyObservedGeometryBeforePointer(session.displayGeometry(), observedGeometry, pending);
      pending.push({ tick: session.tick(), event: { kind: "pointer", x, y, buttons }, pointerGeometry: geometry });
    },
    () => {
      reapplyObservedGeometryBeforePointer(session.displayGeometry(), observedGeometry, pending);
      pending.push({ tick: session.tick(), event: { kind: "pointer.cancel" }, pointerGeometry: null });
    },
    ({ x, y }) => session.engine.runnerControlPointerPreemption(x, y),
    dispatchFallbackAction,
    () => session.engine.surfaceCacheEpoch(),
  );
  const onContextMenu = (event: MouseEvent): void => event.preventDefault();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("contextmenu", onContextMenu);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    hostObserver.dispose();
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    stopPointerInput();
    canvas.removeEventListener("contextmenu", onContextMenu);
    touchControls.close();
    session.close();
  };

  const draw = (now: number): void => {
    frameId = null;
    if (disposed || !isCurrent()) return;
    hostObserver.poll();
    touchControls.update(session.engine.hostFeatures().touch && !session.engine.customTouchControlsDeclared());
    accumulator += Math.max(0, now - previous);
    previous = now;
    const ticks = Math.floor(accumulator / stepMs);
    accumulator -= ticks * stepMs;
    const geometryNeedsTick = reapplyObservedGeometryBeforePointer(session.displayGeometry(), observedGeometry, pending);
    if (ticks === 0 && geometryNeedsTick) {
      frameId = window.requestAnimationFrame(draw);
      return;
    }
    const inputs = stampPendingInputs(pending, session.tick());
    const submittedActionSequence = fallbackActionSequence;
    pending = [];
    const tickBeforeAdvance = session.tick();
    void session.advance(ticks, inputs).then(async () => {
      if (disposed || !isCurrent()) return;
      if (session.tick() !== tickBeforeAdvance) touchControls.acknowledgeSubmittedBatch(submittedActionSequence);
      reconcileObservedHostFeaturesAfterAdvance(session.engine.hostFeatures(), hostObserver, pending);
      const restoredGeometryNeedsTick = reconcileObservedGeometryAfterAdvance(session.displayGeometry(), observedGeometry, pending, session.tick());
      if (restoredGeometryNeedsTick) {
        frameId = window.requestAnimationFrame(draw);
        return;
      }
      const frame = session.draw(accumulator / stepMs);
      const player = session.playerPosition();
      const board = session.boardKey();
      if (!moved && startPlayer !== null && player !== null && (player.x !== startPlayer.x || player.y !== startPlayer.y)) moved = true;
      if (startPlayer === null) startPlayer = player;
      let written = saveWritten;
      if (!saveWritten) {
        written = await host.writeBlob("saves", gameId, savePath, saveBytes());
        if (disposed || !isCurrent()) return;
        saveWritten = written;
        lastSaveTick = session.tick();
      } else if (!saveWriting && session.tick() - lastSaveTick >= 60) {
        saveWriting = true;
        lastSaveTick = session.tick();
        void host.writeBlob("saves", gameId, savePath, saveBytes()).then((result) => {
          saveWriting = false;
          if (result) saveWritten = true;
        }).catch(() => {
          saveWriting = false;
        });
      }
      const saveLabel = `${saveBlobPresent ? "host blob present; " : ""}${written ? "written" : "write failed"}`;
      setReport({
        tick: session.tick(),
        stateHash: session.stateHash(),
        drawHash: frame.drawHash,
        board,
        player,
        moved,
        save: { path: savePath, written, blobPresent: saveBlobPresent },
        render: {
          drawn: frame.render.drawn,
          deferred: frame.render.deferred,
          deferredByKind: frame.render.deferredByKind,
          diagnostics: frame.render.diagnostics,
        },
      });
      status.textContent = [
        `tick ${session.tick()}`,
        `state ${session.stateHash()}`,
        `draw ${frame.drawHash}`,
        board === null ? "board: booting" : `board: ${board}`,
        player === null ? "player: unavailable" : `player ${player.x}, ${player.y}`,
        moved ? "moved: yes" : "moved: no",
        `save ${savePath}: ${saveLabel}`,
        ...(session.audioError() === null ? [] : [`audio: ${session.audioError()}`]),
        "Move: arrows or WASD; tap/click to walk.",
      ].join("\n");
      if (!disposed && isCurrent()) frameId = window.requestAnimationFrame(draw);
    }).catch((error: unknown) => {
      if (disposed || !isCurrent()) return;
      setReport({ tick: session.tick(), stateHash: session.stateHash(), drawHash: "", board: session.boardKey(), player: session.playerPosition(), error: String(error) });
      status.textContent = `player: ${String(error)}`;
      dispose();
    });
  };

  void host.readBlob("saves", gameId, savePath).then((bytes) => {
    if (disposed || !isCurrent()) return;
    saveBlobPresent = bytes !== null;
    frameId = window.requestAnimationFrame(draw);
  }).catch((error: unknown) => {
    if (disposed || !isCurrent()) return;
    setReport({ tick: session.tick(), stateHash: session.stateHash(), drawHash: "", board: session.boardKey(), player: session.playerPosition(), error: String(error) });
    status.textContent = `player: ${String(error)}`;
    dispose();
  });
  return dispose;
}
