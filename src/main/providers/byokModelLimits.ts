import { isGeminiApiBaseUrl } from '../../shared/types';
import type { ByokInstance } from '../configTypes';
import { sendLog } from '../helpers';
import { anthropicModelInputTokens, isAnthropicApiUrl } from './byokAnthropic';
import { byokInstancesForUrl, fetchWithByokTimeout } from './byokClient';

/**
 * How many input tokens a BYOK key's model takes, as its provider reports it. Only three
 * providers say so: the Gemini API (`inputTokenLimit`), Anthropic (`max_input_tokens`) and
 * OpenRouter (`context_length`). Every other endpoint is "unknown", never a guess from the model
 * name: an unknown window keeps `/agent` on the budget it always had.
 */

export const MODEL_LIMIT_TIMEOUT_MS = 5_000;

/** A lookup that failed (network, HTTP, timeout) is asked again after this long. */
export const MODEL_LIMIT_RETRY_MS = 10 * 60_000;

export type ByokModelRef = Pick<ByokInstance, 'baseUrl' | 'apiKey' | 'model'> & { name?: string };

interface LimitLookup {
  /** For the log line. */
  host: string;
  tokens: () => Promise<number | undefined>;
}

/** A plain GET whose JSON reply `read` turns into the window. */
function jsonLookup(url: string, headers: Record<string, string>, read: (body: unknown) => number | undefined): LimitLookup {
  return {
    host: new URL(url).hostname,
    tokens: async () => {
      const bodyText = await fetchWithByokTimeout(url, { method: 'GET', headers }, MODEL_LIMIT_TIMEOUT_MS);
      let body: unknown;
      try {
        body = JSON.parse(bodyText);
      } catch {
        throw new Error('the reply was not JSON');
      }
      return read(body);
    },
  };
}

interface CacheEntry {
  tokens: number | undefined;
  /** Set when the lookup failed: the time it may be tried again. */
  retryAt?: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<number | undefined>>();

export function clearByokModelLimitCache(): void {
  cache.clear();
  inFlight.clear();
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function field(body: unknown, name: string): unknown {
  return body && typeof body === 'object' ? (body as Record<string, unknown>)[name] : undefined;
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase();
}

/** The request that reports the model's window, or null for a provider that reports none. */
export function modelLimitLookup(ref: ByokModelRef): LimitLookup | null {
  const model = ref.model.trim();
  let base: URL;
  try {
    base = new URL(ref.baseUrl.trim());
  } catch {
    return null;
  }
  if (isGeminiApiBaseUrl(ref.baseUrl)) {
    // The compat base is `<origin>/v1beta/openai`; the native model resource sits beside it.
    const id = model.replace(/^models\//, '');
    return jsonLookup(
      `${base.origin}/v1beta/models/${encodeURIComponent(id)}`,
      { 'x-goog-api-key': ref.apiKey },
      (body) => positiveInt(field(body, 'inputTokenLimit')),
    );
  }
  if (isAnthropicApiUrl(ref.baseUrl)) {
    // Through the official SDK, as every Anthropic request (`GET /v1/models/{id}`).
    return {
      host: hostOf(base),
      tokens: () => anthropicModelInputTokens(ref.apiKey, ref.baseUrl, model, MODEL_LIMIT_TIMEOUT_MS),
    };
  }
  if (hostOf(base) === 'openrouter.ai') {
    return jsonLookup(
      `${base.origin}/api/v1/models`,
      { 'Authorization': `Bearer ${ref.apiKey}` },
      (body) => {
        const list = field(body, 'data');
        if (!Array.isArray(list)) return undefined;
        const entry = list.find((item) => field(item, 'id') === model);
        return positiveInt(field(entry, 'context_length')) ?? positiveInt(field(field(entry, 'top_provider'), 'context_length'));
      },
    );
  }
  return null;
}

function cacheKey(ref: ByokModelRef): string {
  const base = new URL(ref.baseUrl.trim());
  return `${base.origin}${base.pathname.replace(/\/+$/, '')}\n${ref.model.trim()}`;
}

function withoutSecret(text: string, secret: string): string {
  return secret ? text.split(secret).join('***') : text;
}

async function lookUp(ref: ByokModelRef, lookup: LimitLookup, key: string): Promise<number | undefined> {
  try {
    // A reply without the number is an answer too: this model's window is not reported.
    const tokens = await lookup.tokens();
    cache.set(key, { tokens });
    return tokens;
  } catch (err: unknown) {
    cache.set(key, { tokens: undefined, retryAt: Date.now() + MODEL_LIMIT_RETRY_MS });
    const detail = withoutSecret(err instanceof Error ? err.message : String(err), ref.apiKey);
    sendLog(`⚠️ BYOK context window unknown for "${ref.name ?? 'key'}" (${lookup.host}, ${ref.model.trim()}) — ${detail}`);
    return undefined;
  } finally {
    inFlight.delete(key);
  }
}

/** The model's input window in tokens, or undefined when its provider does not say. */
export async function getByokContextTokens(ref: ByokModelRef): Promise<number | undefined> {
  if (!ref.apiKey || !ref.model.trim()) return undefined;
  const lookup = modelLimitLookup(ref);
  if (!lookup) return undefined;
  const key = cacheKey(ref);
  const cached = cache.get(key);
  if (cached && (cached.retryAt === undefined || Date.now() < cached.retryAt)) return cached.tokens;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = lookUp(ref, lookup, key);
  inFlight.set(key, request);
  return request;
}

/**
 * The window behind a BYOK target: the key's for `byok://`, the smallest of the members' for
 * `byokgroup://` — and unknown when any member is, because a group request can land on that
 * member and must fit it.
 */
export async function getByokContextTokensForUrl(targetUrl: string): Promise<number | undefined> {
  let instances: ByokInstance[];
  try {
    instances = byokInstancesForUrl(targetUrl);
  } catch {
    return undefined;
  }
  const windows = await Promise.all(instances.map((instance) => getByokContextTokens(instance)));
  if (windows.some((tokens) => tokens === undefined)) return undefined;
  return Math.min(...(windows as number[]));
}
