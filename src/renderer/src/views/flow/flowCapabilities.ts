import { PROVIDER_LABELS, PROVIDER_URLS } from '../../../../shared/types';
import { isShareLinkFormat } from '../../../../shared/shareFormat';
import { storedMcpAccess } from '../../../../shared/mcpFlowStep';
import type { FlowDefinition, Provider, SkillInstance, SkillType } from '../../../../shared/types';

export type FlowRisk =
  | 'execute'
  | 'system'
  | 'delete';

export type FlowAccess =
  | 'readFiles'
  | 'writeFiles'
  | 'screen'
  | 'clipboard'
  | 'sendData'
  | 'thirdPartyAi'
  /** Reading the user's own LINE conversations. Not 'readFiles': "reads files" understates it. */
  | 'lineMessages'
  /** Reading the Telegram group talk the bot kept: other people's words, not the user's files. */
  | 'telegramMessages'
  /** Reading one of the user's own calendars (its subscribed .ics address stays in Settings). */
  | 'calendar'
  /** Reading the user's own mailbox (the account stays on the Mail connector). */
  | 'mail';

export type FlowSetup = 'bot' | 'email' | 'line';

const RISK_BY_SKILL: Partial<Record<SkillType, FlowRisk>> = {
  shell: 'execute',
  run: 'execute',
  js: 'execute',
  browser_js: 'execute',
  power: 'system',
  restart_app: 'system',
  file_delete: 'delete',
};

/**
 * A connector step is only as risky as its tool: one picked as deleting is `delete`, which locks
 * the import button like a file delete. The access is stored with the step at pick time, so this
 * works on a flow from another computer; a run re-checks the live tool and refuses a delete the
 * step was not saved as (`mcpStepRefusal`).
 */
function riskFor(step: SkillInstance): FlowRisk | undefined {
  if (step.type === 'mcp') return storedMcpAccess(step.config.access) === 'delete' ? 'delete' : undefined;
  return RISK_BY_SKILL[step.type];
}

const ACCESS_BY_SKILL: Partial<Record<SkillType, FlowAccess>> = {
  file_read: 'readFiles',
  file_list: 'readFiles',
  file_write: 'writeFiles',
  file_download: 'writeFiles',
  youtube_download: 'writeFiles',
  x_media: 'writeFiles',
  capture: 'screen',
  clipboard: 'clipboard',
  http: 'sendData',
  bot: 'sendData',
  email_send: 'sendData',
  // Its arguments go to the connector's server, whatever the tool does with them.
  mcp: 'sendData',
  llm: 'thirdPartyAi',
  research: 'thirdPartyAi',
  line_read: 'lineMessages',
  telegram_read: 'telegramMessages',
  calendar: 'calendar',
  mail_fetch: 'mail',
};

function accessKindsFor(step: SkillInstance): FlowAccess[] {
  if (step.type !== 'share') {
    const kind = ACCESS_BY_SKILL[step.type];
    return kind ? [kind] : [];
  }
  const format = (step.config.format ?? '').trim();
  if (format.includes('{{')) return ['writeFiles', 'sendData'];
  return isShareLinkFormat(format) ? ['sendData'] : ['writeFiles'];
}

export const FLOW_RISKS: readonly FlowRisk[] = ['execute', 'system', 'delete'] as const;
export const FLOW_ACCESS: readonly FlowAccess[] = [
  'readFiles', 'writeFiles', 'screen', 'clipboard', 'sendData', 'thirdPartyAi', 'lineMessages', 'telegramMessages', 'calendar', 'mail',
] as const;

export function llmProviderLabel(providerUrl: string | undefined): string {
  const url = (providerUrl ?? '').trim();
  if (!url) return '';
  for (const key of Object.keys(PROVIDER_URLS) as Provider[]) {
    if (PROVIDER_URLS[key] === url) return PROVIDER_LABELS[key];
  }
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export interface RiskGroup {
  kind: FlowRisk;
  steps: number[];
}

export interface FlowCapabilities {
  risks: RiskGroup[];
  access: FlowAccess[];
  setup: FlowSetup[];
  hasRisk: boolean;
  /** Folders whose new files start the flow by themselves (file triggers). */
  watchFolders: string[];
}

export function analyzeFlow(flow: FlowDefinition): FlowCapabilities {
  const riskSteps = new Map<FlowRisk, number[]>();
  const access = new Set<FlowAccess>();
  const setup = new Set<FlowSetup>();

  flow.steps.forEach((step, index) => {
    const risk = riskFor(step);
    if (risk) {
      const list = riskSteps.get(risk) ?? [];
      list.push(index + 1);
      riskSteps.set(risk, list);
    }
    for (const kind of accessKindsFor(step)) access.add(kind);
    if (step.type === 'bot' || step.type === 'telegram_read') setup.add('bot');
    if (step.type === 'email_send' || step.type === 'mail_fetch') setup.add('email');
    if (step.type === 'line_read') setup.add('line');
  });

  const watchFolders: string[] = [];
  for (const trigger of [flow.trigger, ...(flow.extraTriggers ?? [])]) {
    if (trigger.type === 'bot') setup.add('bot');
    // A folder trigger hands every new file in it to the steps, without anyone pressing Run.
    if (trigger.type === 'file') {
      access.add('readFiles');
      const folder = (trigger.watchFolder ?? '').trim();
      if (folder && !watchFolders.includes(folder)) watchFolders.push(folder);
    }
  }

  return {
    risks: FLOW_RISKS.filter((kind) => riskSteps.has(kind))
      .map((kind) => ({ kind, steps: riskSteps.get(kind) ?? [] })),
    access: FLOW_ACCESS.filter((kind) => access.has(kind)),
    setup: [...setup],
    hasRisk: riskSteps.size > 0,
    watchFolders,
  };
}

const SUMMARY_KEYS: Partial<Record<SkillType, string[]>> = {
  shell: ['command'],
  run: ['path', 'args'],
  js: ['code'],
  browser_js: ['code'],
  browser: ['url'],
  browser_open: ['url'],
  http: ['method', 'url'],
  rss: ['url'],
  scraper: ['url'],
  search: ['query'],
  research: ['query'],
  gmap_reviews: ['url'],
  line_read: ['chat', 'query'],
  telegram_read: ['chat', 'range'],
  mcp: ['tool', 'arguments'],
  youtube: ['url'],
  youtube_subs: ['channels'],
  youtube_info: ['input'],
  youtube_download: ['url', 'quality'],
  x_posts: ['accounts'],
  x_thread: ['url'],
  x_trends: ['maxItems'],
  x_media: ['input'],
  ptt_board: ['board', 'keyword'],
  llm: ['prompt'],
  bot: ['message'],
  email_send: ['to', 'subject'],
  file_read: ['path'],
  file_write: ['filename', 'folder'],
  share: ['format', 'title'],
  file_delete: ['path'],
  file_download: ['url'],
  file_list: ['directory'],
  notify: ['message'],
  text: ['text'],
  power: ['action'],
  clipboard: ['action'],
  stock: ['symbol'],
  weather: ['location'],
  air_quality: ['location'],
  calendar: ['range'],
  mail_fetch: ['from', 'keywords'],
  almanac: ['date', 'activity'],
  tw_invoice: ['numbers', 'period'],
  loop: ['input'],
  if: ['left', 'operator', 'right'],
  on_change: ['value'],
  delay: ['delayMs'],
  comment: ['note'],
};

/** Steps whose summary and output are code or console text, read character by character. */
const CODE_SKILLS: ReadonlySet<SkillType> = new Set<SkillType>(['shell', 'run', 'js', 'browser_js']);

/** Summaries that are a target — URL or path — where I/l and 0/O lookalikes must stay apart. */
const TARGET_SUMMARY_SKILLS: ReadonlySet<SkillType> = new Set<SkillType>([
  'browser', 'browser_open', 'http', 'rss', 'scraper', 'gmap_reviews', 'youtube', 'x_thread',
  'youtube_download', 'file_download', 'file_read', 'file_delete', 'file_list', 'file_write',
]);

// A bracket followed by what JSON can hold there, so "[Note] … [1][2]" stays prose.
const JSON_START = /^\s*(?:\[\s*[[{"\d\]-]|\{\s*["}])/;
const JSON_END = /[\]}]\s*$/;

/** Monospace is for code, targets and structured data; prompts, messages and answers stay in the UI face. */
export function isCodeSummary(type: SkillType): boolean {
  return CODE_SKILLS.has(type) || TARGET_SUMMARY_SKILLS.has(type);
}

export function isCodeOutput(type: SkillType, output: string): boolean {
  if (CODE_SKILLS.has(type)) return true;
  if (/^\s*</.test(output)) return true;
  return JSON_START.test(output) && JSON_END.test(output);
}

export function summarizeStep(type: SkillType, config: Record<string, string>): string {
  const keys = SUMMARY_KEYS[type] ?? Object.keys(config).slice(0, 1);
  const parts = keys
    .map((key) => (config[key] ?? '').trim())
    .filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ');
}
