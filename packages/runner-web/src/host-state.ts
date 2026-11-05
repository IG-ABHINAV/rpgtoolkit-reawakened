import type { HostDisplayGeometry, NormalizedHostFeatures } from "@tk-reawakened/core";
import type { InputRecord } from "@tk-reawakened/core";

export type HostViewport = { readonly canvas: HTMLCanvasElement; readonly viewport: HTMLElement };
export type HostStateSnapshot = { readonly features: NormalizedHostFeatures; readonly geometry: HostDisplayGeometry };

/** Read only host capabilities that can be reported without inferring an operating-system identity. */
export function readHostFeatures(keyboardObserved = false): NormalizedHostFeatures {
  const nav = navigator as Navigator & {
    readonly maxTouchPoints?: number;
    readonly vibrate?: (pattern: number | readonly number[]) => boolean;
  };
  const pointerFine = window.matchMedia("(pointer: fine)").matches;
  const pointerCoarse = window.matchMedia("(pointer: coarse)").matches;
  const orientation = screen.orientation?.type ?? (window.matchMedia("(orientation: landscape)").matches ? "landscape-primary" : "portrait-primary");
  const connectedGamepad = Array.from(navigator.getGamepads?.() ?? []).some((pad) => pad !== null && pad.connected);
  return {
    touch: (nav.maxTouchPoints ?? 0) > 0 || pointerCoarse,
    pointer: pointerFine ? "fine" : pointerCoarse ? "coarse" : "none",
    keyboard: keyboardObserved,
    gamepad: connectedGamepad,
    haptics: typeof nav.vibrate === "function",
    orientation: orientation.startsWith("landscape") ? "landscape" : orientation.startsWith("portrait") ? "portrait" : null,
  };
}

/** Read CSS safe-area environment values using layout rather than parsing computed CSS expressions. */
export function createSafeAreaProbe(): { readonly read: () => HostDisplayGeometry["safeArea"]; readonly dispose: () => void } {
  const element = document.createElement("div");
  element.setAttribute("aria-hidden", "true");
  element.style.cssText = [
    "position:fixed", "inset:0", "visibility:hidden", "pointer-events:none", "z-index:-1",
    "padding-top:env(safe-area-inset-top)", "padding-right:env(safe-area-inset-right)",
    "padding-bottom:env(safe-area-inset-bottom)", "padding-left:env(safe-area-inset-left)",
  ].join(";");
  document.documentElement.append(element);
  return {
    read: () => {
      const style = getComputedStyle(element);
      return {
        top: Number.parseFloat(style.paddingTop) || 0,
        right: Number.parseFloat(style.paddingRight) || 0,
        bottom: Number.parseFloat(style.paddingBottom) || 0,
        left: Number.parseFloat(style.paddingLeft) || 0,
      };
    },
    dispose: () => element.remove(),
  };
}

/** A queued input with `tick: null` is stamped only when the runner starts the next serialized advance. */
export type PendingInput = { readonly tick: number | null; readonly event: InputRecord["event"] };

/** Stamp deferred host observations when they are handed to the next serialized engine advance. */
export function stampPendingInputs(inputs: readonly PendingInput[], tick: number): InputRecord[] {
  return inputs.map((input) => ({ tick: input.tick ?? tick, event: input.event }));
}

export type ObservedHostGeometry = {
  readonly current: () => HostDisplayGeometry;
  readonly observe: (event: InputRecord["event"]) => void;
};

function sameGeometry(left: HostDisplayGeometry, right: HostDisplayGeometry): boolean {
  return left.content.width === right.content.width && left.content.height === right.content.height &&
    left.game.x === right.game.x && left.game.y === right.game.y &&
    left.game.width === right.game.width && left.game.height === right.game.height &&
    left.safeArea.top === right.safeArea.top && left.safeArea.right === right.safeArea.right &&
    left.safeArea.bottom === right.safeArea.bottom && left.safeArea.left === right.safeArea.left;
}

/** Reapply the live observation after load/restore when engine geometry rolled back; preserve host-before-pointer order. */
export function reapplyObservedGeometryBeforePointer(
  engineGeometry: HostDisplayGeometry,
  observed: ObservedHostGeometry,
  pending: PendingInput[],
): boolean {
  const geometry = observed.current();
  if (sameGeometry(engineGeometry, geometry)) return false;
  if (!pending.some((input) => input.event.kind === "host.display" && sameGeometry(input.event.geometry, geometry))) {
    pending.push({ tick: null, event: { kind: "host.display", geometry } });
  }
  return true;
}

/** A restore may roll geometry back; queue the fresh observation for the next budgeted input tick. */
export function reconcileObservedGeometryAfterAdvance(
  engineGeometry: HostDisplayGeometry,
  observed: ObservedHostGeometry,
  pending: PendingInput[],
): boolean {
  return reapplyObservedGeometryBeforePointer(engineGeometry, observed, pending);
}


/** Keep pointer normalization aligned with the newest ordered host.display observation, even before the engine consumes it. */
export function createObservedHostGeometry(initial: HostDisplayGeometry): ObservedHostGeometry {
  let latest = initial;
  return {
    current: () => latest,
    observe(event) {
      if (event.kind === "host.display") latest = event.geometry;
    },
  };
}

/** Fit and measure only when the host has a positive content box. */
export function measureHostDisplay(
  { canvas, viewport }: HostViewport,
  view: { readonly width: number; readonly height: number },
  safeArea: HostDisplayGeometry["safeArea"],
): HostDisplayGeometry | null {
  const content = viewport.getBoundingClientRect();
  if (!Number.isFinite(content.width) || !Number.isFinite(content.height) || content.width <= 0 || content.height <= 0) return null;
  const scaleRatio = Math.min(content.width / view.width, content.height / view.height);
  const scale = scaleRatio >= 1 ? Math.floor(scaleRatio) : scaleRatio;
  const gameWidth = view.width * scale;
  const gameHeight = view.height * scale;
  // The renderer owns a content-sized backing bitmap; CSS must expose the entire content plane.
  canvas.style.width = `${content.width}px`;
  canvas.style.height = `${content.height}px`;
  return {
    content: { width: content.width, height: content.height },
    game: { x: (content.width - gameWidth) / 2, y: (content.height - gameHeight) / 2, width: gameWidth, height: gameHeight },
    safeArea,
  };
}

/** Wait for a host content box that can satisfy the positive-geometry contract. */
export function waitForHostDisplay(
  host: HostViewport,
  view: { readonly width: number; readonly height: number },
  safeArea: HostDisplayGeometry["safeArea"],
): Promise<HostDisplayGeometry> {
  const initial = measureHostDisplay(host, view, safeArea);
  if (initial !== null) return Promise.resolve(initial);
  const { promise, resolve } = Promise.withResolvers<HostDisplayGeometry>();
  let observer: ResizeObserver | null = null;
  const cleanup = (): void => {
    observer?.disconnect();
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onResize);
  };
  const onResize = (): void => {
    const geometry = measureHostDisplay(host, view, safeArea);
    if (geometry === null) return;
    cleanup();
    resolve(geometry);
  };
  observer = new ResizeObserver(onResize);
  observer.observe(host.viewport);
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  onResize();
  return promise;
}

/** Maintain deterministic host-state updates as events for stamping at the runner's consuming boundary. */
export function observeHostState(
  host: HostViewport,
  view: { readonly width: number; readonly height: number },
  enqueue: (event: InputRecord["event"]) => void,
  initial?: HostStateSnapshot,
): () => void {
  const safeArea = createSafeAreaProbe();
  let previousGeometry: HostDisplayGeometry | null = initial?.geometry ?? null;
  let previousFeatures: NormalizedHostFeatures | null = initial?.features ?? null;
  const send = (event: InputRecord["event"]): void => enqueue(event);
  let keyboardObserved = false;
  const updateDisplay = (): void => {
    const next = measureHostDisplay(host, view, safeArea.read());
    if (next === null) return;
    if (previousGeometry !== null && JSON.stringify(next) === JSON.stringify(previousGeometry)) return;
    previousGeometry = next;
    send({ kind: "host.display", geometry: next });
  };
  const updateFeatures = (): void => {
    const next = readHostFeatures(keyboardObserved);
    if (previousFeatures !== null && JSON.stringify(next) === JSON.stringify(previousFeatures)) return;
    previousFeatures = next;
    send({ kind: "host.features", features: next });
  };
  const connectedGamepads = new Set(
    Array.from(navigator.getGamepads?.() ?? [])
      .filter((pad): pad is Gamepad => pad !== null && pad.connected && pad.index < 4)
      .map((pad) => pad.index),
  );
  const onResize = (): void => { updateDisplay(); updateFeatures(); };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (keyboardObserved || !event.isTrusted || event.code === "" || event.code === "Unidentified" || event.key === "Unidentified") return;
    keyboardObserved = true;
    updateFeatures();
  };
  const onGamepadConnected = (event: GamepadEvent): void => {
    const pad = event.gamepad;
    if (pad.index >= 4 || connectedGamepads.has(pad.index)) return;
    connectedGamepads.add(pad.index);
    updateFeatures();
    send({ kind: "gamepad", device: pad.index, connected: true, axes: { x: 0, y: 0 }, buttons: 0 });
  };
  const onGamepadDisconnected = (event: GamepadEvent): void => {
    const index = event.gamepad.index;
    if (index >= 4 || !connectedGamepads.delete(index)) return;
    send({ kind: "gamepad", device: index, connected: false, axes: { x: 0, y: 0 }, buttons: 0 });
    updateFeatures();
  };
  const observer = new ResizeObserver(onResize);
  observer.observe(host.viewport);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  window.addEventListener("gamepadconnected", onGamepadConnected);
  window.addEventListener("gamepaddisconnected", onGamepadDisconnected);
  const media = ["(pointer: fine)", "(pointer: coarse)", "(orientation: landscape)"].map((query) => window.matchMedia(query));
  for (const item of media) item.addEventListener("change", onResize);
  onResize();
  for (const device of connectedGamepads) send({ kind: "gamepad", device, connected: true, axes: { x: 0, y: 0 }, buttons: 0 });
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onResize);
    window.removeEventListener("gamepadconnected", onGamepadConnected);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("gamepaddisconnected", onGamepadDisconnected);
    for (const item of media) item.removeEventListener("change", onResize);
    safeArea.dispose();
  };
}


