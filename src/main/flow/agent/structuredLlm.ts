import { isByokTargetUrl } from '../../../shared/types';
import { extractJsonFromLlmResponse } from '../../../shared/llmJsonExtract';
import { wholeCharsWithin } from '../../../shared/textBudget';
import { preparePromptForProvider, runAutomation } from '../../providers';
import { isByokRetryable, runByokCompletion } from '../../providers/byokClient';
import type { ByokImage, ByokPrompt } from '../../providers/byokClient';
import { withByokImages } from '../../providers/byokImages';
import { llmLane } from '../lanes';
import { FlowAbortError } from '../runtime';
import type { FlowExecutorDeps } from '../types';
import { sendLog } from '../../helpers';
import { maskSecrets } from './secretMask';
import { acceptReply, createByokTranscript, dropPending, openTurn, rejectReply } from './byokTranscript';
import type { ByokTranscript } from './byokTranscript';
import { workerWindowUnavailable } from '../../workerWindowError';
import { clickStopGeneration } from '../../providers/stopGeneration';

export interface ProviderSession {
  threadUrl: string | null;
  lost: boolean;
  attachments?: string[];
  /** A BYOK run's own conversation (`byokTranscript.ts`); absent for a one-off BYOK request. */
  transcript?: ByokTranscript;
  /**
   * The pictures a BYOK run was given. An API key keeps no thread, so they ride on the opening
   * message of every request — the way a browser thread keeps its first upload in view.
   */
  images?: readonly ByokImage[];
}

export function createProviderSession(
  attachments?: string[],
  byokTranscript = false,
  images?: readonly ByokImage[],
): ProviderSession {
  return {
    threadUrl: null,
    lost: false,
    ...(attachments?.length ? { attachments } : {}),
    ...(byokTranscript ? { transcript: createByokTranscript() } : {}),
    ...(images?.length ? { images } : {}),
  };
}

export async function runProviderText(
  providerUrl: string,
  prompt: ByokPrompt,
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
      const { response } = await runByokCompletion(
        providerUrl,
        withByokImages(prompt, session?.images),
        timeoutMs,
        byokAbort.signal,
        // A run with a conversation resends this prompt as the head of its next request.
        session?.transcript ? { cachePrefix: true, conversationId: session.transcript.id } : {},
      );
      return response;
    } finally {
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  // A browser provider keeps its own thread; only a BYOK run sends the conversation itself.
  if (typeof prompt !== 'string') throw new Error('A multi-turn prompt is only sent to a BYOK provider');
  const resumeThread = session?.threadUrl ?? undefined;
  const uploads = resumeThread ? undefined : session?.attachments;
  const result = await llmLane.runExclusive(async () => {
    if (signal?.aborted) throw new FlowAbortError();
    // Prepared once the lane is ours: a Gemini run queued ahead can lower the cap this is cut to.
    const prepared = preparePromptForProvider(prompt, providerUrl);
    const win = deps.ensureWorkerWin ? await deps.ensureWorkerWin() : deps.getWorkerWin();
    if (!win || win.isDestroyed()) throw workerWindowUnavailable();
    // Stopped while the page answers: the site's own stop ends it, so the worker is free at once.
    const stopPage = (): void => {
      if (!win.isDestroyed()) void clickStopGeneration(win.webContents, providerUrl);
    };
    signal?.addEventListener('abort', stopPage, { once: true });
    try {
      // A session goes on in the same thread, so it is a normal chat; a sessionless ask is a
      // one-shot and follows the temporary-chat setting.
      return await runAutomation(win, prepared.prompt, timeoutMs, providerUrl, uploads, resumeThread, false, session ? false : undefined);
    } finally {
      signal?.removeEventListener('abort', stopPage);
    }
  });
  // A cut-short answer from a stopped page is not an answer.
  if (signal?.aborted) throw new FlowAbortError();
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
/** The longest a rate-limited turn waits on the endpoint's `Retry-After` before trying again. */
export const RATE_LIMIT_WAIT_MAX_MS = 60_000;

/**
 * How long to wait before the next try. A 429 that names its wait (`Retry-After`) waits that long,
 * at most `RATE_LIMIT_WAIT_MAX_MS` and never past the turn's own deadline: retrying sooner only
 * spends the retry inside the window the endpoint said to sit out. Anything else keeps the 1 s /
 * 2 s backoff.
 */
export function transportRetryDelayMs(err: unknown, attempt: number, remainingMs: number): number {
  const backoff = TRANSPORT_BACKOFF_MS * (attempt + 1);
  // Read by shape (a `ByokFailure` carries both): the same check whichever module built the error.
  const failure = err as { status?: unknown; retryAfterMs?: unknown } | null;
  if (failure?.status !== 429 || typeof failure.retryAfterMs !== 'number') return backoff;
  return Math.max(0, Math.min(failure.retryAfterMs, RATE_LIMIT_WAIT_MAX_MS, remainingMs));
}

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
  prompt: ByokPrompt,
  deps: FlowExecutorDeps,
  timeoutMs: number,
  signal?: AbortSignal,
  session?: ProviderSession,
): Promise<string> {
  let lastError: unknown;
  const deadline = Date.now() + timeoutMs;
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
      await sleep(transportRetryDelayMs(err, attempt, deadline - Date.now()), signal);
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
    // On BYOK the session carries only the run's pictures; there is no thread to resume.
    return callWithTransportRetry(providerUrl, turn.full, deps, timeoutMs, signal, session);
  }
  if (!session.threadUrl) {
    return callWithTransportRetry(providerUrl, turn.full, deps, timeoutMs, signal, session);
  }
  const response = await callWithTransportRetry(providerUrl, turn.delta, deps, timeoutMs, signal, session);
  if (!session.lost) return response;
  session.lost = false;
  return callWithTransportRetry(providerUrl, turn.full, deps, timeoutMs, signal, session);
}

/** `otherwise`: worth one more ask, but good enough when no repair is left. */
export type Validation<T> = { ok: true; value: T } | { ok: false; error: string; otherwise?: T };

export const REJECTED_PREVIEW_HEAD = 40_000;
export const REJECTED_PREVIEW_TAIL = 10_000;
const LINE_SEPARATORS = new RegExp('[\\u2028\\u2029]', 'g');

/**
 * A rejected reply, whole, as one log-safe line: the exact text escaped as a JSON string body, so
 * a newline, a line-end backslash or an `&#x20;` stays visible — a whitespace-collapsed preview hid
 * exactly the characters that broke a parse. Only a reply past head + tail loses its middle, and
 * says how much. Masked before it is cut: the `.env`-style rules are anchored to line starts, and a
 * token straddling the cut is still seen whole. yobi.log is plaintext.
 */
export function rejectedReplyPreview(raw: string): string {
  const masked = maskSecrets(raw, true);
  // JSON.stringify leaves U+2028/U+2029 raw, and a log viewer breaks the line on them.
  const escape = (text: string): string => JSON.stringify(text).slice(1, -1).replace(LINE_SEPARATORS, (ch) => `\\u${ch.charCodeAt(0).toString(16)}`);
  if (masked.length <= REJECTED_PREVIEW_HEAD + REJECTED_PREVIEW_TAIL) return escape(masked);
  const head = wholeCharsWithin(masked, REJECTED_PREVIEW_HEAD);
  const tailStart = masked.length - REJECTED_PREVIEW_TAIL;
  // Never start the tail on the second half of a surrogate pair.
  const tail = masked.slice(/[\uDC00-\uDFFF]/.test(masked[tailStart]) ? tailStart + 1 : tailStart);
  const omitted = masked.length - head.length - tail.length;
  return `${escape(head)}…[${omitted} chars]…${escape(tail)}`;
}

export interface AskJsonOptions<T> {
  basePrompt: string;
  providerUrl: string;
  deps: FlowExecutorDeps;
  timeoutMs: number;
  validate: (json: unknown) => Validation<T>;
  /**
   * The rejection for a reply with no JSON in it, read from that reply; undefined (or no function)
   * keeps the generic one. Lets a caller name what the model did instead of answering in JSON.
   */
  noJsonError?: (raw: string) => string | undefined;
  buildRepair: (prevRaw: string, error: string) => string;
  /**
   * The repair message for a BYOK conversation, where the rejected reply is already in the
   * conversation and the rules are in its first message — so it is the reason alone, not the whole
   * prompt again. Falls back to `buildRepair` when omitted.
   */
  transcriptRepair?: (error: string) => string;
  maxRepairs?: number;
  /** `preview` is `rejectedReplyPreview(raw)`: for a log line, never for a prompt. */
  onReject?: (error: string, attempt: number, preview: string) => void;
  /** Just before each request goes out: 0 for the first, then one per repair. */
  onAttempt?: (attempt: number) => void;
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

/**
 * `askJson` with any reading of the reply: `read` parses and checks the raw text (it may take time —
 * a skill draft runs its scripts' tests there), and a rejection is repaired like a bad JSON reply,
 * from the same repair budget.
 */
export interface AskStructuredOptions<T> extends Omit<AskJsonOptions<T>, 'validate'> {
  read: (raw: string) => Validation<T> | Promise<Validation<T>>;
}

const NO_JSON_ERROR = 'No JSON object was found in the response';

function jsonReader<T>(
  validate: (json: unknown) => Validation<T>,
  noJsonError?: (raw: string) => string | undefined,
): (raw: string) => Validation<T> {
  return (raw) => {
    const json = extractJsonFromLlmResponse(raw);
    if (json === null) return { ok: false, error: noJsonError?.(raw) ?? NO_JSON_ERROR };
    const checked = validate(json);
    // Prose holding a bracket ("[image](…)", "[1]") reads as a JSON array: still no object, so
    // the reply gets the same specific reason as prose with nothing in it.
    if (checked.ok || (typeof json === 'object' && json !== null && !Array.isArray(json))) return checked;
    return { ok: false, error: noJsonError?.(raw) ?? checked.error };
  };
}

/**
 * `askStructured` for a BYOK run that keeps a conversation: each request is the conversation so far
 * plus this turn's message; a rejected reply and its repair ride along until a reply passes, and
 * only that reply is kept.
 */
async function askInTranscript<T>(opts: AskStructuredOptions<T>, transcript: ByokTranscript): Promise<AskJsonResult<T>> {
  const maxRepairs = opts.maxRepairs ?? 2;
  // No delta means there is nothing to append to: the full prompt starts the conversation over.
  const delta = transcript.messages.length > 0 ? opts.sessionPrompt : undefined;
  if (delta === undefined) transcript.messages = [];
  let messages = openTurn(transcript, delta ?? opts.basePrompt);
  let lastRaw = '';
  let lastError = 'No response from the model';

  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    let raw: string;
    // A one-message conversation goes out as the plain prompt it is — the same request as before
    // a conversation existed.
    const payload: ByokPrompt = messages.length === 1 ? messages[0].content : messages;
    opts.onAttempt?.(attempt);
    try {
      raw = await callWithTransportRetry(opts.providerUrl, payload, opts.deps, opts.timeoutMs, opts.signal, opts.session);
    } catch (err) {
      dropPending(transcript);
      throw err;
    }
    lastRaw = raw;

    const verdict = await opts.read(raw);
    if (verdict.ok) {
      acceptReply(transcript, raw);
      return { ok: true, value: verdict.value, raw };
    }
    if (attempt === maxRepairs && verdict.otherwise !== undefined) {
      acceptReply(transcript, raw);
      return { ok: true, value: verdict.otherwise, raw };
    }
    lastError = verdict.error;

    if (attempt < maxRepairs) {
      opts.onReject?.(lastError, attempt + 1, rejectedReplyPreview(raw));
      const repair = opts.transcriptRepair ? opts.transcriptRepair(lastError) : opts.buildRepair(raw, lastError);
      messages = rejectReply(transcript, raw, repair);
    }
  }

  dropPending(transcript);
  return { ok: false, error: lastError, reason: 'invalid_output', raw: lastRaw };
}

export async function askStructured<T>(opts: AskStructuredOptions<T>): Promise<AskJsonResult<T>> {
  const transcript = isByokTargetUrl(opts.providerUrl) ? opts.session?.transcript : undefined;
  if (transcript) return askInTranscript(opts, transcript);
  const maxRepairs = opts.maxRepairs ?? 2;
  let prompt = opts.session ? (opts.sessionPrompt ?? opts.basePrompt) : opts.basePrompt;
  let lastRaw = '';
  let lastError = 'No response from the model';

  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const session = opts.session;
    opts.onAttempt?.(attempt);
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

    const verdict = await opts.read(raw);
    if (verdict.ok) return { ok: true, value: verdict.value, raw };
    if (attempt === maxRepairs && verdict.otherwise !== undefined) return { ok: true, value: verdict.otherwise, raw };
    lastError = verdict.error;

    if (attempt < maxRepairs) {
      opts.onReject?.(lastError, attempt + 1, rejectedReplyPreview(raw));
      prompt = opts.buildRepair(raw, lastError);
    }
  }

  return { ok: false, error: lastError, reason: 'invalid_output', raw: lastRaw };
}

export function askJson<T>(opts: AskJsonOptions<T>): Promise<AskJsonResult<T>> {
  const { validate, noJsonError, ...rest } = opts;
  return askStructured({ ...rest, read: jsonReader(validate, noJsonError) });
}
