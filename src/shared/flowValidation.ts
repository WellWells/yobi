import type { FlowGenerationResult, SkillInstance, SkillType, TriggerConfig } from './types';
import {
  DEFAULT_SKILL_CONFIG,
  SKILL_SPECS,
  SKILLS_WITHOUT_OUTPUT_KEY,
  canonicalSkillType,
} from './flowSkillSchema';
import { validateTrigger } from './flowTriggerValidation';
import { checkVariableReferences } from './flowReferenceCheck';
import { sanitizeFlowVariables } from './flowVariables';
import { checkBlockStructure, describeBlockIssue } from './flowBlockStructure';
import { unwrapMarkdownLink } from './markdownLinkUnwrap';

export { extractJsonFromLlmResponse } from './llmJsonExtract';
export { checkBlockStructure, describeBlockIssue } from './flowBlockStructure';
export type { BlockIssue } from './flowBlockStructure';

type StepValidationResult =
  | { ok: true; step: SkillInstance }
  | { ok: false; error: string };

export const OUTPUT_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const REQUIRED_KEYS: Partial<Record<SkillType, string[]>> = Object.fromEntries(
  SKILL_SPECS.map((spec) => [spec.type, spec.fields.filter((f) => f.required).map((f) => f.key)]),
);

const LLM_EXPORT_FORMATS = ['png', 'webp', 'pdf'];

/** Legacy config key spellings, read under their current name instead of being dropped. */
const CONFIG_KEY_ALIASES: Partial<Record<SkillType, Record<string, string>>> = {
  bot: { chatId: 'chatIds' },
};

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

/**
 * Config keys whose value IS a URL, where a model-linkified `[x](https://x)` is a typo worth
 * undoing (`channels`/`accounts` take a URL or a handle per line). Every other key is prose (a
 * message, a prompt, file content) and keeps the user's own Markdown links verbatim.
 */
const URL_VALUED_KEYS = new Set(['url', 'urls', 'provider', 'attachment', 'channels', 'accounts']);

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
  const skillType = typeof type === 'string' ? canonicalSkillType(type) : null;
  if (!skillType) {
    return { ok: false, error: `Step ${index + 1} has unknown type "${String(type)}"` };
  }

  const config: Record<string, string> = { ...DEFAULT_SKILL_CONFIG[skillType] };
  if (typeof s.config === 'object' && s.config !== null) {
    const aliases = CONFIG_KEY_ALIASES[skillType] ?? {};
    const entries = Object.entries(s.config as Record<string, unknown>);
    for (const [rawKey, value] of entries) {
      const key = aliases[rawKey] ?? rawKey;
      // The current spelling wins when a reply carries both.
      if (key !== rawKey && entries.some(([other]) => other === key)) continue;
      if (!(key in config)) continue;
      const text = coerceString(value);
      config[key] = URL_VALUED_KEYS.has(key) ? unwrapMarkdownLink(text) : text;
    }
  }

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

  const blockIssue = checkBlockStructure(steps);
  if (blockIssue) return { ok: false, error: describeBlockIssue(blockIssue) };

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
