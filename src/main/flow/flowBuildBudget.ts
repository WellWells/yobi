import { REPAIR_EXCERPT_MAX_CHARS } from '../../shared/flowSkillSchema';
import { preparePromptForProvider } from '../providers';

/** Builds one attempt's prompt quoting at most `excerptMax` chars of the rejected reply. */
export type RepairPromptBuilder = (excerptMax: number) => string;

function fits(prompt: string, providerUrl: string): boolean {
  return !preparePromptForProvider(prompt, providerUrl).truncated;
}

/**
 * The longest excerpt, up to `REPAIR_EXCERPT_MAX_CHARS`, at which a repair prompt still fits the
 * provider; null when even quoting nothing does not. A repair carries the whole first prompt plus
 * the rejected reply, so on the widest skill selection the full excerpt is what tips it over the
 * cap: quoting less keeps the retry instead of giving the build up.
 */
export function fitRepairExcerpt(build: RepairPromptBuilder, providerUrl: string): number | null {
  if (fits(build(REPAIR_EXCERPT_MAX_CHARS), providerUrl)) return REPAIR_EXCERPT_MAX_CHARS;
  if (!fits(build(0), providerUrl)) return null;
  // `fitting` always fits and `over` never does; the prompt only grows with the excerpt.
  let fitting = 0;
  let over = REPAIR_EXCERPT_MAX_CHARS;
  while (over - fitting > 1) {
    const middle = Math.floor((fitting + over) / 2);
    if (fits(build(middle), providerUrl)) fitting = middle;
    else over = middle;
  }
  return fitting;
}
