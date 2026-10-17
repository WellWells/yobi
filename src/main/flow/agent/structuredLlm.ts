import { isByokTargetUrl } from '../../../shared/types';
import { extractJsonFromLlmResponse } from '../../../shared/llmJsonExtract';
import { compactPreview } from '../../../shared/textBudget';
import { preparePromptForProvider, runAutomation } from '../../providers';
import { isByokRetryable, runByokCompletion } from '../../providers/byokClient';
import { llmLane } from '../lanes';
import { FlowAbortError } from '../runtime';
import type { FlowExecutorDeps } from '../types';
import { sendLog } from '../../helpers';
import { maskSecrets } from './secretMask';
import { workerWindowUnavailable } from '../../workerWindowError';

export interface ProviderSession {
  threadUrl: string | null;
  lost: boolean;
  attachments?: string[];
}

export function createProviderSession(attachments?: string[]): ProviderSession {
  return { threadUrl: null, lost: false, ...(attachments?.length ? { attachments } : {}) };
}

export async function runProviderText(
  providerUrl: string,
  prompt: string,
  deps: FlowExecutorDeps,
  timeoutMs: number,
  signal?: AbortSignal,
  session?: ProviderSession,
): Promise<string> {
  if (isByokTargetUrl(providerUrl)) {
    const byokAbort = new AbortController();
    const onExternalAbort = (): void => byokAbort.abort();
    if (signal) {
      if (signal.aborted) throw new FlowAbortError();
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    try {
      const { response } = await runByokCompletion(providerUrl, prompt, timeoutMs, byokAbort.signal);
      return response;
    } finally {
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  const prepared = preparePromptForProvider(prompt, providerUrl);
  const resumeThread = session?.threadUrl ?? undefined;
  const uploads = resumeThread ? undefined : session?.attachments;
  const result = await llmLane.runExclusive(async () => {
    if (signal?.aborted) throw new FlowAbortError();
    const win = deps.ensureWorkerWin ? await deps.ensureWorkerWin() : deps.getWorkerWin();
    if (!win || win.isDestroyed()) throw workerWindowUnavailable();
    return runAutomation(win, prepared.prompt, timeoutMs, providerUrl, uploads, resumeThread);
  });
  if (session) {
    if (result.threadLost) {
      session.threadUrl = null;
      session.lost = true;
    } else {
      session.threadUrl = result.threadUrl;
      session.lost = false;
    }
  }
  return result.response;
}

const MAX_TRANSPORT_RETRIES = 2;
const TRANSPORT_BACKOFF_MS = 1_000;

export function shouldRetryTransport(err: unknown, aborted: boolean): boolean {
  if (aborted) return false;
  if (err instanceof FlowAbortError) return false;
  return isByokRetryable(err);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new FlowAbortError());
      return;
    }
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(new FlowAbortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function callWithTransportRetry(
  providerUrl: string,
  prompt: string,
  deps: FlowExecutorDeps,
  timeoutMs: number,
  signal?: AbortSignal,
  session?: ProviderSession,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_TRANSPORT_RETRIES; attempt++) {
    if (signal?.aborted) throw new FlowAbortError();
    try {
      return await runProviderText(providerUrl, prompt, deps, timeoutMs, signal, session);
    } catch (err) {
      lastError = err;
      // Browser failures can happen after submission. Replaying the prompt is not idempotent.
      if (!isByokTargetUrl(providerUrl)) {
        sendLog(`⚠️ [Agent] browser automation failed; automatic resend suppressed: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
      if (attempt >= MAX_TRANSPORT_RETRIES || !shouldRetryTransport(err, signal?.aborted ?? false)) throw err;
      await sleep(TRANSPORT_BACKOFF_MS * (attempt + 1), signal);
    }
  }
  throw lastError;
}

export interface SessionTurn {
  delta: string;
  full: string;
}

export async function runSessionText(
  providerUrl: string,
  turn: SessionTurn,
  deps: FlowExecutorDeps,
  timeoutMs: number,
  session: ProviderSession,
  signal?: AbortSignal,
): Promise<string> {
  if (isByokTargetUrl(providerUrl)) {
    return callWithTransportRetry(providerUrl, turn.full, deps, timeoutMs, signal);
  }
  if (!session.threadUrl) {
    return callWithTransportRetry(providerUrl, turn.full, deps, timeoutMs, signal, session);
  }
  const response = await callWithTransportRetry(providerUrl, turn.delta, deps, timeoutMs, signal, session);
  if (!session.lost) return response;
  session.lost = false;
  return callWithTransportRetry(providerUrl, turn.full, deps, timeoutMs, signal, session);
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

const REJECTED_PREVIEW_CHARS = 500;

/**
 * A rejected reply as one log-safe line. The reason alone ("No JSON object was found") cannot tell
 * a prose answer from a sign-in page from an empty read, and each repair costs a full round-trip.
 * Masked before it is flattened and cut: the `.env`-style rules are anchored to line starts, and a
 * token straddling the cut is still seen whole. yobi.log is plaintext.
 */
export function rejectedReplyPreview(raw: string): string {
  return compactPreview(maskSecrets(raw, true), REJECTED_PREVIEW_CHARS);
}

export interface AskJsonOptions<T> {
  basePrompt: string;
  providerUrl: string;
  deps: FlowExecutorDeps;
  timeoutMs: number;
  validate: (json: unknown) => Validation<T>;
  buildRepair: (prevRaw: string, error: string) => string;
  maxRepairs?: number;
  /** `preview` is `rejectedReplyPreview(raw)`: for a log line, never for a prompt. */
  onReject?: (error: string, attempt: number, preview: string) => void;
  signal?: AbortSignal;
  session?: ProviderSession;
  sessionPrompt?: string;
}

export interface AskJsonResult<T> {
  ok: boolean;
  value?: T;
  /** The last rejection, written for the model (it is what the repair prompt quoted back). */
  error?: string;
  /**
   * Why there is no value, for the code that has to tell a person. A request that never came back
   * throws instead, so a failed result always means every reply was rejected.
   */
  reason?: 'invalid_output';
  raw: string;
}

export async function askJson<T>(opts: AskJsonOptions<T>): Promise<AskJsonResult<T>> {
  const maxRepairs = opts.maxRepairs ?? 2;
  let prompt = opts.session ? (opts.sessionPrompt ?? opts.basePrompt) : opts.basePrompt;
  let lastRaw = '';
  let lastError = 'No response from the model';

  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const session = opts.session;
    const raw = session
      ? await runSessionText(
        opts.providerUrl,
        { delta: prompt, full: attempt === 0 ? opts.basePrompt : prompt },
        opts.deps,
        opts.timeoutMs,
        session,
        opts.signal,
      )
      : await callWithTransportRetry(opts.providerUrl, prompt, opts.deps, opts.timeoutMs, opts.signal);
    lastRaw = raw;

    const json = extractJsonFromLlmResponse(raw);
    if (json === null) {
      lastError = 'No JSON object was found in the response';
    } else {
      const verdict = opts.validate(json);
      if (verdict.ok) return { ok: true, value: verdict.value, raw };
      lastError = verdict.error;
    }

    if (attempt < maxRepairs) {
      opts.onReject?.(lastError, attempt + 1, rejectedReplyPreview(raw));
      prompt = opts.buildRepair(raw, lastError);
    }
  }

  return { ok: false, error: lastError, reason: 'invalid_output', raw: lastRaw };
}
