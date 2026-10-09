import * as path from 'node:path';
import type { Task } from '../../shared/types';
import {
  botMemoryContext,
  entriesChangedSince,
  memoryOnlyReply,
  renderChatMemoryBlock,
  renderNativeMemoryReminder,
  resolveMemory,
  settleMemoryReply,
} from '../memory';
import { getLangCache, t } from '../i18n';
import type { MemoryAccessContext, ResolvedMemory, SettledReply, UserMemoryState } from '../memory';

/**
 * Who a bot task speaks for, read from the memory file and the pairing passed in. Undefined for
 * a desktop task: nothing about it can be revoked while its answer is pending.
 */
function botTaskContext(task: Task): ((state: UserMemoryState) => MemoryAccessContext) | undefined {
  const telegram = task.source === 'telegram' ? task.replyTarget : undefined;
  if (telegram) return (state) => botMemoryContext(state, 'telegram', String(telegram.chatId), String(telegram.userId));
  const line = task.source === 'line' ? task.lineReplyTarget : undefined;
  if (line) return (state) => botMemoryContext(state, 'line', line.chatId, line.userId);
  if (task.source === 'telegram' || task.source === 'line') return () => ({ surface: 'bot' });
  return undefined;
}

/**
 * The memory a queued chat task may use. A bot task reaches it only from the user's own account in
 * a private chat; a hotkey capture never does; the desktop composer does unless temporary chat is on.
 */
export function resolveTaskMemory(task: Task, temporary: boolean): Promise<ResolvedMemory> {
  const bot = botTaskContext(task);
  if (bot) return resolveMemory(bot);
  return resolveMemory({ surface: task.source === 'hotkey' ? 'hotkey' : 'app', temporary });
}

/** The memory part of the chat instruction; empty when this task may not use memory. */
export function taskMemoryInstruction(memory: ResolvedMemory): string {
  return memory.access === 'readWrite' ? renderChatMemoryBlock(memory.entries) : '';
}

/**
 * What a native follow-up carries. A thread with no recorded start predates this feature: its first
 * message never had the memory, so every entry counts as new to it.
 *
 * `extraRules` (the recap rule) are independent of memory: they ride when memory is off too, and
 * share the one `System Instruction:` line with the memory reminder when both are present.
 */
export function taskNativeReminder(
  memory: ResolvedMemory,
  threadAt: string | undefined,
  extraRules: readonly string[] = [],
): ((prompt: string) => string) | undefined {
  const memoryReminder = memory.access === 'readWrite'
    ? renderNativeMemoryReminder(entriesChangedSince(memory.entries, threadAt ?? new Date(0).toISOString()))
    : '';
  const parts = [memoryReminder, ...extraRules.map((rule) => rule.trim())].filter(Boolean);
  if (parts.length === 0) return undefined;
  const reminder = `System Instruction: ${parts.join('\n')}`;
  return (prompt) => `${reminder}\n\n${prompt}`;
}

export function settleTaskMemory(
  task: Task,
  memory: ResolvedMemory,
  response: string,
  userText: string,
  conversationPath: string | null,
): Promise<SettledReply> {
  if (memory.access !== 'readWrite') return Promise.resolve({ text: response, notes: [] });
  const currentContext = botTaskContext(task);
  return settleMemoryReply(response, {
    access: memory.access,
    ...(currentContext ? { currentContext } : {}),
    source: task.source === 'telegram' || task.source === 'line' ? 'bot' : 'chat',
    tainted: (task.attachments?.length ?? 0) > 0 || task.external === true,
    userText,
    ...(conversationPath ? { conversation: path.basename(conversationPath) } : {}),
    logPrefix: `[${task.id}]`,
    emptyReply: (notes) => memoryOnlyReply(notes, (key) => t(getLangCache(), key)),
  });
}
