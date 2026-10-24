import type { Provider } from '../../shared/types';
import { GEMINI_SIGNED_OUT_PROMPT_CAP, geminiPromptCap } from './geminiSignInState';

export interface ProviderPromptPolicy {
  maxBytes: number | null;
  maxCharsPlusBreaks: number | null;
}

/**
 * Static, signed-out-safe caps. Runtime budgets read `promptPolicyFor()`; only readers that cannot
 * know which provider or sign-in state consumes the text read this table directly.
 */
export const PROVIDER_PROMPT_POLICIES: Record<Provider, ProviderPromptPolicy> = {
  chatgpt: { maxBytes: 65_535, maxCharsPlusBreaks: null },
  claude: { maxBytes: 100_000, maxCharsPlusBreaks: null },
  perplexity: { maxBytes: 40_000, maxCharsPlusBreaks: null },
  gemini: { maxBytes: null, maxCharsPlusBreaks: GEMINI_SIGNED_OUT_PROMPT_CAP },
};

/** The cap that applies right now. Gemini's depends on the sign-in state (`geminiSignInState`). */
export function promptPolicyFor(provider: Provider): ProviderPromptPolicy {
  if (provider !== 'gemini') return PROVIDER_PROMPT_POLICIES[provider];
  return { maxBytes: null, maxCharsPlusBreaks: geminiPromptCap() };
}
