import { PROVIDER_URLS } from '../../../shared/types';
import type { GeminiModelState } from '../../../shared/geminiModels';
import type { ClaudeModelState } from '../../../shared/claudeModels';
import type { ChatgptModelState } from '../../../shared/chatgptModels';
import type { ModelIcon, ModelOption } from './models';

export type SubmodelProvider = 'gemini' | 'claude' | 'chatgpt';

export interface SubmodelEntry {
  id: string;
  label: string;
}

export interface ProviderSubmodels {
  provider: SubmodelProvider;
  models: readonly SubmodelEntry[];
  /** The provider's remembered pick; empty until the page has been read. */
  currentId: string;
}

export interface SubmodelSources {
  geminiModels: GeminiModelState | null;
  claudeModels: ClaudeModelState | null;
  chatgptModels: ChatgptModelState | null;
  /** Signed out of a provider that needs an account: whatever list is cached is not this user's. */
  needsLogin: (url: string) => boolean;
}

export interface ModelStopSources extends SubmodelSources {
  /** The providers and BYOK entries to walk, hidden ones already removed, in menu order. */
  models: readonly ModelOption[];
}

/**
 * One step of Shift+Tab and one row of `/model`: a provider, or one of the models it offers.
 * Both read the same list, so they walk the same models in the same order as the model menu.
 */
export interface ModelStop {
  url: string;
  label: string;
  icon: ModelIcon;
  sub: (SubmodelEntry & { provider: SubmodelProvider }) | null;
}

/**
 * The models a provider row opens, or `null` for a plain row. The model menu decides its submenus
 * from this too. ChatGPT needs more than one: Free has a single model and only the thinking
 * switch, which lives in the composer.
 */
export function providerSubmodels(url: string, src: SubmodelSources): ProviderSubmodels | null {
  if (url === PROVIDER_URLS.gemini) {
    const models = src.geminiModels?.catalog?.models ?? [];
    if (models.length === 0) return null;
    return { provider: 'gemini', models, currentId: src.geminiModels?.choice.modelId ?? '' };
  }
  if (src.needsLogin(url)) return null;
  if (url === PROVIDER_URLS.claude) {
    const models = src.claudeModels?.catalog?.models ?? [];
    if (models.length === 0) return null;
    return { provider: 'claude', models, currentId: src.claudeModels?.choice.modelId ?? '' };
  }
  if (url === PROVIDER_URLS.chatgpt) {
    const models = src.chatgptModels?.catalog?.models ?? [];
    // With a single version the page hides the choice too.
    if (models.length < 2) return null;
    return { provider: 'chatgpt', models, currentId: src.chatgptModels?.choice.modelId ?? '' };
  }
  return null;
}

export function buildModelStops(src: ModelStopSources): ModelStop[] {
  return src.models.flatMap((model): ModelStop[] => {
    const base = { url: model.url, label: model.label, icon: model.icon };
    const subs = providerSubmodels(model.url, src);
    if (!subs) return [{ ...base, sub: null }];
    return subs.models.map((entry) => ({
      ...base,
      sub: { provider: subs.provider, id: entry.id, label: entry.label },
    }));
  });
}

export function stopKey(stop: ModelStop): string {
  return stop.sub ? `${stop.url}#${stop.sub.id}` : stop.url;
}

/**
 * Where the chat stands in the list. A provider whose remembered pick is not listed (nothing
 * decided yet, or a model the page dropped) stands on its first model.
 */
export function currentStopIndex(stops: readonly ModelStop[], url: string, src: SubmodelSources): number {
  const first = stops.findIndex((stop) => stop.url === url);
  if (first === -1) return -1;
  const currentId = providerSubmodels(url, src)?.currentId;
  if (!currentId) return first;
  const exact = stops.findIndex((stop) => stop.url === url && stop.sub?.id === currentId);
  return exact === -1 ? first : exact;
}

export function nextModelStop(
  stops: readonly ModelStop[],
  url: string,
  src: SubmodelSources,
  direction: 1 | -1 = 1,
): ModelStop | null {
  if (stops.length === 0) return null;
  const index = currentStopIndex(stops, url, src);
  if (index === -1) return stops[0];
  return stops[(index + direction + stops.length) % stops.length];
}

function compact(text: string): string {
  return text.replace(/[\s\-_.·]+/g, '');
}

/**
 * Every typed word has to appear in "provider model", so `gem pro` and `haiku` both land.
 * Separators are ignored as a fallback, so `flashlite` still finds "Flash-Lite".
 */
export function filterModelStops(stops: readonly ModelStop[], query: string): ModelStop[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...stops];
  return stops.filter((stop) => {
    const text = `${stop.label} ${stop.sub?.label ?? ''}`.toLowerCase();
    const packed = compact(text);
    return words.every((word) => text.includes(word) || packed.includes(compact(word)));
  });
}

/**
 * A rule between providers that open a list of their own, so each one's models read as a block.
 * Plain rows (Perplexity, BYOK keys) stay together rather than each sitting between two rules.
 */
export function startsNewStopGroup(stops: readonly ModelStop[], index: number): boolean {
  if (index < 1) return false;
  const prev = stops[index - 1];
  const stop = stops[index];
  return prev.url !== stop.url && (prev.sub !== null || stop.sub !== null);
}
