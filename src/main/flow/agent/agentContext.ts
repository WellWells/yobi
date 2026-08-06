import { loadConversation } from '../../chat/conversationStore';
import { measureFor, packReplayPrompt, promptCapFor } from '../../chat/conversationContext';
import type { ConversationDoc } from '../../../shared/conversationDoc';
import { isByokTargetUrl } from '../../../shared/types';
import { getTempChatConversation, isTempChatMode } from '../../tempChat';
import { sendLog } from '../../helpers';
import { INSTRUCTION_EST } from './agentPrompts';

/** Exported for the test suite, which derives its boundary cases from them. */
export const SAFETY_MARGIN = 1_200;
export const AGENT_HISTORY_MIN = 800;
const AGENT_HISTORY_MAX = 12_000;

export function agentHistoryBudget(providerUrl: string, catalogLen: number, goalLen: number): number {
  if (isByokTargetUrl(providerUrl)) return AGENT_HISTORY_MAX;
  const budget = promptCapFor(providerUrl) - INSTRUCTION_EST - catalogLen - goalLen - SAFETY_MARGIN;
  if (budget < AGENT_HISTORY_MIN) return 0;
  return Math.min(budget, AGENT_HISTORY_MAX);
}

export function historyFromDoc(
  doc: ConversationDoc,
  budget: number,
  measure: (text: string) => number,
): string {
  if (budget <= 0) return '';
  const summarizedTurns = doc.thread.summarizedTurns ?? 0;
  return packReplayPrompt({
    turns: doc.turns.slice(summarizedTurns),
    summary: doc.thread.summary ?? '',
    newPrompt: '',
    budget,
    measure,
  }).history;
}

export function historyPromptCost(history: string, providerUrl: string): number {
  return history ? measureFor(providerUrl)(history) : 0;
}

async function conversationDocFor(conversationPath?: string): Promise<ConversationDoc | null> {
  if (isTempChatMode()) return getTempChatConversation();
  if (!conversationPath) return null;
  return (await loadConversation(conversationPath))?.doc ?? null;
}

export async function buildAgentHistory(args: {
  conversationPath?: string;
  providerUrl: string;
  catalogLen: number;
  goalLen: number;
}): Promise<string> {
  const { conversationPath, providerUrl, catalogLen, goalLen } = args;
  if (!conversationPath && !isTempChatMode()) return '';

  const budget = agentHistoryBudget(providerUrl, catalogLen, goalLen);
  if (budget <= 0) {
    sendLog('🧠 [Agent] The provider\'s input limit leaves no room for conversation history — running without it');
    return '';
  }

  const doc = await conversationDocFor(conversationPath);
  if (!doc) return '';

  const history = historyFromDoc(doc, budget, measureFor(providerUrl));
  if (history) sendLog(`🧠 [Agent] Carrying earlier conversation (${historyPromptCost(history, providerUrl)}/${budget} of the history budget)`);
  return history;
}
