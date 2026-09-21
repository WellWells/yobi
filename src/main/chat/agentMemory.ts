import * as path from 'node:path';
import { AGENT_ASK_TOOL } from '../../shared/types';
import type { AgentRunState, AgentTurnRecord } from '../../shared/types';
import { AGENT_HELP_TOOL } from '../flow/agent/agentTools';
import { memoryOnlyReply, renderAgentMemoryBlock, resolveMemory, settleMemoryReply } from '../memory';
import type { MemoryAccessContext, ResolvedMemory, SettledReply } from '../memory';
import { isTempChatMode } from '../tempChat';
import type { CommandOrigin } from './commandOrigin';

/**
 * The app's own composer may use the memory unless temporary chat is on. A bot run gets it only
 * when its caller established that the message came from the user's own account, privately.
 */
export function resolveAgentMemory(origin: CommandOrigin, ctx: MemoryAccessContext | undefined): Promise<ResolvedMemory> {
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
  memory: ResolvedMemory,
  state: AgentRunState,
  origin: CommandOrigin,
  translate: (key: string) => string,
): Promise<SettledReply> {
  if (memory.access !== 'readWrite') return Promise.resolve({ text: answer, notes: [] });
  return settleMemoryReply(answer, {
    access: memory.access,
    source: origin === 'bot' ? 'bot' : 'agent',
    tainted: agentReadOutsideContent(state.turns, state.attachments),
    userText: agentUserWords(state),
    ...(state.conversationPath ? { conversation: path.basename(state.conversationPath) } : {}),
    logPrefix: '[Agent]',
    emptyReply: (notes) => memoryOnlyReply(notes, translate),
  });
}
