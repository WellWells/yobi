import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { TriangleAlert } from 'lucide-react';
import { assignMcpCommandNames } from '../../../../../../shared/mcpCommand';
import type { McpCommandAssignment, McpCommandClash, McpCommandOwner } from '../../../../../../shared/mcpCommand';
import type { McpServerConfig } from '../../../../../../shared/types';
import { fillTemplate } from '../../../../../../shared/fillTemplate';

type CommandServer = Pick<McpServerConfig, 'id' | 'name' | 'url' | 'commandName'> & { agentEnabled?: boolean };

function fill(text: string, command: string, name: string): string {
  return fillTemplate(text, { command, name });
}

// Literal keys per branch: i18n:check only sees keys written out inside t().
function lostLine(command: string, owner: McpCommandOwner, t: (key: string) => string): string {
  switch (owner.kind) {
    case 'builtin': return fill(t('settings.mcp.command.clash.builtin'), command, '');
    case 'flow': return fill(t('settings.mcp.command.clash.flow'), command, owner.name);
    case 'connector': return fill(t('settings.mcp.command.clash.connector'), command, owner.name);
  }
}

/**
 * What to say on one connector about its slash command: that it has none and who holds the name,
 * or — on the connector that kept a contested name — which connector went without. Both sides of
 * a clash between two connectors are marked, so neither card hides half the story.
 */
export function commandClashLines<T extends { id: string; name: string }>(
  serverId: string,
  assignment: { clashes: readonly McpCommandClash<T>[] },
  t: (key: string) => string,
): string[] {
  const lines: string[] = [];
  for (const clash of assignment.clashes) {
    if (clash.server.id === serverId) lines.push(lostLine(clash.command, clash.owner, t));
  }
  for (const clash of assignment.clashes) {
    if (clash.owner.kind !== 'connector' || clash.owner.serverId !== serverId) continue;
    lines.push(fill(t('settings.mcp.command.clash.kept'), clash.command, clash.server.name));
  }
  return lines;
}

/**
 * The assignment as it would be once the form is saved: the edited server takes the draft in its
 * place (a new one goes last, as it would be added), so the field warns before the user saves.
 */
export function draftCommandAssignment<T extends CommandServer>(
  servers: readonly T[],
  owners: ReadonlyMap<string, McpCommandOwner>,
  draft: CommandServer,
): McpCommandAssignment<CommandServer> {
  const list: CommandServer[] = servers.map((server) => (server.id === draft.id ? draft : server));
  if (!servers.some((server) => server.id === draft.id)) list.push(draft);
  const usable = list.filter((server) => server.agentEnabled !== false);
  return assignMcpCommandNames(usable, new Map(owners));
}

export const CommandClashNotice: React.FC<{ lines: readonly string[] }> = ({ lines }) => {
  if (lines.length === 0) return null;
  return (
    <Stack gap={2}>
      {lines.map((line) => (
        <Group key={line} gap={6} align="flex-start" wrap="nowrap">
          <TriangleAlert size={13} color="var(--mantine-color-warning)" style={{ marginTop: 2, flexShrink: 0 }} />
          <Text fz="xs" c="var(--mantine-color-warning)" lh={1.5}>{line}</Text>
        </Group>
      ))}
    </Stack>
  );
};
