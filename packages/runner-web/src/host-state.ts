import type { HostDisplayGeometry, NormalizedHostFeatures } from "@tk-reawakened/core";
import type { InputRecord } from "@tk-reawakened/core";
import { fitCanvas } from "./viewport.ts";

export type HostViewport = { readonly canvas: HTMLCanvasElement; readonly viewport: HTMLElement };
export type HostStateSnapshot = { readonly features: NormalizedHostFeatures; readonly geometry: HostDisplayGeometry };

/** Read only host capabilities that can be reported without inferring an operating-system identity. */
export function readHostFeatures(): NormalizedHostFeatures {
  const nav = navigator as Navigator & { readonly maxTouchPoints?: number; readonly vibrate?: (pattern: number | readonly number[]) => boolean };
  const pointerFine = window.matchMedia("(pointer: fine)").matches;
  const pointerCoarse = window.matchMedia("(pointer: coarse)").matches;
  const orientation = screen.orientation?.type ?? (window.matchMedia("(orientation: landscape)").matches ? "landscape-primary" : "portrait-primary");
  const connectedGamepad = Array.from(navigator.getGamepads?.() ?? []).some((pad) => pad !== null && pad.connected);
  return {
    touch: (nav.maxTouchPoints ?? 0) > 0 || pointerCoarse,
    pointer: pointerFine ? "fine" : pointerCoarse ? "coarse" : "none",
    keyboard: true,
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

/** Fit the game and measure all geometry in the same viewport-relative CSS-pixel coordinate space. */
export function measureHostDisplay(
  { canvas, viewport }: HostViewport,
  view: { readonly width: number; readonly height: number },
  safeArea: HostDisplayGeometry["safeArea"],
): HostDisplayGeometry {
  const content = viewport.getBoundingClientRect();
  fitCanvas(canvas, view.width, view.height, { width: content.width, height: content.height });
  const frame = canvas.getBoundingClientRect();
  return {
    content: { width: content.width, height: content.height },
    game: { x: frame.left - content.left, y: frame.top - content.top, width: frame.width, height: frame.height },
    safeArea,
  };
}

/** Maintain the deterministic geometry and feature records as explicit AD-14 host inputs. */
export function observeHostState(
  host: HostViewport,
  view: { readonly width: number; readonly height: number },
  tick: () => number,
  enqueue: (input: InputRecord) => void,
  initial?: HostStateSnapshot,
): () => void {
  const safeArea = createSafeAreaProbe();
  let previousGeometry = initial?.geometry ?? measureHostDisplay(host, view, safeArea.read());
  let previousFeatures = initial?.features ?? readHostFeatures();
  const send = (event: InputRecord["event"]): void => enqueue({ tick: tick(), event });
  const updateDisplay = (): void => {
    const next = measureHostDisplay(host, view, safeArea.read());
    if (JSON.stringify(next) === JSON.stringify(previousGeometry)) return;
    previousGeometry = next;
    send({ kind: "host.display", geometry: next });
  };
  const updateFeatures = (): void => {
    const next = readHostFeatures();
    if (JSON.stringify(next) === JSON.stringify(previousFeatures)) return;
    previousFeatures = next;
    send({ kind: "host.features", features: next });
  };
  const onResize = (): void => { updateDisplay(); updateFeatures(); };
  const onGamepadConnected = (event: GamepadEvent): void => {
    const pad = event.gamepad;
    if (pad.index >= 4) return;
    updateFeatures();
    send({ kind: "gamepad", device: pad.index, connected: true, axes: { x: 0, y: 0 }, buttons: 0 });
  };
  const onGamepadDisconnected = (event: GamepadEvent): void => {
    if (event.gamepad.index >= 4) return;
    send({ kind: "gamepad", device: event.gamepad.index, connected: false, axes: { x: 0, y: 0 }, buttons: 0 });
    updateFeatures();
  };
  const observer = new ResizeObserver(onResize);
  observer.observe(host.viewport);
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  window.addEventListener("gamepadconnected", onGamepadConnected);
  window.addEventListener("gamepaddisconnected", onGamepadDisconnected);
  const media = ["(pointer: fine)", "(pointer: coarse)", "(orientation: landscape)"].map((query) => window.matchMedia(query));
  for (const item of media) item.addEventListener("change", onResize);
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onResize);
    window.removeEventListener("gamepadconnected", onGamepadConnected);
    window.removeEventListener("gamepaddisconnected", onGamepadDisconnected);
    for (const item of media) item.removeEventListener("change", onResize);
    safeArea.dispose();
  };
}

