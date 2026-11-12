/**
 * The chat model a new install starts with: DeepSeek for a Simplified Chinese user, Gemini
 * elsewhere. Decided once, the first time Yobi starts (and again after a factory reset), and
 * stored; from then on only the user's own choice changes it. An install that already saved a
 * model keeps it, whatever its language.
 */
import type { Config } from './configTypes';
import { PROVIDER_URLS } from '../shared/types';
import { isSimplifiedChineseUser } from './userRegion';

export function defaultChatTarget(systemLanguages: readonly string[], cfg: Pick<Config, 'locale' | 'localeSetByUser'>): string {
  return isSimplifiedChineseUser(systemLanguages, cfg) ? PROVIDER_URLS.deepseek : PROVIDER_URLS.gemini;
}

/** The model to store while it is still undecided (`filledIn`), or null when there is nothing to decide. */
export function decideChatTargetDefault(
  filledIn: boolean,
  systemLanguages: readonly string[],
  cfg: Pick<Config, 'locale' | 'localeSetByUser'>,
): string | null {
  if (!filledIn) return null;
  return defaultChatTarget(systemLanguages, cfg);
}
