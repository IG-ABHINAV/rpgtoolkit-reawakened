export type FallbackTouchAction = "up" | "down" | "left" | "right" | "confirm" | "cancel";

export type TouchControlGeometry = {
  readonly content: { readonly width: number; readonly height: number };
  readonly game: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly safeArea: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
};

const CONTROL_SIZE = 48;
const CONTROL_GAP = 8;
const D_PAD_WIDTH = CONTROL_SIZE * 3 + CONTROL_GAP * 2;
const D_PAD_HEIGHT = CONTROL_SIZE * 2 + CONTROL_GAP;
const ACTION_WIDTH = CONTROL_SIZE * 2 + CONTROL_GAP;
const MARGIN_CLEARANCE = 8;

export function isFallbackTouchControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".fallback-touch-controls") !== null;
}

export function fallbackTouchLayout(geometry: TouchControlGeometry): { readonly docked: boolean; readonly left: number; readonly right: number; readonly bottom: number } {
  const leftSpace = geometry.game.x - geometry.safeArea.left;
  const rightSpace = geometry.content.width - geometry.game.x - geometry.game.width - geometry.safeArea.right;
  const availableHeight = geometry.content.height - geometry.safeArea.top - geometry.safeArea.bottom;
  const docked = leftSpace >= D_PAD_WIDTH + MARGIN_CLEARANCE && rightSpace >= ACTION_WIDTH + MARGIN_CLEARANCE && availableHeight >= D_PAD_HEIGHT + MARGIN_CLEARANCE;
  const overlayLeft = Math.max(geometry.game.x, geometry.safeArea.left) + MARGIN_CLEARANCE;
  const overlayRight = Math.min(geometry.game.x + geometry.game.width, geometry.content.width - geometry.safeArea.right) - ACTION_WIDTH - MARGIN_CLEARANCE;
  return {
    docked,
    left: docked ? geometry.safeArea.left + (leftSpace - D_PAD_WIDTH) / 2 : overlayLeft,
    right: docked ? geometry.content.width - geometry.safeArea.right - (rightSpace - ACTION_WIDTH) / 2 - ACTION_WIDTH : overlayRight,
    bottom: docked
      ? geometry.safeArea.bottom + MARGIN_CLEARANCE
      : geometry.content.height - Math.min(geometry.game.y + geometry.game.height, geometry.content.height - geometry.safeArea.bottom) + MARGIN_CLEARANCE,
  };
}

const TOUCH_STYLES = `
.fallback-touch-controls{position:absolute;z-index:2;display:flex;align-items:end;gap:20px;pointer-events:none;touch-action:none}
.fallback-touch-controls[hidden]{display:none}
.fallback-touch-pad,.fallback-touch-actions{display:grid;grid-template-columns:repeat(3,48px);grid-template-rows:repeat(2,48px);gap:8px;pointer-events:auto}
.fallback-touch-actions{grid-template-columns:repeat(2,48px);grid-template-rows:48px}
.fallback-touch-button{width:48px;height:48px;padding:0;border:2px solid #fff;border-radius:50%;background:rgba(12,18,28,.88);color:#fff;font:700 20px/1 sans-serif;touch-action:none;user-select:none;-webkit-user-select:none}
.fallback-touch-button:focus-visible{outline:3px solid #ffd84d;outline-offset:3px}
.fallback-touch-button[aria-pressed="true"]{background:rgba(60,115,190,.96)}
.fallback-touch-overlay .fallback-touch-button{background:rgba(12,18,28,.62)}
.fallback-touch-overlay .fallback-touch-button[aria-pressed="true"]{background:rgba(60,115,190,.85)}
`;

type TouchControlHandle = {
  readonly element: HTMLDivElement;
  readonly acknowledgeSubmittedBatch: (sequence: number) => void;
  readonly update: (enabled: boolean) => void;
  readonly close: () => void;
};

export function createFallbackTouchControls(
  stage: HTMLElement,
  geometry: () => TouchControlGeometry,
  dispatch: (action: FallbackTouchAction, down: boolean) => number,
): TouchControlHandle {
  const root = document.createElement("div");
  root.className = "fallback-touch-controls";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Touch controls");
  root.hidden = true;
  const style = document.createElement("style");
  style.textContent = TOUCH_STYLES;
  document.head.append(style);
  const previousPosition = stage.style.position;
  const changedPosition = getComputedStyle(stage).position === "static";
  if (changedPosition) stage.style.position = "relative";
  const pad = document.createElement("div");
  pad.className = "fallback-touch-pad";
  pad.setAttribute("role", "group");
  const actionGroup = document.createElement("div");
  actionGroup.className = "fallback-touch-actions";
  actionGroup.setAttribute("role", "group");
  const buttons = new Map<FallbackTouchAction, HTMLButtonElement>();
  const activePointers = new Map<number, FallbackTouchAction>();
  const activeKeys = new Map<string, FallbackTouchAction>();
  const activeClicks = new Map<FallbackTouchAction, number>();
  const actions: readonly { readonly action: FallbackTouchAction; readonly label: string; readonly glyph: string; readonly zone: "dpad" | "actions"; readonly row: number; readonly column: number }[] = [
    { action: "up", label: "Move up", glyph: "▲", zone: "dpad", row: 0, column: 1 },
    { action: "left", label: "Move left", glyph: "◀", zone: "dpad", row: 1, column: 0 },
    { action: "down", label: "Move down", glyph: "▼", zone: "dpad", row: 1, column: 1 },
    { action: "right", label: "Move right", glyph: "▶", zone: "dpad", row: 1, column: 2 },
    { action: "confirm", label: "Confirm", glyph: "A", zone: "actions", row: 0, column: 0 },
    { action: "cancel", label: "Cancel", glyph: "B", zone: "actions", row: 0, column: 1 },
  ];

  const hasActiveSource = (action: FallbackTouchAction): boolean => {
    for (const activeAction of activePointers.values()) if (activeAction === action) return true;
    for (const activeAction of activeKeys.values()) if (activeAction === action) return true;
    return activeClicks.has(action);
  };
  const press = (action: FallbackTouchAction, wasActive: boolean): void => {
    buttons.get(action)?.setAttribute("aria-pressed", "true");
    if (!wasActive) dispatch(action, true);
  };
  const release = (action: FallbackTouchAction): void => {
    if (!hasActiveSource(action)) {
      buttons.get(action)?.setAttribute("aria-pressed", "false");
      dispatch(action, false);
    }
  };
  const releasePointer = (pointerId: number): void => {
    const action = activePointers.get(pointerId);
    if (action === undefined) return;
    activePointers.delete(pointerId);
    release(action);
  };
  const releaseKey = (event: KeyboardEvent): void => {
    if (event.code !== "Enter" && event.code !== "Space") return;
    const action = activeKeys.get(event.code);
    if (action === undefined) return;
    event.preventDefault();
    activeKeys.delete(event.code);
    release(action);
  };
  const activateClick = (action: FallbackTouchAction): void => {
      if (activeClicks.has(action) || hasActiveSource(action)) return;
      const submittedAt = dispatch(action, true);
      activeClicks.set(action, submittedAt);
      buttons.get(action)?.setAttribute("aria-pressed", "true");
    };
  const releaseAll = (): void => {
    for (const pointerId of [...activePointers.keys()]) releasePointer(pointerId);
    for (const [code, action] of activeKeys) {
      activeKeys.delete(code);
      release(action);
    }
    for (const action of activeClicks.keys()) {
      activeClicks.delete(action);
      release(action);
    }
  };
  const position = (): void => {
    const measured = geometry();
    const layout = fallbackTouchLayout(measured);
    root.classList.toggle("fallback-touch-docked", layout.docked);
    root.classList.toggle("fallback-touch-overlay", !layout.docked);
    root.style.cssText = `left:0;right:0;bottom:0;top:0;width:${measured.content.width}px;height:${measured.content.height}px`;
    pad.style.cssText = `position:absolute;left:${layout.left}px;bottom:${layout.bottom}px`;
    actionGroup.style.cssText = `position:absolute;right:${measured.content.width - layout.right - ACTION_WIDTH}px;bottom:${layout.bottom}px`;
  };

  window.addEventListener("blur", releaseAll);
  window.addEventListener("keyup", releaseKey);
  for (const entry of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `fallback-touch-button fallback-touch-${entry.zone}`;
    button.setAttribute("aria-label", entry.label);
    button.setAttribute("aria-pressed", "false");
    button.textContent = entry.glyph;
    button.style.gridRow = String(entry.row + 1);
    button.style.gridColumn = String(entry.column + 1);
    button.addEventListener("pointerdown", (event) => {
      if (button.disabled || event.button !== 0) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      const wasActive = hasActiveSource(entry.action);
      activePointers.set(event.pointerId, entry.action);
      press(entry.action, wasActive);
    });
    button.addEventListener("pointermove", (event) => event.preventDefault());
    button.addEventListener("pointerup", (event) => { event.preventDefault(); releasePointer(event.pointerId); });
    button.addEventListener("pointercancel", (event) => { event.preventDefault(); releasePointer(event.pointerId); });
    button.addEventListener("lostpointercapture", (event) => releasePointer(event.pointerId));
    button.addEventListener("keydown", (event) => {
      if ((event.code !== "Enter" && event.code !== "Space") || button.disabled || event.repeat) return;
      event.preventDefault();
      if (activeKeys.has(event.code)) return;
      const wasActive = hasActiveSource(entry.action);
      activeKeys.set(event.code, entry.action);
      press(entry.action, wasActive);
    });
    button.addEventListener("keyup", releaseKey);
    button.addEventListener("click", (event) => {
      if (event.detail === 0 && !button.disabled) activateClick(entry.action);
    });
    buttons.set(entry.action, button);
    (entry.zone === "dpad" ? pad : actionGroup).append(button);
  }
  root.append(pad, actionGroup);
  stage.append(root);
  position();

  return {
    element: root,
    acknowledgeSubmittedBatch: (sequence) => {
      for (const [action, submittedAt] of activeClicks) {
        if (submittedAt > sequence) continue;
        activeClicks.delete(action);
        release(action);
      }
    },
    update: (enabled) => {
      if (!enabled) releaseAll();
      root.hidden = !enabled;
      if (enabled) position();
    },
    close: () => {
      releaseAll();
      window.removeEventListener("blur", releaseAll);
      window.removeEventListener("keyup", releaseKey);
      root.remove();
      style.remove();
      if (changedPosition) stage.style.position = previousPosition;
    },
  };
}
