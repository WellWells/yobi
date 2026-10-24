/**
 * The providers' own temporary chats: kept out of the account's history, so a one-shot send
 * (a flow step, a translation, a search synthesis) leaves no conversation behind.
 * ChatGPT and Claude open one from a link; Gemini only from a button its runner presses;
 * Perplexity's is an account-menu toggle for signed-in users, so it is not used.
 */
import { PROVIDER_URLS, providerFromUrl } from '../../shared/types';
import type { Provider } from '../../shared/types';
import { isSamePage, TEMPORARY_CHAT_QUERY } from './pageReuse';

export function supportsTemporaryChat(provider: Provider): boolean {
  return provider !== 'perplexity';
}

/** The provider home as a temporary chat; any other page (a custom GPT, a thread) is left as is. */
export function temporaryChatUrl(url: string): string {
  const provider = providerFromUrl(url);
  const query = TEMPORARY_CHAT_QUERY[provider];
  if (!query || !isSamePage(url, PROVIDER_URLS[provider])) return url;
  const parsed = new URL(url);
  parsed.searchParams.set(query.name, query.value);
  return parsed.href;
}
