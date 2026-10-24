import { FLOW_VAR_PREFIX } from './flowVariables';
import { escapeRegExp } from './regex';
import { isHttpUrl } from './webUrl';
import type { FlowVariable, SkillInstance } from './types';

/** One feed entry as the rss step reads it: the step's own title fallback, ISO date when the feed has one. */
export interface FeedPreviewItem {
  title: string;
  link: string;
  date?: string;
}

/**
 * What the setup preview shows. `empty.notFeed` marks an address that answered with a web page
 * (a homepage pasted where the feed goes); `cancelled` is a read replaced by a newer one.
 */
export type FeedPreviewResult =
  | { status: 'items'; items: FeedPreviewItem[] }
  | { status: 'empty'; notFeed: boolean }
  | { status: 'error'; message: string }
  | { status: 'cancelled' };

/** `slot` names the field asking: a newer read for the same slot stops the one before it. */
export interface FeedPreviewRequest {
  url: string;
  slot: string;
}

/**
 * Whether an `rss` step reads this variable as its whole address (`{{var.key}}`, spaces inside
 * the braces allowed). An address built around the variable is not previewed: the preview would
 * read a different URL from the one the step reads.
 */
export function variableFeedsRssStep(steps: readonly SkillInstance[], key: string): boolean {
  if (!key) return false;
  const whole = new RegExp(`^\\{\\{\\s*${FLOW_VAR_PREFIX}\\.${escapeRegExp(key)}\\s*\\}\\}$`);
  return steps.some((step) => step.type === 'rss' && whole.test((step.config.url ?? '').trim()));
}

/** `feed` variables always preview; `url` ones only when an rss step reads them as they are. */
export function showsFeedPreview(variable: FlowVariable, steps: readonly SkillInstance[]): boolean {
  if (variable.type === 'feed') return true;
  return variable.type === 'url' && variableFeedsRssStep(steps, variable.key);
}

/** An address the preview reads: http(s) with nothing left to fill in. */
export function isPreviewableFeedUrl(raw: string): boolean {
  const trimmed = raw.trim();
  return !trimmed.includes('{{') && isHttpUrl(trimmed);
}
