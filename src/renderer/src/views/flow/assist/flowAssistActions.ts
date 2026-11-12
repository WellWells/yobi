import { flowAssistApi } from '../../../api/electronApi';
import { useFlowAssistStore, threadOf } from '../../../store/useFlowAssistStore';
import type { AssistNameRow, AssistResult } from '../../../store/useFlowAssistStore';
import { useFlowStore } from '../../../store/useFlowStore';
import { useI18nStore } from '../../../store/i18nStore';
import { assistBaseKey, assistChanges, singleStepMaterial } from '../../../../../shared/flowAssist';
import type { AiNameSource } from '../../../../../shared/aiName';
import { summaryContext } from '../outline/rowText';
import type { NamedModel } from '../flowCapabilities';
import type { FlowAssistFailure } from '../../../../../shared/flowAssist';
import type { FlowClarification, FlowDefinition } from '../../../../../shared/types';
import type { StepSummaryContext } from '../stepSummary';
import { collectStepIssues } from '../outline/stepIssues';
import { namingTargets, problemLines, stepNameMaterial } from './assistMaterial';

/*
 * The assistant's three requests and what applying their results does. Each reads the draft at
 * the moment it is sent; a reply for a request that was cancelled or replaced is dropped. Nothing
 * here saves: applying changes the draft, and the editor's Save is what writes it.
 */

function draftOf(flowId: string): FlowDefinition | undefined {
  return useFlowStore.getState().flows.find((flow) => flow.id === flowId);
}

function tr(key: string): string {
  return useI18nStore.getState().t(key);
}

function settle(flowId: string, id: string, result: AssistResult): void {
  const state = useFlowAssistStore.getState();
  if (threadOf(state.threads, flowId).job?.id !== id) return;
  state.patch(flowId, { job: null, result });
}

function begin(flowId: string, kind: 'edit' | 'explain' | 'names'): string | null {
  const state = useFlowAssistStore.getState();
  if (threadOf(state.threads, flowId).job || !state.modelUrl) return null;
  const id = crypto.randomUUID();
  state.patch(flowId, { job: { kind, id } });
  return id;
}

function failure(result: FlowAssistFailure, retry: Extract<AssistResult, { kind: 'error' }>['retry']): AssistResult | null {
  return result.reason === 'cancelled' ? null : { kind: 'error', message: result.error, retry };
}

function onThrow(flowId: string, id: string, retry: Extract<AssistResult, { kind: 'error' }>['retry']): () => void {
  return () => settle(flowId, id, { kind: 'error', message: tr('flow.assist.error.empty'), retry });
}

export function cancelAssist(flowId: string): void {
  const state = useFlowAssistStore.getState();
  const job = threadOf(state.threads, flowId).job;
  if (!job) return;
  state.patch(flowId, { job: null });
  void flowAssistApi.cancel(job.id).catch(() => undefined);
}

export async function startEdit(flowId: string, change: string, answers?: FlowClarification[]): Promise<void> {
  const draft = draftOf(flowId);
  const text = change.trim();
  if (!draft || !text) return;
  const id = begin(flowId, 'edit');
  if (!id) return;
  const base = assistBaseKey(draft);
  const providerUrl = useFlowAssistStore.getState().modelUrl;
  try {
    const result = await flowAssistApi.edit({ id, providerUrl, flow: draft, change: text, ...(answers?.length ? { answers } : {}) });
    if (!result.ok) {
      const next = failure(result, { kind: 'edit', change: text });
      if (next) settle(flowId, id, next);
      return;
    }
    if (result.status === 'questions') settle(flowId, id, { kind: 'questions', change: text, questions: result.questions });
    else if (result.status === 'unchanged') settle(flowId, id, { kind: 'unchanged', change: text });
    else settle(flowId, id, {
      kind: 'proposal',
      change: text,
      flow: result.flow,
      issues: result.issues,
      paused: result.paused,
      changes: assistChanges(draft, result.flow),
      base,
    });
  } catch {
    onThrow(flowId, id, { kind: 'edit', change: text })();
  }
}

/**
 * The proposal into the draft, as one unsaved change — only while the draft is still the one it
 * was made from: edits made meanwhile would be lost under it.
 */
export function applyProposal(flowId: string): 'applied' | 'changed' | 'missing' {
  const state = useFlowAssistStore.getState();
  const result = threadOf(state.threads, flowId).result;
  const draft = draftOf(flowId);
  if (!draft || result?.kind !== 'proposal') return 'missing';
  if (assistBaseKey(draft) !== result.base) {
    state.patch(flowId, { result: { kind: 'error', message: tr('flow.assist.error.draftChanged'), retry: { kind: 'edit', change: result.change } } });
    return 'changed';
  }
  useFlowStore.getState().updateFlow({ ...result.flow, id: draft.id });
  state.patch(flowId, { result: { kind: 'applied', what: 'edit', count: result.changes.steps.length } });
  return 'applied';
}

export async function startExplain(flowId: string): Promise<void> {
  const draft = draftOf(flowId);
  if (!draft) return;
  const id = begin(flowId, 'explain');
  if (!id) return;
  const problems = problemLines(draft, collectStepIssues(draft, tr), tr);
  try {
    const result = await flowAssistApi.explain({ id, providerUrl: useFlowAssistStore.getState().modelUrl, flow: draft, problems });
    const next = result.ok ? { kind: 'explain' as const, markdown: result.markdown } : failure(result, { kind: 'explain' });
    if (next) settle(flowId, id, next);
  } catch {
    onThrow(flowId, id, { kind: 'explain' })();
  }
}

/** Names for the steps still called by their kind; all of them when every step has a name. */
export async function startNames(flowId: string, context: Omit<StepSummaryContext, 'index'>): Promise<void> {
  const draft = draftOf(flowId);
  if (!draft) return;
  const targets = namingTargets(draft, tr);
  if (targets.length === 0) return;
  const id = begin(flowId, 'names');
  if (!id) return;
  const steps = stepNameMaterial(draft, tr, context);
  try {
    const result = await flowAssistApi.names({ id, providerUrl: useFlowAssistStore.getState().modelUrl, flowName: draft.name, steps, targets });
    if (!result.ok) {
      const next = failure(result, { kind: 'names' });
      if (next) settle(flowId, id, next);
      return;
    }
    const rows: AssistNameRow[] = draft.steps.flatMap((step, index) => {
      const name = result.names[step.id];
      return name ? [{ stepId: step.id, index: index + 1, before: step.label, name }] : [];
    });
    settle(flowId, id, { kind: 'names', rows, skipped: Math.max(0, targets.length - rows.length) });
  } catch {
    onThrow(flowId, id, { kind: 'names' })();
  }
}

/**
 * What the ✨ on a step's name field names it from, read when a model is picked: its summary with
 * the steps around it, from the draft as it is then.
 */
export function stepNameSource(flowId: string, stepId: string, models: readonly NamedModel[]): AiNameSource | null {
  const draft = draftOf(flowId);
  if (!draft) return null;
  const context = summaryContext(draft, tr, models, useI18nStore.getState().locale);
  const material = singleStepMaterial(draft.name, stepNameMaterial(draft, tr, context), stepId);
  return material ? { kind: 'step', material } : null;
}

/** The ticked names onto their steps; a step renamed or removed since the request keeps what it has. */
export function applyNames(flowId: string, stepIds: readonly string[]): number {
  const state = useFlowAssistStore.getState();
  const result = threadOf(state.threads, flowId).result;
  const draft = draftOf(flowId);
  if (!draft || result?.kind !== 'names') return 0;
  const wanted = new Set(stepIds);
  const { updateStep } = useFlowStore.getState();
  let count = 0;
  for (const row of result.rows) {
    if (!wanted.has(row.stepId)) continue;
    const step = draft.steps.find((entry) => entry.id === row.stepId);
    if (!step || step.label !== row.before) continue;
    updateStep(flowId, row.stepId, { label: row.name });
    count += 1;
  }
  state.patch(flowId, { result: { kind: 'applied', what: 'names', count } });
  return count;
}
