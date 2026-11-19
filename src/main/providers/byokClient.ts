import { byokIdFromUrl, byokGroupIdFromUrl, byokTypeTakesImages, isByokGroupUrl } from '../../shared/types';
import type { ByokGroup } from '../../shared/types';
import { config } from '../config';
import type { ByokInstance } from '../configTypes';
import { sendLog } from '../helpers';
import { meterReported, meterText } from '../tokenMeter';
import { meterLlmRequest, noteKeyCooldown, noteKeyResult } from '../llmMeter';
import { classifyFailure } from '../metricsNormalize';
import { estimateTokens } from '../../shared/tokenEstimate';
import { Semaphore } from '../flow/lanes';
import {
  BYOK_REQUEST_FAILED_PREFIX, ByokFailure, ByokRefusal, byokMessages, extractApiErrorDetail, refusalOf,
} from './byokCore';
import type { ByokChatStream, ByokPrompt, ByokStreamResult, ByokUsage } from './byokCore';
import { isAnthropicApiUrl, listAnthropicModels, streamAnthropicChat } from './byokAnthropic';
import { cacheHintsFor, hasCacheHints } from './byokCacheHints';
import type { CacheHintOptions } from './byokCacheHints';

export {
  BYOK_REFUSED_PREFIX, BYOK_REQUEST_FAILED_PREFIX, ByokFailure, ByokRefusal, refusalOf,
} from './byokCore';
export type { ByokChatMessage, ByokImage, ByokPrompt, ByokUsage } from './byokCore';

export const BYOK_INSTANCE_MISSING_ERROR = 'BYOK provider not found — the instance may have been deleted';
export const BYOK_GROUP_MISSING_ERROR = 'BYOK group not found — it may have been deleted';
export const BYOK_GROUP_EMPTY_ERROR = 'BYOK group has no usable keys — add at least one key to the group';
export const BYOK_CONFIG_INCOMPLETE_PREFIX = 'BYOK configuration incomplete: ';

const COOLDOWN_STATUSES = new Set([429, 503]);

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429]);

const PERMANENT_SERVER_STATUSES = new Set([501, 505]);

const MIN_COOLDOWN_MS = 1_000;
const MAX_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_COOLDOWN_MS = 60_000;

export function isByokRetryable(err: unknown): boolean {
  if (err instanceof ByokRefusal) return false;
  if (!(err instanceof ByokFailure) || err.status === undefined) return true;
  if (PERMANENT_SERVER_STATUSES.has(err.status)) return false;
  const refusedByEndpoint = err.status >= 400 && err.status < 500;
  return refusedByEndpoint ? RETRYABLE_STATUSES.has(err.status) : true;
}

export function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header?.trim()) return undefined;
  const clamp = (ms: number): number => Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, ms));
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return clamp(seconds * 1_000);
  const when = Date.parse(header);
  return Number.isFinite(when) ? clamp(when - Date.now()) : undefined;
}

export interface ByokEndpoint {
  baseUrl: string;
  apiKey: string;
  model?: string;
  label?: string;
  id?: string;
  /** The key's preset reads pictures (`byokTypeTakesImages`). */
  takesImages?: true;
}

/** A rough per-picture input cost, for the estimate of an endpoint that reports no usage. */
const IMAGE_TOKEN_ESTIMATE = 1_500;

export const BYOK_NO_IMAGE_KEY_ERROR = 'BYOK group has no key that takes images';

type WireContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

/** The OpenAI-compatible shape: a message with pictures becomes parts, pictures before the text. */
function wireMessages(prompt: ByokPrompt): { role: string; content: WireContent }[] {
  return byokMessages(prompt).map(({ role, content, images }) => {
    if (!images?.length) return { role, content };
    return {
      role,
      content: [
        ...images.map((image) => ({
          type: 'image_url' as const,
          image_url: { url: `data:${image.mimeType};base64,${image.data}` },
        })),
        { type: 'text' as const, text: content },
      ],
    };
  });
}

export function byokPromptImageCount(prompt: ByokPrompt): number {
  if (typeof prompt === 'string') return 0;
  return prompt.reduce((sum, message) => sum + (message.images?.length ?? 0), 0);
}

/** The text a request carries, for the token estimate an endpoint without usage reporting needs. */
export function byokPromptText(prompt: ByokPrompt): string {
  return typeof prompt === 'string' ? prompt : prompt.map((message) => message.content).join('\n\n');
}

export function findByokInstanceByUrl(url: string): ByokInstance | null {
  const id = byokIdFromUrl(url);
  if (!id) return null;
  return config.byokInstances.find((instance) => instance.id === id) ?? null;
}

function findByokGroupByUrl(url: string): ByokGroup | null {
  const id = byokGroupIdFromUrl(url);
  if (!id) return null;
  return config.byokGroups.find((group) => group.id === id) ?? null;
}

export function getByokLabel(url: string): string {
  if (isByokGroupUrl(url)) return findByokGroupByUrl(url)?.name ?? 'BYOK';
  return findByokInstanceByUrl(url)?.name ?? 'BYOK';
}

export function byokConcurrencyCeiling(url: string): number {
  if (!isByokGroupUrl(url)) return 1;
  const group = findByokGroupByUrl(url);
  if (!group) return 1;
  const usable = group.memberIds.filter(
    (memberId) => config.byokInstances.some((instance) => instance.id === memberId),
  ).length;
  return Math.max(1, usable);
}

function endpointForInstance(instance: ByokInstance): ByokEndpoint {
  return {
    baseUrl: instance.baseUrl,
    apiKey: instance.apiKey,
    model: instance.model,
    label: instance.name,
    id: instance.id,
    ...(byokTypeTakesImages(instance.providerType) ? { takesImages: true } : {}),
  };
}

/** Whether the key behind `url` takes pictures; a group does when any of its keys does. */
export function byokTargetTakesImages(url: string): boolean {
  if (isByokGroupUrl(url)) {
    const group = findByokGroupByUrl(url);
    return group?.memberIds.some((memberId) => {
      const member = config.byokInstances.find((instance) => instance.id === memberId);
      return member ? byokTypeTakesImages(member.providerType) : false;
    }) ?? false;
  }
  const instance = findByokInstanceByUrl(url);
  return instance ? byokTypeTakesImages(instance.providerType) : false;
}

const groupRotation = new Map<string, number>();

const keyCooldown = new Map<string, number>();

/**
 * One request in flight per key, across the whole app: callers nest (concurrent `research` calls
 * each fan out). Keyed by instance, not group URL: a key in two groups is still one key to the
 * provider's rate limiter.
 */
const keySlots = new Map<string, Semaphore>();

export function byokKeySlot(id: string): Semaphore {
  let slot = keySlots.get(id);
  if (!slot) {
    slot = new Semaphore(1);
    keySlots.set(id, slot);
  }
  return slot;
}

function isKeyBusy(id: string | undefined): boolean {
  return id ? keySlots.get(id)?.busy === true : false;
}

/**
 * Runs `call` holding the key's slot. A cancel lands immediately even while queued, and is
 * reported the same way as an in-flight cancel.
 */
async function callInKeySlot<T>(id: string, call: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const slot = byokKeySlot(id);
  try {
    await slot.acquire(signal);
  } catch {
    throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}aborted`);
  }
  try {
    // A request that waited out someone else's call may have been cancelled as the slot came free.
    if (signal?.aborted) throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}aborted`);
    return await call();
  } finally {
    slot.release();
  }
}

function cooldownUntil(id: string | undefined): number {
  return id ? keyCooldown.get(id) ?? 0 : 0;
}

export function markKeyCooling(id: string, retryAfterMs: number | undefined): void {
  keyCooldown.set(id, Date.now() + (retryAfterMs ?? DEFAULT_COOLDOWN_MS));
}

export function clearByokCooldowns(): void {
  keyCooldown.clear();
}

export function orderGroupMembers(groupId: string, members: ByokInstance[]): ByokInstance[] {
  const start = (groupRotation.get(groupId) ?? 0) % members.length;
  groupRotation.set(groupId, start + 1);
  const rotated: ByokInstance[] = [];
  for (let offset = 0; offset < members.length; offset++) {
    rotated.push(members[(start + offset) % members.length]);
  }
  const now = Date.now();
  // An idle key first, so concurrent callers spread across the group instead of queueing on the
  // one the rotation happened to name. Only among READY keys: a busy key frees up in seconds,
  // while a cooling one is likely to answer the next request with another 429.
  const ready = rotated
    .filter((instance) => cooldownUntil(instance.id) <= now)
    .sort((a, b) => Number(isKeyBusy(a.id)) - Number(isKeyBusy(b.id)));
  const cooling = rotated
    .filter((instance) => cooldownUntil(instance.id) > now)
    .sort((a, b) => cooldownUntil(a.id) - cooldownUntil(b.id));
  return [...ready, ...cooling];
}

/**
 * The keys a BYOK URL stands for, in config order and without touching the group rotation: one
 * instance for `byok://`, the group's existing members for `byokgroup://`. Throws like a request
 * would when the instance or group is gone or the group has no keys left.
 */
export function byokInstancesForUrl(url: string): ByokInstance[] {
  if (isByokGroupUrl(url)) {
    const group = findByokGroupByUrl(url);
    if (!group) throw new Error(BYOK_GROUP_MISSING_ERROR);
    const members = group.memberIds
      .map((memberId) => config.byokInstances.find((instance) => instance.id === memberId))
      .filter((instance): instance is ByokInstance => Boolean(instance));
    if (members.length === 0) throw new Error(BYOK_GROUP_EMPTY_ERROR);
    return members;
  }
  const instance = findByokInstanceByUrl(url);
  if (!instance) throw new Error(BYOK_INSTANCE_MISSING_ERROR);
  return [instance];
}

function resolveByokTryList(url: string): ByokEndpoint[] {
  const instances = byokInstancesForUrl(url);
  const groupId = isByokGroupUrl(url) ? byokGroupIdFromUrl(url) : null;
  return (groupId ? orderGroupMembers(groupId, instances) : instances).map(endpointForInstance);
}

function buildCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}

function buildModelsUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/models`;
}

function assertEndpoint(cfg: ByokEndpoint, needModel: boolean): void {
  const suffix = cfg.label?.trim() ? ` for "${cfg.label.trim()}"` : '';
  if (!cfg.apiKey) throw new Error(`${BYOK_CONFIG_INCOMPLETE_PREFIX}API key is not set${suffix}`);
  if (!cfg.baseUrl) throw new Error(`${BYOK_CONFIG_INCOMPLETE_PREFIX}base URL is not set${suffix}`);
  if (needModel && !cfg.model) throw new Error(`${BYOK_CONFIG_INCOMPLETE_PREFIX}model is not set${suffix}`);
}

/** The refusal in a whole (non-streamed) completion body, or null. */
function refusalInBody(bodyText: string): ByokRefusal | null {
  try {
    const parsed = JSON.parse(bodyText) as { choices?: { message?: { refusal?: unknown }; finish_reason?: unknown }[] };
    const choice = parsed?.choices?.[0];
    const text = typeof choice?.message?.refusal === 'string' ? choice.message.refusal : '';
    return refusalOf(typeof choice?.finish_reason === 'string' ? choice.finish_reason : '', text);
  } catch {
    return null;
  }
}

function extractCompletionContent(bodyText: string): string | null {
  try {
    const parsed = JSON.parse(bodyText) as { choices?: { message?: { content?: unknown } }[] };
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.trim();
  } catch {
  }
  return null;
}

function tokenCount(value: unknown, input: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(input, Math.round(value));
}

function promptDetails(usage: Record<string, unknown>): Record<string, unknown> {
  const details = usage.prompt_tokens_details;
  return details && typeof details === 'object' ? details as Record<string, unknown> : {};
}

function readCachedInput(usage: Record<string, unknown>, input: number): number | undefined {
  return tokenCount(promptDetails(usage).cached_tokens ?? usage.cached_tokens, input);
}

/**
 * Tokens written to the cache: OpenAI (GPT-5.6+) and OpenRouter report `cache_write_tokens`,
 * Qwen's explicit cache `cache_creation_input_tokens`, both inside `prompt_tokens_details`.
 */
function readCacheWriteInput(usage: Record<string, unknown>, input: number): number | undefined {
  const details = promptDetails(usage);
  return tokenCount(details.cache_write_tokens ?? details.cache_creation_input_tokens, input);
}

export function parseByokUsage(raw: unknown): ByokUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const usage = raw as Record<string, unknown>;
  const { prompt_tokens: input, completion_tokens: output } = usage;
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null;
  const rounded = Math.round(input);
  const cachedInput = readCachedInput(usage, rounded);
  const cacheWriteInput = readCacheWriteInput(usage, rounded);
  return {
    input: rounded,
    output: Math.round(output),
    ...(cachedInput === undefined ? {} : { cachedInput }),
    ...(cacheWriteInput ? { cacheWriteInput } : {}),
  };
}

export function extractCompletionUsage(bodyText: string): ByokUsage | null {
  try {
    return parseByokUsage((JSON.parse(bodyText) as { usage?: unknown })?.usage);
  } catch {
    return null;
  }
}

function parseModelIds(bodyText: string): string[] {
  let list: unknown;
  try {
    const parsed = JSON.parse(bodyText) as { data?: unknown; models?: unknown };
    list = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed?.models) ? parsed.models : null;
  } catch {
    throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}the endpoint did not return a model list`);
  }
  if (!Array.isArray(list)) {
    throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}the endpoint did not return a model list`);
  }
  const ids = new Set<string>();
  for (const item of list) {
    const id = typeof item === 'string'
      ? item
      : (item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined);
    if (typeof id === 'string' && id.trim()) ids.add(id.trim());
  }
  return Array.from(ids).sort((a, b) => a.localeCompare(b));
}

export async function fetchWithByokTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = (): void => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}aborted`);
    }
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const mapTransportError = (err: unknown): Error => {
    if (signal?.aborted) return new Error(`${BYOK_REQUEST_FAILED_PREFIX}aborted`);
    if (controller.signal.aborted) {
      return new Error(`${BYOK_REQUEST_FAILED_PREFIX}timed out after ${Math.ceil(timeoutMs / 1_000)} seconds`);
    }
    const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
    const detail = cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err));
    return new Error(`${BYOK_REQUEST_FAILED_PREFIX}${detail}`);
  };

  try {
    let httpResponse: Response;
    let bodyText: string;
    try {
      httpResponse = await fetch(url, { ...init, signal: controller.signal });
      bodyText = await httpResponse.text();
    } catch (err: unknown) {
      throw mapTransportError(err);
    }
    if (!httpResponse.ok) {
      throw new ByokFailure(
        `${BYOK_REQUEST_FAILED_PREFIX}HTTP ${httpResponse.status} — ${extractApiErrorDetail(bodyText)}`,
        {
          status: httpResponse.status,
          retryAfterMs: parseRetryAfter(httpResponse.headers.get('retry-after')),
        },
      );
    }
    return bodyText;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

const STREAM_TOTAL_TIMEOUT_FACTOR = 3;

/**
 * An error some OpenAI-compatible endpoints (Gemini's) write into a stream after it began: a bare
 * JSON object or one-element array with `error`, not on a `data:` line. Read as the HTTP error it
 * stands for, so an overloaded model cools its key down like a 503 response would.
 */
export function trailingStreamError(rawBody: string): ByokFailure | null {
  const rest = rawBody
    .split(/\r?\n/)
    .filter((line) => !/^\s*(data:|:|event:|id:|retry:)/.test(line))
    .join('\n')
    .trim();
  if (!rest.startsWith('{') && !rest.startsWith('[')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rest);
  } catch {
    return null;
  }
  const body = (Array.isArray(parsed) ? parsed[0] : parsed) as { error?: { code?: unknown; message?: unknown } } | undefined;
  const error = body?.error;
  if (!error) return null;
  const status = typeof error.code === 'number' ? error.code : undefined;
  const message = typeof error.message === 'string' && error.message.trim() ? error.message.trim() : extractApiErrorDetail(rest);
  return new ByokFailure(
    `${BYOK_REQUEST_FAILED_PREFIX}${status ? `HTTP ${status} — ` : ''}${message}`,
    status ? { status } : {},
  );
}

/** Reads an OpenAI-compatible `chat/completions` stream (`data:` chunks ending in `[DONE]`). */
function openAiStream(): ByokChatStream {
  let content = '';
  let finishReason = '';
  let refusalText = '';
  let usage: ByokUsage | null = null;
  let sawDone = false;
  return {
    consumeLine(rawLine) {
      const line = rawLine.trim();
      if (!line || line.startsWith(':')) return undefined;
      if (!line.startsWith('data:')) return undefined;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        sawDone = true;
        return 'done';
      }
      let parsed: {
        choices?: { delta?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[];
        error?: { message?: unknown };
        usage?: unknown;
      };
      try {
        parsed = JSON.parse(data);
      } catch {
        return undefined;
      }
      if (parsed.error) throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}${extractApiErrorDetail(data)}`);
      usage = parseByokUsage(parsed.usage) ?? usage;
      const choice = parsed.choices?.[0];
      const piece = choice?.delta?.content;
      if (typeof piece === 'string') content += piece;
      if (typeof choice?.delta?.refusal === 'string') refusalText += choice.delta.refusal;
      if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
      return undefined;
    },
    // A refusal wins over whatever text came first: a filter that stops a reply mid-stream leaves
    // a fragment that must not be handed on as the answer.
    finish(rawBody) {
      const refused = refusalOf(finishReason, refusalText) ?? (content.trim() ? null : refusalInBody(rawBody));
      if (refused) throw refused;
      // A stream that stopped without saying it was finished. Taken as the whole reply it is a
      // fragment that can still parse (a tool call with half an argument).
      if (!sawDone && !finishReason) {
        const trailing = trailingStreamError(rawBody);
        if (trailing) throw trailing;
      }
      if (content.trim() && !sawDone && !finishReason) {
        sendLog(`⚠️ BYOK stream stopped mid-reply after ${content.length} characters; tail: ${rawBody.slice(-200).replace(/\s+/g, ' ')}`);
        throw new ByokFailure(`${BYOK_REQUEST_FAILED_PREFIX}the reply stopped before it finished`);
      }
      return {
        content: content.trim() || (extractCompletionContent(rawBody) ?? ''),
        usage: usage ?? extractCompletionUsage(rawBody),
      };
    },
    partial() {
      return { content: content.trim(), usage };
    },
    whole(bodyText) {
      const refused = refusalInBody(bodyText);
      if (refused) throw refused;
      return { content: extractCompletionContent(bodyText) ?? '', usage: extractCompletionUsage(bodyText) };
    },
  };
}

async function streamByokChat(
  url: string,
  init: RequestInit,
  idleTimeoutMs: number,
  stream: ByokChatStream,
  signal?: AbortSignal,
): Promise<ByokStreamResult> {
  const controller = new AbortController();
  let abortedByIdle = false;
  let abortedByDeadline = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const totalTimeoutMs = idleTimeoutMs * STREAM_TOTAL_TIMEOUT_FACTOR;
  const deadlineTimer = setTimeout(() => { abortedByDeadline = true; controller.abort(); }, totalTimeoutMs);
  const resetIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { abortedByIdle = true; controller.abort(); }, idleTimeoutMs);
  };
  const onExternalAbort = (): void => controller.abort();
  if (signal) {
    if (signal.aborted) throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}aborted`);
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const mapTransportError = (err: unknown): Error => {
    if (signal?.aborted) return new Error(`${BYOK_REQUEST_FAILED_PREFIX}aborted`);
    if (abortedByDeadline) {
      return new Error(`${BYOK_REQUEST_FAILED_PREFIX}still streaming after ${Math.ceil(totalTimeoutMs / 1_000)} seconds — gave up`);
    }
    if (abortedByIdle) {
      return new Error(`${BYOK_REQUEST_FAILED_PREFIX}timed out after ${Math.ceil(idleTimeoutMs / 1_000)} seconds with no output`);
    }
    const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
    const detail = cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err));
    return new Error(`${BYOK_REQUEST_FAILED_PREFIX}${detail}`);
  };

  try {
    resetIdle();
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (err: unknown) {
      throw mapTransportError(err);
    }
    resetIdle();

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new ByokFailure(
        `${BYOK_REQUEST_FAILED_PREFIX}HTTP ${response.status} — ${extractApiErrorDetail(bodyText)}`,
        {
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        },
      );
    }

    if (!response.body) {
      let bodyText: string;
      try {
        bodyText = await response.text();
      } catch (err: unknown) {
        throw mapTransportError(err);
      }
      const whole = stream.whole(bodyText);
      if (!whole.content) throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}empty or malformed completion response`);
      return whole;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let rawBody = '';

    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (err: unknown) {
        const sofar = stream.partial();
        if ((abortedByIdle || abortedByDeadline) && sofar.content) return sofar;
        throw mapTransportError(err);
      }
      if (result.done) break;
      resetIdle();
      const decoded = decoder.decode(result.value, { stream: true });
      rawBody += decoded;
      buffer += decoded;

      let nlIndex: number;
      while ((nlIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nlIndex);
        buffer = buffer.slice(nlIndex + 1);
        if (stream.consumeLine(line) === 'done') return stream.finish(rawBody);
      }
    }
    if (buffer.trim()) stream.consumeLine(buffer);
    return stream.finish(rawBody);
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(deadlineTimer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

const streamOptionsUnsupported = new Set<string>();

function isBadRequestError(err: unknown): boolean {
  return err instanceof ByokFailure && err.status === 400;
}

function logCacheHit(usage: ByokUsage): void {
  if (usage.input <= 0) return;
  const read = usage.cachedInput ?? 0;
  const written = usage.cacheWriteInput ?? 0;
  if (read <= 0 && written <= 0) return;
  const share = Math.round((read / usage.input) * 100);
  const write = written > 0 ? `, ${written} written` : '';
  sendLog(`💾 BYOK prompt cache: ${read} of ${usage.input} input tokens reused (${share}%)${write}`);
}

/**
 * `cachePrefix`: the prompt opens a conversation whose next request resends it (an `/agent`
 * transcript), so ask the provider to cache it. `conversationId`: that conversation's random id,
 * the cache-routing key some providers take (`byokCacheHints.ts`).
 */
export type ByokCallOptions = CacheHintOptions;

/**
 * Endpoints that answered 400 to a request carrying cache hints but took it without them: the
 * hints are dropped for that URL from then on. A proxy behind a known host may not pass them on.
 */
const cacheHintsUnsupported = new Set<string>();

/** One request to the native Messages API through the official SDK (`byokAnthropic.ts`). */
function sendAnthropicChat(
  cfg: ByokEndpoint,
  prompt: ByokPrompt,
  idleTimeoutMs: number,
  options: ByokCallOptions,
  signal?: AbortSignal,
): Promise<ByokStreamResult> {
  return streamAnthropicChat({
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model ?? '',
    prompt,
    cachePrefix: options.cachePrefix === true,
    idleTimeoutMs,
    totalTimeoutMs: idleTimeoutMs * STREAM_TOTAL_TIMEOUT_FACTOR,
    signal,
    retryAfter: parseRetryAfter,
  });
}

/** One request to an OpenAI-compatible `chat/completions` endpoint. */
async function sendOpenAiChat(
  cfg: ByokEndpoint,
  prompt: ByokPrompt,
  idleTimeoutMs: number,
  options: ByokCallOptions,
  signal?: AbortSignal,
): Promise<ByokStreamResult> {
  const url = buildCompletionsUrl(cfg.baseUrl);
  const hints = cacheHintsFor(cfg.baseUrl, cfg.model, options);
  const send = async (includeUsage: boolean, includeHints: boolean): Promise<ByokStreamResult> =>
    streamByokChat(
      url,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
          ...(includeHints ? hints.headers : {}),
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: wireMessages(prompt),
          stream: true,
          ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
          ...(includeHints ? hints.body : {}),
        }),
      },
      idleTimeoutMs,
      openAiStream(),
      signal,
    );

  // A 400 may be an optional field the endpoint does not know: drop the cache hints first, then
  // `stream_options`, and remember which one it was. Any other failure, or a 400 that stays, is
  // the original error.
  const wantUsage = !streamOptionsUnsupported.has(url);
  const wantHints = hasCacheHints(hints) && !cacheHintsUnsupported.has(url);
  try {
    return await send(wantUsage, wantHints);
  } catch (err: unknown) {
    if (signal?.aborted || !isBadRequestError(err)) throw err;
    if (wantHints) {
      try {
        const result = await send(wantUsage, false);
        cacheHintsUnsupported.add(url);
        sendLog('⚠️ BYOK endpoint rejected the prompt-cache hints — sending without them');
        return result;
      } catch (retryErr: unknown) {
        if (signal?.aborted || !isBadRequestError(retryErr)) throw err;
      }
    }
    if (!wantUsage) throw err;
    let result: ByokStreamResult;
    try {
      result = await send(false, false);
    } catch {
      throw err;
    }
    streamOptionsUnsupported.add(url);
    sendLog('⚠️ BYOK endpoint rejected stream_options — token counts will be estimated for it');
    return result;
  }
}

export async function callByokChat(
  cfg: ByokEndpoint,
  prompt: ByokPrompt,
  idleTimeoutMs: number,
  signal?: AbortSignal,
  options: ByokCallOptions = {},
): Promise<{ response: string; title: string; usage: ByokUsage | null }> {
  assertEndpoint(cfg, true);
  const result = isAnthropicApiUrl(cfg.baseUrl)
    ? await sendAnthropicChat(cfg, prompt, idleTimeoutMs, options, signal)
    : await sendOpenAiChat(cfg, prompt, idleTimeoutMs, options, signal);

  if (!result.content) {
    throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}empty or malformed completion response`);
  }
  if (result.usage) {
    meterReported(result.usage.input, result.usage.output);
    logCacheHit(result.usage);
  } else {
    meterText(byokPromptText(prompt), result.content);
  }
  return { response: result.content, title: '', usage: result.usage };
}

export async function listByokModels(cfg: ByokEndpoint, timeoutMs: number): Promise<string[]> {
  assertEndpoint(cfg, false);
  if (isAnthropicApiUrl(cfg.baseUrl)) return listAnthropicModels(cfg.apiKey, cfg.baseUrl, timeoutMs);
  const bodyText = await fetchWithByokTimeout(
    buildModelsUrl(cfg.baseUrl),
    {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
    },
    timeoutMs,
  );
  return parseModelIds(bodyText);
}

export interface ByokKeyRunOptions<T> {
  signal?: AbortSignal;
  /** Token counts for the stats page when the endpoint reported none. */
  estimate: (result: T) => ByokUsage;
  /** Members able to serve this call; the rest of a group are skipped, not charged. */
  accept?: (endpoint: ByokEndpoint) => boolean;
  /** Thrown when `accept` leaves no member to call. */
  noneAccepted?: string;
  /** Whether a failure is worth handing to the next key. Every failure is, unless this says no. */
  failOver?: (err: unknown) => boolean;
}

/** Runs one model request on the key (or the first working key of the group) behind a BYOK URL. */
export async function runOnByokKeys<T extends { usage: ByokUsage | null }>(
  targetUrl: string,
  call: (endpoint: ByokEndpoint) => Promise<T>,
  options: ByokKeyRunOptions<T>,
): Promise<T> {
  const { signal } = options;
  const resolved = resolveByokTryList(targetUrl);
  const tryList = options.accept ? resolved.filter(options.accept) : resolved;
  if (tryList.length === 0) throw new Error(options.noneAccepted ?? BYOK_GROUP_EMPTY_ERROR);
  // One call is one model request however many keys it burns through; each attempt is also
  // charged to the key that served it, so a failover shows up on both keys, not just the winner.
  return meterLlmRequest(async () => {
    let lastError: unknown;
    for (let index = 0; index < tryList.length; index++) {
      if (signal?.aborted) throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}aborted`);
      const endpoint = tryList[index];
      try {
        const result = endpoint.id ? await callInKeySlot(endpoint.id, () => call(endpoint), signal) : await call(endpoint);
        noteKeyResult(endpoint.id, 'success', result.usage ?? options.estimate(result));
        return result;
      } catch (err: unknown) {
        lastError = err;
        if (signal?.aborted) throw err;
        noteKeyResult(endpoint.id, classifyFailure(err instanceof Error ? err.message : String(err)));
        if (err instanceof ByokFailure && endpoint.id && COOLDOWN_STATUSES.has(err.status ?? 0)) {
          markKeyCooling(endpoint.id, err.retryAfterMs);
          noteKeyCooldown(endpoint.id);
        }
        // The next key would be asked the same thing and decline it the same way.
        if (err instanceof ByokRefusal) break;
        if (options.failOver && !options.failOver(err)) break;
        if (index < tryList.length - 1) {
          const detail = err instanceof Error ? err.message : String(err);
          sendLog(`⚠️ BYOK key "${endpoint.label ?? 'key'}" failed, trying next in group — ${detail}`);
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`${BYOK_REQUEST_FAILED_PREFIX}all keys in the group failed`);
  }, signal);
}

export async function runByokCompletion(
  targetUrl: string,
  prompt: ByokPrompt,
  timeoutMs: number,
  signal?: AbortSignal,
  options: ByokCallOptions = {},
): Promise<{ response: string; title: string; usage: ByokUsage | null }> {
  const imageCount = byokPromptImageCount(prompt);
  return runOnByokKeys(targetUrl, (endpoint) => callByokChat(endpoint, prompt, timeoutMs, signal, options), {
    signal,
    estimate: (result) => ({
      input: estimateTokens(byokPromptText(prompt)) + imageCount * IMAGE_TOKEN_ESTIMATE,
      output: estimateTokens(result.response),
    }),
    // A group may mix keys: pictures go only to the ones that read them.
    ...(imageCount > 0
      ? { accept: (endpoint: ByokEndpoint) => endpoint.takesImages === true, noneAccepted: BYOK_NO_IMAGE_KEY_ERROR }
      : {}),
  });
}
