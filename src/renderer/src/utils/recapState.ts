import type { RecapView } from '../../../shared/recap';

/*
 * When the composer's recap line shows. Being away and opening an older conversation are events;
 * everything else (enough turns, nothing in flight, not dismissed) is state. An event arms the line
 * for one conversation and one recap, and the state decides whether an armed line is drawn — so an
 * answer that was already on its way when the user came back cannot pop the line when it lands.
 * Pure, so the rules are tested without a DOM.
 */

export const RECAP_AWAY_MS = 60_000;
export const RECAP_MIN_TURNS = 3;
/** Input refreshes "last active" at most this often: a timestamp, not a timer, so a hidden window's throttling cannot matter. */
export const ACTIVITY_STEP_MS = 10_000;

export interface RecapArm {
  path: string;
  /** The recap it was armed for; a newer one (an answer landed) is not what the user came back to. */
  at: string;
  /** Asked for with `/recap`: shown whatever the thresholds say. */
  manual: boolean;
}

export interface RecapState {
  armed: RecapArm | null;
  /** `recapKey(path, at)` of lines the user closed; this recap stays closed, the next one may show. */
  dismissed: ReadonlySet<string>;
  /** A conversation the user just opened, judged once its file has loaded. */
  pendingOpen: string | null;
}

export const INITIAL_RECAP_STATE: RecapState = { armed: null, dismissed: new Set(), pendingOpen: null };

export interface RecapContext {
  /** The open conversation's file path, or '' for an unsaved or temporary one. */
  path: string;
  recap: RecapView | null;
  turnCount: number;
  /** A send or Agent run for this conversation is in flight. */
  pending: boolean;
}

export type RecapEvent =
  | { kind: 'returned'; awayMs: number; ctx: RecapContext }
  | { kind: 'opened'; path: string }
  | { kind: 'loaded'; ctx: RecapContext; now: number }
  | { kind: 'manual'; ctx: RecapContext }
  | { kind: 'sendStarted' }
  | { kind: 'dismiss' }
  | { kind: 'switched'; path: string };

export function recapKey(path: string, at: string): string {
  return `${path}\n${at}`;
}

function arm(state: RecapState, ctx: RecapContext): RecapState {
  if (!ctx.recap || ctx.pending) return state;
  return { ...state, armed: { path: ctx.path, at: ctx.recap.at, manual: false } };
}

export function reduceRecap(state: RecapState, event: RecapEvent): RecapState {
  switch (event.kind) {
    case 'returned':
      return event.awayMs >= RECAP_AWAY_MS ? arm(state, event.ctx) : state;
    case 'opened':
      return { ...state, pendingOpen: event.path };
    case 'loaded': {
      if (state.pendingOpen !== event.ctx.path) return state;
      const judged = { ...state, pendingOpen: null };
      const at = Date.parse(event.ctx.recap?.at ?? '');
      return Number.isFinite(at) && event.now - at >= RECAP_AWAY_MS ? arm(judged, event.ctx) : judged;
    }
    case 'manual':
      return { ...state, armed: { path: event.ctx.path, at: event.ctx.recap?.at ?? '', manual: true } };
    case 'sendStarted':
      return state.armed ? { ...state, armed: null } : state;
    case 'dismiss': {
      if (!state.armed) return state;
      const dismissed = new Set(state.dismissed);
      dismissed.add(recapKey(state.armed.path, state.armed.at));
      return { ...state, armed: null, dismissed };
    }
    case 'switched':
      return state.armed && state.armed.path !== event.path ? { ...state, armed: null } : state;
    default:
      return state;
  }
}

export type RecapDisplay = 'recap' | 'empty' | null;

/** Whether the armed line is drawn for the conversation on screen. */
export function shouldShowRecap(state: RecapState, ctx: RecapContext & { currentView: string }): RecapDisplay {
  const { armed } = state;
  if (!armed || armed.path !== ctx.path || ctx.currentView !== 'chat') return null;
  if (armed.manual) {
    // "Nothing yet" belongs to a conversation; a temporary chat closed under it leaves no turns.
    if (!ctx.recap) return armed.at === '' && ctx.turnCount > 0 ? 'empty' : null;
    return ctx.recap.at === armed.at ? 'recap' : null;
  }
  if (!ctx.recap || ctx.recap.at !== armed.at) return null;
  if (ctx.turnCount < RECAP_MIN_TURNS || ctx.pending) return null;
  return state.dismissed.has(recapKey(armed.path, armed.at)) ? null : 'recap';
}

export interface ActivityState {
  lastActiveAt: number;
  focused: boolean;
}

/**
 * "Away" is time with no sign of the user, not only time with the window unfocused: with Yobi in
 * front, locking the screen or walking off never blurs it. Input while the window has focus counts
 * as being here; hover over an unfocused window does not. Reports how long the user was gone at the
 * moment they come back (focus, or the first input after a gap).
 */
export function trackActivity(
  state: ActivityState,
  event: 'focus' | 'blur' | 'input',
  now: number,
): { state: ActivityState; awayMs: number | null } {
  if (event === 'blur') return { state: { lastActiveAt: now, focused: false }, awayMs: null };
  if (event === 'focus') return { state: { lastActiveAt: now, focused: true }, awayMs: now - state.lastActiveAt };
  if (!state.focused) return { state, awayMs: null };
  const gap = now - state.lastActiveAt;
  if (gap < ACTIVITY_STEP_MS) return { state, awayMs: null };
  return { state: { lastActiveAt: now, focused: true }, awayMs: gap };
}
