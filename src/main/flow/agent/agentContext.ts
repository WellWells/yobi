import { loadConversation } from '../../chat/conversationStore';
import { measureFor, packReplayPrompt, promptCapFor } from '../../chat/conversationContext';
import { readTurnFiles, readTurnMedia } from '../../../shared/conversationDoc';
import type { ConversationDoc, ConversationTurn } from '../../../shared/conversationDoc';
import { isByokTargetUrl } from '../../../shared/types';
import { getTempChatConversation } from '../../tempChat';
import { sendLog } from '../../helpers';
import { INSTRUCTION_EST } from './agentPrompts';
import { agentReadPathFor } from './agentSandbox';

export const SHOWN_FILES_HEADING = 'FILES SHOWN WITH THIS ANSWER (on this computer; a tool that takes a file path can use them):';

/** A turn as the agent replays it: its answer, then the files it showed under that heading. */
export function withShownFiles(turn: ConversationTurn, paths: readonly string[]): ConversationTurn {
  if (paths.length === 0) return turn;
  const list = paths.map((file) => `- ${file}`).join('\n');
  return { ...turn, response: `${turn.response.trim()}\n\n${SHOWN_FILES_HEADING}\n${list}`.trim() };
}

/**
 * The turns with the pictures and files each one showed (a picture a provider drew, a saved
 * video), named by the paths the agent's tools read; a file outside them is left out.
 */
export async function turnsWithShownFiles(turns: readonly ConversationTurn[]): Promise<ConversationTurn[]> {
  return Promise.all(turns.map(async (turn) => {
    const files = [...readTurnMedia(turn.meta), ...readTurnFiles(turn.meta)];
    if (files.length === 0) return turn;
    const paths = await Promise.all(files.map((file) => agentReadPathFor(file)));
    return withShownFiles(turn, [...new Set(paths.filter((file): file is string => file !== null))]);
  }));
}

export const SAFETY_MARGIN = 1_200;
export const AGENT_HISTORY_MIN = 800;
const AGENT_HISTORY_MAX = 12_000;

export const MCP_CATALOG_RESERVE = 4_000;

export function agentHistoryBudget(
  providerUrl: string,
  catalogLen: number,
  goalLen: number,
  mcpReserve = 0,
): number {
  if (isByokTargetUrl(providerUrl)) return AGENT_HISTORY_MAX;
  const budget = promptCapFor(providerUrl) - INSTRUCTION_EST - catalogLen - goalLen - SAFETY_MARGIN - mcpReserve;
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

/**
 * The temporary chat is read only when the caller says this run IS that chat (the desktop composer
 * with the mode on), never because the mode happens to be on: a bot message, a flow or a helper
 * running meanwhile would otherwise be handed the desktop user's private turns.
 */
async function conversationDocFor(conversationPath: string | undefined, temporaryChat: boolean): Promise<ConversationDoc | null> {
  if (temporaryChat) return getTempChatConversation();
  if (!conversationPath) return null;
  return (await loadConversation(conversationPath))?.doc ?? null;
}

export async function buildAgentHistory(args: {
  conversationPath?: string;
  /** This run is the desktop's temporary chat; see `conversationDocFor`. */
  temporaryChat?: boolean;
  providerUrl: string;
  catalogLen: number;
  goalLen: number;
  mcpReserve?: number;
}): Promise<string> {
  const { conversationPath, providerUrl, catalogLen, goalLen, mcpReserve = 0 } = args;
  const temporaryChat = args.temporaryChat === true;
  if (!conversationPath && !temporaryChat) return '';

  const budget = agentHistoryBudget(providerUrl, catalogLen, goalLen, mcpReserve);
  if (budget <= 0) {
    sendLog('🧠 [Agent] The provider\'s input limit leaves no room for conversation history — running without it');
    return '';
  }

  const doc = await conversationDocFor(conversationPath, temporaryChat);
  if (!doc) return '';

  const history = historyFromDoc({ ...doc, turns: await turnsWithShownFiles(doc.turns) }, budget, measureFor(providerUrl));
  if (history) sendLog(`🧠 [Agent] Carrying earlier conversation (${historyPromptCost(history, providerUrl)}/${budget} of the history budget)`);
  return history;
}
