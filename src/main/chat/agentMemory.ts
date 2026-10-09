import * as path from 'node:path';
import { AGENT_ASK_TOOL } from '../../shared/types';
import type { AgentRunState, AgentTurnRecord } from '../../shared/types';
import { AGENT_HELP_TOOL } from '../flow/agent/agentTools';
import {
  botMemoryContext,
  memoryOnlyReply,
  parseBotChatKey,
  renderAgentMemoryBlock,
  resolveMemory,
  settleMemoryReply,
} from '../memory';
import type { MemoryAccessContext, ResolvedMemory, SettledReply, UserMemoryState } from '../memory';
import { isTempChatMode } from '../tempChat';
import type { CommandOrigin } from './commandOrigin';

/** A fixed context, or one worked out from the memory file — the form that can be checked again later. */
export type AgentMemoryContext = MemoryAccessContext | ((state: UserMemoryState) => MemoryAccessContext);

export interface AgentMemory extends ResolvedMemory {
  /** Who is asking, re-read when the answer's memory lines are written; a run can last minutes. */
  current?: (state: UserMemoryState) => MemoryAccessContext;
}

/**
 * The memory context of a bot chat named by its chat key, as a resolver: it reads the "me" marks
 * and the pairing each time it is asked, so an account unpaired mid-run stops writing at the end.
 */
export function botChatMemoryResolver(chatKey: string): (state: UserMemoryState) => MemoryAccessContext {
  const parsed = parseBotChatKey(chatKey);
  return (state) => (parsed ? botMemoryContext(state, parsed.platform, parsed.chatId, parsed.userId) : { surface: 'bot' });
}

/**
 * The app's own composer may use the memory unless temporary chat is on. A bot run gets it only
 * when its caller established that the message came from the user's own account, privately.
 */
export async function resolveAgentMemory(origin: CommandOrigin, ctx: AgentMemoryContext | undefined): Promise<AgentMemory> {
  if (typeof ctx === 'function') return { ...(await resolveMemory(ctx)), current: ctx };
  if (ctx) return resolveMemory(ctx);
  return resolveMemory(origin === 'bot' ? { surface: 'bot' } : { surface: 'app', temporary: isTempChatMode() });
}

export function agentMemoryBlock(memory: ResolvedMemory): string {
  return memory.access === 'readWrite' ? renderAgentMemoryBlock(memory.entries) : '';
}

/**
 * Any step other than asking the user or reading a tool's own help put someone else's text in front
 * of the model — a page, a mail, a chat, a file, a helper's report of one.
 */
export function agentReadOutsideContent(turns: readonly AgentTurnRecord[], attachments: readonly string[] = []): boolean {
  return attachments.length > 0 || turns.some((turn) => turn.tool !== AGENT_ASK_TOOL && turn.tool !== AGENT_HELP_TOOL);
}

/** The goal and the user's answers to this run's questions — the only text in a run the user wrote. */
export function agentUserWords(state: AgentRunState): string {
  const answers = state.turns
    .filter((turn) => turn.tool === AGENT_ASK_TOOL && turn.observation)
    .map((turn) => turn.observation);
  return [state.goal, ...answers].join('\n');
}

export function settleAgentMemory(
  answer: string,
  memory: AgentMemory,
  state: AgentRunState,
  origin: CommandOrigin,
  translate: (key: string) => string,
): Promise<SettledReply> {
  if (memory.access !== 'readWrite') return Promise.resolve({ text: answer, notes: [] });
  return settleMemoryReply(answer, {
    access: memory.access,
    ...(memory.current ? { currentContext: memory.current } : {}),
    source: origin === 'bot' ? 'bot' : 'agent',
    tainted: agentReadOutsideContent(state.turns, state.attachments),
    userText: agentUserWords(state),
    ...(state.conversationPath ? { conversation: path.basename(state.conversationPath) } : {}),
    logPrefix: '[Agent]',
    emptyReply: (notes) => memoryOnlyReply(notes, translate),
  });
}
