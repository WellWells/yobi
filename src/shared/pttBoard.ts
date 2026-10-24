/*
 * The ptt_board step's own rules, shared by the step in main and its form in the renderer: what a
 * keyword may hold, how the score mode turns into PTT's net-score condition, and what the setup
 * preview and board picker exchange over IPC.
 */

/** PTT clamps its net score to -100..100 (爆 = 100, XX = -100). */
export const PTT_MAX_SCORE = 100;

export const PTT_SCORE_MODES = ['none', 'push', 'boo'] as const;

/** none: every article; push: net score >= N; boo: net score <= -N. */
export type PttScoreMode = (typeof PTT_SCORE_MODES)[number];

const OPERATOR_KEYS = new Set(['recommend', 'author', 'thread']);

/**
 * True when PTT would read part of the keyword as a filter instead of title text: a
 * whitespace-separated token `recommend:`/`author:`/`thread:` (any case) with a value after the colon.
 */
export function pttKeywordHasOperator(keyword: string): boolean {
  return keyword.split(/\s+/).some((token) => {
    const colon = token.indexOf(':');
    return colon > 0 && colon < token.length - 1 && OPERATOR_KEYS.has(token.slice(0, colon).toLowerCase());
  });
}

export function parsePttScoreMode(raw: string | undefined): PttScoreMode {
  return (PTT_SCORE_MODES as readonly string[]).includes(raw ?? '') ? raw as PttScoreMode : 'none';
}

/** A whole number from 1 to 100, or null. */
export function parsePttScore(raw: string | undefined): number | null {
  const text = (raw ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= PTT_MAX_SCORE ? n : null;
}

/**
 * PTT's `recommend:` value for the step's score fields: 0 = no condition, N for pushes, -N for
 * boos; null when a score mode is on and the score is not 1-100.
 */
export function pttMinScore(scoreMode: string | undefined, score: string | undefined): number | null {
  const mode = parsePttScoreMode(scoreMode);
  if (mode === 'none') return 0;
  const n = parsePttScore(score);
  if (n === null) return null;
  return mode === 'boo' ? -n : n;
}

/** One board in the picker: its name, class column and title as the directory lists them. */
export interface PttBoardChoice {
  board: string;
  cls: string;
  title: string;
}

/** `slot` names the field asking: a newer read for the same slot stops the one before it. */
export interface PttBoardPreviewRequest {
  board: string;
  keyword: string;
  scoreMode: string;
  score: string;
  slot: string;
}

export interface PttBoardPreviewItem {
  title: string;
  link: string;
  score: string;
  date: string;
}

/** `url` is the PTT page the step reads, for "open on PTT"; `cancelled` is a read replaced by a newer one. */
export type PttBoardPreviewResult =
  | { status: 'items'; items: PttBoardPreviewItem[]; url: string }
  | { status: 'empty'; url: string }
  | { status: 'error'; message: string }
  | { status: 'cancelled' };
