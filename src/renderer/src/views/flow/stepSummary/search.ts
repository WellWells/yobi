import type { SkillInstance } from '../../../../../shared/types';
import { isNamed, t } from './core';
import { stepSummary } from './summary';
import type { StepSummaryContext } from './types';

export type StepSearchField = 'name' | 'type' | 'output' | 'summary' | 'prompt' | 'code' | 'url' | 'message' | 'setting';

export interface StepSearchEntry {
  field: StepSearchField;
  text: string;
  /**
   * The outline may quote the text around a hit ("提示詞：…重點整理…"). False for code: a hit
   * there says only which field matched, since code holds passwords and tokens.
   */
  excerpt: boolean;
}

const FIELD_OF: Readonly<Record<string, StepSearchField>> = {
  prompt: 'prompt',
  code: 'code',
  command: 'code',
  url: 'url',
  urls: 'url',
  channels: 'url',
  accounts: 'url',
  message: 'message',
  title: 'message',
  body: 'message',
  subject: 'message',
  text: 'message',
  note: 'message',
  content: 'message',
};

/**
 * Never searched: HTTP headers and body carry tokens, chats and calendars are stored as IDs,
 * receipt numbers are personal, connector arguments may hold keys, and the rest is plumbing.
 */
const NOT_SEARCHED = new Set([
  'headers', 'chatIds', 'chatId', 'chat', 'calendar', 'numbers', 'arguments', 'access', 'provider',
  'fallbackProvider', 'reader', 'palette', 'backgroundStyle', 'attachmentType',
]);

/**
 * What the outline's search matches a step on: its name, its type (in the interface language
 * and as the type code), its output name, its summary, and its settings. The `field` lets a hit
 * say why the row matched.
 */
export function stepSearchText(step: SkillInstance, ctx: StepSummaryContext): StepSearchEntry[] {
  const entries: StepSearchEntry[] = [];
  if (isNamed(step, ctx.t)) entries.push({ field: 'name', text: step.label.trim(), excerpt: true });
  entries.push({ field: 'type', text: `${t(ctx, `flow.skill.${step.type}`)} ${step.type}`, excerpt: true });
  if (step.outputKey) entries.push({ field: 'output', text: `{{${step.outputKey}}}`, excerpt: true });
  const summary = stepSummary(step, ctx);
  entries.push({ field: 'summary', text: [summary.primary, summary.secondary].filter(Boolean).join(' · '), excerpt: true });
  for (const [key, raw] of Object.entries(step.config)) {
    const text = raw.trim();
    if (!text || NOT_SEARCHED.has(key) || text === 'true' || text === 'false') continue;
    if (step.type === 'http' && key === 'body') continue;
    const field = FIELD_OF[key] ?? 'setting';
    // An API's query string is where its key rides (`?key=…`): searched, never quoted.
    const quotable = field !== 'code' && !(step.type === 'http' && key === 'url' && /[?#]/.test(text));
    entries.push({ field, text, excerpt: quotable });
  }
  return entries;
}
