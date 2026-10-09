import type { FlowDefinition, SkillInstance, SkillType } from '../../../shared/types';
import { DEFAULT_SKILL_CONFIG, SKILLS_WITHOUT_OUTPUT_KEY } from '../../../shared/flowSkillSchema';

export const DEFAULT_OUTPUT_BASE: Partial<Record<SkillType, string>> = {
  browser_open: 'tab',
  forex: 'currency',
  random: 'rand',
  on_change: 'changed',
};

export function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultStep(type: SkillType = 'shell', outputKey?: string, t: (key: string) => string = (k) => k): SkillInstance {
  const id = createId();
  const config = { ...DEFAULT_SKILL_CONFIG[type] };
  const labelMap: Record<SkillType, string> = {
    shell: t('flow.skill.shell'),
    run: t('flow.skill.run'),
    js: t('flow.skill.js'),
    browser: t('flow.skill.browser'),
    browser_open: t('flow.skill.browser_open'),
    browser_js: t('flow.skill.browser_js'),
    browser_close: t('flow.skill.browser_close'),
    llm: t('flow.skill.llm'),
    clipboard: t('flow.skill.clipboard'),
    delay: t('flow.skill.delay'),
    notify: t('flow.skill.notify'),
    capture: t('flow.skill.capture'),
    share: t('flow.skill.share'),
    bot: t('flow.skill.bot'),
    rss: t('flow.skill.rss'),
    stop: t('flow.skill.stop'),
    comment: t('flow.skill.comment'),
    scraper: t('flow.skill.scraper'),
    search: t('flow.skill.search'),
    research: t('flow.skill.research'),
    gmap_reviews: t('flow.skill.gmap_reviews'),
    line_read: t('flow.skill.line_read'),
    loop: t('flow.skill.loop'),
    end_loop: t('flow.skill.end_loop'),
    if: t('flow.skill.if'),
    end_if: t('flow.skill.end_if'),
    on_change: t('flow.skill.on_change'),
    break: t('flow.skill.break'),
    continue: t('flow.skill.continue'),
    sysinfo: t('flow.skill.sysinfo'),
    http: t('flow.skill.http'),
    youtube: t('flow.skill.youtube'),
    youtube_subs: t('flow.skill.youtube_subs'),
    x_posts: t('flow.skill.x_posts'),
    x_thread: t('flow.skill.x_thread'),
    x_trends: t('flow.skill.x_trends'),
    power: t('flow.skill.power'),
    restart_app: t('flow.skill.restart_app'),
    file_write: t('flow.skill.file_write'),
    file_read: t('flow.skill.file_read'),
    file_list: t('flow.skill.file_list'),
    file_delete: t('flow.skill.file_delete'),
    file_download: t('flow.skill.file_download'),
    email_send: t('flow.skill.email_send'),
    text: t('flow.skill.text'),
    stock: t('flow.skill.stock'),
    forex: t('flow.skill.forex'),
    weather: t('flow.skill.weather'),
    air_quality: t('flow.skill.air_quality'),
    random: t('flow.skill.random'),
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
    name: t('flow.newFlow'),
    description: t('flow.newFlow.desc'),
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

/** The first `${base}_${n}` (n counting up from `start`) that no step's outputKey already uses. */
export function nextFreeOutputKey(base: string, steps: SkillInstance[], start: number): string {
  const taken = new Set(steps.map((s) => s.outputKey?.trim()).filter(Boolean));
  let n = Math.max(1, start);
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Where a new step goes: before a trailing end_loop/end_if (inside that block), else at the end. */
export function stepInsertIndex(steps: SkillInstance[]): number {
  const last = steps[steps.length - 1];
  return last && (last.type === 'end_loop' || last.type === 'end_if') ? steps.length - 1 : steps.length;
}

// Steps that have a key but never produce a list worth looping over, plus every step with no output.
const NON_LOOP_SOURCES: ReadonlySet<SkillType> = new Set<SkillType>(['clipboard', 'bot', 'loop', ...SKILLS_WITHOUT_OUTPUT_KEY]);

/**
 * The step a new loop should read: the nearest step before `before` that has a real outputKey.
 * A closed loop's body is jumped over — its keys no longer exist after its end_loop.
 */
export function findLoopSource(steps: SkillInstance[], before: number): SkillInstance | undefined {
  for (let i = Math.min(before, steps.length) - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === 'end_loop') {
      const open = findMatchingMarker(steps, i);
      if (open >= 0) i = open;
      continue;
    }
    if (NON_LOOP_SOURCES.has(step.type) || !step.outputKey?.trim()) continue;
    return step;
  }
  return undefined;
}

// Fields only main writes; the editor never edits them, so main's value always wins.
const MAIN_OWNED_FIELDS: ReadonlySet<string> = new Set(['updatedAt']);

/**
 * Lays main's reply to a save over the editor copy. A top-level field the user changed after the
 * request was sent keeps the user's edit (the flow then stays unsaved); every other field takes
 * main's copy, so normalization and a forced `enabled: false` still land.
 */
export function mergeSaveReply(current: FlowDefinition, sent: FlowDefinition, saved: FlowDefinition): FlowDefinition {
  const cur = current as unknown as Record<string, unknown>;
  const req = sent as unknown as Record<string, unknown>;
  const reply = saved as unknown as Record<string, unknown>;
  const keys = [...Object.keys(reply), ...Object.keys(cur).filter((k) => !(k in reply))];
  const merged: Record<string, unknown> = {};
  for (const key of keys) {
    const edited = !MAIN_OWNED_FIELDS.has(key) && JSON.stringify(cur[key]) !== JSON.stringify(req[key]);
    const value = edited ? cur[key] : reply[key];
    if (value !== undefined) merged[key] = value;
  }
  return merged as unknown as FlowDefinition;
}
