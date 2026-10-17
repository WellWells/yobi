import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { assignMcpCommandNames, mcpCommandFlowId, reservedCommandOwners } from '../../../shared/mcpCommand';
import type { McpCommandAssignment, McpCommandOwner } from '../../../shared/mcpCommand';
import { reachableOnSend } from '../../../shared/mcpConnectOnUse';
import { useFlowStore } from '../store/useFlowStore';
import { useMcpStore } from '../store/useMcpStore';
import { useChatCommands } from './useChatCommands';
import type { ChatCommand } from './useChatCommands';
import type { McpServerView } from '../../../shared/types';

/**
 * Every name a connector cannot take, with who holds it. Settings reads the same map as the
 * chat, so a connector Settings calls command-less is exactly one the slash menu leaves out.
 */
export function useReservedCommandOwners(): ReadonlyMap<string, McpCommandOwner> {
  const flowCommands = useChatCommands();
  const flows = useFlowStore((s) => s.flows);
  return useMemo(() => {
    const names = new Map(flows.map((flow) => [flow.id, flow.name]));
    return reservedCommandOwners(flowCommands, (id) => names.get(id) ?? '');
  }, [flowCommands, flows]);
}

/**
 * Which servers get a slash command, and which lost theirs to a name already held.
 *
 * `agentEnabled === false` gets neither: that toggle means "an AI may drive this server", and
 * disclosing it to the agent is exactly that — leaving the command visible would let the switch
 * be walked around by typing a slash.
 */
export function useMcpCommandAssignment(): McpCommandAssignment<McpServerView> {
  const servers = useMcpStore(useShallow((s) => s.servers));
  const owners = useReservedCommandOwners();
  return useMemo(() => {
    // Listed whether or not it is connected: an open connector connects when its command runs, and
    // a command that says "sign in first" is easier to recover from than one that vanishes.
    const usable = servers.filter((server) => server.agentEnabled !== false);
    return assignMcpCommandNames(usable, new Map(owners));
  }, [servers, owners]);
}

/**
 * One slash command per connected MCP server: `/notion`, `/github`, … Typing one discloses that
 * server to the conversation's agent turns from then on, so the command name is the whole
 * permission story the user sees.
 */
export function useMcpCommands(describe: (server: { connected: boolean }) => string): ChatCommand[] {
  const { assigned } = useMcpCommandAssignment();
  return useMemo(() => assigned.map(({ server, command }) => ({
    flowId: mcpCommandFlowId(server.id),
    command,
    description: describe({ connected: reachableOnSend(server) }),
    connectorUrl: server.url,
  })), [assigned, describe]);
}
