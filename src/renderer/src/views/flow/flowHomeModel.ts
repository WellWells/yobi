import type { FlowDefinition, TriggerConfig, TriggerType } from '../../../../shared/types';
import type { FlowFolder } from '../../../../shared/flowFolders';
import { comboLabel } from '../../../../shared/shortcuts';
import { describeSchedule } from '../../../../shared/flowScheduleSummary';
import { FLOW_TEMPLATES } from './examples';
import type { FlowTemplate } from './examples';

/**
 * The flow page with no flow open: the user's flows as cards (search, filter, sort, grouped by
 * category) and, before there are any, a few templates to start from. Pure, so the page stays a
 * layout over these.
 */

export type FlowHomeStatus = 'all' | 'enabled' | 'disabled';

export interface FlowHomeFilter {
  status: FlowHomeStatus;
  /** Any of these ways to start; empty = every flow. */
  kinds: readonly TriggerType[];
}

export type FlowHomeSort = 'order' | 'name' | 'lastRun';

export interface FlowHomeGroup {
  /** The category; null = flows in none (or no grouping at all). */
  name: string | null;
  flows: FlowDefinition[];
}

/**
 * One per gallery rail, for someone with no flows yet: each needs little setup and no account a
 * new user may not have (the fewest-questions pick of some rails is a LINE or Taiwan-only one).
 */
export const FEATURED_TEMPLATE_KEYS = [
  'sel_translate', 'file_summary', 'morning_brief', 'page_change', 'telegram_digest', 'cmd_ask',
] as const;

export function featuredTemplates(templates: readonly FlowTemplate[] = FLOW_TEMPLATES): FlowTemplate[] {
  return FEATURED_TEMPLATE_KEYS.flatMap((key) => templates.find((tpl) => tpl.key === key) ?? []);
}

export function triggerKindsOf(flow: FlowDefinition): TriggerType[] {
  return [...new Set([flow.trigger.type, ...(flow.extraTriggers ?? []).map((trigger) => trigger.type)])];
}

function searchable(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

export function filterFlows(flows: readonly FlowDefinition[], query: string, filter: FlowHomeFilter): FlowDefinition[] {
  const terms = searchable(query).split(/\s+/).filter(Boolean);
  return flows.filter((flow) => {
    if (filter.status === 'enabled' && !flow.enabled) return false;
    if (filter.status === 'disabled' && flow.enabled) return false;
    if (filter.kinds.length > 0 && !triggerKindsOf(flow).some((kind) => filter.kinds.includes(kind))) return false;
    if (terms.length === 0) return true;
    const text = searchable(`${flow.name} ${flow.description ?? ''}`);
    return terms.every((term) => text.includes(term));
  });
}

/** `lastRunAt`: when a flow last ran (ms); flows that have not stay last, in their order. */
export function sortFlows(
  flows: readonly FlowDefinition[],
  sort: FlowHomeSort,
  lastRunAt: (flowId: string) => number | undefined,
  compare: (a: string, b: string) => number,
): FlowDefinition[] {
  if (sort === 'name') return [...flows].sort((a, b) => compare(a.name, b.name));
  if (sort === 'lastRun') {
    return [...flows].sort((a, b) => (lastRunAt(b.id) ?? -Infinity) - (lastRunAt(a.id) ?? -Infinity));
  }
  return [...flows];
}

/** By category in the sidebar's order (by name), the uncategorized last; no grouping when nothing shown is in one. */
export function groupByCategory(
  flows: readonly FlowDefinition[],
  folders: readonly FlowFolder[],
  compareNames: (a: string, b: string) => number,
): FlowHomeGroup[] {
  const homeOf = new Map<string, string>();
  for (const folder of folders) for (const id of folder.flowIds) homeOf.set(id, folder.name);
  if (!flows.some((flow) => homeOf.has(flow.id))) return [{ name: null, flows: [...flows] }];
  const names = [...new Set(flows.flatMap((flow) => homeOf.get(flow.id) ?? []))].sort(compareNames);
  const groups: FlowHomeGroup[] = names.map((name) => ({ name, flows: flows.filter((flow) => homeOf.get(flow.id) === name) }));
  const rest = flows.filter((flow) => !homeOf.has(flow.id));
  return rest.length > 0 ? [...groups, { name: null, flows: rest }] : groups;
}

function folderName(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).pop() ?? '';
}

/** How the flow starts, in a few characters: the keys, the command, the folder, the schedule, or its kind. */
export function triggerFact(trigger: TriggerConfig, t: (key: string) => string, mac: boolean): string {
  const kind = t(`flow.trigger.${trigger.type}`);
  if (trigger.type === 'hotkey') return trigger.keys ? comboLabel(trigger.keys, mac) : kind;
  if (trigger.type === 'chat') return trigger.chatCommand ? `/${trigger.chatCommand}` : kind;
  if (trigger.type === 'bot') return trigger.botCommand ? `/${trigger.botCommand}` : kind;
  if (trigger.type === 'file') return folderName(trigger.watchFolder ?? '') || kind;
  if (trigger.type === 'cron') return describeSchedule(trigger, t) || kind;
  return kind;
}
