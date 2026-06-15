import type { FlowGenerationResult, SkillInstance, SkillType, TriggerConfig } from './types';
import {
  DEFAULT_SKILL_CONFIG,
  SKILL_SPECS,
  SKILL_TYPES,
  SKILLS_WITHOUT_OUTPUT_KEY,
} from './flowSkillSchema';
import { parseCronToScheduleFields } from './flowSchedule';

type StepValidationResult =
  | { ok: true; step: SkillInstance }
  | { ok: false; error: string };

const REQUIRED_KEYS: Partial<Record<SkillType, string[]>> = Object.fromEntries(
  SKILL_SPECS.map((spec) => [spec.type, spec.fields.filter((f) => f.required).map((f) => f.key)]),
);

function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function extractJsonFromLlmResponse(text: string): unknown | null {
  if (!text) return null;
  let body = text.trim();

  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) body = fence[1].trim();

  const direct = tryParse(body);
  if (direct !== undefined) return direct;

  const firstObj = body.indexOf('{');
  const firstArr = body.indexOf('[');
  if (firstObj === -1 && firstArr === -1) return null;
  const useObj = firstArr === -1 || (firstObj !== -1 && firstObj < firstArr);
  const start = useObj ? firstObj : firstArr;
  const end = body.lastIndexOf(useObj ? '}' : ']');
  if (end <= start) return null;

  const parsed = tryParse(body.slice(start, end + 1));
  return parsed === undefined ? null : parsed;
}

function coerceString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function unwrapMarkdownLink(value: string): string {
  const match = value.trim().match(/^\[[^\]]*\]\((\S+?)\)$/);
  return match ? match[1].trim() : value;
}

function unwrapFlow(obj: Record<string, unknown>): Record<string, unknown> {
  if (obj.flow && typeof obj.flow === 'object' && !Array.isArray(obj.flow)) {
    return obj.flow as Record<string, unknown>;
  }
  return obj;
}

function validateStep(raw: unknown, index: number): StepValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: `Step ${index + 1} is not an object` };
  }
  const s = raw as Record<string, unknown>;
  const type = s.type;
  if (typeof type !== 'string' || !SKILL_TYPES.includes(type as SkillType)) {
    return { ok: false, error: `Step ${index + 1} has unknown type "${String(type)}"` };
  }
  const skillType = type as SkillType;

  const config: Record<string, string> = { ...DEFAULT_SKILL_CONFIG[skillType] };
  if (typeof s.config === 'object' && s.config !== null) {
    for (const [key, value] of Object.entries(s.config as Record<string, unknown>)) {
      if (key in config) config[key] = unwrapMarkdownLink(coerceString(value));
    }
  }

  for (const key of REQUIRED_KEYS[skillType] ?? []) {
    if (!(config[key] ?? '').trim()) {
      return { ok: false, error: `Step ${index + 1} ("${skillType}") is missing required "${key}"` };
    }
  }

  const noOutput = SKILLS_WITHOUT_OUTPUT_KEY.includes(skillType);
  const outputKey = noOutput
    ? ''
    : (typeof s.outputKey === 'string' && s.outputKey.trim() ? s.outputKey.trim() : `${skillType}_${index + 1}`);
  const label = typeof s.label === 'string' && s.label.trim() ? s.label.trim() : skillType;

  return { ok: true, step: { id: '', type: skillType, label, config, outputKey } };
}

function checkBlockBalance(steps: SkillInstance[]): string | null {
  let loopDepth = 0;
  let ifDepth = 0;
  for (const step of steps) {
    if (step.type === 'loop') loopDepth++;
    else if (step.type === 'end_loop') {
      loopDepth--;
      if (loopDepth < 0) return 'Unmatched "end_loop" without a preceding "loop"';
    } else if (step.type === 'if') ifDepth++;
    else if (step.type === 'end_if') {
      ifDepth--;
      if (ifDepth < 0) return 'Unmatched "end_if" without a preceding "if"';
    } else if ((step.type === 'break' || step.type === 'continue') && loopDepth === 0) {
      return `"${step.type}" must be inside a loop`;
    }
  }
  if (loopDepth !== 0) return 'Unbalanced "loop"/"end_loop" blocks';
  if (ifDepth !== 0) return 'Unbalanced "if"/"end_if" blocks';
  return null;
}

function normalizeTrigger(raw: unknown): TriggerConfig {
  const manual: TriggerConfig = { type: 'manual' };
  if (typeof raw !== 'object' || raw === null) return manual;
  const tr = raw as Record<string, unknown>;

  if (tr.type === 'hotkey') {
    const keys = typeof tr.keys === 'string' ? tr.keys.trim() : '';
    return keys ? { type: 'hotkey', keys } : manual;
  }
  if (tr.type === 'cron') {
    const cronExpression = typeof tr.cronExpression === 'string' ? tr.cronExpression.trim() : '';
    if (!cronExpression) return manual;
    const scheduleFields = parseCronToScheduleFields(cronExpression);
    return scheduleFields ? { type: 'cron', cronExpression, ...scheduleFields } : { type: 'cron', cronExpression };
  }
  if (tr.type === 'bot') {
    const botCommand = typeof tr.botCommand === 'string' ? tr.botCommand.trim().toLowerCase() : '';
    if (!botCommand) return manual;
    return {
      type: 'bot',
      botCommand,
      botCommandDescription: typeof tr.botCommandDescription === 'string' ? tr.botCommandDescription : '',
      botInputVariable: typeof tr.botInputVariable === 'string' && tr.botInputVariable.trim()
        ? tr.botInputVariable.trim()
        : 'input',
    };
  }
  if (tr.type === 'chat') {
    const chatCommand = typeof tr.chatCommand === 'string' ? tr.chatCommand.trim().toLowerCase() : '';
    if (!chatCommand) return manual;
    return {
      type: 'chat',
      chatCommand,
      chatCommandDescription: typeof tr.chatCommandDescription === 'string' ? tr.chatCommandDescription : '',
      chatInputVariable: typeof tr.chatInputVariable === 'string' && tr.chatInputVariable.trim()
        ? tr.chatInputVariable.trim()
        : 'input',
    };
  }
  return manual;
}

function normalizeExtraTriggers(raw: unknown): TriggerConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeTrigger).filter((t) => t.type !== 'manual');
}

export function validateFlowCandidate(raw: unknown): FlowGenerationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Response is not a JSON object' };
  }
  const inner = unwrapFlow(raw as Record<string, unknown>);

  const name = typeof inner.name === 'string' ? inner.name.trim() : '';
  if (!name) return { ok: false, error: 'Missing flow "name"' };

  if (!Array.isArray(inner.steps) || inner.steps.length === 0) {
    return { ok: false, error: 'Flow has no steps' };
  }

  const steps: SkillInstance[] = [];
  for (let i = 0; i < inner.steps.length; i++) {
    const result = validateStep(inner.steps[i], i);
    if (!result.ok) return result;
    steps.push(result.step);
  }

  const balanceError = checkBlockBalance(steps);
  if (balanceError) return { ok: false, error: balanceError };

  const extraTriggers = normalizeExtraTriggers(inner.extraTriggers);

  return {
    ok: true,
    flow: {
      id: '',
      name,
      description: typeof inner.description === 'string' ? inner.description : '',
      enabled: false,
      trigger: normalizeTrigger(inner.trigger),
      ...(extraTriggers.length > 0 ? { extraTriggers } : {}),
      steps,
      createdAt: '',
      updatedAt: '',
    },
  };
}
