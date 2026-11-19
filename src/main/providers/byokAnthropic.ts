import type Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlock, BetaMessageContentParam, BetaMessageParam, BetaUsage, MessageCreateParamsBase,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { sendLog } from '../helpers';
import { BYOK_REQUEST_FAILED_PREFIX, ByokFailure, ByokRefusal, byokMessages } from './byokCore';
import type { ByokPrompt, ByokStreamResult, ByokUsage } from './byokCore';

/**
 * An Anthropic key on `api.anthropic.com` goes to the native Messages API through the official
 * SDK (`@anthropic-ai/sdk`), not the OpenAI-compatible layer: that layer ignores prompt caching
 * altogether ("Prompt caching is not supported") and reports no cached tokens, so every `/agent`
 * turn paid full price for the conversation it resent.
 */

/**
 * The Messages API requires `max_tokens`. 32,000 fits every model Anthropic still serves (the
 * smallest output cap is 32K) and costs nothing to set high: output rate limits count only the
 * tokens actually generated.
 */
export const ANTHROPIC_MAX_TOKENS = 32_000;

/** The beta that lets a request name `fallbacks`, including the `"default"` form. */
export const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Models with a server-side refusal fallback. Anthropic recommends opting in by default: on a
 * policy decline the API re-runs the same request on the model it recommends for that category,
 * inside the same call. Claude Haiku 5.5 has none (a fallback list there is a 400), and older
 * models have no `allowed_fallback_models`.
 */
const SERVER_FALLBACK_MODELS = new Set([
  'claude-fable-5-2', 'claude-fable-5-1', 'claude-fable-5',
  'claude-mythos-5-2', 'claude-mythos-5-1', 'claude-mythos-5',
  'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5',
]);

export function takesServerFallback(model: string): boolean {
  return SERVER_FALLBACK_MODELS.has(model.trim());
}

export function isAnthropicApiUrl(url: string): boolean {
  try {
    return new URL(url.trim()).hostname.toLowerCase() === 'api.anthropic.com';
  } catch {
    return false;
  }
}

type StreamParams = MessageCreateParamsBase & { betas?: string[] };

/**
 * The request. `cachePrefix` turns on automatic prompt caching (one top-level `cache_control`):
 * the breakpoint lands on the last block, and the next request of the same conversation reads
 * everything up to it back at a fraction of the price. Only a conversation asks for it — a
 * one-off prompt would pay the cache write and never read it.
 */
export function anthropicRequestBody(model: string, prompt: ByokPrompt, cachePrefix: boolean): StreamParams {
  const messages: BetaMessageParam[] = byokMessages(prompt).map(({ role, content, images }) => {
    if (!images?.length) return { role, content };
    const parts: Exclude<BetaMessageContentParam, string> = images.map((image) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: image.mimeType as 'image/png', data: image.data },
    }));
    // An empty text block is a 400; a picture sent with no words goes alone.
    if (content.trim()) parts.push({ type: 'text', text: content });
    return { role, content: parts };
  });
  const fallback = takesServerFallback(model);
  return {
    model,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    messages,
    ...(cachePrefix ? { cache_control: { type: 'ephemeral' as const } } : {}),
    ...(fallback ? { fallbacks: 'default' as const, betas: [SERVER_FALLBACK_BETA] } : {}),
  };
}

type Counts = Pick<BetaUsage, 'input_tokens' | 'output_tokens' | 'cache_creation_input_tokens' | 'cache_read_input_tokens'>;

function countsOf(raw: unknown): Counts | null {
  if (!raw || typeof raw !== 'object') return null;
  const usage = raw as Record<string, unknown>;
  const read = (name: string): number | null => {
    const value = usage[name];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  };
  const input = read('input_tokens');
  const output = read('output_tokens');
  if (input === null || output === null) return null;
  return {
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: read('cache_creation_input_tokens'),
    cache_read_input_tokens: read('cache_read_input_tokens'),
  };
}

/**
 * Anthropic's usage as `ByokUsage`. Its `input_tokens` is only the uncached part, so the total adds
 * the cache write and read back in; `cachedInput` is the read. When a fallback ran, the top-level
 * counts cover only the attempt that answered — `usage.iterations` is the per-attempt record, and
 * every sampling attempt (`message`, `fallback_message`) is summed.
 */
export function parseAnthropicUsage(raw: unknown): ByokUsage | null {
  const iterations = raw && typeof raw === 'object' ? (raw as { iterations?: unknown }).iterations : undefined;
  const attempts = Array.isArray(iterations)
    ? iterations
      .filter((entry) => entry?.type === 'message' || entry?.type === 'fallback_message')
      .map(countsOf)
      .filter((counts): counts is Counts => counts !== null)
    : [];
  const parts = attempts.length > 0 ? attempts : [countsOf(raw)].filter((counts): counts is Counts => counts !== null);
  if (parts.length === 0) return null;
  let input = 0;
  let output = 0;
  let cached: number | undefined;
  let written: number | undefined;
  for (const part of parts) {
    input += part.input_tokens + (part.cache_creation_input_tokens ?? 0) + (part.cache_read_input_tokens ?? 0);
    output += part.output_tokens;
    if (typeof part.cache_read_input_tokens === 'number') cached = (cached ?? 0) + part.cache_read_input_tokens;
    if (typeof part.cache_creation_input_tokens === 'number') written = (written ?? 0) + part.cache_creation_input_tokens;
  }
  return {
    input,
    output,
    ...(cached === undefined ? {} : { cachedInput: cached }),
    ...(written ? { cacheWriteInput: written } : {}),
  };
}

/**
 * The answer in a finished message: every text block, in order. After a mid-stream fallback the
 * declined model's partial text, a `fallback` block and the fallback model's continuation all sit
 * in `content`, and the continuation picks up from that partial, so the texts join into one reply.
 */
export function anthropicReplyText(content: readonly BetaContentBlock[]): string {
  return content
    .filter((block): block is Extract<BetaContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

/**
 * A finished message as Yobi's result. A refusal (the whole fallback chain declined) throws, and
 * so does a stream that closed with no stop reason: the SDK hands back what it had, and a
 * fragment of a JSON action must not pass for the answer. `max_tokens` is still an answer.
 */
export function settleAnthropicReply(message: {
  content: readonly BetaContentBlock[];
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  usage: unknown;
}): ByokStreamResult {
  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category;
    throw new ByokRefusal(category ? `refusal (${category})` : 'refusal');
  }
  const content = anthropicReplyText(message.content);
  if (!message.stop_reason) {
    sendLog(`⚠️ BYOK stream stopped mid-reply after ${content.length} characters; tail: ${content.slice(-200).replace(/\s+/g, ' ')}`);
    throw new ByokFailure(`${BYOK_REQUEST_FAILED_PREFIX}the reply stopped before it finished`);
  }
  return { content, usage: parseAnthropicUsage(message.usage) };
}

type Sdk = typeof import('@anthropic-ai/sdk');

/** An SDK error as the `ByokFailure` the rest of BYOK reads (status, `Retry-After`). */
function byokFailureFrom(
  sdk: Sdk, err: unknown, retryAfter: (value: string | null) => number | undefined, timeoutMs?: number,
): Error {
  const { APIError, APIConnectionTimeoutError, AnthropicError } = sdk.default;
  if (err instanceof APIConnectionTimeoutError && timeoutMs !== undefined) {
    return new Error(`${BYOK_REQUEST_FAILED_PREFIX}timed out after ${Math.ceil(timeoutMs / 1_000)} seconds`);
  }
  if (!(err instanceof APIError)) {
    // The SDK's own errors past the HTTP layer (a stream that closed before a message formed,
    // an unreadable event) all mean the reply broke off.
    if (!(err instanceof AnthropicError)) return err instanceof Error ? err : new Error(String(err));
    sendLog(`⚠️ BYOK stream broke off: ${err.message}`);
    return new ByokFailure(`${BYOK_REQUEST_FAILED_PREFIX}the reply stopped before it finished`);
  }
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const detail = typeof body?.error?.message === 'string' && body.error.message.trim() ? body.error.message.trim() : err.message;
  // The id Anthropic support asks for; the detail is left out (an error can echo the key back).
  if (err.requestID) sendLog(`⚠️ Anthropic request ${err.requestID} failed${err.status ? ` (HTTP ${err.status})` : ''}`);
  if (err.status === undefined) {
    // A connection error: name the socket's own code (ECONNRESET, ENOTFOUND) as the old path did.
    const cause = (err as { cause?: { code?: string; cause?: { code?: string } } }).cause;
    const code = cause?.code ?? cause?.cause?.code;
    return new ByokFailure(`${BYOK_REQUEST_FAILED_PREFIX}${code ?? detail}`);
  }
  return new ByokFailure(`${BYOK_REQUEST_FAILED_PREFIX}HTTP ${err.status} — ${detail}`, {
    status: err.status,
    retryAfterMs: retryAfter(err.headers?.get('retry-after') ?? null),
  });
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * A client for one key. Retries stay off (`maxRetries: 0`): BYOK retries and fails over between
 * keys itself. `fetch` is looked up per call so a stubbed global reaches the SDK.
 */
function anthropicClient(sdk: Sdk, apiKey: string, baseUrl: string, timeoutMs: number, fetch?: Fetch): Anthropic {
  return new sdk.default({
    apiKey,
    baseURL: new URL(baseUrl.trim()).origin,
    maxRetries: 0,
    timeout: timeoutMs,
    fetch: fetch ?? ((input, init) => globalThis.fetch(input, init)),
  });
}

const noRetryAfter = (): undefined => undefined;

/** Every model id the key can use (the SDK walks the pages). */
export async function listAnthropicModels(apiKey: string, baseUrl: string, timeoutMs: number): Promise<string[]> {
  const sdk = await import('@anthropic-ai/sdk');
  try {
    const ids: string[] = [];
    for await (const model of anthropicClient(sdk, apiKey, baseUrl, timeoutMs).models.list({ limit: 1_000 })) ids.push(model.id);
    return ids;
  } catch (err: unknown) {
    throw byokFailureFrom(sdk, err, noRetryAfter, timeoutMs);
  }
}

/** The model's `max_input_tokens`, or undefined when Anthropic does not report one. */
export async function anthropicModelInputTokens(
  apiKey: string, baseUrl: string, model: string, timeoutMs: number,
): Promise<number | undefined> {
  const sdk = await import('@anthropic-ai/sdk');
  try {
    const info = await anthropicClient(sdk, apiKey, baseUrl, timeoutMs).models.retrieve(model);
    const tokens = info.max_input_tokens;
    return typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : undefined;
  } catch (err: unknown) {
    throw byokFailureFrom(sdk, err, noRetryAfter, timeoutMs);
  }
}

export interface AnthropicChatRequest {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: ByokPrompt;
  cachePrefix: boolean;
  /** No bytes from the network for this long ends the request; three times it is the hard cap. */
  idleTimeoutMs: number;
  totalTimeoutMs: number;
  signal?: AbortSignal;
  retryAfter: (value: string | null) => number | undefined;
}

/**
 * One streamed request through the SDK. The idle clock runs on the bytes the network delivers,
 * not on SDK events: a long thinking phase sends only pings, which the SDK does not surface.
 */
export async function streamAnthropicChat(request: AnthropicChatRequest): Promise<ByokStreamResult> {
  const sdk = await import('@anthropic-ai/sdk');
  const { signal, idleTimeoutMs, totalTimeoutMs } = request;
  const controller = new AbortController();
  let abortedByIdle = false;
  let abortedByDeadline = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const deadlineTimer = setTimeout(() => { abortedByDeadline = true; controller.abort(); }, totalTimeoutMs);
  const resetIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { abortedByIdle = true; controller.abort(); }, idleTimeoutMs);
  };
  const onExternalAbort = (): void => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(deadlineTimer);
      throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}aborted`);
    }
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const watchedFetch: Fetch = async (input, init) => {
    const response = await globalThis.fetch(input, init);
    resetIdle();
    if (!response.body) return response;
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, out) {
        resetIdle();
        out.enqueue(chunk);
      },
    }));
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };

  const client = anthropicClient(sdk, request.apiKey, request.baseUrl, totalTimeoutMs, watchedFetch);

  let text = '';
  try {
    resetIdle();
    const stream = client.beta.messages.stream(
      anthropicRequestBody(request.model, request.prompt, request.cachePrefix),
      { signal: controller.signal },
    );
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') text += event.delta.text;
    }
    return settleAnthropicReply(await stream.finalMessage());
  } catch (err: unknown) {
    if (err instanceof ByokRefusal) throw err;
    if (signal?.aborted) throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}aborted`);
    if (abortedByIdle || abortedByDeadline) {
      // What arrived before the cut is handed on, as on every BYOK endpoint.
      if (text.trim()) return { content: text.trim(), usage: null };
      throw new Error(abortedByDeadline
        ? `${BYOK_REQUEST_FAILED_PREFIX}still streaming after ${Math.ceil(totalTimeoutMs / 1_000)} seconds — gave up`
        : `${BYOK_REQUEST_FAILED_PREFIX}timed out after ${Math.ceil(idleTimeoutMs / 1_000)} seconds with no output`);
    }
    throw byokFailureFrom(sdk, err, request.retryAfter);
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(deadlineTimer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}
