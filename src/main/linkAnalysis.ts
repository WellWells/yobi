import { byokGroupIdFromUrl, byokIdFromUrl, isByokTargetUrl, isModelUrlHidden, PROVIDER_URLS } from '../shared/types';
import type { FlowDefinition } from '../shared/types';
import type { BuiltinBuildContext, BuiltinEntry } from '../shared/linkSites/registry';
import { config, getHiddenSources } from './config';

/** A missing or hidden source follows the caller, as an empty function setting does. */
export function resolveAnalysisTarget(kind: 'maps' | 'article', fallback: string): string {
  const target = config.linkAnalysis?.[kind === 'maps' ? 'mapsTargetUrl' : 'articleTargetUrl']?.trim() ?? '';
  if (!target || isModelUrlHidden(target, getHiddenSources())) return fallback;
  const keyId = byokIdFromUrl(target);
  if (keyId !== null) return config.byokInstances.some((key) => key.id === keyId) ? target : fallback;
  const groupId = byokGroupIdFromUrl(target);
  if (groupId !== null) {
    const group = config.byokGroups.find((entry) => entry.id === groupId);
    return group?.memberIds.some((id) => config.byokInstances.some((key) => key.id === id)) ? target : fallback;
  }
  return isByokTargetUrl(target) ? fallback : target;
}

/**
 * A model the analysis settings may store: empty (follow the caller), a built-in web provider, or
 * a BYOK key or group that exists. The value already stored stays acceptable after its key is
 * removed, so editing the prompt does not fail on that choice; `resolveAnalysisTarget` skips it.
 */
export function isSelectableAnalysisTarget(target: string, stored = ''): boolean {
  if (!target || target === stored) return true;
  const keyId = byokIdFromUrl(target);
  if (keyId !== null) return config.byokInstances.some((key) => key.id === keyId);
  const groupId = byokGroupIdFromUrl(target);
  if (groupId !== null) return config.byokGroups.some((group) => group.id === groupId);
  return (Object.values(PROVIDER_URLS) as string[]).includes(target);
}

/** Only the built-in post analysis buttons use the article override; saved flows keep their choices. */
export function buildBuiltinWithAnalysisTarget(entry: BuiltinEntry, context: BuiltinBuildContext): FlowDefinition {
  const flow = entry.build(context);
  if (entry.action !== 'analyze' && entry.action !== 'analyzeChat') return flow;
  const target = resolveAnalysisTarget('article', '');
  if (!target) return flow;
  return {
    ...flow,
    steps: flow.steps.map((step) => step.type === 'llm' ? { ...step, config: { ...step.config, provider: target } } : step),
  };
}
