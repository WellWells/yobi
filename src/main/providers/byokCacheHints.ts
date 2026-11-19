/**
 * What each OpenAI-compatible provider asks a client to send so a conversation's repeated prefix
 * is read from its prompt cache (per each provider's docs). They all
 * cache a byte-identical prefix on their own; these only raise the hit rate, or — for Claude on
 * OpenRouter — turn caching on at all:
 * - OpenAI: `prompt_cache_key`, a stable key that routes requests sharing a prefix to the same
 *   cache ("use a stable `prompt_cache_key` for requests that share a reusable prefix").
 * - Mistral: `prompt_cache_key` too ("Use `prompt_cache_key` for multi-turn conversations").
 * - xAI: the `x-grok-conv-id` header ("Always set `x-grok-conv-id`"; cache entries live per server).
 * - OpenRouter: `session_id`, its sticky-routing key (without it the routing sticks only after a
 *   first hit), and for `anthropic/*` models a top-level `cache_control`: Anthropic models cache
 *   only when asked, and the top-level form moves the breakpoint along as the conversation grows.
 * Only a conversation (an `/agent` transcript) sends them: its key is a random id per run, never
 * the user's key or anything personal. One-off prompts send nothing new.
 */

export interface CacheHintOptions {
  /** The prompt opens a conversation whose next request resends it. */
  cachePrefix?: boolean;
  /** A random id for that conversation, the same on every request of it. */
  conversationId?: string;
}

export interface CacheHints {
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

const NONE: CacheHints = { body: {}, headers: {} };

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl.trim()).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** True for a model OpenRouter serves from Anthropic, which caches only on request. */
export function isOpenRouterAnthropicModel(model: string | undefined): boolean {
  return /^anthropic\//i.test(model?.trim() ?? '');
}

export function cacheHintsFor(baseUrl: string, model: string | undefined, options: CacheHintOptions): CacheHints {
  const id = options.conversationId?.trim();
  if (!options.cachePrefix || !id) return NONE;
  switch (hostOf(baseUrl)) {
    case 'api.openai.com':
    case 'api.mistral.ai':
      return { body: { prompt_cache_key: id }, headers: {} };
    case 'api.x.ai':
      return { body: {}, headers: { 'x-grok-conv-id': id } };
    case 'openrouter.ai':
      return {
        body: {
          session_id: id,
          ...(isOpenRouterAnthropicModel(model) ? { cache_control: { type: 'ephemeral' } } : {}),
        },
        headers: {},
      };
    default:
      return NONE;
  }
}

export function hasCacheHints(hints: CacheHints): boolean {
  return Object.keys(hints.body).length > 0 || Object.keys(hints.headers).length > 0;
}
