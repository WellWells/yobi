/**
 * PTT is a Taiwanese forum, so its connector starts on for a Taiwan user and off elsewhere —
 * decided once, the first time this version starts, and stored, like the Taiwan rail connector.
 * From then on only the user's own switch changes it (a factory reset decides again).
 */
import type { Config } from '../configTypes';
import { isTaiwanUser } from '../userRegion';

/** On for a Taiwan user (`isTaiwanUser`): the system's first language, or Yobi's chosen one. */
export function pttConnectorDefaultOn(systemLanguages: readonly string[], cfg: Pick<Config, 'locale' | 'localeSetByUser'>): boolean {
  return isTaiwanUser(systemLanguages, cfg);
}

/** Decides the default once; returns the patch to store, or null when it is already decided. */
export function decidePttConnectorDefault(
  cfg: Pick<Config, 'pttConnectorEnabled' | 'locale' | 'localeSetByUser'>,
  systemLanguages: readonly string[],
): { pttConnectorEnabled: boolean } | null {
  if (typeof cfg.pttConnectorEnabled === 'boolean') return null;
  return { pttConnectorEnabled: pttConnectorDefaultOn(systemLanguages, cfg) };
}
