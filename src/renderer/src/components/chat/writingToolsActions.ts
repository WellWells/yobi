import type { WritingAction, WritingContext, WritingToolsResult } from '../../../../shared/writingTools';
import { clipboardApi, writingToolsApi } from '../../api/electronApi';
import { reloadOpenConversation } from '../../hooks/useReloadOpenConversation';
import { NEW_CONVERSATION_KEY, useAppStore } from '../../store/appStore';
import { draftKey, useAnswerEditStore } from '../../store/answerEditStore';
import { useI18nStore } from '../../store/i18nStore';
import { rewriteBusy, useWritingToolsStore, type RewriteJob, type RewriteTarget } from '../../store/writingToolsStore';
import { translateBusy, turnKey, useTranslateStore } from '../../store/translateStore';
import { applyRewrite, planReplace } from '../../utils/markdownBlocks';
import { writeAnswer } from './answerEditActions';

export type PutMode = 'replace' | 'insertBelow';

export type RewritePlan =
  | { ok: true; response: string }
  | { ok: false; reason: 'unmapped' | 'changed' | 'partial' };

function placed(response: string | null): RewritePlan {
  return response === null ? { ok: false, reason: 'partial' } : { ok: true, response };
}

/**
 * The answer with the rewrite put in place, or why it cannot be. A saved answer must be exactly
 * what the rewrite started from; a draft may have changed elsewhere, as long as the block being
 * rewritten is still there, once.
 */
export function planRewriteWrite(current: string, target: RewriteTarget, result: string, mode: PutMode): RewritePlan {
  if (target.kind === 'draft') {
    const block = target.original.slice(target.range.start, target.range.end);
    let range = target.range;
    if (current.slice(range.start, range.end) !== block) {
      const at = current.indexOf(block);
      if (!block || at < 0 || current.indexOf(block, at + 1) >= 0) return { ok: false, reason: 'changed' };
      range = { start: at, end: at + block.length };
    }
    return placed(applyRewrite(current, range, result, mode));
  }
  if (current !== target.response) return { ok: false, reason: 'changed' };
  if (target.range) return placed(applyRewrite(current, target.range, result, mode));
  if (mode === 'replace') return { ok: false, reason: 'unmapped' };
  const at = target.insertAt ?? current.length;
  return placed(applyRewrite(current, { start: at, end: at }, result, 'insertBelow'));
}

/** Why "replace" or "insert below" cannot be pressed right now; null when it can. */
export type PutBlock = 'temp' | 'sending' | 'awaiting' | 'translating' | 'editing' | 'unmapped' | 'partial' | 'locked';

export function putBlockReason(target: RewriteTarget, mode: PutMode, state: {
  pending: number;
  draftOpen: boolean;
  /** The agent that wrote this answer is waiting for the user's reply to its question. */
  awaiting: boolean;
  /** The answer is being translated: the translation is saved against the answer it started from. */
  translating: boolean;
  /** The result, once there is one: a list or table cannot replace part of a list or table. */
  result?: string;
  /** The passage is in a Notion block edited in Notion (a table, a child page). */
  locked?: boolean;
}): PutBlock | null {
  if (mode === 'replace' && state.locked) return 'locked';
  if (target.kind === 'draft') return null;
  if (target.path === NEW_CONVERSATION_KEY || !target.path) return 'temp';
  if (state.pending > 0) return 'sending';
  if (state.awaiting) return 'awaiting';
  if (state.translating) return 'translating';
  if (state.draftOpen) return 'editing';
  if (mode !== 'replace') return null;
  if (!target.range) return 'unmapped';
  if (state.result && !planReplace(target.response, target.range, state.result)) return 'partial';
  return null;
}

const HIGHLIGHT_SOURCE = 'yobi-rewrite-source';

/**
 * Keeps the passage being rewritten marked once the selection is gone (focus moved to the panel),
 * in the selection colour, so it reads as "still selected".
 */
export function markRewriteSource(range: Range | null): void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return;
  if (range) CSS.highlights.set(HIGHLIGHT_SOURCE, new Highlight(range));
  else CSS.highlights.delete(HIGHLIGHT_SOURCE);
}

/**
 * The question and the whole answer on both sides of `range` (the draft, while editing), so the
 * rewrite is judged against everything the passage sits in. Main trims it to fit the model.
 */
export function contextAround(source: string, range: { start: number; end: number }, question?: string): WritingContext {
  const before = source.slice(0, range.start);
  const after = source.slice(range.end);
  return {
    ...(question?.trim() ? { question: question.trim() } : {}),
    ...(before.trim() ? { before } : {}),
    ...(after.trim() ? { after } : {}),
  };
}

let sequence = 0;

function failureMessage(result: Extract<WritingToolsResult, { ok: false }>): string {
  const { t } = useI18nStore.getState();
  if (result.reason === 'tooLong') return t('chat.rewrite.error.tooLong');
  if (result.reason === 'empty') return t('chat.rewrite.error.empty');
  return result.error || t('chat.rewrite.error.failed');
}

/**
 * The model the panel shows and a rewrite uses: the one picked in the panel, else main's answer
 * now — the last model used, or the chat model when none was — read afresh, since the chat model
 * can change between rewrites.
 */
export async function ensureWritingModel(): Promise<string> {
  const store = useWritingToolsStore.getState();
  if (store.modelChosen && store.modelUrl) return store.modelUrl;
  const url = await writingToolsApi.getModel().catch(() => '');
  const now = useWritingToolsStore.getState();
  if (url && !now.modelChosen) now.setModelUrl(url);
  return useWritingToolsStore.getState().modelUrl || url;
}

/** Starts a rewrite, replacing any before it: one card, one request. */
export async function startRewrite(args: {
  action: WritingAction;
  instruction?: string;
  text: string;
  context?: WritingContext;
  target: RewriteTarget;
  anchor?: HTMLElement | null;
}): Promise<void> {
  const store = useWritingToolsStore.getState();
  const previous = store.job;
  if (previous && rewriteBusy(previous)) void writingToolsApi.cancel(previous.id);

  const providerUrl = await ensureWritingModel();
  const id = `w${Date.now().toString(36)}${(sequence++).toString(36)}`;
  const instruction = args.action === 'custom' ? (args.instruction ?? '').trim() : '';
  const job: RewriteJob = {
    id,
    action: args.action,
    instruction,
    providerUrl,
    text: args.text,
    context: args.context ?? {},
    target: args.target,
    status: 'running',
    result: '',
    error: '',
  };
  useWritingToolsStore.getState().setJob(job, args.anchor ?? null);

  const result: WritingToolsResult = await writingToolsApi.run({
    id,
    providerUrl,
    action: args.action,
    text: args.text,
    ...(instruction ? { instruction } : {}),
    ...(args.context ? { context: args.context } : {}),
  }).catch(() => ({ ok: false as const, reason: 'failed' as const }));

  const current = useWritingToolsStore.getState();
  if (current.job?.id !== id) return;
  if (result.ok) {
    current.patchJob(id, { status: 'done', result: result.text, providerUrl: result.providerUrl, error: '' });
    return;
  }
  if (result.reason === 'cancelled') {
    discardRewrite();
    return;
  }
  current.patchJob(id, { status: 'error', error: failureMessage(result) });
}

/** Follows the queue: "waiting behind another request" until this one's turn comes. */
export function subscribeRewriteProgress(): () => void {
  return writingToolsApi.onProgress(({ id, phase }) => {
    const job = useWritingToolsStore.getState().job;
    if (!job || job.id !== id || !rewriteBusy(job)) return;
    useWritingToolsStore.getState().patchJob(id, { status: phase });
  });
}

export function discardRewrite(): void {
  useWritingToolsStore.getState().setJob(null);
  markRewriteSource(null);
}

export function cancelRewrite(): void {
  const job = useWritingToolsStore.getState().job;
  if (job && rewriteBusy(job)) void writingToolsApi.cancel(job.id);
  discardRewrite();
}

export function retryRewrite(): void {
  const { job, anchor } = useWritingToolsStore.getState();
  if (!job) return;
  void startRewrite({
    action: job.action, instruction: job.instruction, text: job.text, context: job.context, target: job.target, anchor,
  });
}

export function copyRewrite(): Promise<boolean> {
  const job = useWritingToolsStore.getState().job;
  return job?.result ? clipboardApi.copyText(job.result) : Promise.resolve(false);
}

export function quoteRewrite(): void {
  const { job, quote } = useWritingToolsStore.getState();
  if (job?.result && quote) quote(job.result);
}

function putFailed(id: string, reason: 'unmapped' | 'changed' | 'partial' | 'failed'): void {
  const { t } = useI18nStore.getState();
  useWritingToolsStore.getState().patchJob(id, { error: t(`chat.rewrite.put.${reason}`) });
}

/** Puts the result in place: into the saved answer (an edit, with undo) or into the editor's draft. */
export async function putRewrite(mode: PutMode): Promise<void> {
  const job = useWritingToolsStore.getState().job;
  if (!job || job.status !== 'done' || !job.result) return;
  const { target } = job;

  if (target.kind === 'draft') {
    const editor = useAnswerEditStore.getState();
    const draft = editor.drafts[draftKey(target.path, target.turnIndex)];
    const plan = draft ? planRewriteWrite(draft.text, target, job.result, mode) : { ok: false as const, reason: 'changed' as const };
    if (!plan.ok) {
      putFailed(job.id, plan.reason);
      return;
    }
    editor.update(target.path, target.turnIndex, { text: plan.response });
    discardRewrite();
    return;
  }

  const app = useAppStore.getState();
  const turn = app.selectedFile?.path === target.path ? app.conversation?.turns[target.turnIndex] : undefined;
  if (!turn || !app.conversation) {
    putFailed(job.id, 'changed');
    return;
  }
  // The card's button already says so; this covers a translation started after it was drawn.
  if (translateBusy(useTranslateStore.getState().jobs[turnKey(target.path, target.turnIndex)])) {
    const { t } = useI18nStore.getState();
    useWritingToolsStore.getState().patchJob(job.id, { error: t('chat.rewrite.blocked.translating') });
    return;
  }
  const plan = planRewriteWrite(turn.response, target, job.result, mode);
  if (!plan.ok) {
    putFailed(job.id, plan.reason);
    return;
  }
  const editedAt = typeof turn.meta.ed === 'string' ? turn.meta.ed : null;
  const written = await writeAnswer({
    path: target.path,
    turnIndex: target.turnIndex,
    turnCount: app.conversation.turns.length,
    editedAt,
    expected: turn.response,
    response: plan.response,
  });
  if (useWritingToolsStore.getState().job?.id !== job.id) return;
  if (written.ok) {
    discardRewrite();
    return;
  }
  if (written.reason === 'conflict') void reloadOpenConversation();
  putFailed(job.id, written.reason === 'conflict' || written.reason === 'missing' ? 'changed' : 'failed');
}
