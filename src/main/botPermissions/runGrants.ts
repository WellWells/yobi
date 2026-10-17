import { NO_BOT_RIGHTS, intersectBotRights } from '../../shared/botPermissions';
import type { BotRights } from '../../shared/botPermissions';
import type { AgentRunState } from '../../shared/types';
import { parseBotChatKey } from '../memory/memoryContext';
import { getBotRights } from './rights';

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
