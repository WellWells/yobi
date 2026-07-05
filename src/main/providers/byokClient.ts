import { byokIdFromUrl, byokGroupIdFromUrl, isByokGroupUrl } from '../../shared/types';
import type { ByokGroup } from '../../shared/types';
import { config } from '../config';
import type { ByokInstance } from '../configTypes';
import { sendLog } from '../helpers';

// Errors below are matched by localizeUserFacingError (i18n.ts) — keep the
// exact string / prefixes in sync with the mappings there.
export const BYOK_INSTANCE_MISSING_ERROR = 'BYOK provider not found — the instance may have been deleted';
export const BYOK_GROUP_MISSING_ERROR = 'BYOK group not found — it may have been deleted';
export const BYOK_GROUP_EMPTY_ERROR = 'BYOK group has no usable keys — add at least one key to the group';
export const BYOK_CONFIG_INCOMPLETE_PREFIX = 'BYOK configuration incomplete: ';
export const BYOK_REQUEST_FAILED_PREFIX = 'BYOK request failed: ';

export interface ByokEndpoint {
  baseUrl: string;
  apiKey: string;
  model?: string;
  label?: string;
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

function endpointForInstance(instance: ByokInstance): ByokEndpoint {
  return { baseUrl: instance.baseUrl, apiKey: instance.apiKey, model: instance.model, label: instance.name };
}

// Per-group round-robin cursor. In-memory only (resets on restart) — its sole job
// is to spread successive requests across a group's keys so no single free-tier
// key burns through its daily quota alone. The stored value stays bounded to the
// member count via the modulo in resolveByokTryList.
const groupRotation = new Map<string, number>();

// Ordered list of endpoints to attempt for a target. A single key yields a
// one-element list; a group yields its members reordered to start at the rotation
// cursor and wrap around — so the first entry spreads load and the remainder are
// the failover fallbacks tried within the same request.
function resolveByokTryList(url: string): ByokEndpoint[] {
  if (isByokGroupUrl(url)) {
    const group = findByokGroupByUrl(url);
    if (!group) throw new Error(BYOK_GROUP_MISSING_ERROR);
    const members = group.memberIds
      .map((memberId) => config.byokInstances.find((instance) => instance.id === memberId))
      .filter((instance): instance is ByokInstance => Boolean(instance));
    if (members.length === 0) throw new Error(BYOK_GROUP_EMPTY_ERROR);
    const start = (groupRotation.get(group.id) ?? 0) % members.length;
    groupRotation.set(group.id, start + 1);
    const ordered: ByokInstance[] = [];
    for (let offset = 0; offset < members.length; offset++) {
      ordered.push(members[(start + offset) % members.length]);
    }
    return ordered.map(endpointForInstance);
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

// Runs one fetch with a timeout + external-abort, mapping transport-level and
// non-2xx failures onto the BYOK error contract (localized by i18n.ts).
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
      throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}HTTP ${httpResponse.status} — ${extractApiErrorDetail(bodyText)}`);
    }
    return bodyText;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

// Streams an OpenAI-compatible chat completion, resetting an IDLE timer on every received
// chunk — so a long generation is never cut off while it is actively producing output; only a
// genuine stall (no bytes for idleTimeoutMs) or a stream end/[DONE] stops it. The idle window
// also serves as the connect/first-byte deadline. Falls back to a plain non-streaming JSON read
// if the endpoint ignores `stream:true`. On a mid-stream idle abort, any partial text already
// produced is returned rather than discarded.
async function streamByokChat(
  url: string,
  init: RequestInit,
  idleTimeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  let abortedByIdle = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
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
    resetIdle(); // headers arrived — give the body read its own fresh idle window

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}HTTP ${response.status} — ${extractApiErrorDetail(bodyText)}`);
    }

    // No body to stream (rare): read whatever there is as a single completion.
    if (!response.body) {
      let bodyText: string;
      try {
        bodyText = await response.text();
      } catch (err: unknown) {
        throw mapTransportError(err);
      }
      const whole = extractCompletionContent(bodyText);
      if (!whole) throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}empty or malformed completion response`);
      return whole;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let rawBody = '';
    let content = '';
    // If the endpoint ignored stream:true and returned one whole JSON completion (any content-type),
    // no 'data:' line matches and content stays empty — recover it from the accumulated raw body.
    const finalize = (): string => content.trim() || (extractCompletionContent(rawBody) ?? '');
    // Consumes one SSE line; returns 'done' at the [DONE] terminator.
    const consumeLine = (rawLine: string): 'done' | undefined => {
      const line = rawLine.trim();
      if (!line || line.startsWith(':')) return;              // blank line / SSE comment (keep-alive)
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return 'done';
      let parsed: { choices?: { delta?: { content?: unknown } }[]; error?: { message?: unknown } };
      try {
        parsed = JSON.parse(data);
      } catch {
        return;                                               // partial / non-JSON keep-alive line
      }
      if (parsed.error) throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}${extractApiErrorDetail(data)}`);
      const piece = parsed.choices?.[0]?.delta?.content;
      if (typeof piece === 'string') content += piece;
    };

    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (err: unknown) {
        // Idle abort mid-stream: keep whatever the model already produced rather than losing it.
        if (abortedByIdle && content.trim()) return content.trim();
        throw mapTransportError(err);
      }
      if (result.done) break;
      resetIdle(); // any received bytes count as activity
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
    // Stream closed: flush a final line the endpoint sent with no trailing newline.
    if (buffer.trim()) consumeLine(buffer);
    return finalize();
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

export async function callByokChat(
  cfg: ByokEndpoint,
  prompt: string,
  idleTimeoutMs: number,
  signal?: AbortSignal,
): Promise<{ response: string; title: string }> {
  assertEndpoint(cfg, true);
  const content = await streamByokChat(
    buildCompletionsUrl(cfg.baseUrl),
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
      }),
    },
    idleTimeoutMs,
    signal,
  );
  if (!content) {
    throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}empty or malformed completion response`);
  }
  return { response: content, title: '' };
}

// GET {baseUrl}/models — the standard OpenAI-compatible model-discovery endpoint.
export async function listByokModels(cfg: ByokEndpoint, timeoutMs: number): Promise<string[]> {
  assertEndpoint(cfg, false);
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

export async function runByokCompletion(
  targetUrl: string,
  prompt: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ response: string; title: string }> {
  const tryList = resolveByokTryList(targetUrl);
  let lastError: unknown;
  for (let index = 0; index < tryList.length; index++) {
    if (signal?.aborted) throw new Error(`${BYOK_REQUEST_FAILED_PREFIX}aborted`);
    const endpoint = tryList[index];
    try {
      return await callByokChat(endpoint, prompt, timeoutMs, signal);
    } catch (err: unknown) {
      lastError = err;
      // A user-initiated abort must stop the whole request, never fail over to
      // another key — the user asked to cancel, not to try harder.
      if (signal?.aborted) throw err;
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
