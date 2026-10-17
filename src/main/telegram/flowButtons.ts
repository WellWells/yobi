import { randomBytes } from 'node:crypto';
import type { FlowButton } from '../../shared/types';

/** Prefix of a flow button's `callback_data`; the export buttons use their own. */
export const FLOW_BUTTON_CB_PREFIX = 'fb';

const BUTTON_TTL_MS = 10 * 60_000;
const MAX_LIVE_BUTTONS = 500;

export interface FlowButtonRecord {
  flowId: string;
  input: string;
  chatId: number;
  /** The person who started the run; only they may press. Absent for a run nobody started. */
  userId?: number;
  expiresAt: number;
  /** Its run is still going: a second tap now would start the same download twice. */
  busy?: boolean;
}

const live = new Map<string, FlowButtonRecord>();

function prune(now: number): void {
  for (const [token, record] of live) {
    if (record.expiresAt <= now) live.delete(token);
  }
  // Oldest first (Map keeps insertion order) once a flood of menus outgrows the cap.
  while (live.size > MAX_LIVE_BUTTONS) {
    const oldest = live.keys().next().value;
    if (oldest === undefined) break;
    live.delete(oldest);
  }
}

/**
 * A token standing in for one button. The callback data carries only this — Telegram caps it at
 * 64 bytes and anything in it comes back from the client untouched by us, so a flow id or an
 * input there would be a request anyone could forge.
 */
export function registerFlowButton(
  button: FlowButton,
  owner: { flowId: string; chatId: number; userId?: number },
  now = Date.now(),
): string {
  prune(now);
  const token = randomBytes(12).toString('base64url');
  live.set(token, { flowId: owner.flowId, input: button.input, chatId: owner.chatId, userId: owner.userId, expiresAt: now + BUTTON_TTL_MS });
  return token;
}

export function flowButtonCallbackData(token: string): string {
  return `${FLOW_BUTTON_CB_PREFIX}:${token}`;
}

export function parseFlowButtonCallback(data: string | undefined): string | null {
  if (!data?.startsWith(`${FLOW_BUTTON_CB_PREFIX}:`)) return null;
  const token = data.slice(FLOW_BUTTON_CB_PREFIX.length + 1);
  return /^[\w-]{16}$/.test(token) ? token : null;
}

export type FlowButtonClaim =
  | { ok: true; record: FlowButtonRecord }
  | { ok: false; reason: 'expired' | 'otherChat' | 'otherUser' | 'busy' };

/**
 * Takes the button for this press. It keeps working until it expires — the person may press it
 * again after deleting the video it sent — but not while its own run is still going, so the second
 * tap of a double tap does not start the same download twice. `releaseFlowButton` frees it when
 * the run ends. A press by someone else leaves it in place for the person it belongs to.
 */
export function claimFlowButton(token: string, press: { chatId: number; userId: number }, now = Date.now()): FlowButtonClaim {
  prune(now);
  const record = live.get(token);
  if (!record) return { ok: false, reason: 'expired' };
  if (record.chatId !== press.chatId) return { ok: false, reason: 'otherChat' };
  if (record.userId !== undefined && record.userId !== press.userId) return { ok: false, reason: 'otherUser' };
  if (record.busy) return { ok: false, reason: 'busy' };
  record.busy = true;
  return { ok: true, record };
}

export function releaseFlowButton(token: string): void {
  const record = live.get(token);
  if (record) record.busy = false;
}

export function clearFlowButtons(): void {
  live.clear();
}

/**
 * Widest label (CJK counts 2) that still shares a row: a quality, size and destination label fits.
 * A phone that cannot fit two cuts the tail, and the quality and size come first.
 */
const PAIR_MAX_WIDTH = 32;

/** Hangul, CJK, fullwidth forms: two columns each. */
const WIDE_CHAR = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;

function labelWidth(label: string): number {
  let width = 0;
  for (const ch of label) width += WIDE_CHAR.test(ch) ? 2 : 1;
  return width;
}

/**
 * Two buttons to a row, in order. A label too wide to share gets a row of its own; in a run of
 * narrow ones with an odd count, the first stands alone — it is the menu's lead choice ("summary").
 */
export function flowButtonRows<T extends { label: string }>(buttons: readonly T[]): T[][] {
  const rows: T[][] = [];
  let run: T[] = [];
  const closeRun = (): void => {
    if (run.length % 2 === 1) rows.push([run.shift() as T]);
    for (let i = 0; i < run.length; i += 2) rows.push(run.slice(i, i + 2));
    run = [];
  };
  for (const button of buttons) {
    if (labelWidth(button.label) > PAIR_MAX_WIDTH) {
      closeRun();
      rows.push([button]);
    } else {
      run.push(button);
    }
  }
  closeRun();
  return rows;
}

/** The inline keyboard for a message, each button behind a fresh token. */
export function flowButtonKeyboard(
  buttons: readonly FlowButton[],
  owner: { flowId: string; chatId: number; userId?: number },
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return {
    inline_keyboard: flowButtonRows(buttons).map((row) => row.map((button) => ({
      text: button.label,
      callback_data: flowButtonCallbackData(registerFlowButton(button, owner)),
    }))),
  };
}
