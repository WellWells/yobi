import { PROVIDER_LABELS, PROVIDER_URLS } from '../../../../shared/types';
import { isShareLinkFormat } from '../../../../shared/shareFormat';
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
  | 'thirdPartyAi';

export type FlowSetup = 'bot' | 'email';

const RISK_BY_SKILL: Partial<Record<SkillType, FlowRisk>> = {
  shell: 'execute',
  run: 'execute',
  js: 'execute',
  browser_js: 'execute',
  power: 'system',
  restart_app: 'system',
  file_delete: 'delete',
};

const ACCESS_BY_SKILL: Partial<Record<SkillType, FlowAccess>> = {
  file_read: 'readFiles',
  file_list: 'readFiles',
  file_write: 'writeFiles',
  file_download: 'writeFiles',
  capture: 'screen',
  clipboard: 'clipboard',
  http: 'sendData',
  bot: 'sendData',
  email_send: 'sendData',
  llm: 'thirdPartyAi',
  research: 'thirdPartyAi',
};

/*
 * A share step writes a file OR uploads to a third-party paste service, depending on its
 * format — one of them is a very different disclosure from the other. When the format is an
 * unresolved {{variable}} both are declared: this list is what the import trust gate shows
 * the user, and there it is always better to over-disclose than to under-disclose.
 */
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
  'readFiles', 'writeFiles', 'screen', 'clipboard', 'sendData', 'thirdPartyAi',
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
}

export function analyzeFlow(flow: FlowDefinition): FlowCapabilities {
  const riskSteps = new Map<FlowRisk, number[]>();
  const access = new Set<FlowAccess>();
  const setup = new Set<FlowSetup>();

  flow.steps.forEach((step, index) => {
    const risk = RISK_BY_SKILL[step.type];
    if (risk) {
      const list = riskSteps.get(risk) ?? [];
      list.push(index + 1);
      riskSteps.set(risk, list);
    }
    for (const kind of accessKindsFor(step)) access.add(kind);
    if (step.type === 'bot') setup.add('bot');
    if (step.type === 'email_send') setup.add('email');
  });

  for (const trigger of [flow.trigger, ...(flow.extraTriggers ?? [])]) {
    if (trigger.type === 'bot') setup.add('bot');
  }

  return {
    risks: FLOW_RISKS.filter((kind) => riskSteps.has(kind))
      .map((kind) => ({ kind, steps: riskSteps.get(kind) ?? [] })),
    access: FLOW_ACCESS.filter((kind) => access.has(kind)),
    setup: [...setup],
    hasRisk: riskSteps.size > 0,
  };
}

export function analyzeFlows(flows: FlowDefinition[]): boolean {
  return flows.some((flow) => analyzeFlow(flow).hasRisk);
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
  youtube: ['url'],
  youtube_subs: ['channels'],
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
  loop: ['input'],
  if: ['left', 'operator', 'right'],
  on_change: ['value'],
  delay: ['delayMs'],
  comment: ['note'],
};

export function summarizeStep(type: SkillType, config: Record<string, string>): string {
  const keys = SUMMARY_KEYS[type] ?? Object.keys(config).slice(0, 1);
  const parts = keys
    .map((key) => (config[key] ?? '').trim())
    .filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ');
}
