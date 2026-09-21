import { buildByokGroupUrl, buildByokUrl, isGeminiApiBaseUrl } from '../../../../../shared/types';
import type { ByokSettingsSnapshot, HiddenSources } from '../../../../../shared/types';

export interface FallbackChoice {
  value: string;
  label: string;
}

/**
 * The BYOK entries that can read a YouTube video: Gemini API keys, and groups holding at least
 * one. Entries hidden in Settings stay out unless the step already uses them.
 */
export function geminiFallbackChoices(
  snapshot: ByokSettingsSnapshot,
  hidden: HiddenSources,
  selected: string,
): { groups: FallbackChoice[]; keys: FallbackChoice[] } {
  const geminiIds = new Set(
    snapshot.instances.filter((instance) => isGeminiApiBaseUrl(instance.baseUrl)).map((instance) => instance.id),
  );
  const shown = (value: string, isHidden: boolean): boolean => !isHidden || value === selected;

  const groups = snapshot.groups
    .filter((group) => group.memberIds.some((id) => geminiIds.has(id)))
    .map((group) => ({ value: buildByokGroupUrl(group.id), label: group.name, hidden: hidden.byokGroupIds.includes(group.id) }))
    .filter((choice) => shown(choice.value, choice.hidden))
    .map(({ value, label }) => ({ value, label }));

  const keys = snapshot.instances
    .filter((instance) => geminiIds.has(instance.id))
    .map((instance) => ({ value: buildByokUrl(instance.id), label: instance.name, hidden: hidden.byokIds.includes(instance.id) }))
    .filter((choice) => shown(choice.value, choice.hidden))
    .map(({ value, label }) => ({ value, label }));

  return { groups, keys };
}
