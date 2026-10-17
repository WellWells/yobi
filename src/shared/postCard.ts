/**
 * A forum article's header (a PTT article): the desktop chat draws it as a card in place of the
 * answer's opening block, which says the same in words for Telegram, LINE and the saved file.
 */
export interface PostCard {
  title: string;
  board: string;
  /** The author's id. */
  author: string;
  /** The author's nickname; "" when none. */
  name: string;
  /** Epoch ms; 0 when the page gave no time. */
  at: number;
  /** Where the site says it was posted from, in its own words; "" when it does not say. */
  from: string;
  push: number;
  boo: number;
  arrow: number;
}

/** The card as a turn keeps it: `h` is the answer's opening block it stands for, exactly as written. */
export interface TurnPostCard extends PostCard {
  h: string;
}

/** Local `YYYY-MM-DD HH:mm`, the same stamp the log uses. */
export function formatPostTime(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleString('sv-SE', { hour12: false }).slice(0, 16);
}

const TEXT_FIELDS = ['title', 'board', 'author', 'name', 'from', 'h'] as const;
const COUNT_FIELDS = ['at', 'push', 'boo', 'arrow'] as const;

function lf(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * The card and the rest of the answer, or null: the file may have been edited by hand, and once
 * the answer no longer opens with the block the card stands for, the words are shown as written.
 */
export function readPostCard(raw: unknown, response: string): { card: TurnPostCard; rest: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!TEXT_FIELDS.every((key) => typeof value[key] === 'string')) return null;
  if (!COUNT_FIELDS.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]) && (value[key] as number) >= 0)) return null;
  const card = Object.fromEntries([...TEXT_FIELDS, ...COUNT_FIELDS].map((key) => [key, value[key]])) as unknown as TurnPostCard;
  const opening = lf(card.h);
  const answer = lf(response);
  if (!opening.trim() || !answer.startsWith(opening)) return null;
  return { card, rest: answer.slice(opening.length).replace(/^\s+/, '') };
}

/** A flow's card (JSON) for the turn it answers, or null when it is not one or not that answer's. */
export function postCardForTurn(json: string | undefined, response: string): TurnPostCard | null {
  if (!json) return null;
  try {
    return readPostCard(JSON.parse(json), response)?.card ?? null;
  } catch {
    return null;
  }
}
