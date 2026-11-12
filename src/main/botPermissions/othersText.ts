/**
 * A bot run that carries words someone else wrote runs on what a group may have. On LINE PC every
 * chat is the owner's own for their rights (`rights.ts` `isOwnChat`): their LINE chats, files on
 * this computer, Notion and mail reach a run they start anywhere. That is safe only while nothing
 * but the asker's own words reaches the run. Once the group's talk (`recentChat`) or a quoted
 * message (`replyTo`) written by anyone else is in it, those words could steer the agent into
 * reading private data and posting it where everyone in the chat reads it. Such a run keeps chat,
 * the agent tools, the web, the
 * downloader and public-data connectors; it loses local tools, shell, private connectors (LINE's own
 * included), connector changes, flow building and personal memory. Decided from the run's saved
 * state and its conversation's mark (`BotSession.othersText`), so a resume and every later turn
 * that replays those words decide the same.
 */
import { botConversationHasOthersText } from '../botConversations';
import { PUBLIC_DATA_CONNECTOR_IDS } from '../../shared/builtinConnectors';
import { connectorCapability } from '../../shared/botCapabilities';
import { intersectBotRights } from '../../shared/botPermissions';
import type { BotRights } from '../../shared/botPermissions';
import type { AgentRunState } from '../../shared/types';
import { parseBotChatKey } from '../memory/memoryContext';

type RunChat = Pick<AgentRunState, 'replyTo' | 'recentChat'>;

/**
 * Whether a run started from this chat key carries someone else's words: on LINE PC, a quoted
 * message not marked the asker's, or any line of the group's talk not theirs. Other platforms
 * already give a group only what a group may have, and their private chats hold no one else.
 */
export function carriesOthersText(chatKey: string, chat: RunChat): boolean {
  if (parseBotChatKey(chatKey)?.platform !== 'lineSelf') return false;
  const reply = chat.replyTo;
  if (reply && typeof reply === 'object' && reply.asker !== true) return true;
  return Array.isArray(chat.recentChat) && chat.recentChat.some((line) => line?.asker !== true);
}

/**
 * Whether a run carries someone else's words, counting the conversation it continues: once one run
 * brought them in, the file holds them (the quote in the turn, the answer built from them) and every
 * later turn replays it, so a later "Yobi 明天天氣" with nothing quoted is held the same until the
 * conversation is new (`/new`, idle). The run's own words decide first; then the file's mark.
 */
export async function runCarriesOthersText(chatKey: string, chat: RunChat, conversationPath: string | null | undefined): Promise<boolean> {
  if (parseBotChatKey(chatKey)?.platform !== 'lineSelf') return false;
  return carriesOthersText(chatKey, chat) || botConversationHasOthersText(chatKey, conversationPath);
}

/** The most a run with someone else's words in it may have: what a group may be given. */
function groupCeiling(): BotRights {
  const connectors = PUBLIC_DATA_CONNECTOR_IDS.filter((id) => connectorCapability(id).inGroups);
  return {
    chat: true,
    agent: true,
    web: true,
    download: true,
    preview: true,
    local: false,
    shell: false,
    admin: false,
    connectors: connectors.length > 0 ? connectors : 'none',
  };
}

/** The rights such a run keeps; unchanged when it carries no one else's words. */
export function othersTextRights(rights: BotRights, othersText: boolean): BotRights {
  if (!othersText) return rights;
  const narrowed = intersectBotRights(rights, groupCeiling());
  return Array.isArray(narrowed.connectors) && narrowed.connectors.length === 0 ? { ...narrowed, connectors: 'none' } : narrowed;
}

/**
 * What the asker may approve in the chat for such a run: nothing (no connector change, no flow
 * saved); unchanged when it carries no one else's words.
 */
export function othersTextApprovals<A extends { connectorChanges: boolean; flows: object | null }>(approvals: A, othersText: boolean): A {
  return othersText ? { ...approvals, connectorChanges: false, flows: null } : approvals;
}
