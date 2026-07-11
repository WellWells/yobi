import type { FlowDefinition, FlowVariable, FlowVariableOption, FlowVariableType } from './types';
import { FLOW_VARIABLE_TYPES } from './types';

// Flow variables: the single sanitizer + lookup helpers shared by the main
// process (persistence, execution, the enable gate), the renderer (import
// parser, settings panel) and the generated-flow validator. Keeping one copy
// stops the three paths drifting into different ideas of what a valid variable
// is — an import that accepts a malformed key would produce {{var.…}} the
// reference checker then rejects.

/** Namespace every variable is exposed under at runtime: {{var.<key>}}. */
export const FLOW_VAR_PREFIX = 'var';

/** Same grammar as an outputKey — both become {{…}} interpolation names. */
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

/**
 * Coerce any string into a legal {{var.<key>}} name. Repairing rather than
 * rejecting matters because the alternative is destroying user data: a key the
 * author is halfway through typing ("feed-url") would otherwise take the whole
 * variable — label, options and the value already filled in — down with it on
 * the next save, with no dialog and nothing left for Restore to recover.
 */
function repairVariableKey(raw: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_]/g, '_');
  if (FLOW_VAR_KEY_RE.test(cleaned)) return cleaned;
  // Left over: empty, or leading digit. A letter prefix settles both.
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
  // A multi-line box and a placeholder only make sense for the free-text types.
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

  return variable;
}

/**
 * Accepts anything (disk, an imported JSON file, an LLM response) and returns a
 * well-formed variable list. Bad keys are repaired and duplicates are suffixed
 * rather than dropped — a variable carries the value the user typed, and losing
 * it silently is worse than renaming it visibly. Only an entry that is not an
 * object at all has nothing to preserve, so only that is discarded.
 */
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

/** The {{var.<key>}} names a flow's steps are allowed to reference. */
export function flowVariableTokens(variables: FlowVariable[] | undefined): string[] {
  return (variables ?? []).map((v) => `${FLOW_VAR_PREFIX}.${v.key}`);
}

/** Required variables the user has not filled in — a flow with any of these cannot run. */
export function missingRequiredVariables(flow: FlowDefinition): FlowVariable[] {
  return (flow.variables ?? []).filter((v) => v.required && !v.value.trim());
}

export function cloneFlowVariables(variables: FlowVariable[] | undefined): FlowVariable[] | undefined {
  if (!variables) return undefined;
  return variables.map((v) => ({
    ...v,
    ...(v.options ? { options: v.options.map((o) => ({ ...o })) } : {}),
  }));
}
