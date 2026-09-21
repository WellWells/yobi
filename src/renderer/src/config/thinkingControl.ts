import { PROVIDER_URLS } from '../../../shared/types';
import type { GeminiModelState } from '../../../shared/geminiModels';
import { selectedClaudeEffort, selectedClaudeModel } from '../../../shared/claudeModels';
import type { ClaudeModelState } from '../../../shared/claudeModels';
import { selectedChatgptEffort, selectedChatgptModel } from '../../../shared/chatgptModels';
import type { ChatgptModelState } from '../../../shared/chatgptModels';

/*
 * The composer's thinking control, derived from what each provider's page offers (measured
 * 2026-09-19 on the worker's own accounts):
 *
 * - Gemini: one "extended thinking" switch, and every model takes it (3.5 Flash-Lite, 3.8 Flash
 *   and 3.1 Pro all showed it enabled), so it is one setting, not one per model.
 * - Claude: per model. Sonnet 5 has a switch plus five effort levels, Sonnet 4.6 a switch plus
 *   four, Haiku 4.5 a switch only. A model never selected on the page has unknown options.
 * - ChatGPT: Free has one switch; Plus has no switch but an effort slider per version whose first
 *   step, Instant, is the "not thinking" one.
 * - Perplexity and BYOK: nothing to set.
 *
 * Nothing is offered that the page has not shown: an unread catalog or unknown options mean no
 * control, never a guess.
 */

export type ThinkingProvider = 'gemini' | 'claude' | 'chatgpt';
export type ThinkingLevelProvider = 'claude' | 'chatgpt';

export interface ThinkingLevel {
  /** The page's language-independent id (`data-effort-id`, or a ChatGPT preset key). */
  id: string;
  /** The page's own label — only shown for an id this app has no translation for. */
  pageLabel: string;
}

export type ThinkingControl =
  | { kind: 'none' }
  | { kind: 'toggle'; provider: ThinkingProvider; on: boolean }
  | {
    kind: 'menu';
    provider: ThinkingLevelProvider;
    /** The model's on/off switch, when it has one besides its levels. */
    toggle: { on: boolean } | null;
    levels: ThinkingLevel[];
    /** The chosen level's id; empty while none of the listed levels is chosen. */
    level: string;
    /** Whether the send will think — what tints the pill. */
    active: boolean;
  };

export interface ThinkingSources {
  gemini: GeminiModelState | null;
  claude: ClaudeModelState | null;
  chatgpt: ChatgptModelState | null;
  /** The provider needs a sign-in it does not have, so its cached options are not current. */
  signedOut: boolean;
}

const NONE: ThinkingControl = { kind: 'none' };

export function thinkingControl(url: string, sources: ThinkingSources): ThinkingControl {
  if (sources.signedOut) return NONE;
  if (url === PROVIDER_URLS.gemini) return geminiControl(sources.gemini);
  if (url === PROVIDER_URLS.claude) return claudeControl(sources.claude);
  if (url === PROVIDER_URLS.chatgpt) return chatgptControl(sources.chatgpt);
  return NONE;
}

function geminiControl(state: GeminiModelState | null): ThinkingControl {
  if (!state?.catalog?.thinking) return NONE;
  return { kind: 'toggle', provider: 'gemini', on: state.choice.extendedThinking === true };
}

function claudeControl(state: ClaudeModelState | null): ThinkingControl {
  const options = selectedClaudeModel(state)?.options;
  if (!state || !options) return NONE;
  const toggle = options.thinking ? { on: state.choice.thinking === true } : null;
  if (options.efforts.length === 0) {
    return toggle ? { kind: 'toggle', provider: 'claude', on: toggle.on } : NONE;
  }
  return {
    kind: 'menu',
    provider: 'claude',
    toggle,
    levels: options.efforts.map((effort) => ({ id: effort.id, pageLabel: effort.label })),
    level: selectedClaudeEffort(state)?.id ?? '',
    // Levels without a switch would be the model's only way to think, so they count as on.
    active: toggle ? toggle.on : true,
  };
}

function chatgptControl(state: ChatgptModelState | null): ThinkingControl {
  const catalog = state?.catalog;
  if (!state || !catalog) return NONE;
  if (catalog.models.length === 0) {
    return catalog.thinking
      ? { kind: 'toggle', provider: 'chatgpt', on: state.choice.thinking === true }
      : NONE;
  }
  const efforts = selectedChatgptModel(state)?.efforts ?? [];
  // A single step is no choice.
  if (efforts.length < 2) return NONE;
  const level = selectedChatgptEffort(state)?.id ?? '';
  return {
    kind: 'menu',
    provider: 'chatgpt',
    toggle: null,
    levels: efforts.map((effort) => ({ id: effort.id, pageLabel: effort.label })),
    level,
    active: level !== '' && !isInstantEffort(level),
  };
}

/** A ChatGPT preset key is `lane` or `lane:effort`; the `instant` lane does not think. */
export function isInstantEffort(id: string): boolean {
  return id.split(':')[0] === 'instant';
}

/*
 * Levels are drawn in the app's language, not the page's: claude.ai follows the account's
 * language (English on a zh-TW machine, measured), the others the system's. Keyed by the page's
 * language-independent ids; a level first seen after this was written keeps the page's label.
 */
const LEVEL_KEYS: Record<ThinkingLevelProvider, Record<string, string>> = {
  claude: {
    low: 'chat.thinkingMode.level.low',
    medium: 'chat.thinkingMode.level.medium',
    high: 'chat.thinkingMode.level.high',
    xhigh: 'chat.thinkingMode.level.xhigh',
    max: 'chat.thinkingMode.level.max',
  },
  chatgpt: {
    instant: 'chat.thinkingMode.level.instant',
    // The zh-TW page names these 中 and 高 on the same slider.
    'thinking:standard': 'chat.thinkingMode.level.medium',
    'thinking:extended': 'chat.thinkingMode.level.high',
  },
};

export function thinkingLevelLabel(
  provider: ThinkingLevelProvider,
  level: ThinkingLevel,
  t: (key: string) => string,
): string {
  const key = LEVEL_KEYS[provider][level.id];
  return key ? t(key) : level.pageLabel;
}

/** "Thinking", or "Thinking · High" while a level decides how hard it thinks. */
export function thinkingPillLabel(control: ThinkingControl, t: (key: string) => string): string {
  const base = t('chat.thinkingMode.label');
  if (control.kind !== 'menu' || !control.active) return base;
  const level = control.levels.find((entry) => entry.id === control.level);
  return level ? `${base} · ${thinkingLevelLabel(control.provider, level, t)}` : base;
}
