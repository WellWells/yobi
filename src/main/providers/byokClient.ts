import { byokIdFromUrl, byokGroupIdFromUrl, isByokGroupUrl } from '../../shared/types';
import type { ByokGroup } from '../../shared/types';
import { config } from '../config';
import type { ByokInstance } from '../configTypes';
import { sendLog } from '../helpers';
import { meterReported, meterText } from '../tokenMeter';

export const BYOK_INSTANCE_MISSING_ERROR = 'BYOK provider not found — the instance may have been deleted';
export const BYOK_GROUP_MISSING_ERROR = 'BYOK group not found — it may have been deleted';
export const BYOK_GROUP_EMPTY_ERROR = 'BYOK group has no usable keys — add at least one key to the group';
export const BYOK_CONFIG_INCOMPLETE_PREFIX = 'BYOK configuration incomplete: ';
export const BYOK_REQUEST_FAILED_PREFIX = 'BYOK request failed: ';

const COOLDOWN_STATUSES = new Set([429, 503]);

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429]);

const PERMANENT_SERVER_STATUSES = new Set([501, 505]);

const MIN_COOLDOWN_MS = 1_000;
const MAX_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_COOLDOWN_MS = 60_000;

export class ByokFailure extends Error {
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, options: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'ByokFailure';
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function isByokRetryable(err: unknown): boolean {
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
}

export interface ByokUsage {
  input: number;
  output: number;
  cachedInput?: number;
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
  };
}

const groupRotation = new Map<string, number>();

const keyCooldown = new Map<string, number>();

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
  const ready = rotated.filter((instance) => cooldownUntil(instance.id) <= now);
  const cooling = rotated
    .filter((instance) => cooldownUntil(instance.id) > now)
    .sort((a, b) => cooldownUntil(a.id) - cooldownUntil(b.id));
  return [...ready, ...cooling];
}

function resolveByokTryList(url: string): ByokEndpoint[] {
  if (isByokGroupUrl(url)) {
    const group = findByokGroupByUrl(url);
    if (!group) throw new Error(BYOK_GROUP_MISSING_ERROR);
    const members = group.memberIds
      .map((memberId) => config.byokInstances.find((instance) => instance.id === memberId))
      .filter((instance): instance is ByokInstance => Boolean(instance));
    if (members.length === 0) throw new Error(BYOK_GROUP_EMPTY_ERROR);
    return orderGroupMembers(group.id, members).map(endpointForInstance);
  }
  const instance = findByokInstanceByUrl(url);
  if (!instance) throw new Error(BYOK_INSTANCE_MISSING_ERROR);
  return [endpointForInstance(instance)];
}

function buildCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}

function buildModelsUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/models`;
}

function isAnthropicHost(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === 'api.anthropic.com';
  } catch {
    return false;
  }
}

function modelsAuthHeaders(url: string, apiKey: string): Record<string, string> {
  if (isAnthropicHost(url)) {
    return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  }
  return { 'Authorization': `Bearer ${apiKey}` };
}

function assertEndpoint(cfg: ByokEndpoint, needModel: boolean): void {
  const suffix = cfg.label?.trim() ? ` for "${cfg.label.trim()}"` : '';
  if (!cfg.apiKey) throw new Error(`${BYOK_CONFIG_INCOMPLETE_PREFIX}API key is not set${suffix}`);
  if (!cfg.baseUrl) throw new Error(`${BYOK_CONFIG_INCOMPLETE_PREFIX}base URL is not set${suffix}`);
  if (needModel && !cfg.model) throw new Error(`${BYOK_CONFIG_INCOMPLETE_PREFIX}model is not set${suffix}`);
}

function extractApiErrorDetail(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: unknown } };
    if (typeof parsed?.error?.message === 'string' && parsed.error.message.trim()) {
      return parsed.error.message.trim();
    }
  } catch {
  }
  const compact = bodyText.replace(/\s+/g, ' ').trim();
  return compact.length > 200 ? `${compact.slice(0, 200)}…` : compact;
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

function readCachedInput(usage: Record<string, unknown>, input: number): number | undefined {
  const details = usage.prompt_tokens_details;
  const nested = details && typeof details === 'object'
    ? (details as Record<string, unknown>).cached_tokens
    : undefined;
  const value = nested ?? usage.cached_tokens;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(input, Math.round(value));
}

export function parseByokUsage(raw: unknown): ByokUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const usage = raw as Record<string, unknown>;
  const { prompt_tokens: input, completion_tokens: output } = usage;
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null;
  const rounded = Math.round(input);
  const cachedInput = readCachedInput(usage, rounded);
  return {
    input: rounded,
    output: Math.round(output),
    ...(cachedInput === undefined ? {} : { cachedInput }),
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

async function fetchWithByokTimeout(
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

async function streamByokChat(
  url: string,
  init: RequestInit,
  idleTimeoutMs: number,
  signal?: AbortSignal,
): Promise<{ content: string; usage: ByokUsage | null }> {
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
      const whole = extractCompletionContent(bodyText);
      if (!whole) throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}empty or malformed completion response`);
      return { content: whole, usage: extractCompletionUsage(bodyText) };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let rawBody = '';
    let content = '';
    let usage: ByokUsage | null = null;
    const finalize = (): { content: string; usage: ByokUsage | null } => ({
      content: content.trim() || (extractCompletionContent(rawBody) ?? ''),
      usage: usage ?? extractCompletionUsage(rawBody),
    });
    const consumeLine = (rawLine: string): 'done' | undefined => {
      const line = rawLine.trim();
      if (!line || line.startsWith(':')) return;
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return 'done';
      let parsed: { choices?: { delta?: { content?: unknown } }[]; error?: { message?: unknown }; usage?: unknown };
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      if (parsed.error) throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}${extractApiErrorDetail(data)}`);
      usage = parseByokUsage(parsed.usage) ?? usage;
      const piece = parsed.choices?.[0]?.delta?.content;
      if (typeof piece === 'string') content += piece;
    };

    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (err: unknown) {
        if ((abortedByIdle || abortedByDeadline) && content.trim()) {
          return { content: content.trim(), usage };
        }
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
        if (consumeLine(line) === 'done') return finalize();
      }
    }
    if (buffer.trim()) consumeLine(buffer);
    return finalize();
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
  if (usage.cachedInput === undefined || usage.cachedInput <= 0 || usage.input <= 0) return;
  const share = Math.round((usage.cachedInput / usage.input) * 100);
  sendLog(`💾 BYOK prompt cache: ${usage.cachedInput} of ${usage.input} input tokens reused (${share}%)`);
}

export async function callByokChat(
  cfg: ByokEndpoint,
  prompt: string,
  idleTimeoutMs: number,
  signal?: AbortSignal,
): Promise<{ response: string; title: string; usage: ByokUsage | null }> {
  assertEndpoint(cfg, true);
  const url = buildCompletionsUrl(cfg.baseUrl);
  const send = async (includeUsage: boolean): Promise<{ content: string; usage: ByokUsage | null }> =>
    streamByokChat(
      url,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
          ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
        }),
      },
      idleTimeoutMs,
      signal,
    );

  const wantUsage = !streamOptionsUnsupported.has(url);
  let result: { content: string; usage: ByokUsage | null };
  try {
    result = await send(wantUsage);
  } catch (err: unknown) {
    if (!wantUsage || signal?.aborted || !isBadRequestError(err)) throw err;
    try {
      result = await send(false);
    } catch {
      throw err;
    }
    streamOptionsUnsupported.add(url);
    sendLog('⚠️ BYOK endpoint rejected stream_options — token counts will be estimated for it');
  }

  if (!result.content) {
    throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}empty or malformed completion response`);
  }
  if (result.usage) {
    meterReported(result.usage.input, result.usage.output);
    logCacheHit(result.usage);
  } else {
    meterText(prompt, result.content);
  }
  return { response: result.content, title: '', usage: result.usage };
}

export async function listByokModels(cfg: ByokEndpoint, timeoutMs: number): Promise<string[]> {
  assertEndpoint(cfg, false);
  let url = buildModelsUrl(cfg.baseUrl);
  if (isAnthropicHost(url)) url += '?limit=1000';
  const bodyText = await fetchWithByokTimeout(
    url,
    {
      method: 'GET',
      headers: modelsAuthHeaders(url, cfg.apiKey),
    },
    timeoutMs,
  );
  return parseModelIds(bodyText);
}

export async function runByokCompletion(
  targetUrl: string,
  prompt: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ response: string; title: string; usage: ByokUsage | null }> {
  const tryList = resolveByokTryList(targetUrl);
  let lastError: unknown;
  for (let index = 0; index < tryList.length; index++) {
    if (signal?.aborted) throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}aborted`);
    const endpoint = tryList[index];
    try {
      return await callByokChat(endpoint, prompt, timeoutMs, signal);
    } catch (err: unknown) {
      lastError = err;
      if (signal?.aborted) throw err;
      if (err instanceof ByokFailure && endpoint.id && COOLDOWN_STATUSES.has(err.status ?? 0)) {
        markKeyCooling(endpoint.id, err.retryAfterMs);
      }
      if (index < tryList.length - 1) {
        const detail = err instanceof Error ? err.message : String(err);
        sendLog(`⚠️ BYOK key "${endpoint.label ?? 'key'}" failed, trying next in group — ${detail}`);
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`${BYOK_REQUEST_FAILED_PREFIX}all keys in the group failed`);
}
