import { matchConnectorKeywords } from '../shared/connectorKeywords';
import type { KeywordCandidate } from '../shared/connectorKeywords';
import { reachableOnSend } from '../shared/mcpConnectOnUse';
import type { BotConnectorRights } from '../shared/botPermissions';
import type { McpServerView } from '../shared/types';
import { loadConversation, mergeConversationThread } from './chat/conversationStore';
import { sendLog } from './helpers';
import { getMcpRegistry } from './mcp';

/**
 * Which connectors a bot message declares, the way the desktop composer does: a connector the
 * message names (`matchConnectorKeywords`) is declared for the run, and the conversation keeps it in
 * its thread marker (`mcp`), so a follow-up that does not name it again still has it. Undeclared, a
 * bot run sweeps up every connected server, and with many of them the model sees one summary line
 * per server and guesses at tool names.
 */
export interface BotConnectorDisclosure {
  /** Declared for this run: kept or named, reachable now, and granted to this account. */
  ids: string[];
  /** The conversation's set after this message, or null when the message added nothing. */
  remember: string[] | null;
  /** Named by this message itself, kept or not: a job for the agent beyond whatever else it asks. */
  named: string[];
}

function granted(rights: BotConnectorRights, id: string): boolean {
  return rights === 'all' || (rights !== 'none' && rights.includes(id));
}

/** The connectors this account may have declared, each marked by whether a send can reach it. */
export function botKeywordCandidates(views: readonly McpServerView[], rights: BotConnectorRights): KeywordCandidate[] {
  return views
    .filter((view) => view.agentEnabled !== false && granted(rights, view.id))
    .map((view) => ({ id: view.id, name: view.name, url: view.url, connected: reachableOnSend(view) }));
}

/**
 * A kept connector that cannot be reached now is left out rather than declared: declared and
 * unreachable fails the whole run, and every later message of the conversation would fail with it.
 */
export function pickBotConnectors(
  text: string,
  kept: readonly string[],
  candidates: readonly KeywordCandidate[],
): BotConnectorDisclosure {
  const named = matchConnectorKeywords(text, candidates);
  const reachable = new Set(candidates.filter((candidate) => candidate.connected).map((candidate) => candidate.id));
  const ids = [...new Set([...kept.filter((id) => reachable.has(id)), ...named])];
  const added = named.filter((id) => !kept.includes(id));
  return { ids, remember: added.length > 0 ? [...kept, ...added] : null, named };
}

export async function discloseBotConnectors(
  text: string,
  conversationPath: string | undefined,
  rights: BotConnectorRights,
): Promise<BotConnectorDisclosure> {
  const registry = getMcpRegistry();
  if (!registry || rights === 'none') return { ids: [], remember: null, named: [] };
  const kept = conversationPath ? (await loadConversation(conversationPath))?.doc.thread?.mcp ?? [] : [];
  return pickBotConnectors(text, kept, botKeywordCandidates(registry.listServers(), rights));
}

/** Best effort: the run already used the set, it just will not carry to the next message. */
export async function rememberBotConnectors(filePath: string, ids: readonly string[]): Promise<void> {
  try {
    await mergeConversationThread(filePath, { mcp: [...ids] });
  } catch (err: unknown) {
    sendLog(`⚠️ [Bot] could not remember the conversation's connectors (${err instanceof Error ? err.message : String(err)})`);
  }
}
