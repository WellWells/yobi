/**
 * Where the person using Yobi is, as far as the system's languages and Yobi's own language tell.
 * Read every time it is asked: changing either language changes what Taiwan-only features show.
 */
import type { Config } from './configTypes';
import type { LinkRecognitionRegion } from '../shared/linkRecognition';

const TAIWAN_CHINESE = /^zh-(tw|hant-tw)$/iu;

/**
 * Taiwan when the system's first language is Taiwan Chinese, or the user picked Traditional Chinese
 * for Yobi themselves. `locale` alone is not enough: it is `en-US` until the window's first
 * auto-detect, and that auto-detect reads the system languages the first check already looked at.
 */
export function isTaiwanUser(systemLanguages: readonly string[], cfg: Pick<Config, 'locale' | 'localeSetByUser'>): boolean {
  const first = systemLanguages[0]?.trim() ?? '';
  if (TAIWAN_CHINESE.test(first)) return true;
  return cfg.localeSetByUser && cfg.locale === 'zh-TW';
}

/** Taiwan as above; Chinese when that, or the system's first language or Yobi's is any Chinese. */
export function userRegion(systemLanguages: readonly string[], cfg: Pick<Config, 'locale' | 'localeSetByUser'>): LinkRecognitionRegion {
  const taiwan = isTaiwanUser(systemLanguages, cfg);
  const first = systemLanguages[0]?.trim().toLowerCase() ?? '';
  const chinese = taiwan || first.startsWith('zh') || cfg.locale.toLowerCase().startsWith('zh');
  return { taiwan, chinese };
}
