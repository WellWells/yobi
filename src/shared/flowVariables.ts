import type { FlowDefinition, FlowVariable, FlowVariableOption, FlowVariableType } from './types';
import { FLOW_VARIABLE_TYPES } from './types';

export const FLOW_VAR_PREFIX = 'var';

export const FLOW_VAR_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function isFlowVariableType(value: unknown): value is FlowVariableType {
  return typeof value === 'string' && (FLOW_VARIABLE_TYPES as readonly string[]).includes(value);
}

function coerceString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function sanitizeOptions(raw: unknown): FlowVariableOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const options: FlowVariableOption[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const value = coerceString(obj.value).trim();
    if (!value) continue;
    const label = coerceString(obj.label).trim();
    options.push({ value, label: label || value });
  }
  return options.length > 0 ? options : undefined;
}

function sanitizePickWriteKeys(raw: unknown): FlowVariable['pickWriteKeys'] {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const keys: NonNullable<FlowVariable['pickWriteKeys']> = {};
  const title = coerceString(obj.title).trim();
  if (FLOW_VAR_KEY_RE.test(title)) keys.title = title;
  const link = coerceString(obj.link).trim();
  if (FLOW_VAR_KEY_RE.test(link)) keys.link = link;
  return keys.title || keys.link ? keys : undefined;
}

function repairVariableKey(raw: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_]/g, '_');
  if (FLOW_VAR_KEY_RE.test(cleaned)) return cleaned;
  return `v_${cleaned}`;
}

function uniqueKey(key: string, taken: Set<string>): string {
  if (!taken.has(key)) return key;
  let n = 2;
  while (taken.has(`${key}_${n}`)) n++;
  return `${key}_${n}`;
}

function sanitizeVariable(raw: unknown): FlowVariable | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const key = repairVariableKey(coerceString(obj.key));

  const type: FlowVariableType = isFlowVariableType(obj.type) ? obj.type : 'text';
  const variable: FlowVariable = {
    key,
    type,
    label: coerceString(obj.label).trim() || key,
    value: coerceString(obj.value),
  };

  const question = coerceString(obj.question).trim();
  if (question) variable.question = question;
  const hint = coerceString(obj.hint).trim();
  if (hint) variable.hint = hint;
  if (obj.required === true) variable.required = true;
  if (type === 'text' || type === 'url' || type === 'feed') {
    if (obj.multiline === true) variable.multiline = true;
    const placeholder = coerceString(obj.placeholder);
    if (placeholder) variable.placeholder = placeholder;
  }

  if (type === 'select') {
    const options = sanitizeOptions(obj.options);
    if (options) variable.options = options;
  }
  if (type === 'number') {
    const min = coerceString(obj.min).trim();
    if (min) variable.min = min;
    const max = coerceString(obj.max).trim();
    if (max) variable.max = max;
  }

  if (obj.pickTarget === 'title' || obj.pickTarget === 'link' || obj.pickTarget === 'list') {
    variable.pickTarget = obj.pickTarget;
    const pickUrlKey = coerceString(obj.pickUrlKey).trim();
    if (pickUrlKey) variable.pickUrlKey = pickUrlKey;
    const writeKeys = sanitizePickWriteKeys(obj.pickWriteKeys);
    if (obj.pickTarget === 'list' && writeKeys) variable.pickWriteKeys = writeKeys;
  }
  if (obj.hiddenInSetup === true) variable.hiddenInSetup = true;

  return variable;
}

export function sanitizeFlowVariables(raw: unknown): FlowVariable[] {
  if (!Array.isArray(raw)) return [];
  const taken = new Set<string>();
  const variables: FlowVariable[] = [];
  for (const item of raw) {
    const variable = sanitizeVariable(item);
    if (!variable) continue;
    variable.key = uniqueKey(variable.key, taken);
    taken.add(variable.key);
    variables.push(variable);
  }
  return variables;
}

export function missingRequiredVariables(flow: FlowDefinition): FlowVariable[] {
  return (flow.variables ?? []).filter((v) => v.required && !v.value.trim());
}

export function cloneFlowVariables(variables: FlowVariable[] | undefined): FlowVariable[] | undefined {
  if (!variables) return undefined;
  return variables.map((v) => ({
    ...v,
    ...(v.options ? { options: v.options.map((o) => ({ ...o })) } : {}),
    ...(v.pickWriteKeys ? { pickWriteKeys: { ...v.pickWriteKeys } } : {}),
  }));
}
