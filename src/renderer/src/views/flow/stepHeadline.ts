import { isCodeSummary, llmProviderLabel, summarizeStep, type NamedModel } from './flowCapabilities';
import type { SkillInstance } from '../../../../shared/types';

export interface StepHeadline {
  /** The step's own name, or what it is set to do when it has none. Empty when it has neither. */
  title: string;
  /** What it is set to do, under a name the user gave it; empty otherwise. */
  detail: string;
  /** The summary is code or a target (a URL, a path) and is read character by character. */
  titleIsCode: boolean;
  detailIsCode: boolean;
}

/**
 * The one line a collapsed step card reads as. A new step's label is the skill's own name, which
 * the card's badge already shows, so only a name the user changed counts as a name; otherwise the
 * summary of its settings (the same one the import preview shows) stands in for it.
 */
export function stepHeadline(
  step: SkillInstance,
  t: (key: string) => string,
  models: readonly NamedModel[] = [],
): StepHeadline {
  const label = step.label.trim();
  const named = label !== '' && label !== t(`flow.skill.${step.type}`);
  const settings = summarizeStep(step.type, step.config);
  const provider = step.type === 'llm' ? llmProviderLabel(step.config.provider, models, t('flow.step.byokProvider')) : '';
  const summary = provider && settings ? `${provider} · ${settings}` : settings || provider;
  const code = isCodeSummary(step.type) && !provider;
  if (named) return { title: label, detail: summary, titleIsCode: false, detailIsCode: code };
  return { title: summary, detail: '', titleIsCode: code, detailIsCode: false };
}
