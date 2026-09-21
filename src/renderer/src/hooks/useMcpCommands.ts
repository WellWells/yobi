import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { assignMcpCommandNames, mcpCommandFlowId } from '../../../shared/mcpCommand';
import { useMcpStore } from '../store/useMcpStore';
import type { ChatCommand } from './useChatCommands';

/**
 * One slash command per connected MCP server: `/notion`, `/github`, … Typing one discloses that
 * server to the conversation's agent turns from then on, so the command name is the whole
 * permission story the user sees.
 *
 * `agentEnabled === false` hides the command. That toggle means "an AI may drive this server",
 * and disclosing it to the agent is exactly that — leaving the command visible would let the
 * switch be walked around by typing a slash.
 */
export function useMcpCommands(
  reservedNames: ReadonlySet<string>,
  describe: (server: { connected: boolean }) => string,
): ChatCommand[] {
  const servers = useMcpStore(useShallow((s) => s.servers));
  return useMemo(() => {
    // Listed whether or not it is connected. Filtering on `status === 'connected'` made the
    // command vanish after every launch for the no-auth connectors — syncOnBoot only reconnects
    // servers that already hold a token — and a command that disappears is harder to recover from
    // than one that runs and says "connect this first".
    const usable = servers.filter((server) => server.agentEnabled !== false);
    return assignMcpCommandNames(usable, new Set(reservedNames)).map(({ server, command }) => ({
      flowId: mcpCommandFlowId(server.id),
      command,
      description: describe({ connected: server.status === 'connected' }),
      connectorUrl: server.url,
    }));
  }, [servers, reservedNames, describe]);
}
