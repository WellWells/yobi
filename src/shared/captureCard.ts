import type { CardLayout } from './types';

/**
 * What an exported card prints, shared by every path that renders one: the chat export dialog in
 * the renderer, and a flow's LLM export and the bot image export in main.
 */

/** A bubble card, or more than one turn, makes no sense without the questions. */
export function mustShowPrompt(cardLayout: CardLayout, exportedTurnCount: number): boolean {
  return cardLayout === 'bubble' || exportedTurnCount > 1;
}

const CARD_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
};

function cardTimeFormat(locale: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, CARD_TIME_OPTIONS);
  } catch {
    // A community pack can carry a tag Intl rejects; the system's own order beats no time at all.
    return new Intl.DateTimeFormat(undefined, CARD_TIME_OPTIONS);
  }
}

/**
 * An absolute local date and time to the minute, in the app language's order. Absolute because the
 * card is baked into an image: a relative "19 minutes ago" would still say it a week later.
 */
export function formatCardTime(ts: string, locale: string): string {
  if (!ts) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return cardTimeFormat(locale).format(date);
}
