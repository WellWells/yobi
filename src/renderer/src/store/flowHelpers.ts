import type { FlowDefinition, SkillInstance, SkillType } from '../../../shared/types';
import { DEFAULT_SKILL_CONFIG, SKILLS_WITHOUT_OUTPUT_KEY } from '../../../shared/flowSkillSchema';

export const DEFAULT_OUTPUT_BASE: Partial<Record<SkillType, string>> = {
  browser_open: 'tab',
  forex: 'currency',
  random: 'rand',
};

export function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultStep(type: SkillType = 'shell', outputKey?: string, t: (key: string) => string = (k) => k): SkillInstance {
  const id = createId();
  const config = { ...DEFAULT_SKILL_CONFIG[type] };
  const labelMap: Record<SkillType, string> = {
    shell: t('agentflow.skill.shell'),
    run: t('agentflow.skill.run'),
    js: t('agentflow.skill.js'),
    browser: t('agentflow.skill.browser'),
    browser_open: t('agentflow.skill.browser_open'),
    browser_js: t('agentflow.skill.browser_js'),
    browser_close: t('agentflow.skill.browser_close'),
    llm: t('agentflow.skill.llm'),
    clipboard: t('agentflow.skill.clipboard'),
    delay: t('agentflow.skill.delay'),
    notify: t('agentflow.skill.notify'),
    capture: t('agentflow.skill.capture'),
    bot: t('agentflow.skill.bot'),
    rss: t('agentflow.skill.rss'),
    stop: t('agentflow.skill.stop'),
    comment: t('agentflow.skill.comment'),
    scraper: t('agentflow.skill.scraper'),
    loop: t('agentflow.skill.loop'),
    end_loop: t('agentflow.skill.end_loop'),
    if: t('agentflow.skill.if'),
    end_if: t('agentflow.skill.end_if'),
    break: t('agentflow.skill.break'),
    continue: t('agentflow.skill.continue'),
    sysinfo: t('agentflow.skill.sysinfo'),
    http: t('agentflow.skill.http'),
    youtube: t('agentflow.skill.youtube'),
    youtube_subs: t('agentflow.skill.youtube_subs'),
    power: t('agentflow.skill.power'),
    restart_app: t('agentflow.skill.restart_app'),
    file_write: t('agentflow.skill.file_write'),
    file_read: t('agentflow.skill.file_read'),
    file_list: t('agentflow.skill.file_list'),
    file_delete: t('agentflow.skill.file_delete'),
    file_download: t('agentflow.skill.file_download'),
    email_send: t('agentflow.skill.email_send'),
    text: t('agentflow.skill.text'),
    stock: t('agentflow.skill.stock'),
    forex: t('agentflow.skill.forex'),
    weather: t('agentflow.skill.weather'),
    random: t('agentflow.skill.random'),
  };
  const noOutputKey = SKILLS_WITHOUT_OUTPUT_KEY.includes(type);
  return {
    id,
    type,
    label: labelMap[type],
    config,
    outputKey: outputKey ?? (noOutputKey ? '' : `${type}_1`),
  };
}

export function createDefaultFlow(t: (key: string) => string = (k) => k): FlowDefinition {
  return {
    id: createId(),
    name: t('agentflow.newFlow'),
    description: t('agentflow.newFlow.desc'),
    enabled: true,
    trigger: { type: 'manual' },
    steps: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function cloneFlow(flow: FlowDefinition): FlowDefinition {
  return JSON.parse(JSON.stringify(flow)) as FlowDefinition;
}

export function findMatchingMarker(steps: SkillInstance[], index: number): number {
  const type = steps[index]?.type;
  const pair: Partial<Record<SkillType, { other: SkillType; dir: 1 | -1 }>> = {
    loop: { other: 'end_loop', dir: 1 },
    if: { other: 'end_if', dir: 1 },
    end_loop: { other: 'loop', dir: -1 },
    end_if: { other: 'if', dir: -1 },
  };
  const entry = type ? pair[type] : undefined;
  if (!type || !entry) return -1;
  let depth = 1;
  for (let j = index + entry.dir; j >= 0 && j < steps.length; j += entry.dir) {
    if (steps[j].type === type) depth++;
    else if (steps[j].type === entry.other) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}
