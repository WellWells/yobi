import { useEffect, useMemo } from 'react';
import type React from 'react';

/** Below this, the gesture is still a click on whatever is under the pointer. */
export const DRAG_SCROLL_THRESHOLD_PX = 4;

/**
 * The gesture state behind drag-to-scroll, kept free of the DOM so the two rules that actually
 * break things can be tested: a small press has to stay a click, and the click that ends a real
 * drag must not reach the button the pointer happens to be resting on.
 */
export function createDragScroll(threshold: number = DRAG_SCROLL_THRESHOLD_PX) {
  let pointerId = -1;
  let startX = 0;
  let startLeft = 0;
  let dragged = false;
  let clickGuard = false;

  return {
    begin(id: number, clientX: number, scrollLeft: number): void {
      pointerId = id;
      startX = clientX;
      startLeft = scrollLeft;
      dragged = false;
      clickGuard = false;
    },

    /** The scrollLeft to apply, or null while the gesture is still small enough to be a click. */
    move(id: number, clientX: number): number | null {
      if (id !== pointerId) return null;
      const dx = clientX - startX;
      if (!dragged && Math.abs(dx) < threshold) return null;
      dragged = true;
      return startLeft - dx;
    },

    /** True when the gesture was a real drag — which is also when the trailing click is armed. */
    end(id: number): boolean {
      if (id !== pointerId) return false;
      pointerId = -1;
      clickGuard = dragged;
      dragged = false;
      return clickGuard;
    },

    /** One-shot, so a later keyboard-driven click is never swallowed by a stale guard. */
    swallowClick(): boolean {
      if (!clickGuard) return false;
      clickGuard = false;
      return true;
    },

    clearClickGuard(): void {
      clickGuard = false;
    },
  };
}

/** Chromium's line height for `deltaMode === 1` wheels. */
const WHEEL_LINE_PX = 40;

/**
 * How far a vertical wheel moves a sideways rail, or null when the rail should not claim it:
 * nothing to scroll, or the gesture is already horizontal (a trackpad swipe scrolls natively).
 *
 * Deliberately independent of where the rail sits: a claimed wheel stays claimed at either end,
 * so reaching the last tile does not suddenly scroll the page under the pointer instead. The
 * page scrolls again once the pointer leaves the rail.
 */
export function sidewaysWheelDelta(
  rail: { scrollWidth: number; clientWidth: number },
  deltaX: number,
  deltaY: number,
  deltaMode: number,
): number | null {
  if (rail.scrollWidth <= rail.clientWidth) return null;
  if (Math.abs(deltaY) <= Math.abs(deltaX)) return null;
  return deltaY * (deltaMode === 1 ? WHEEL_LINE_PX : 1);
}

/**
 * A rail that hides its scrollbar has to move with a plain wheel too: a Windows mouse has no
 * horizontal axis. Native and non-passive: React's `onWheel` is passive, so it could not stop
 * the wheel from also reaching the page, which showed as the page taking over at the rail's end.
 */
export function useWheelScrollsSideways(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const rail = ref.current;
    if (!rail) return undefined;
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey) return; // Ctrl+wheel is zoom.
      const delta = sidewaysWheelDelta(rail, e.deltaX, e.deltaY, e.deltaMode);
      if (delta === null) return;
      e.preventDefault();
      rail.scrollLeft += delta;
    };
    rail.addEventListener('wheel', onWheel, { passive: false });
    return () => rail.removeEventListener('wheel', onWheel);
  }, [ref]);
}

export interface DragScrollHandlers {
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp: React.PointerEventHandler<HTMLDivElement>;
  onPointerCancel: React.PointerEventHandler<HTMLDivElement>;
  onClickCapture: React.MouseEventHandler<HTMLDivElement>;
}

/**
 * Grab-and-drag scrolling for a horizontally scrolling container, for the mouse users who have
 * neither a horizontal wheel axis nor a visible scrollbar to aim at.
 *
 * Mouse only on purpose: `overflow-x` already gives touch and pen native panning, and running
 * both at once moves the container twice per swipe.
 */
export function useDragScroll(): DragScrollHandlers {
  const drag = useMemo(() => createDragScroll(), []);

  return useMemo(() => ({
    onPointerDown: (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      const rail = e.currentTarget;
      if (rail.scrollWidth <= rail.clientWidth) return;
      drag.begin(e.pointerId, e.clientX, rail.scrollLeft);
    },

    onPointerMove: (e) => {
      const next = drag.move(e.pointerId, e.clientX);
      if (next === null) return;
      const rail = e.currentTarget;
      // Captured only once the gesture is a drag, so a plain click on a tile is left alone.
      // Without it, dragging past the container edge drops the rest of the gesture.
      if (!rail.hasPointerCapture(e.pointerId)) rail.setPointerCapture(e.pointerId);
      rail.scrollLeft = next;
    },

    onPointerUp: (e) => {
      const rail = e.currentTarget;
      if (rail.hasPointerCapture(e.pointerId)) rail.releasePointerCapture(e.pointerId);
      if (!drag.end(e.pointerId)) return;
      // A click follows pointerup within the same frame, so a guard still set on the next frame
      // belongs to a gesture that never produced one.
      requestAnimationFrame(() => drag.clearClickGuard());
    },

    onPointerCancel: (e) => {
      drag.end(e.pointerId);
      drag.clearClickGuard();
    },

    onClickCapture: (e) => {
      if (!drag.swallowClick()) return;
      e.preventDefault();
      e.stopPropagation();
    },
  }), [drag]);
}
