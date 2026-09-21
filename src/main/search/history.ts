import { loadConversation } from '../chat/conversationStore';
import { measureFor, packReplayPrompt, promptCapFor } from '../chat/conversationContext';
import { getTempChatConversation } from '../tempChat';
import { isByokTargetUrl } from '../../shared/types';
import type { SearchMode } from '../../shared/types';
import type { ConversationDoc } from '../../shared/conversationDoc';

/*
 * A follow-up keeps its subject in the thread rather than in its own words: "is registering a
 * hassle, what personal data does it want" only means something next to the question before it.
 * Searching it verbatim retrieves whatever else on the web registers people, and the answer is
 * then faithfully grounded in the wrong pages.
 *
 * So the thread comes along — but on a short leash. Every character spent here is one the
 * sources do not get, and the sources are what the answer is allowed to cite.
 */
const HISTORY_BUDGET: Record<SearchMode, number> = { standard: 4_000, quick: 2_000 };

/** Share of a browser provider's whole input cap that history may take. */
const CAP_SHARE = 0.2;

export function historyBudget(targetUrl: string, mode: SearchMode): number {
  const wanted = HISTORY_BUDGET[mode];
  if (isByokTargetUrl(targetUrl)) return wanted;
  const cap = promptCapFor(targetUrl);
  return cap > 0 ? Math.min(wanted, Math.floor(cap * CAP_SHARE)) : wanted;
}

async function conversationDocFor(
  conversationPath: string | undefined,
  tempChat: boolean,
): Promise<ConversationDoc | null> {
  if (tempChat) return getTempChatConversation();
  if (!conversationPath) return null;
  return (await loadConversation(conversationPath))?.doc ?? null;
}

/**
 * The earlier turns of the chat the search was typed into, packed newest-first into `budget`.
 * Empty when the search did not come from a conversation, or when it is the first question in
 * one — both mean there is no context to resolve against.
 *
 * `tempChat` is decided by the caller, never read from the global here: temp-chat mode is a
 * desktop setting, and a search arriving from a bot must not be answered out of the thread
 * sitting on the user's screen.
 */
export async function buildSearchHistory(args: {
  conversationPath?: string;
  targetUrl: string;
  mode: SearchMode;
  tempChat?: boolean;
}): Promise<string> {
  const { conversationPath, targetUrl, mode, tempChat = false } = args;
  if (!conversationPath && !tempChat) return '';

  const budget = historyBudget(targetUrl, mode);
  if (budget <= 0) return '';

  const doc = await conversationDocFor(conversationPath, tempChat);
  if (!doc) return '';

  return packReplayPrompt({
    turns: doc.turns.slice(doc.thread.summarizedTurns ?? 0),
    summary: doc.thread.summary ?? '',
    newPrompt: '',
    budget,
    measure: measureFor(targetUrl),
  }).history;
}
