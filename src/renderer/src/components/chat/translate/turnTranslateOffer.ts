import { isDesktopBuiltinFlowId } from '../../../../../shared/builtinFlows';
import { hasSimplifiedChinese } from '../../../../../shared/simplifiedHint';
import { suggestTranslation, type TranslateLanguage } from '../../../../../shared/translateLanguages';

export interface TurnTranslateOffer {
  /** "Translate into <language>", offered unasked; null when not offered. */
  suggestion: TranslateLanguage | null;
  /** "Convert to Traditional", for a zh-TW reader meeting Simplified characters. */
  traditional: boolean;
}

const NO_OFFER: TurnTranslateOffer = { suggestion: null, traditional: false };

/**
 * What a turn's action row offers unasked, beside the language menu that is always there. A pasted
 * link's built-in (a video's title and quality menu, a post as written) is a card Yobi laid out,
 * not an answer written in another language: it gets the menu, never the offer.
 */
export function turnTranslateOffer(
  response: string, uiLocale: string, command: string | undefined, translated: boolean,
): TurnTranslateOffer {
  if (translated || (command && isDesktopBuiltinFlowId(command))) return NO_OFFER;
  const traditional = uiLocale === 'zh-TW' && hasSimplifiedChinese(response);
  return { suggestion: traditional ? null : suggestTranslation(response, uiLocale), traditional };
}
