/**
 * The time windows of the `telegram_read` step, shared so the picker and the step cannot drift.
 * All relative: a scheduled flow with a fixed date would freeze on the day it was written. The
 * bot keeps three days, so nothing reaches further back.
 */
export const TELEGRAM_READ_RANGES = ['last24h', 'today', 'yesterday', 'last3d'] as const;

export type TelegramReadRange = (typeof TELEGRAM_READ_RANGES)[number];

export const DEFAULT_TELEGRAM_READ_RANGE: TelegramReadRange = 'last24h';

export function isTelegramReadRange(value: string): value is TelegramReadRange {
  return (TELEGRAM_READ_RANGES as readonly string[]).includes(value);
}
