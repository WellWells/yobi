/**
 * The Taiwan rail connector is only useful in Taiwan, so it starts on for Taiwan Chinese systems
 * and off elsewhere — decided once, the first time this version starts, and stored. From then on
 * only the user's own switch changes it: switched off, it stays off (a factory reset decides again,
 * as a fresh install would).
 */
import type { Config } from '../configTypes';

const TAIWAN_CHINESE = /^zh-(tw|hant-tw)$/iu;

/**
 * On when the system's first language is Taiwan Chinese, or the user picked Traditional Chinese for
 * Yobi themselves. `locale` alone is not enough: it is `en-US` until the window's first auto-detect,
 * and that auto-detect reads the system languages the first check already looked at.
 */
export function taiwanRailDefaultOn(systemLanguages: readonly string[], cfg: Pick<Config, 'locale' | 'localeSetByUser'>): boolean {
  const first = systemLanguages[0]?.trim() ?? '';
  if (TAIWAN_CHINESE.test(first)) return true;
  return cfg.localeSetByUser && cfg.locale === 'zh-TW';
}

/** Decides the default once; returns the patch to store, or null when it is already decided. */
export function decideTaiwanRailDefault(
  cfg: Pick<Config, 'taiwanRailEnabled' | 'locale' | 'localeSetByUser'>,
  systemLanguages: readonly string[],
): { taiwanRailEnabled: boolean } | null {
  if (typeof cfg.taiwanRailEnabled === 'boolean') return null;
  return { taiwanRailEnabled: taiwanRailDefaultOn(systemLanguages, cfg) };
}
