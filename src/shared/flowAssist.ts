import type { FlowBuildIssue, FlowClarification, FlowDefinition, SkillType } from './types';
import { DEFAULT_SKILL_CONFIG } from './flowSkillSpecs';

/*
 * The flow editor's AI assistant (the right pane's Assistant tab): change the open flow by saying
 * what to change, explain what it does, name its steps. Every request carries the editor's draft
 * (unsaved changes included) and comes back as a proposal; nothing is saved until the user applies
 * it and then presses Save. Pure: the request shapes, their parsers and the change list.
 */

export type FlowAssistFailure =
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'failed'; error: string };

export interface FlowAssistEditRequest {
  /** Picked by the window; a cancel names it. */
  id: string;
  providerUrl: string;
  flow: FlowDefinition;
  change: string;
  /** The user's answers to the questions the last try asked. */
  answers?: FlowClarification[];
}

export type FlowAssistEditResult =
  /** The whole flow with the change made; `paused` = it adds a step that acts on the computer, so it comes back switched off. */
  | { ok: true; status: 'proposal'; flow: FlowDefinition; issues: FlowBuildIssue[]; paused: boolean }
  | { ok: true; status: 'questions'; questions: string[] }
  | { ok: true; status: 'unchanged' }
  | FlowAssistFailure;

export interface FlowAssistExplainRequest {
  id: string;
  providerUrl: string;
  flow: FlowDefinition;
  /** What the editor's own checks found, in the user's words, so the explanation names them. */
  problems: string[];
}

export type FlowAssistExplainResult = { ok: true; markdown: string } | FlowAssistFailure;

/** One step as the naming prompt reads it: what the editor's summary says it does. */
export interface StepNameMaterial {
  id: string;
  /** 1-based, as the steps are numbered everywhere the user sees them. */
  index: number;
  type: SkillType;
  /** The step's kind in the interface language ("AI 提示"). */
  typeName: string;
  /** The name it has now; '' when it has only its kind's name. */
  label: string;
  /** The card's summary line(s): what it reads, what it does, where it sends. */
  summary: string;
}

export interface FlowAssistNamesRequest {
  id: string;
  providerUrl: string;
  flowName: string;
  /** Every step, for context: a name reads right only beside its neighbours. */
  steps: StepNameMaterial[];
  /** The ids to name. */
  targets: string[];
}

export type FlowAssistNamesResult = { ok: true; names: Record<string, string> } | FlowAssistFailure;

/** A flow this long is named in one request; the rest keep their names (the panel says so). */
export const ASSIST_NAME_MAX_STEPS = 60;
export const ASSIST_STEP_LINE_MAX_CHARS = 220;
export const ASSIST_CHANGE_MAX_CHARS = 4_000;
export const ASSIST_PROBLEMS_MAX = 20;

export function clipLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : flat;
}

/** One step as a naming prompt reads it; `target` marks the ones to name with *. */
export function stepMaterialLine(step: StepNameMaterial, target: boolean): string {
  const named = step.label ? ` "${clipLine(step.label, 60)}"` : '';
  return clipLine(`${target ? '*' : ' '} #${step.index} [${step.typeName}]${named}: ${step.summary || '-'}`, ASSIST_STEP_LINE_MAX_CHARS);
}

/** The steps around one, for naming it alone (the ✨ on its name field). */
export const STEP_NAME_NEIGHBOURS = 2;

export function singleStepMaterial(flowName: string, steps: readonly StepNameMaterial[], stepId: string): string {
  const at = steps.findIndex((step) => step.id === stepId);
  if (at < 0) return '';
  const around = steps.slice(Math.max(0, at - STEP_NAME_NEIGHBOURS), at + STEP_NAME_NEIGHBOURS + 1);
  return [`Automation: ${clipLine(flowName, 80) || '-'}`, ...around.map((step) => stepMaterialLine(step, step.id === stepId))].join('\n');
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function flowOf(raw: unknown): FlowDefinition | null {
  if (!raw || typeof raw !== 'object') return null;
  const flow = raw as Partial<FlowDefinition>;
  if (!isString(flow.id) || !isString(flow.name) || !Array.isArray(flow.steps) || !flow.trigger) return null;
  return flow as FlowDefinition;
}

function base(raw: unknown): { id: string; providerUrl: string; value: Record<string, unknown> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!isString(value.id) || !value.id || !isString(value.providerUrl)) return null;
  return { id: value.id, providerUrl: value.providerUrl.trim(), value };
}

export function parseAssistEditRequest(raw: unknown): FlowAssistEditRequest | null {
  const head = base(raw);
  const flow = flowOf(head?.value.flow);
  const change = head?.value.change;
  if (!head || !flow || !isString(change) || !change.trim()) return null;
  const answers = Array.isArray(head.value.answers)
    ? head.value.answers
      .filter((entry): entry is FlowClarification => Boolean(entry) && isString((entry as FlowClarification).question) && isString((entry as FlowClarification).answer))
      .map(({ question, answer }) => ({ question, answer }))
    : [];
  return {
    id: head.id,
    providerUrl: head.providerUrl,
    flow,
    change: change.trim().slice(0, ASSIST_CHANGE_MAX_CHARS),
    ...(answers.length > 0 ? { answers } : {}),
  };
}

export function parseAssistExplainRequest(raw: unknown): FlowAssistExplainRequest | null {
  const head = base(raw);
  const flow = flowOf(head?.value.flow);
  if (!head || !flow) return null;
  const problems = Array.isArray(head.value.problems) ? head.value.problems.filter(isString).slice(0, ASSIST_PROBLEMS_MAX) : [];
  return { id: head.id, providerUrl: head.providerUrl, flow, problems };
}

export function parseAssistNamesRequest(raw: unknown): FlowAssistNamesRequest | null {
  const head = base(raw);
  if (!head || !Array.isArray(head.value.steps) || !Array.isArray(head.value.targets)) return null;
  const steps = head.value.steps.filter((entry): entry is StepNameMaterial => {
    const step = entry as Partial<StepNameMaterial> | null;
    return Boolean(step) && isString(step!.id) && typeof step!.index === 'number' && isString(step!.type)
      && isString(step!.typeName) && isString(step!.label) && isString(step!.summary);
  });
  const known = new Set(steps.map((step) => step.id));
  const targets = head.value.targets.filter(isString).filter((id) => known.has(id)).slice(0, ASSIST_NAME_MAX_STEPS);
  if (targets.length === 0) return null;
  return { id: head.id, providerUrl: head.providerUrl, flowName: isString(head.value.flowName) ? head.value.flowName : '', steps, targets };
}

/** What the editor compares to tell whether the draft moved on since a request was sent. */
export function assistBaseKey(flow: FlowDefinition): string {
  return JSON.stringify([flow.name, flow.description ?? '', flow.trigger, flow.extraTriggers ?? [], flow.variables ?? [], flow.steps]);
}

export type AssistChangeKind = 'added' | 'changed' | 'removed';

export interface AssistChange {
  kind: AssistChangeKind;
  stepId: string;
  /** 1-based position: in the proposal for added and changed, in the draft for removed. */
  index: number;
  type: SkillType;
  label: string;
}

export interface AssistChangeList {
  steps: AssistChange[];
  name: boolean;
  description: boolean;
  trigger: boolean;
  variables: boolean;
}

/** A step as it behaves: the model reads configs without their defaults and writes them back so. */
function stepKey(step: FlowDefinition['steps'][number]): string {
  const config = Object.entries({ ...(DEFAULT_SKILL_CONFIG[step.type] ?? {}), ...step.config })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([step.type, step.label, step.outputKey ?? '', config]);
}

/**
 * What a proposal changes, by step id (a revision keeps the ids of the steps it keeps), so each
 * row can take the user to its card. Steps that only moved are not listed.
 */
export function assistChanges(before: FlowDefinition, after: FlowDefinition): AssistChangeList {
  const old = new Map(before.steps.map((step) => [step.id, step]));
  const kept = new Set(after.steps.map((step) => step.id));
  const steps: AssistChange[] = [];
  after.steps.forEach((step, index) => {
    const previous = old.get(step.id);
    if (!previous) steps.push({ kind: 'added', stepId: step.id, index: index + 1, type: step.type, label: step.label });
    else if (stepKey(previous) !== stepKey(step)) steps.push({ kind: 'changed', stepId: step.id, index: index + 1, type: step.type, label: step.label });
  });
  before.steps.forEach((step, index) => {
    if (!kept.has(step.id)) steps.push({ kind: 'removed', stepId: step.id, index: index + 1, type: step.type, label: step.label });
  });
  return {
    steps,
    name: before.name !== after.name,
    description: (before.description ?? '') !== (after.description ?? ''),
    trigger: JSON.stringify([before.trigger, before.extraTriggers ?? []]) !== JSON.stringify([after.trigger, after.extraTriggers ?? []]),
    variables: JSON.stringify(before.variables ?? []) !== JSON.stringify(after.variables ?? []),
  };
}
