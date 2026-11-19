import { builtinFlowRight } from '../../shared/builtinFlowRight';
import { t } from '../i18n';

/** The capabilities a bot reply can name when it refuses one, worded for the person asking. */
type BotDeniedCapability = 'agent' | 'web' | 'download' | 'analyze';

/**
 * The one refusal wording both bots send when an account lacks a grant. Kept apart from the
 * resolver so the chat handlers can word a refusal without loading the config.
 */
export function botAccessDeniedText(strings: Record<string, string>, capability: BotDeniedCapability): string {
  return t(strings, 'bot.access.denied', { capability: t(strings, `bot.access.cap.${capability}`) });
}

/** The refusal for a built-in flow's line: the analysis for a line that sums up, else the downloader. */
export function botFlowDeniedText(strings: Record<string, string>, flowId: string, input: string): string {
  return botAccessDeniedText(strings, builtinFlowRight(flowId, input) ?? 'download');
}
