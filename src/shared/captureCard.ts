import type { CaptureSettings, CaptureTurn, CardLayout, CardTheme, MarkdownCapturePayload } from './types';
import { captureBackgroundCss, paletteCardTheme } from './capturePalettes';
import type { CaptureBackgroundStyle, CaptureDirection } from './capturePalettes';

/**
 * What an exported card prints, shared by every path that renders one: the chat export dialog in
 * the renderer, and a flow's LLM export and the bot image export in main.
 */

/** A bubble card, or more than one turn, makes no sense without the questions. */
export function mustShowPrompt(cardLayout: CardLayout, exportedTurnCount: number): boolean {
  return cardLayout === 'bubble' || exportedTurnCount > 1;
}

export interface CardStyle {
  background: string;
  cardTheme: CardTheme;
  width: number;
  margin: number;
  pixelRatio: number;
}

/**
 * The look Settings › Card style gives a card rendered in main (a bot export, a flow's llm
 * export): the background (palette, solid/gradient/mesh, direction), a light or dark card, width,
 * margin and resolution. `palette` is the caller's own pick and replaces the style's palette only;
 * blank keeps the style's.
 */
export function cardStyleFromSettings(settings: CaptureSettings, palette = ''): CardStyle {
  const key = palette.trim() || settings.palette;
  return {
    background: captureBackgroundCss(
      key,
      settings.backgroundStyle as CaptureBackgroundStyle,
      settings.direction as CaptureDirection,
    ),
    cardTheme: paletteCardTheme(key),
    width: settings.width,
    margin: settings.margin,
    pixelRatio: settings.pixelRatio,
  };
}

/**
 * Every card is drawn as turns. A payload that carries none (one answer, one document) is a single
 * turn, so a bot export, a flow card and the in-app export come out as the same card. The capture
 * window has no i18n, so a card prints only what the payload brings.
 */
export function cardTurns(payload: MarkdownCapturePayload): CaptureTurn[] {
  if (payload.turns?.length) return payload.turns;
  return [{ prompt: payload.prompt, response: payload.content, provider: payload.provider, timestamp: payload.timestamp }];
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
