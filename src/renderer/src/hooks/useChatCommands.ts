import { useMemo } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import {
  BOT_COMMAND_RE,
  BUILTIN_AGENT_FLOW_ID,
  BUILTIN_CHAT_FLOW_ID,
  BUILTIN_NEW_FLOW_ID,
  BUILTIN_QUICKSEARCH_FLOW_ID,
  BUILTIN_SEARCH_FLOW_ID,
} from '../../../shared/types';

export interface ChatCommand {
  flowId: string;
  command: string;
  description: string;
  aliases?: string[];
  action?: true;
}

export type CommandGroup = 'action' | 'builtin' | 'flow';

const ACTION_FLOW_IDS = new Set<string>([BUILTIN_NEW_FLOW_ID]);
const BUILTIN_FLOW_IDS = new Set<string>([
  BUILTIN_CHAT_FLOW_ID,
  BUILTIN_AGENT_FLOW_ID,
  BUILTIN_SEARCH_FLOW_ID,
  BUILTIN_QUICKSEARCH_FLOW_ID,
]);

const GROUP_ORDER: CommandGroup[] = ['action', 'builtin', 'flow'];

export function commandGroup(command: ChatCommand): CommandGroup {
  if (ACTION_FLOW_IDS.has(command.flowId)) return 'action';
  if (BUILTIN_FLOW_IDS.has(command.flowId)) return 'builtin';
  return 'flow';
}

export function startsNewGroup(commands: ChatCommand[], index: number): boolean {
  if (index < 1) return false;
  return commandGroup(commands[index]) !== commandGroup(commands[index - 1]);
}

function spellings(command: ChatCommand): string[] {
  return [command.command, ...(command.aliases ?? [])];
}

export function filterChatCommands(commands: ChatCommand[], query: string): ChatCommand[] {
  const matched = commands.filter((c) => spellings(c).some((name) => name.includes(query)));
  const rank = (c: ChatCommand): number => (spellings(c).some((name) => name.startsWith(query)) ? 0 : 1);
  return GROUP_ORDER.flatMap((group) => matched
    .filter((c) => commandGroup(c) === group)
    .sort((a, b) => rank(a) - rank(b)));
}

export function parseSlashCommand(text: string): { command: string; args: string } | null {
  if (!text.startsWith('/')) return null;
  const body = text.slice(1);
  const spaceIdx = body.search(/\s/);
  if (spaceIdx === -1) return { command: body.toLowerCase(), args: '' };
  return { command: body.slice(0, spaceIdx).toLowerCase(), args: body.slice(spaceIdx + 1).trim() };
}

export function slashMenuQuery(text: string): string | null {
  const match = /^\/([a-zA-Z0-9_]*)$/.exec(text);
  return match ? match[1].toLowerCase() : null;
}

export function useChatCommands(): ChatCommand[] {
  const flows = useFlowStore((s) => s.flows);
  return useMemo(() => {
    const seen = new Set<string>();
    const commands: ChatCommand[] = [];
    for (const flow of flows) {
      if (!flow.enabled) continue;
      for (const trigger of [flow.trigger, ...(flow.extraTriggers ?? [])]) {
        if (trigger.type !== 'chat') continue;
        const command = (trigger.chatCommand ?? '').toLowerCase().trim();
        if (!command || !BOT_COMMAND_RE.test(command) || seen.has(command)) continue;
        seen.add(command);
        commands.push({ flowId: flow.id, command, description: trigger.chatCommandDescription?.trim() ?? '' });
      }
    }
    return commands;
  }, [flows]);
}
