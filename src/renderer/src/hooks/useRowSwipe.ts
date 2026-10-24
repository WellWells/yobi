import { useCallback, useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { ComponentType, RefObject } from 'react';
import { windowApi } from '../api/electronApi';
import {
  CLOSED_VIEW, SWIPE, initialSwipeMachine, rowView, swipeBegin, swipeClose, swipeEnd, swipeForget,
  swipeTick, swipeWheel, wheelDeltaPx,
} from '../utils/rowSwipe';
import type { RowSwipeView, SwipeCommit, SwipeLayout, SwipeMachine, SwipeStep } from '../utils/rowSwipe';

/** One action behind a row. Keyboard and screen-reader users reach the same actions through the row's context menu. */
export interface SwipeAction {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
  tone: 'destructive' | 'accent' | 'neutral';
  onTrigger: () => void;
  /** Swiping all the way across runs it (Mail's trash). At most one per side. */
  fullSwipe?: boolean;
}

interface RowEntry {
  el: HTMLElement | null;
  leading: readonly SwipeAction[];
  trailing: readonly SwipeAction[];
}

// One machine for the whole window: one gesture at a time, one row open at a time.
let machine: SwipeMachine = initialSwipeMachine();
const listeners = new Set<() => void>();
const rows = new Map<string, RowEntry>();
const viewCache = new Map<string, RowSwipeView>();
let timer: ReturnType<typeof setTimeout> | null = null;
let nativeDrag = false;
let globalsAttached = false;

function now(): number {
  return performance.now();
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const wait = machine.phase === 'tracking' ? SWIPE.IDLE_END_MS : machine.phase === 'tail' ? SWIPE.TAIL_QUIET_MS : null;
  if (wait === null) return;
  const due = Math.max(0, machine.lastAt + wait - now()) + 1;
  timer = setTimeout(() => {
    timer = null;
    apply(swipeTick(machine, now()));
  }, due);
}

function setMachine(next: SwipeMachine): void {
  if (next !== machine) {
    machine = next;
    for (const listener of listeners) listener();
  }
  schedule();
}

function runCommit(commit: SwipeCommit): void {
  const entry = rows.get(commit.row);
  const actions = commit.side === 'leading' ? entry?.leading : entry?.trailing;
  actions?.find((action) => action.fullSwipe)?.onTrigger();
  // The row stays flown out for one snap, then comes back (the action may have kept it, e.g. a confirm).
  setTimeout(() => {
    if (machine.row === commit.row) setMachine(swipeClose(machine));
  }, SWIPE.SNAP_MS);
}

function apply(result: SwipeStep): void {
  setMachine(result.machine);
  if (result.commit) runCommit(result.commit);
}

function closeOpenRow(): void {
  setMachine(swipeClose(machine));
}

function isOpenAndResting(): boolean {
  return machine.row !== null && !(machine.phase === 'tracking' && machine.axis === 'x');
}

/** Window-level wiring, attached once: main's gesture signal and the ways an open row closes. */
function attachGlobals(): void {
  if (globalsAttached) return;
  globalsAttached = true;
  windowApi.onTrackpadGesture((event) => {
    if (event.phase === 'end') apply(swipeEnd(machine, now()));
    else setMachine(swipeBegin(machine));
  });
  document.addEventListener('pointerdown', (e) => {
    if (!isOpenAndResting() || machine.row === null) return;
    const el = rows.get(machine.row)?.el;
    if (el && e.target instanceof Node && el.contains(e.target)) return;
    closeOpenRow();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpenAndResting()) closeOpenRow();
  }, true);
  // Scrolls this machine caused are cancelled; any other scroll (keyboard, scrollbar) closes.
  document.addEventListener('scroll', () => {
    if (machine.phase === 'idle' && machine.row !== null) closeOpenRow();
  }, true);
  document.addEventListener('dragstart', () => { nativeDrag = true; }, true);
  document.addEventListener('dragend', () => { nativeDrag = false; }, true);
  document.addEventListener('drop', () => { nativeDrag = false; }, true);
}

function measure(entry: RowEntry, el: HTMLElement): SwipeLayout {
  return {
    width: el.clientWidth,
    leading: entry.leading.length * SWIPE.ACTION_WIDTH_PX,
    trailing: entry.trailing.length * SWIPE.ACTION_WIDTH_PX,
    leadingFull: entry.leading.some((action) => action.fullSwipe),
    trailingFull: entry.trailing.some((action) => action.fullSwipe),
  };
}

/** Wheel events a swipe ignores: pinch-zoom (ctrl), a held button (dnd-kit drag, text selection), a native drag. */
export function wheelIgnored(e: Pick<WheelEvent, 'ctrlKey' | 'buttons'>, dragging: boolean): boolean {
  return e.ctrlKey || e.buttons !== 0 || dragging;
}

function onRowWheel(id: string, e: WheelEvent): void {
  if (wheelIgnored(e, nativeDrag)) return;
  const entry = rows.get(id);
  if (!entry?.el) return;
  const { dx, dy } = wheelDeltaPx(e.deltaX, e.deltaY, e.deltaMode);
  const result = swipeWheel(machine, { row: id, layout: measure(entry, entry.el), dx, dy, t: now() });
  if (result.preventDefault && e.cancelable) e.preventDefault();
  apply(result);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function cachedView(id: string): RowSwipeView {
  const next = rowView(machine, id);
  const cached = viewCache.get(id);
  if (cached && cached.offset === next.offset && cached.tracking === next.tracking && cached.armed === next.armed) {
    return cached;
  }
  viewCache.set(id, next);
  return next;
}

export interface RowSwipe {
  rootRef: RefObject<HTMLDivElement | null>;
  view: RowSwipeView;
  /** Close this row if it is open. */
  close: () => void;
  /** Run an action from its button: the row closes first. */
  trigger: (action: SwipeAction) => void;
}

/**
 * Swipe wiring for one row. Mount it only where a swipe is wanted (macOS, enabled): unmounting
 * forgets the row, so a row that becomes disabled while open closes.
 */
export function useRowSwipe(leading: readonly SwipeAction[], trailing: readonly SwipeAction[]): RowSwipe {
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Latest actions every render, so a commit runs the handler the row has now.
  useLayoutEffect(() => {
    const entry = rows.get(id);
    if (entry) {
      entry.leading = leading;
      entry.trailing = trailing;
    }
  });

  useEffect(() => {
    attachGlobals();
    const el = rootRef.current;
    const entry: RowEntry = { el, leading, trailing };
    rows.set(id, entry);
    if (!el) return () => { rows.delete(id); };
    // Native and non-passive: React's onWheel is passive and could not keep the list from scrolling.
    const handler = (e: WheelEvent): void => onRowWheel(id, e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => {
      el.removeEventListener('wheel', handler);
      rows.delete(id);
      viewCache.delete(id);
      setMachine(swipeForget(machine, id));
    };
    // The actions are refreshed by the layout effect above; re-registering would forget an open row.
  }, [id]);

  const view = useSyncExternalStore(subscribe, () => cachedView(id), () => CLOSED_VIEW);

  const close = useCallback(() => {
    if (machine.row === id) closeOpenRow();
  }, [id]);

  const trigger = useCallback((action: SwipeAction) => {
    if (machine.row === id) closeOpenRow();
    action.onTrigger();
  }, [id]);

  return { rootRef, view, close, trigger };
}
