import type { FlowDefinition, SkillInstance, TriggerConfig, TriggerType } from '../../../../shared/types';
import { SKILL_TYPES } from '../../../../shared/flowSkillSchema';
import { createId } from '../../store/flowHelpers';

const TRIGGER_TYPES: TriggerType[] = ['hotkey', 'cron', 'manual', 'bot', 'chat'];

function hasFlowShape(val: unknown): val is Record<string, unknown> {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.name === 'string'
    && Array.isArray(obj.steps)
    && typeof obj.trigger === 'object'
    && obj.trigger !== null
  );
}

function sanitizeTrigger(raw: unknown): TriggerConfig {
  const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const type = TRIGGER_TYPES.includes(obj.type as TriggerType) ? obj.type as TriggerType : 'manual';
  return { ...obj, type } as TriggerConfig;
}

function sanitizeStep(raw: unknown): SkillInstance | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.type !== 'string' || !SKILL_TYPES.includes(obj.type as SkillInstance['type'])) return null;
  const config: Record<string, string> = {};
  if (obj.config && typeof obj.config === 'object') {
    for (const [key, value] of Object.entries(obj.config as Record<string, unknown>)) {
      if (value === null || value === undefined) continue;
      config[key] = typeof value === 'string' ? value : String(value);
    }
  }
  return {
    id: typeof obj.id === 'string' && obj.id ? obj.id : createId(),
    type: obj.type as SkillInstance['type'],
    label: typeof obj.label === 'string' ? obj.label : '',
    config,
    outputKey: typeof obj.outputKey === 'string' ? obj.outputKey : '',
  };
}

function sanitizeFlow(obj: Record<string, unknown>): FlowDefinition | null {
  const steps: SkillInstance[] = [];
  for (const rawStep of obj.steps as unknown[]) {
    const step = sanitizeStep(rawStep);
    if (!step) return null;
    steps.push(step);
  }
  const extraTriggers = Array.isArray(obj.extraTriggers)
    ? obj.extraTriggers.filter((tr) => tr && typeof tr === 'object').map(sanitizeTrigger)
    : [];
  const now = new Date().toISOString();
  return {
    id: typeof obj.id === 'string' && obj.id ? obj.id : createId(),
    name: obj.name as string,
    description: typeof obj.description === 'string' ? obj.description : '',
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : false,
    trigger: sanitizeTrigger(obj.trigger),
    ...(extraTriggers.length > 0 ? { extraTriggers } : {}),
    steps,
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : now,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : now,
  };
}

export function parseImportedFlows(raw: unknown): FlowDefinition[] | null {
  if (Array.isArray(raw)) {
    const flows: FlowDefinition[] = [];
    for (const item of raw) {
      const parsed = parseImportedFlows(item);
      if (parsed) flows.push(...parsed);
    }
    return flows.length > 0 ? flows : null;
  }

  if (typeof raw !== 'object' || raw === null) return null;

  const obj = raw as Record<string, unknown>;

  if (obj.type === 'agentflow-export' && obj.flow) {
    return hasFlowShape(obj.flow) ? wrap(sanitizeFlow(obj.flow)) : null;
  }

  if (hasFlowShape(obj)) return wrap(sanitizeFlow(obj));

  return null;
}

function wrap(flow: FlowDefinition | null): FlowDefinition[] | null {
  return flow ? [flow] : null;
}
