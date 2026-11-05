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

/** Physical-pixel placement for the fallback controls; margin docking is all-or-nothing. */
export function fallbackTouchLayout(geometry: TouchControlGeometry): { readonly docked: boolean; readonly left: number; readonly right: number } {
  const leftSpace = geometry.game.x - geometry.safeArea.left;
  const rightSpace = geometry.content.width - geometry.game.x - geometry.game.width - geometry.safeArea.right;
  const availableHeight = geometry.content.height - geometry.safeArea.top - geometry.safeArea.bottom;
  const docked = leftSpace >= D_PAD_WIDTH + MARGIN_CLEARANCE &&
    rightSpace >= ACTION_WIDTH + MARGIN_CLEARANCE &&
    availableHeight >= D_PAD_HEIGHT + MARGIN_CLEARANCE;
  const left = docked
    ? geometry.safeArea.left + (leftSpace - D_PAD_WIDTH) / 2
    : geometry.game.x + MARGIN_CLEARANCE;
  const right = docked
    ? geometry.content.width - geometry.safeArea.right - (rightSpace - ACTION_WIDTH) / 2 - ACTION_WIDTH
    : geometry.game.x + geometry.game.width - ACTION_WIDTH - MARGIN_CLEARANCE;
  return { docked, left, right };
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
/** Creates accessible runner chrome without changing the game's logical viewport. */
export function createFallbackTouchControls(
  stage: HTMLElement,
  geometry: () => TouchControlGeometry,
  dispatch: (action: FallbackTouchAction, down: boolean) => void,
): { readonly element: HTMLDivElement; readonly update: (enabled: boolean) => void; readonly close: () => void } {
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
  const actions: readonly { readonly action: FallbackTouchAction; readonly label: string; readonly glyph: string; readonly zone: "dpad" | "actions"; readonly row: number; readonly column: number }[] = [
    { action: "up", label: "Move up", glyph: "▲", zone: "dpad", row: 0, column: 1 },
    { action: "left", label: "Move left", glyph: "◀", zone: "dpad", row: 1, column: 0 },
    { action: "down", label: "Move down", glyph: "▼", zone: "dpad", row: 1, column: 1 },
    { action: "right", label: "Move right", glyph: "▶", zone: "dpad", row: 1, column: 2 },
    { action: "confirm", label: "Confirm", glyph: "A", zone: "actions", row: 0, column: 0 },
    { action: "cancel", label: "Cancel", glyph: "B", zone: "actions", row: 0, column: 1 },
  ];

  const release = (pointerId: number): void => {
    const action = activePointers.get(pointerId);
    if (action === undefined) return;
    activePointers.delete(pointerId);
    buttons.get(action)?.setAttribute("aria-pressed", "false");
    dispatch(action, false);
  };
  const releaseAll = (): void => {
    for (const pointerId of [...activePointers.keys()]) release(pointerId);
  };
  window.addEventListener("blur", releaseAll);
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
      event.stopPropagation();
      if (!button.disabled && event.button === 0) {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        activePointers.set(event.pointerId, entry.action);
        button.setAttribute("aria-pressed", "true");
        dispatch(entry.action, true);
      }
    });
    button.addEventListener("pointermove", (event) => event.stopPropagation());
    button.addEventListener("pointerup", (event) => {
      event.stopPropagation();
      release(event.pointerId);
    });
    button.addEventListener("pointercancel", (event) => {
      event.stopPropagation();
      release(event.pointerId);
    });
    button.addEventListener("lostpointercapture", (event) => release(event.pointerId));
    button.addEventListener("click", (event) => {
      // Native keyboard activation has detail 0; pointer activation already emitted its press/release edges.
      if (event.detail === 0 && !button.disabled) {
        dispatch(entry.action, true);
        dispatch(entry.action, false);
      }
    });
    buttons.set(entry.action, button);
    (entry.zone === "dpad" ? pad : actionGroup).append(button);
  }
  root.append(pad, actionGroup);

  const position = (): void => {
    const measured = geometry();
    const layout = fallbackTouchLayout(measured);
    root.classList.toggle("fallback-touch-docked", layout.docked);
    root.classList.toggle("fallback-touch-overlay", !layout.docked);
    root.style.left = "0px";
    root.style.right = "0px";
    root.style.bottom = "0px";
    root.style.top = "0px";
    root.style.width = `${measured.content.width}px`;
    root.style.height = `${measured.content.height}px`;
    pad.style.position = "absolute";
    actionGroup.style.position = "absolute";
    pad.style.left = `${layout.left}px`;
    actionGroup.style.right = `${measured.content.width - layout.right - ACTION_WIDTH}px`;
    const bottom = measured.safeArea.bottom + MARGIN_CLEARANCE;
    pad.style.bottom = `${bottom}px`;
    actionGroup.style.bottom = `${bottom}px`;
  };
  stage.append(root);
  position();

  return {
    element: root,
    update: (enabled) => {
      if (!enabled) releaseAll();
      root.hidden = !enabled;
      if (enabled) position();
    },
    close: () => {
      releaseAll();
      window.removeEventListener("blur", releaseAll);
      style.remove();
      if (changedPosition) stage.style.position = previousPosition;
    },
  };
}
