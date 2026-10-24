import { NO_BOT_RIGHTS, intersectBotRights } from '../../shared/botPermissions';
import type { BotRights } from '../../shared/botPermissions';
import type { AgentRunState } from '../../shared/types';
import { isBotSelfAccount, parseBotChatKey } from '../memory/memoryContext';
import { loadUserMemory } from '../memory/memoryStore';
import { computeBotConnectorChanges, computeBotFlowAdmin, getBotRights } from './rights';

type BotRunGrants = NonNullable<AgentRunState['botGrants']>;

/**
 * The rights of the person behind a bot chat key in that chat, read now; an unreadable key gets
 * none. Its `chat` is what stands between a stranger and a run: every paired account has it, an
 * unpaired person only in a group that grants it.
 */
export async function botChatRights(chatKey: string): Promise<BotRights> {
  const parsed = parseBotChatKey(chatKey);
  if (!parsed) return { ...NO_BOT_RIGHTS };
  return getBotRights(parsed.platform, parsed.userId, parsed.chatId);
}

/** `computeBotConnectorChanges` for a chat key, with a fresh read of the memory file; a failure fails closed. */
export async function botChatApprovesConnectorChanges(chatKey: string): Promise<boolean> {
  const parsed = parseBotChatKey(chatKey);
  if (!parsed) return false;
  const state = await loadUserMemory().catch(() => null);
  return computeBotConnectorChanges(state, parsed.platform, parsed.userId, parsed.chatId);
}

/**
 * Whether the person behind a bot chat key may build and change flows from this chat, read now: a
 * flow admin (`computeBotFlowAdmin`: the owner, or a Telegram admin-grant holder, still paired, in
 * their own private chat). `owner` says which — another admin's flows that read the owner's data
 * are saved switched off. A failure fails closed.
 */
export async function botChatFlowBuilder(chatKey: string): Promise<{ owner: boolean } | null> {
  const parsed = parseBotChatKey(chatKey);
  if (!parsed) return null;
  const state = await loadUserMemory().catch(() => null);
  if (!computeBotFlowAdmin(state, parsed.platform, parsed.userId, parsed.chatId)) return null;
  return { owner: state !== null && isBotSelfAccount(state, parsed.platform, parsed.userId) };
}

function grantsOf(rights: BotRights): BotRunGrants {
  const { connectors } = rights;
  return {
    web: rights.web,
    local: rights.local,
    shell: rights.shell,
    connectors: connectors === 'all' || connectors === 'none' ? connectors : [...connectors],
  };
}

function asRights(grants: BotRunGrants): BotRights {
  return {
    // A run that exists was allowed to start; whether it may go on is the rights read now.
    chat: true,
    agent: true,
    admin: true,
    download: true,
    preview: true,
    web: grants.web,
    local: grants.local,
    shell: grants.shell === true,
    connectors: grants.connectors,
  };
}

/**
 * A run saved before grants were recorded. Read narrowly: no local tools, and connectors only if
 * the run had them then (only the owner's runs did), each still subject to the account's grants
 * now — a pending question from an older build must not come back wider than either rule.
 */
function legacyGrants(state: AgentRunState): BotRunGrants {
  return {
    web: state.web !== false,
    local: false,
    shell: false,
    connectors: state.connectors === 'none' ? 'none' : 'all',
  };
}

/**
 * Records on the run what the account may use, and mirrors it into the two fields the agent run
 * already honours (`connectors: 'none'`, `web: false`). A fresh run takes the rights as they are; a
 * resume keeps only what both the saved run and the rights now allow — only ever narrowing.
 */
export function applyBotRunGrants(state: AgentRunState, rights: BotRights, resuming: boolean): BotRunGrants {
  const now = grantsOf(rights);
  const saved = state.botGrants ?? (resuming ? legacyGrants(state) : null);
  const next = saved ? grantsOf(intersectBotRights(asRights(saved), asRights(now))) : now;
  state.botGrants = next;
  if (next.connectors === 'none') state.connectors = 'none';
  if (!next.web) state.web = false;
  return next;
}
