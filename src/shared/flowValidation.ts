import type { FlowGenerationResult, SkillInstance, SkillType, TriggerConfig } from './types';
import {
  DEFAULT_SKILL_CONFIG,
  SKILL_SPECS,
  SKILL_TYPES,
  SKILLS_WITHOUT_OUTPUT_KEY,
} from './flowSkillSchema';
import { validateTrigger } from './flowTriggerValidation';
import { checkVariableReferences } from './flowReferenceCheck';
import { sanitizeFlowVariables } from './flowVariables';

export { extractJsonFromLlmResponse } from './llmJsonExtract';

type StepValidationResult =
  | { ok: true; step: SkillInstance }
  | { ok: false; error: string };

// Canonical outputKey grammar — shared with the renderer step editor.
export const OUTPUT_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const REQUIRED_KEYS: Partial<Record<SkillType, string[]>> = Object.fromEntries(
  SKILL_SPECS.map((spec) => [spec.type, spec.fields.filter((f) => f.required).map((f) => f.key)]),
);

const LLM_EXPORT_FORMATS = ['png', 'webp', 'pdf'];

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

  // The runtime's file-export gate (isCaptureFormat) is an exact lowercase
  // match, so normalize here and reject unknown formats instead of letting
  // "PNG"/"jpg" silently skip the export at execution time.
  if (skillType === 'llm') {
    const exportFormat = (config.exportFormat ?? '').trim().toLowerCase();
    if (exportFormat && !LLM_EXPORT_FORMATS.includes(exportFormat)) {
      return { ok: false, error: `Step ${index + 1} ("llm") has invalid exportFormat "${config.exportFormat}" — use "png", "webp", "pdf" or ""` };
    }
    config.exportFormat = exportFormat;
  }

  for (const key of REQUIRED_KEYS[skillType] ?? []) {
    if (!(config[key] ?? '').trim()) {
      return { ok: false, error: `Step ${index + 1} ("${skillType}") is missing required "${key}"` };
    }
  }

  const noOutput = SKILLS_WITHOUT_OUTPUT_KEY.includes(skillType);
  const rawKey = typeof s.outputKey === 'string' ? s.outputKey.trim() : '';
  if (!noOutput && rawKey && !OUTPUT_KEY_RE.test(rawKey)) {
    return { ok: false, error: `Step ${index + 1} has invalid outputKey "${rawKey}" — use only letters, digits and underscores, starting with a letter (e.g. "${skillType}_${index + 1}")` };
  }
  const outputKey = noOutput ? '' : rawKey;
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

function checkDuplicateOutputKeys(steps: SkillInstance[]): string | null {
  const seen = new Set<string>();
  for (let i = 0; i < steps.length; i++) {
    const key = steps[i].outputKey;
    if (!key) continue;
    if (seen.has(key)) return `Step ${i + 1} reuses outputKey "${key}" — every outputKey must be unique`;
    seen.add(key);
  }
  return null;
}

// Runs after the explicit-duplicate check so an auto-assigned key can never
// collide with (or be blamed for) a key the model chose.
function assignFallbackOutputKeys(steps: SkillInstance[]): void {
  const used = new Set(steps.map((s) => s.outputKey).filter(Boolean));
  steps.forEach((step, i) => {
    if (step.outputKey || SKILLS_WITHOUT_OUTPUT_KEY.includes(step.type)) return;
    let n = i + 1;
    let key = `${step.type}_${n}`;
    while (used.has(key)) key = `${step.type}_${++n}`;
    used.add(key);
    step.outputKey = key;
  });
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

  const duplicateError = checkDuplicateOutputKeys(steps);
  if (duplicateError) return { ok: false, error: duplicateError };
  assignFallbackOutputKeys(steps);

  const balanceError = checkBlockBalance(steps);
  if (balanceError) return { ok: false, error: balanceError };

  const triggerResult = validateTrigger(inner.trigger);
  if (!triggerResult.ok) return triggerResult;

  const extraTriggers: TriggerConfig[] = [];
  if (Array.isArray(inner.extraTriggers)) {
    for (const rawExtra of inner.extraTriggers) {
      const extraResult = validateTrigger(rawExtra);
      if (!extraResult.ok) return extraResult;
      if (extraResult.trigger.type !== 'manual') extraTriggers.push(extraResult.trigger);
    }
  }

  const variables = sanitizeFlowVariables(inner.variables);

  const referenceError = checkVariableReferences(steps, [triggerResult.trigger, ...extraTriggers], variables);
  if (referenceError) return { ok: false, error: referenceError };

  return {
    ok: true,
    flow: {
      id: '',
      name,
      description: typeof inner.description === 'string' ? inner.description : '',
      enabled: false,
      trigger: triggerResult.trigger,
      ...(extraTriggers.length > 0 ? { extraTriggers } : {}),
      ...(variables.length > 0 ? { variables } : {}),
      steps,
      createdAt: '',
      updatedAt: '',
    },
  };
}
