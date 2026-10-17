import { t } from '../i18n';

/** The capabilities a bot reply can name when it refuses one, worded for the person asking. */
type BotDeniedCapability = 'agent' | 'web' | 'download';

/**
 * The one refusal wording both bots send when an account lacks a grant. Kept apart from the
 * resolver so the chat handlers can word a refusal without loading the config.
 */
export function botAccessDeniedText(strings: Record<string, string>, capability: BotDeniedCapability): string {
  return t(strings, 'bot.access.denied', { capability: t(strings, `bot.access.cap.${capability}`) });
}
