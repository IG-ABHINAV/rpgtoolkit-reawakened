/**
 * Pointer-event to logical-frame mapping for the shared live player pages.
 * Coordinates are relative to Plane 2 and deliberately remain unclamped so
 * Plane 3 author controls receive negative and beyond-viewport logical pixels.
 */

import type { HostDisplayGeometry } from "@tk-reawakened/core";
import { isFallbackTouchControlTarget } from "./touch-controls.ts";

export type LogicalPointer = { readonly x: number; readonly y: number };

/** Convert a content-relative host pointer to unclamped logical coordinates. */
export function pointerEventToLogical(
  event: PointerEvent,
  host: HTMLElement,
  viewSize: { readonly width: number; readonly height: number },
  geometry: HostDisplayGeometry,
): LogicalPointer {
  const rect = host.getBoundingClientRect();
  const scaleX = geometry.game.width / viewSize.width;
  const scaleY = geometry.game.height / viewSize.height;
  return {
    x: Math.floor((event.clientX - rect.left - geometry.game.x) / scaleX),
    y: Math.floor((event.clientY - rect.top - geometry.game.y) / scaleY),
  };
}
/**
 * Attach the host-side pointer lifecycle shared by the web, desktop, and mobile live players.
 * Plane 3 points remain ordinary pointer records; leaving Plane 2 cancels a held primary press.
 */
export function attachPointerInput(
  host: HTMLElement,
  viewSize: { readonly width: number; readonly height: number },
  geometry: () => HostDisplayGeometry,
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
    if (isFallbackTouchControlTarget(event.target)) return;
    const rect = host.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom;
    const primaryNow = (event.buttons & 1) !== 0;
    const newPrimaryDown = event.type === "pointerdown" && event.button === 0 && primaryNow;
    const chordedPrimaryMove = event.type === "pointermove" &&
      (event.pointerType === "mouse" || event.pointerType === "pen") &&
      primaryNow &&
      (routedButtons & 1) === 0;
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
    if (primaryPointerId !== null && event.pointerId !== primaryPointerId) return;

    if (ownsPrimary && event.pointerId === suppressedPointerId && !primaryNow) suppressedPointerId = null;
    const buttons = event.pointerId === suppressedPointerId ? eventButtons & ~1 : eventButtons;
    lastPointer = pointerEventToLogical(event, host, viewSize, geometry());
    onPointer(lastPointer, buttons);
    routedButtons = buttons;
    if (ownsPrimary && event.type === "pointerup" && !primaryNow) {
      primaryPointerId = null;
      suppressedPointerId = null;
    }
  };
  const onPointerLeave = (event: PointerEvent): void => cancelPrimary(event.pointerId);
  const onPointerUpOutside = (event: PointerEvent): void => {
    if (event.pointerId !== primaryPointerId || event.target === host) return;
    if ((event.buttons & 1) === 0) {
      cancelPrimary(event.pointerId);
      primaryPointerId = null;
      suppressedPointerId = null;
    }
  };
  const onPointerCancel = (event: PointerEvent): void => {
    if (event.currentTarget === window && event.target === host) return;
    if (primaryPointerId !== null && event.pointerId !== primaryPointerId) return;
    if (primaryPointerId === event.pointerId) cancelPrimary(event.pointerId);
    else onCancel();
    primaryPointerId = null;
    suppressedPointerId = null;
    routedButtons &= ~1;
  };
  const onWindowBlur = (): void => {
    if (primaryPointerId === null || (routedButtons & 1) === 0) return;
    onCancel();
    suppressedPointerId = primaryPointerId;
    routedButtons &= ~1;
  };

  host.addEventListener("pointerdown", route);
  host.addEventListener("pointermove", route);
  host.addEventListener("pointerup", route);
  host.addEventListener("pointerleave", onPointerLeave);
  host.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("pointerup", onPointerUpOutside);
  window.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("blur", onWindowBlur);
  return (): void => {
    host.removeEventListener("pointerdown", route);
    host.removeEventListener("pointermove", route);
    host.removeEventListener("pointerup", route);
    host.removeEventListener("pointerleave", onPointerLeave);
    host.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("pointerup", onPointerUpOutside);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("blur", onWindowBlur);
  };
}

