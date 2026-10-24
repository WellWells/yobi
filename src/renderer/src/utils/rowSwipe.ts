/**
 * Two-finger trackpad swipe on list rows (macOS): the pure state machine, no DOM.
 *
 * A trackpad swipe reaches the page as a stream of `wheel` events, not pointer drags, and the
 * DOM never says when the fingers lift. Main forwards the gesture's begin/end
 * (`IPC.TRACKPAD_GESTURE`), but whether that end arrives at the lift or only after the momentum
 * coast is unmeasured, and it may not arrive at all for a sequence the page cancelled. So the
 * machine ends a gesture on whichever comes first — the end signal, a quiet gap, or a run of
 * smoothly decaying deltas (momentum) — and after an end it swallows the decaying tail instead
 * of treating it as a new swipe.
 *
 * One machine serves every row: one gesture at a time, one row open at a time. Offsets are in
 * CSS px; negative = content moved left (trailing actions revealed), positive = leading.
 *
 * The constants are first guesses, written on a machine without a trackpad: hand tuning on a
 * Mac is pending.
 */

export const SWIPE = {
  /** Travel (px, either axis) before the gesture commits to an axis. */
  AXIS_LOCK_PX: 8,
  /** Horizontal only if |dx| exceeds |dy| by this factor at lock time; otherwise it is a scroll. */
  AXIS_DOMINANCE: 1.6,
  /** Width of one action cell behind the row. */
  ACTION_WIDTH_PX: 64,
  /** On release, a side opens when the projected offset passes this fraction of its width. */
  OPEN_FRACTION: 0.5,
  /** Release velocity (px/ms) is projected this far ahead to decide open/closed (a flick opens). */
  FLING_PROJECTION_MS: 120,
  /** Window of recent motion the release velocity is measured over. */
  VELOCITY_WINDOW_MS: 80,
  /** A full swipe arms past this fraction of the row width… */
  FULL_SWIPE_FRACTION: 0.6,
  /** …and never closer than this to the open width, so opening cannot slide into a commit. */
  FULL_SWIPE_MIN_EXTRA_PX: 40,
  /** Cap on the threshold for narrow rows. */
  FULL_SWIPE_MAX_FRACTION: 0.9,
  /** Once armed, it stays armed until the offset falls this far back below the threshold. */
  FULL_SWIPE_HYSTERESIS_PX: 12,
  /** Rubber-band coefficient past the open width (UIScrollView's 0.55). */
  RUBBER_BAND: 0.55,
  /** No wheel event for this long ends the gesture (the end signal never came). */
  IDLE_END_MS: 140,
  /** After an end, events closer together than this are still the old gesture's tail… */
  TAIL_QUIET_MS: 90,
  /** …unless one grows past the last by this factor (plus 1px): fingers are back. */
  TAIL_GROWTH: 1.15,
  /** This many consecutive smoothly shrinking deltas read as momentum: the fingers have lifted. */
  DECAY_RUN_TO_END: 6,
  /** "Smoothly" shrinking: each delta at least this fraction of the previous one. */
  DECAY_MIN_RATIO: 0.6,
  /** Deltas below this (px) are noise for the decay run. */
  DECAY_MIN_MAGNITUDE: 0.5,
  /** `deltaMode === 1` (lines) to px. */
  LINE_HEIGHT_PX: 16,
  /** Snap animation length; also how long a committed row stays flown out before it resets. */
  SNAP_MS: 200,
} as const;

export type SwipeSide = 'leading' | 'trailing';

/** What a row offers, measured when the gesture reaches it. */
export interface SwipeLayout {
  width: number;
  leading: number;
  trailing: number;
  leadingFull: boolean;
  trailingFull: boolean;
}

interface Sample { t: number; d: number }

export interface SwipeMachine {
  phase: 'idle' | 'tracking' | 'tail';
  axis: 'pending' | 'x' | 'y';
  /** The row being swiped, or the open row while idle; null = every row closed. */
  row: string | null;
  layout: SwipeLayout | null;
  offset: number;
  /** Offset when the horizontal lock happened. */
  origin: number;
  /** Raw finger travel (offset direction) since the lock. */
  travel: number;
  accX: number;
  accY: number;
  lastAt: number;
  lastMagnitude: number;
  decayRun: number;
  samples: readonly Sample[];
  armed: SwipeSide | null;
}

export interface WheelInput {
  row: string;
  layout: SwipeLayout;
  dx: number;
  dy: number;
  t: number;
}

/** A full swipe released while armed: run that side's `fullSwipe` action. */
export interface SwipeCommit { row: string; side: SwipeSide }

export interface SwipeStep {
  machine: SwipeMachine;
  /** Cancel the wheel event's default (the list must not scroll under a horizontal swipe). */
  preventDefault: boolean;
  commit: SwipeCommit | null;
}

export function initialSwipeMachine(): SwipeMachine {
  return {
    phase: 'idle', axis: 'pending', row: null, layout: null, offset: 0, origin: 0, travel: 0,
    accX: 0, accY: 0, lastAt: 0, lastMagnitude: 0, decayRun: 0, samples: [], armed: null,
  };
}

/** Wheel deltas in px. */
export function wheelDeltaPx(deltaX: number, deltaY: number, deltaMode: number): { dx: number; dy: number } {
  const scale = deltaMode === 1 ? SWIPE.LINE_HEIGHT_PX : 1;
  return { dx: deltaX * scale, dy: deltaY * scale };
}

function sideOf(offset: number): SwipeSide | null {
  if (offset < 0) return 'trailing';
  if (offset > 0) return 'leading';
  return null;
}

function sideWidth(layout: SwipeLayout, side: SwipeSide): number {
  return side === 'leading' ? layout.leading : layout.trailing;
}

function sideFull(layout: SwipeLayout, side: SwipeSide): boolean {
  return side === 'leading' ? layout.leadingFull : layout.trailingFull;
}

export function rubberBand(overshoot: number, dimension: number): number {
  if (overshoot <= 0 || dimension <= 0) return 0;
  return (overshoot * SWIPE.RUBBER_BAND * dimension) / (dimension + SWIPE.RUBBER_BAND * overshoot);
}

/** |offset| at which a full swipe arms on `side`. */
export function fullSwipeThreshold(layout: SwipeLayout, side: SwipeSide): number {
  const wanted = Math.max(layout.width * SWIPE.FULL_SWIPE_FRACTION, sideWidth(layout, side) + SWIPE.FULL_SWIPE_MIN_EXTRA_PX);
  return Math.min(wanted, layout.width * SWIPE.FULL_SWIPE_MAX_FRACTION);
}

/** A gesture that starts from an open side stops at closed rather than crossing to the other side. */
function clampToOrigin(raw: number, origin: number): number {
  if (origin < 0) return Math.min(raw, 0);
  if (origin > 0) return Math.max(raw, 0);
  return raw;
}

/** The displayed offset for a raw finger position: free up to the open width, banded beyond. */
export function swipeOffset(raw: number, origin: number, layout: SwipeLayout): number {
  const clamped = clampToOrigin(raw, origin);
  const side = sideOf(clamped);
  if (!side) return 0;
  const sign = side === 'trailing' ? -1 : 1;
  const distance = Math.abs(clamped);
  const open = sideWidth(layout, side);
  // A side with a full-swipe action follows the finger all the way across, like Mail.
  if (sideFull(layout, side) && open > 0) return sign * Math.min(distance, layout.width);
  if (distance <= open) return sign * distance;
  return sign * (open + rubberBand(distance - open, layout.width));
}

function nextArmed(offset: number, layout: SwipeLayout, wasArmed: SwipeSide | null): SwipeSide | null {
  const side = sideOf(offset);
  if (!side || !sideFull(layout, side) || sideWidth(layout, side) <= 0) return null;
  const threshold = fullSwipeThreshold(layout, side);
  const slack = wasArmed === side ? SWIPE.FULL_SWIPE_HYSTERESIS_PX : 0;
  return Math.abs(offset) >= threshold - slack ? side : null;
}

/** Release velocity in offset px/ms over the recent window ending at `t`. */
export function releaseVelocity(samples: readonly Sample[], t: number): number {
  const recent = samples.filter((s) => s.t >= t - SWIPE.VELOCITY_WINDOW_MS);
  if (recent.length === 0) return 0;
  return recent.reduce((sum, s) => sum + s.d, 0) / SWIPE.VELOCITY_WINDOW_MS;
}

/** Where a released row rests: open on a side, or closed. */
export function snapTarget(offset: number, origin: number, velocity: number, layout: SwipeLayout): number {
  const projected = clampToOrigin(offset + velocity * SWIPE.FLING_PROJECTION_MS, origin);
  const side = sideOf(projected);
  if (!side) return 0;
  const open = sideWidth(layout, side);
  if (open <= 0 || Math.abs(projected) < open * SWIPE.OPEN_FRACTION) return 0;
  return side === 'trailing' ? -open : open;
}

function step(machine: SwipeMachine, preventDefault = false, commit: SwipeCommit | null = null): SwipeStep {
  return { machine, preventDefault, commit };
}

function isDecaying(previous: number, magnitude: number): boolean {
  return magnitude >= SWIPE.DECAY_MIN_MAGNITUDE
    && magnitude < previous
    && magnitude >= previous * SWIPE.DECAY_MIN_RATIO;
}

/** A fresh gesture; an open row stays open until the axis is known. */
function startGesture(m: SwipeMachine): SwipeMachine {
  const open = m.row !== null && m.offset !== 0;
  return {
    ...m,
    phase: 'tracking', axis: 'pending', accX: 0, accY: 0, travel: 0, samples: [], armed: null,
    decayRun: 0, lastMagnitude: 0,
    row: open ? m.row : null, layout: open ? m.layout : null, offset: open ? m.offset : 0,
  };
}

function lockAxis(m: SwipeMachine, input: WheelInput): SwipeStep {
  const horizontal = Math.abs(m.accX) > SWIPE.AXIS_DOMINANCE * Math.abs(m.accY);
  if (!horizontal) {
    // A scroll closes whatever row is open and then passes through untouched.
    return step({ ...m, axis: 'y', row: null, layout: null, offset: 0, origin: 0 });
  }
  const sameRow = m.row === input.row;
  const origin = sameRow ? m.offset : 0;
  const travel = -m.accX;
  const offset = swipeOffset(origin + travel, origin, input.layout);
  return step({
    ...m,
    axis: 'x', row: input.row, layout: input.layout, origin, travel, offset,
    samples: [{ t: input.t, d: travel }],
    armed: nextArmed(offset, input.layout, null),
  }, true);
}

/** One wheel event over a row. */
export function swipeWheel(machine: SwipeMachine, input: WheelInput): SwipeStep {
  const magnitude = Math.hypot(input.dx, input.dy);
  let m = machine;

  if (m.phase === 'tail') {
    const quiet = input.t - m.lastAt >= SWIPE.TAIL_QUIET_MS;
    const growing = magnitude > m.lastMagnitude * SWIPE.TAIL_GROWTH + 1;
    if (!quiet && !growing) {
      // Momentum after the end: swallow it (cancel it too if the gesture was a swipe, so the
      // coast's vertical drift does not scroll the list and close the row just opened).
      return step({ ...m, lastAt: input.t, lastMagnitude: magnitude }, m.axis === 'x');
    }
    m = { ...m, phase: 'idle' };
  }
  if (m.phase === 'idle') m = startGesture(m);

  const previous = m.lastMagnitude;
  m = { ...m, lastAt: input.t, lastMagnitude: magnitude };

  if (m.axis === 'pending') {
    m = { ...m, accX: m.accX + input.dx, accY: m.accY + input.dy };
    if (Math.max(Math.abs(m.accX), Math.abs(m.accY)) < SWIPE.AXIS_LOCK_PX) {
      // Chromium keeps a wheel sequence cancelable only if its first event was cancelled, so a
      // gesture that leans horizontal is held back until the axis is known.
      return step(m, Math.abs(m.accX) > Math.abs(m.accY));
    }
    return lockAxis(m, input);
  }

  if (m.axis === 'y' || !m.layout || m.row === null) return step(m);

  const decayRun = isDecaying(previous, magnitude) ? m.decayRun + 1 : 0;
  const travel = m.travel - input.dx;
  const offset = swipeOffset(m.origin + travel, m.origin, m.layout);
  const samples = [...m.samples, { t: input.t, d: -input.dx }]
    .filter((s) => s.t >= input.t - SWIPE.VELOCITY_WINDOW_MS);
  m = { ...m, travel, offset, samples, decayRun, armed: nextArmed(offset, m.layout, m.armed) };
  if (SWIPE.DECAY_RUN_TO_END > 0 && decayRun >= SWIPE.DECAY_RUN_TO_END) {
    const ended = swipeEnd(m, input.t);
    return { ...ended, preventDefault: true };
  }
  return step(m, true);
}

/** The gesture ended (main's end signal, a quiet gap, or momentum detected). Idempotent. */
export function swipeEnd(machine: SwipeMachine, t: number): SwipeStep {
  const m = machine;
  if (m.phase !== 'tracking') return step(m);
  if (m.axis !== 'x' || !m.layout || m.row === null) {
    return step({ ...m, phase: 'tail', axis: m.axis === 'x' ? 'x' : 'y', lastAt: t });
  }
  if (m.armed) {
    const sign = m.armed === 'trailing' ? -1 : 1;
    return step(
      { ...m, phase: 'tail', lastAt: t, offset: sign * m.layout.width },
      false,
      { row: m.row, side: m.armed },
    );
  }
  const target = snapTarget(m.offset, m.origin, releaseVelocity(m.samples, t), m.layout);
  return step({
    ...m,
    phase: 'tail', lastAt: t, offset: target, armed: null, samples: [],
    row: target === 0 ? null : m.row,
    layout: target === 0 ? null : m.layout,
  });
}

/** Timer tick: end a gesture whose end signal never came; let a finished tail go. */
export function swipeTick(machine: SwipeMachine, t: number): SwipeStep {
  if (machine.phase === 'tracking' && t - machine.lastAt >= SWIPE.IDLE_END_MS) return swipeEnd(machine, t);
  if (machine.phase === 'tail' && t - machine.lastAt >= SWIPE.TAIL_QUIET_MS) {
    return step({ ...machine, phase: 'idle' });
  }
  return step(machine);
}

/**
 * Main's begin signal. It arrives after the first wheel event of its own gesture (Chromium
 * starts the scroll gesture once that event is handled) and momentum may carry one too, so
 * it cannot start or split anything; it is accepted for symmetry and changes nothing.
 */
export function swipeBegin(machine: SwipeMachine): SwipeMachine {
  return machine;
}

/** Close the open row (outside click, scroll, Escape, an action ran). A swipe in flight is left alone. */
export function swipeClose(machine: SwipeMachine): SwipeMachine {
  if (machine.phase === 'tracking' && machine.axis === 'x') return machine;
  if (machine.row === null && machine.offset === 0) return machine;
  return { ...machine, row: null, layout: null, offset: 0, origin: 0, armed: null };
}

/** Forget a row that unmounted or became disabled, even mid-swipe. */
export function swipeForget(machine: SwipeMachine, row: string): SwipeMachine {
  if (machine.row !== row) return machine;
  const phase = machine.phase === 'tracking' ? 'tail' : machine.phase;
  return { ...machine, phase, row: null, layout: null, offset: 0, origin: 0, armed: null };
}

/** What one row draws. */
export interface RowSwipeView {
  offset: number;
  /** The finger is on it: follow without animation. */
  tracking: boolean;
  armed: SwipeSide | null;
}

export const CLOSED_VIEW: RowSwipeView = { offset: 0, tracking: false, armed: null };

export function rowView(machine: SwipeMachine, row: string): RowSwipeView {
  if (machine.row !== row) return CLOSED_VIEW;
  return {
    offset: machine.offset,
    tracking: machine.phase === 'tracking' && machine.axis === 'x',
    armed: machine.armed,
  };
}

/** The content's CSS transition: none under the finger or with reduced motion, a snap otherwise. */
export function swipeTransition(tracking: boolean, reducedMotion: boolean): string | undefined {
  if (tracking || reducedMotion) return undefined;
  return `transform ${SWIPE.SNAP_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
}

/**
 * The box to anchor a row's menu to: the swipe root (`data-swipe-row`), which does not move,
 * rather than the row itself, which may still be slid aside when "More" is pressed.
 */
export function swipeAnchorElement(row: Element): Element {
  return row.closest('[data-swipe-row]') ?? row;
}

/** Where "More" opens the row's context menu: under the row, as if from a button on it. */
export function menuAnchorUnderRow(rect: { left: number; bottom: number; width: number }): { x: number; y: number } {
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.bottom) };
}
