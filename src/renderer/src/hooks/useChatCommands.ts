import { useMemo } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { MCP_COMMAND_ID_PREFIX } from '../../../shared/mcpCommand';
import {
  BOT_COMMAND_RE,
  BUILTIN_AGENT_FLOW_ID,
  BUILTIN_CHAT_FLOW_ID,
  BUILTIN_MODEL_COMMAND,
  BUILTIN_MODEL_FLOW_ID,
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
  /** Connector endpoint, for MCP commands only — the menu resolves it to that brand's mark. */
  connectorUrl?: string;
}

export type CommandGroup = 'action' | 'builtin' | 'mcp' | 'flow';

// `/model` acts on the app rather than asking anything, so it sits with `/new` even though it
// takes an argument where `/new` runs at once.
const ACTION_FLOW_IDS = new Set<string>([BUILTIN_NEW_FLOW_ID, BUILTIN_MODEL_FLOW_ID]);
const BUILTIN_FLOW_IDS = new Set<string>([
  BUILTIN_CHAT_FLOW_ID,
  BUILTIN_AGENT_FLOW_ID,
  BUILTIN_SEARCH_FLOW_ID,
  BUILTIN_QUICKSEARCH_FLOW_ID,
]);

const GROUP_ORDER: CommandGroup[] = ['action', 'builtin', 'mcp', 'flow'];

export function commandGroup(command: ChatCommand): CommandGroup {
  if (ACTION_FLOW_IDS.has(command.flowId)) return 'action';
  if (BUILTIN_FLOW_IDS.has(command.flowId)) return 'builtin';
  // A prefix test, not a Set: connector ids are unbounded. Still never a plain-object lookup,
  // so an id like 'toString' cannot pass itself off as a group.
  if (command.flowId.startsWith(MCP_COMMAND_ID_PREFIX)) return 'mcp';
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

const MODEL_MENU_RE = new RegExp(`^/${BUILTIN_MODEL_COMMAND}[ \\t\\u3000]+(.*)$`, 'i');

/**
 * What `/model ` has been followed by so far, or `null` when the box does not read as one. The
 * space is what opens the list: `/model` alone is still being typed as a command.
 */
export function modelMenuQuery(text: string): string | null {
  const match = MODEL_MENU_RE.exec(text);
  return match ? match[1] : null;
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
