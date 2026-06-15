import { useMemo } from 'react';
import { useAgentFlowStore } from '../store/useAgentFlowStore';
import { TELEGRAM_COMMAND_RE } from '../../../shared/types';

export interface ChatCommand {
  flowId: string;
  command: string;
  description: string;
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
  const flows = useAgentFlowStore((s) => s.flows);
  return useMemo(() => {
    const seen = new Set<string>();
    const commands: ChatCommand[] = [];
    for (const flow of flows) {
      if (!flow.enabled) continue;
      for (const trigger of [flow.trigger, ...(flow.extraTriggers ?? [])]) {
        if (trigger.type !== 'chat') continue;
        const command = (trigger.chatCommand ?? '').toLowerCase().trim();
        if (!command || !TELEGRAM_COMMAND_RE.test(command) || seen.has(command)) continue;
        seen.add(command);
        commands.push({ flowId: flow.id, command, description: trigger.chatCommandDescription?.trim() ?? '' });
      }
    }
    return commands;
  }, [flows]);
}
