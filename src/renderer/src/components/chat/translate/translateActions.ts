import type { TurnTranslation } from '../../../../../shared/conversationDoc';
import { fnv1a } from '../../../../../shared/fnv1a';
import type { TranslateResult } from '../../../../../shared/translate';
import { pushRecentLanguage, type TranslateLanguage } from '../../../../../shared/translateLanguages';
import { translateApi } from '../../../api/electronApi';
import { reloadOpenConversation } from '../../../hooks/useReloadOpenConversation';
import { showAppNotice } from '../../../hooks/useUiNotifications';
import { NEW_CONVERSATION_KEY } from '../../../store/appStore';
import { useI18nStore } from '../../../store/i18nStore';
import { translateBusy, turnKey, useTranslateStore, type TurnTranslateJob } from '../../../store/translateStore';
import { convertToTraditional } from '../../../utils/openccRuntime';
import { showSavedContent } from '../answerEditActions';
import { ensureWritingModel } from '../writingToolsActions';

/**
 * Translating answers and selections. Main runs one translation at a time and a new one would
 * replace the one before, so requests line up here instead: translating three answers in a row
 * translates all three, one after another.
 */

let sequence = 0;
let tail: Promise<void> = Promise.resolve();
const phaseListeners = new Map<string, (phase: 'waiting' | 'running') => void>();
let subscribed = false;

function nextId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${(sequence++).toString(36)}`;
}

/** Progress from main, to whichever request it names. */
function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  translateApi.onProgress(({ id, phase }) => {
    const listener = phaseListeners.get(id);
    if (listener) listener(phase);
  });
}

/** Runs one request after every earlier one; `skip` is checked when its turn comes. */
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work);
  tail = run.then(() => undefined, () => undefined);
  return run;
}

export function failureText(result: Extract<TranslateResult, { ok: false }>): string {
  const { t } = useI18nStore.getState();
  if (result.reason === 'tooLong') return t('chat.translate.error.tooLong');
  if (result.reason === 'empty') return t('chat.translate.error.empty');
  return result.error || t('chat.translate.error.failed');
}

export function rememberLanguage(to: TranslateLanguage): void {
  const store = useTranslateStore.getState();
  store.setRecent(pushRecentLanguage(store.recent, to));
}

export interface QueuedTranslation {
  id: string;
  result: Promise<TranslateResult>;
}

/**
 * One translation request, in line behind the others. `onPhase` follows it from queued to
 * running. A request cancelled before its turn never reaches main. `filePath` names the saved
 * conversation an answer belongs to: main keeps it from being moved or deleted while it runs.
 */
export function queueTranslation(
  text: string,
  to: TranslateLanguage,
  providerUrl: string,
  onPhase: (phase: 'waiting' | 'running') => void,
  id: string = nextId('t'),
  filePath?: string,
): QueuedTranslation {
  ensureSubscribed();
  phaseListeners.set(id, onPhase);
  const result = enqueue(async (): Promise<TranslateResult> => {
    if (!phaseListeners.has(id)) return { ok: false, reason: 'cancelled' };
    return translateApi.run({ id, providerUrl, text, to, ...(filePath ? { filePath } : {}) }).catch(() => ({ ok: false as const, reason: 'failed' as const }));
  }).finally(() => phaseListeners.delete(id));
  return { id, result };
}

/** Stops a request: one still in line is dropped; one already sent has its late answer dropped. */
export function cancelTranslation(id: string): void {
  phaseListeners.delete(id);
  void translateApi.cancel(id).catch(() => false);
}

function isTemp(path: string): boolean {
  return !path || path === NEW_CONVERSATION_KEY;
}

/**
 * Keeps a translation: in the turn's marker for a saved conversation, in memory for the temporary
 * chat. Null when it was kept, else why not.
 */
async function keepTranslation(path: string, turnIndex: number, response: string, tr: TurnTranslation | null): Promise<string | null> {
  const key = turnKey(path, turnIndex);
  if (isTemp(path)) {
    useTranslateStore.getState().setMemory(key, tr);
    return null;
  }
  const result = await translateApi.setTurnTranslation({ filePath: path, turnIndex, expected: response, tr })
    .catch(() => ({ ok: false as const, reason: 'failed' as const }));
  if (result.ok) {
    showSavedContent(path, result.content);
    return null;
  }
  const { t } = useI18nStore.getState();
  if (result.reason === 'conflict' || result.reason === 'missing') {
    void reloadOpenConversation();
    return t('chat.translate.error.changed');
  }
  return t('chat.translate.error.save');
}

function translationOf(response: string, to: TranslateLanguage, text: string, by: TurnTranslation['by'], extra: Partial<TurnTranslation> = {}): TurnTranslation {
  return { to, text, h: fnv1a(response.trim()), by, at: new Date().toISOString(), ...extra };
}

async function settle(key: string, id: string, path: string, turnIndex: number, response: string, tr: TurnTranslation): Promise<void> {
  const error = await keepTranslation(path, turnIndex, response, tr);
  const store = useTranslateStore.getState();
  if (store.jobs[key]?.id !== id) return;
  if (error) {
    store.patchJob(id, { status: 'error', error });
    return;
  }
  store.setJob(key, null);
  store.setView(key, 'both');
}

/** Translates one answer whole with the quick-action model, and keeps the result under it. */
export async function translateTurn(args: {
  path: string;
  turnIndex: number;
  response: string;
  to: TranslateLanguage;
  /** The provider's name as the UI shows it, for "translated by". */
  providerLabel: (url: string) => string;
}): Promise<void> {
  const key = turnKey(args.path, args.turnIndex);
  cancelTurnTranslation(args.path, args.turnIndex);
  rememberLanguage(args.to);
  const id = nextId('a');
  const job: TurnTranslateJob = { id, to: args.to, by: 'ai', source: args.response, status: 'queued', error: '' };
  useTranslateStore.getState().setJob(key, job);

  const providerUrl = await ensureWritingModel();
  if (useTranslateStore.getState().jobs[key]?.id !== id) return;
  const queued = queueTranslation(args.response, args.to, providerUrl, (phase) => {
    useTranslateStore.getState().patchJob(id, { status: phase });
  }, id, isTemp(args.path) ? undefined : args.path);
  const result = await queued.result;
  const store = useTranslateStore.getState();
  if (store.jobs[key]?.id !== id) return;
  if (!result.ok) {
    if (result.reason === 'cancelled') store.setJob(key, null);
    else store.patchJob(id, { status: 'error', error: failureText(result) });
    return;
  }
  const tr = translationOf(args.response, args.to, result.text, 'ai', {
    p: args.providerLabel(result.providerUrl),
    ...(result.unmatched ? { unmatched: true as const } : {}),
  });
  await settle(key, id, args.path, args.turnIndex, args.response, tr);
}

/** Simplified to Taiwan Traditional on this computer: no request, nothing leaves the app. */
export async function convertTurnToTraditional(args: { path: string; turnIndex: number; response: string }): Promise<void> {
  const key = turnKey(args.path, args.turnIndex);
  cancelTurnTranslation(args.path, args.turnIndex);
  const id = nextId('o');
  const store = useTranslateStore.getState();
  store.setJob(key, { id, to: 'zh-TW', by: 'opencc', source: args.response, status: 'running', error: '' });
  const { t } = useI18nStore.getState();
  let text: string;
  try {
    text = await convertToTraditional(args.response);
  } catch {
    if (useTranslateStore.getState().jobs[key]?.id === id) {
      useTranslateStore.getState().patchJob(id, { status: 'error', error: t('chat.translate.error.convert') });
    }
    return;
  }
  if (useTranslateStore.getState().jobs[key]?.id !== id) return;
  if (text.trim() === args.response.trim()) {
    useTranslateStore.getState().setJob(key, null);
    showAppNotice({ message: t('chat.translate.noChange'), level: 'info' });
    return;
  }
  await settle(key, id, args.path, args.turnIndex, args.response, translationOf(args.response, 'zh-TW', text, 'opencc'));
}

export function cancelTurnTranslation(path: string, turnIndex: number): void {
  const key = turnKey(path, turnIndex);
  const job = useTranslateStore.getState().jobs[key];
  if (!job) return;
  if (translateBusy(job) && job.by === 'ai') cancelTranslation(job.id);
  useTranslateStore.getState().setJob(key, null);
}

/** Takes the translation away (the answer itself is never touched). */
export async function removeTurnTranslation(path: string, turnIndex: number, response: string): Promise<void> {
  const error = await keepTranslation(path, turnIndex, response, null);
  if (error) showAppNotice({ message: error, level: 'error' });
}
