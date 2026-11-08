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
  preemptionAtFallback: (pointer: LogicalPointer) => number | "author" | null,
  onModalFallbackAction: (action: "confirm" | "cancel", down: boolean, modalId: number) => void,
  timelineEpoch: () => number,
): () => void {
  let primaryPointerId: number | null = null;
  let suppressedPointerId: number | null = null;
  let routedButtons = 0;
  let lastPointer: LogicalPointer = { x: 0, y: 0 };
  const runnerOwnedPointers = new Set<number>();
  const corePreemptedFallbackPointers = new Set<number>();
  const modalFallbackPointers = new Map<number, { readonly action: "confirm" | "cancel"; readonly button: HTMLButtonElement; readonly modalId: number; cancelled: boolean }>();
  const handledCancels = new WeakSet<Event>();
  let observedTimelineEpoch = timelineEpoch();

  const cancelModalFallback = (pointerId: number): void => {
    const fallback = modalFallbackPointers.get(pointerId);
    if (fallback !== undefined) fallback.cancelled = true;
  };
  const cancelPrimary = (pointerId: number): void => {
    cancelModalFallback(pointerId);
    if (pointerId !== primaryPointerId || suppressedPointerId === pointerId || (routedButtons & 1) === 0) return;
    onCancel();
    suppressedPointerId = pointerId;
    routedButtons &= ~1;
  };
  const route = (event: PointerEvent): void => {
    const currentEpoch = timelineEpoch();
    const timelineChanged = currentEpoch !== observedTimelineEpoch;
    if (timelineChanged) {
      observedTimelineEpoch = currentEpoch;
      modalFallbackPointers.clear();
      if (primaryPointerId !== null) suppressedPointerId = primaryPointerId;
      routedButtons &= ~1;
    }
    const newPrimaryDown = event.type === "pointerdown" && event.button === 0 && (event.buttons & 1) !== 0;
    if (newPrimaryDown) {
      // A genuine new down ends any missed outside-window release before target classification.
      cancelPrimary(event.pointerId);
      if (timelineChanged || suppressedPointerId === event.pointerId) onPointer(lastPointer, event.buttons & ~1);
      if (primaryPointerId === event.pointerId) primaryPointerId = null;
      if (suppressedPointerId === event.pointerId) suppressedPointerId = null;
      runnerOwnedPointers.delete(event.pointerId);
      corePreemptedFallbackPointers.delete(event.pointerId);
      modalFallbackPointers.delete(event.pointerId);
    }
    const fallbackTarget = isFallbackTouchControlTarget(event.target);
    if (runnerOwnedPointers.has(event.pointerId)) {
      if (event.type === "pointerup") runnerOwnedPointers.delete(event.pointerId);
      return;
    }
    const corePreempted = corePreemptedFallbackPointers.has(event.pointerId);
    if (fallbackTarget && !corePreempted) {
      if (event.type === "pointerdown") {
        if (event.button !== 0 || (event.buttons & 1) === 0) return;
        const point = pointerEventToLogical(event, host, viewSize, geometry());
        const preemption = preemptionAtFallback(point);
        if (preemption === null) {
          runnerOwnedPointers.add(event.pointerId);
          return;
        }
        corePreemptedFallbackPointers.add(event.pointerId);
        if (typeof preemption === "number" && event.target instanceof Element) {
          const button = event.target.closest<HTMLButtonElement>(".fallback-touch-button");
          const action = button?.dataset.action;
          if (button !== null && (action === "confirm" || action === "cancel")) {
            modalFallbackPointers.set(event.pointerId, { action, button, modalId: preemption, cancelled: false });
          }
        }
      } else if (event.pointerId !== primaryPointerId) {
        return;
      }
    }
    const modalFallback = modalFallbackPointers.get(event.pointerId);
    if (modalFallback !== undefined && event.type === "pointermove" &&
        document.elementFromPoint(event.clientX, event.clientY)?.closest(".fallback-touch-button") !== modalFallback.button) {
      modalFallback.cancelled = true;
    }
    if (corePreemptedFallbackPointers.has(event.pointerId)) {
      event.preventDefault();
      event.stopPropagation();
    }
    const rect = host.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom;
    const primaryNow = (event.buttons & 1) !== 0;
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
      if (event.type === "pointerup") {
        corePreemptedFallbackPointers.delete(event.pointerId);
        modalFallbackPointers.delete(event.pointerId);
      }
      return;
    }
    if (primaryPointerId !== null && event.pointerId !== primaryPointerId) return;

    if (ownsPrimary && event.pointerId === suppressedPointerId && !primaryNow) suppressedPointerId = null;
    const buttons = event.pointerId === suppressedPointerId ? eventButtons & ~1 : eventButtons;
    lastPointer = pointerEventToLogical(event, host, viewSize, geometry());
    onPointer(lastPointer, buttons);
    routedButtons = buttons;
    if (event.type === "pointerup") {
      if (modalFallback !== undefined) {
        modalFallbackPointers.delete(event.pointerId);
        if (!modalFallback.cancelled &&
            document.elementFromPoint(event.clientX, event.clientY)?.closest(".fallback-touch-button") === modalFallback.button) {
          onModalFallbackAction(modalFallback.action, true, modalFallback.modalId);
          onModalFallbackAction(modalFallback.action, false, modalFallback.modalId);
        }
      }
      corePreemptedFallbackPointers.delete(event.pointerId);
    }
    if (ownsPrimary && event.type === "pointerup" && !primaryNow) {
      primaryPointerId = null;
      suppressedPointerId = null;
    }
  };
  const onPointerLeave = (event: PointerEvent): void => cancelPrimary(event.pointerId);
  const onPointerUpOutside = (event: PointerEvent): void => {
    if (runnerOwnedPointers.delete(event.pointerId)) return;
    modalFallbackPointers.delete(event.pointerId);
    if (event.pointerId !== primaryPointerId || event.target === host) {
      corePreemptedFallbackPointers.delete(event.pointerId);
      return;
    }
    if ((event.buttons & 1) === 0) {
      cancelPrimary(event.pointerId);
      onPointer(lastPointer, routedButtons & ~1);
      routedButtons &= ~1;
      primaryPointerId = null;
      suppressedPointerId = null;
      corePreemptedFallbackPointers.delete(event.pointerId);
    }
  };
  const onPointerCancel = (event: PointerEvent): void => {
    if (event.currentTarget === window && handledCancels.has(event)) return;
    if (event.currentTarget === host) handledCancels.add(event);
    if (runnerOwnedPointers.delete(event.pointerId)) return;
    modalFallbackPointers.delete(event.pointerId);
    const corePreempted = corePreemptedFallbackPointers.delete(event.pointerId);
    if (corePreempted) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (event.currentTarget === window && event.target === host) return;
    if (primaryPointerId !== null && event.pointerId !== primaryPointerId) return;
    if (primaryPointerId === event.pointerId) cancelPrimary(event.pointerId);
    else onCancel();
    primaryPointerId = null;
    suppressedPointerId = null;
    routedButtons &= ~1;
  };
  const onLostPointerCapture = (event: PointerEvent): void => {
    if (runnerOwnedPointers.has(event.pointerId)) return;
    modalFallbackPointers.delete(event.pointerId);
    if (!corePreemptedFallbackPointers.has(event.pointerId)) return;
    cancelPrimary(event.pointerId);
  };
  const onWindowBlur = (): void => {
    // Keep runner-owned pointers reserved until physical release; otherwise a held fallback press can turn into gameplay.
    corePreemptedFallbackPointers.clear();
    modalFallbackPointers.clear();
    if (primaryPointerId !== null && ((routedButtons & 1) !== 0 || suppressedPointerId === primaryPointerId)) {
      if ((routedButtons & 1) !== 0) onCancel();
      suppressedPointerId = primaryPointerId;
    } else {
      primaryPointerId = null;
      suppressedPointerId = null;
    }
    routedButtons = 0;
  };

  host.addEventListener("pointerdown", route, true);
  host.addEventListener("pointermove", route, true);
  host.addEventListener("pointerup", route, true);
  host.addEventListener("pointerleave", onPointerLeave);
  host.addEventListener("pointercancel", onPointerCancel, true);
  host.addEventListener("lostpointercapture", onLostPointerCapture, true);
  window.addEventListener("pointerup", onPointerUpOutside);
  window.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("blur", onWindowBlur);
  return (): void => {
    host.removeEventListener("pointerdown", route, true);
    host.removeEventListener("pointermove", route, true);
    host.removeEventListener("pointerup", route, true);
    host.removeEventListener("pointerleave", onPointerLeave);
    host.removeEventListener("pointercancel", onPointerCancel, true);
    host.removeEventListener("lostpointercapture", onLostPointerCapture, true);
    window.removeEventListener("pointerup", onPointerUpOutside);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("blur", onWindowBlur);
  };
}

