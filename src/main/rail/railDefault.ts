/**
 * The Taiwan rail connector is only useful in Taiwan, so it starts on for Taiwan Chinese systems
 * and off elsewhere — decided once, the first time this version starts, and stored. From then on
 * only the user's own switch changes it: switched off, it stays off (a factory reset decides again,
 * as a fresh install would).
 */
import type { Config } from '../configTypes';
import { isTaiwanUser } from '../userRegion';

/** On for a Taiwan user (`isTaiwanUser`): the system's first language, or Yobi's chosen one. */
export function taiwanRailDefaultOn(systemLanguages: readonly string[], cfg: Pick<Config, 'locale' | 'localeSetByUser'>): boolean {
  return isTaiwanUser(systemLanguages, cfg);
}

/** Decides the default once; returns the patch to store, or null when it is already decided. */
export function decideTaiwanRailDefault(
  cfg: Pick<Config, 'taiwanRailEnabled' | 'locale' | 'localeSetByUser'>,
  systemLanguages: readonly string[],
): { taiwanRailEnabled: boolean } | null {
  if (typeof cfg.taiwanRailEnabled === 'boolean') return null;
  return { taiwanRailEnabled: taiwanRailDefaultOn(systemLanguages, cfg) };
}
