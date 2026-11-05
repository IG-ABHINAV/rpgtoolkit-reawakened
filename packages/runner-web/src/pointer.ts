/**
 * Pointer-event to logical-frame mapping for the shared live player pages.
 *
 * The engine consumes pointer events in logical integer pixels relative to the
 * top-left of the game's view (E-111). The canvas is scaled and letterboxed by
 * CSS, so screen coordinates must be converted through the canvas's own box,
 * not through window or device coordinates.
 */

export type LogicalPointer = { readonly x: number; readonly y: number };

/**
 * Convert a DOM pointer event into logical frame coordinates.
 *
 * - Uses `canvas.getBoundingClientRect()` so letterboxing offsets are included.
 * - Divides by the current CSS-to-logical scale derived from the canvas drawing
 *   buffer size vs. its laid-out CSS size.
 * - Clamps to the logical frame so a click on the black surround does not
 *   report a coordinate outside the game.
 */
export function pointerEventToLogical(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  viewSize: { readonly width: number; readonly height: number },
): LogicalPointer {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = Math.max(0, Math.min(viewSize.width - 1, (event.clientX - rect.left) * scaleX));
  const y = Math.max(0, Math.min(viewSize.height - 1, (event.clientY - rect.top) * scaleY));
  return { x: Math.floor(x), y: Math.floor(y) };
}
/**
 * Attach the host-side pointer lifecycle shared by the web, desktop, and mobile live players.
 * A primary press canceled by leaving the canvas is not reintroduced by pointer movement
 * during re-entry; only a physical release or browser cancellation clears that suppression.
 */
export function attachPointerInput(
  canvas: HTMLCanvasElement,
  viewSize: { readonly width: number; readonly height: number },
  onPointer: (pointer: LogicalPointer, buttons: number) => void,
  onCancel: () => void,
): () => void {
  let primaryPointerId: number | null = null;
  let suppressedPointerId: number | null = null;
  let routedButtons = 0;
  let lastPointer: LogicalPointer = { x: 0, y: 0 };

  const cancelPrimary = (pointerId: number): void => {
    if (pointerId !== primaryPointerId || suppressedPointerId === pointerId || (routedButtons & 1) === 0) return;
    onCancel();
    suppressedPointerId = pointerId;
    routedButtons &= ~1;
  };
  const route = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom;
    const primaryNow = (event.buttons & 1) !== 0;
    const newPrimaryDown = event.type === "pointerdown" && event.button === 0 && primaryNow;
    const chordedPrimaryMove = event.type === "pointermove" && (event.pointerType === "mouse" || event.pointerType === "pen") && primaryNow && (routedButtons & 1) === 0;
    if (primaryPointerId === null && !outside && (newPrimaryDown || chordedPrimaryMove)) {
      primaryPointerId = event.pointerId;
      suppressedPointerId = null;
    } else if (event.pointerId === primaryPointerId && newPrimaryDown) {
      suppressedPointerId = null;
    }
    const ownsPrimary = event.pointerId === primaryPointerId;
    const eventButtons = ownsPrimary
      ? event.buttons
      : (event.buttons & ~1) | (routedButtons & 1);

    if (outside) {
      if (ownsPrimary && (primaryNow || (routedButtons & 1) !== 0)) cancelPrimary(event.pointerId);
      const releasableButtons = (eventButtons & routedButtons & ~1) | (ownsPrimary ? 0 : routedButtons & 1);
      if (releasableButtons !== routedButtons) {
        onPointer(lastPointer, releasableButtons);
        routedButtons = releasableButtons;
      }
      if (ownsPrimary && !primaryNow) {
        primaryPointerId = null;
        suppressedPointerId = null;
      }
      return;
    }

    if (ownsPrimary && event.pointerId === suppressedPointerId && !primaryNow) suppressedPointerId = null;
    const buttons = event.pointerId === suppressedPointerId ? eventButtons & ~1 : eventButtons;
    lastPointer = pointerEventToLogical(event, canvas, viewSize);
    onPointer(lastPointer, buttons);
    routedButtons = buttons;
    if (ownsPrimary && event.type === "pointerup" && !primaryNow) {
      primaryPointerId = null;
      suppressedPointerId = null;
    }
  };
  const onPointerLeave = (event: PointerEvent): void => cancelPrimary(event.pointerId);
  const onPointerUpOutside = (event: PointerEvent): void => {
    if (event.pointerId !== primaryPointerId || event.target === canvas) return;
    if ((event.buttons & 1) === 0) {
      cancelPrimary(event.pointerId);
      primaryPointerId = null;
      suppressedPointerId = null;
    }
  };
  const onPointerCancel = (event: PointerEvent): void => {
    if (event.currentTarget === window && event.target === canvas) return;
    if (primaryPointerId !== null && event.pointerId !== primaryPointerId) return;
    if (primaryPointerId === event.pointerId) cancelPrimary(event.pointerId);
    else onCancel();
    primaryPointerId = null;
    suppressedPointerId = null;
    routedButtons &= ~1;
  };

  canvas.addEventListener("pointerdown", route);
  canvas.addEventListener("pointermove", route);
  canvas.addEventListener("pointerup", route);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("pointerup", onPointerUpOutside);
  window.addEventListener("pointercancel", onPointerCancel);
  return (): void => {
    canvas.removeEventListener("pointerdown", route);
    canvas.removeEventListener("pointermove", route);
    canvas.removeEventListener("pointerup", route);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("pointerup", onPointerUpOutside);
    window.removeEventListener("pointercancel", onPointerCancel);
  };
}
