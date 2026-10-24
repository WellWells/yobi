import React from 'react';
import { ActionIcon, Badge, Box, Group, Loader, Menu, Stack, Text, Tooltip } from '@mantine/core';
import { KeyRound, LogIn, MoreVertical, Pencil, Plug, Trash2, Unplug } from 'lucide-react';
import { AppButton } from '../../../../components/AppButton';
import { connectorTint, renderConnectorIcon } from '../../../../config/connectorIcons';
import { Z_POPOVER } from '../../../../config/zLayers';
import { useThemeStore } from '../../../../store/themeStore';
import classes from './ConnectorCard.module.css';
import { connectorCardDetail } from './connectorTiles';
import { BotAccessCaption } from '../BotAccessCaption';
import { CommandClashNotice } from './CommandClashNotice';
import type { McpCatalogEntry } from '../../../../../../shared/mcpCatalog';
import type { McpServerView } from '../../../../../../shared/types';
import { fillTemplate } from '../../../../../../shared/fillTemplate';

export interface ConnectorCardProps {
  entry?: McpCatalogEntry;
  server?: McpServerView;
  name: string;
  description: string;
  /** Who may use this connector through the bots (read-only); omitted while no bot is on. */
  botAccess?: string;
  /** Why this connector has no slash command, or which connector went without the name it kept. */
  commandNotice?: readonly string[];
  busy: boolean;
  t: (key: string) => string;
  onAdd: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onOpenTools: () => void;
}

export type ConnectorCardAction = 'connect' | 'token' | 'signIn';

/**
 * The card's one labelled button, or none once connected. An entry that needs a pasted token
 * opens the form; a saved server that lost its sign-in signs in again; anything else connects.
 */
export function connectorCardAction(
  entry: McpCatalogEntry | undefined,
  server: McpServerView | undefined,
): ConnectorCardAction | null {
  if (!server) return entry?.auth === 'token' ? 'token' : 'connect';
  if (server.status === 'connected') return null;
  return server.status === 'needs_auth' ? 'signIn' : 'connect';
}

const ACTION_LOOK: Record<ConnectorCardAction, { icon: React.ReactNode; labelKey: string }> = {
  connect: { icon: <Plug size={12} />, labelKey: 'settings.mcp.connect' },
  token: { icon: <KeyRound size={12} />, labelKey: 'settings.mcp.enterToken' },
  signIn: { icon: <LogIn size={12} />, labelKey: 'settings.mcp.signIn' },
};

export const ConnectorCard: React.FC<ConnectorCardProps> = ({
  entry, server, name, description, botAccess, commandNotice, busy, t,
  onAdd, onConnect, onDisconnect, onEdit, onRemove, onOpenTools,
}) => {
  const status = server?.status;
  const connected = status === 'connected';
  const pending = busy || status === 'connecting';
  const needsAuth = status === 'needs_auth' || status === 'error';
  const toolCount = server?.toolCount ?? 0;
  const interactive = connected && toolCount > 0;
  const theme = useThemeStore((state) => state.theme);
  const tint = connectorTint(entry, theme);
  const kind = connectorCardAction(entry, server);
  const action = kind ? ACTION_LOOK[kind] : null;

  return (
    <Box
      p={12}
      h="100%"
      className={classes.card}
      data-interactive={interactive || undefined}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--mantine-radius-md)',
        background: 'var(--bg-secondary)',
        cursor: interactive ? 'pointer' : 'default',
      }}
      onClick={interactive ? onOpenTools : undefined}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap={10}>
        <Group gap={10} align="flex-start" wrap="nowrap" flex={1} miw={0}>
          <Box
            c={tint ?? 'var(--text-primary)'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, flexShrink: 0, borderRadius: 'var(--mantine-radius-sm)',
              background: 'var(--bg-tertiary)',
            }}
          >
            {renderConnectorIcon(entry)}
          </Box>
          <Stack gap={3} miw={0}>
            <Group gap={6} wrap="nowrap" miw={0}>
              <Text fz="var(--font-size-base)" fw={600} c="var(--text-primary)" truncate>{name}</Text>
              {connected && (
                <Badge variant="light" color="var(--mantine-color-success)" size="sm">
                  {fillTemplate(t('settings.mcp.toolCount'), { count: String(toolCount) })}
                </Badge>
              )}
              {needsAuth && (
                <Badge
                  variant="light"
                  color={status === 'error' ? 'var(--mantine-color-error)' : 'var(--mantine-color-warning)'}
                  size="sm"
                >
                  {t(status === 'error' ? 'settings.mcp.status.error' : 'settings.mcp.status.needsAuth')}
                </Badge>
              )}
            </Group>
            <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5} lineClamp={2}>
              {connectorCardDetail(server, description)}
            </Text>
            {commandNotice && <CommandClashNotice lines={commandNotice} />}
            {botAccess && <BotAccessCaption text={botAccess} />}
          </Stack>
        </Group>

        <Group gap={4} wrap="nowrap" align="center" style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          {pending && <Loader size={16} />}
          {!pending && action && (
            <AppButton
              variant="default"
              size="compact-xs"
              leftSection={action.icon}
              onClick={server ? onConnect : onAdd}
              style={{ flexShrink: 0 }}
            >
              {t(action.labelKey)}
            </AppButton>
          )}
          {server && (
            <Menu position="bottom-end" withinPortal zIndex={Z_POPOVER}>
              <Menu.Target>
                <Tooltip label={t('common.moreActions')} position="bottom">
                  <ActionIcon variant="subtle" size={30} aria-label={t('common.moreActions')}>
                    <MoreVertical size={15} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                {connected && (
                  <Menu.Item leftSection={<Unplug size={14} />} onClick={onDisconnect}>
                    {t('settings.mcp.disconnect')}
                  </Menu.Item>
                )}
                <Menu.Item leftSection={<Pencil size={14} />} onClick={onEdit}>
                  {t('settings.mcp.edit')}
                </Menu.Item>
                <Menu.Item leftSection={<Trash2 size={14} />} c="red" onClick={onRemove}>
                  {t('settings.mcp.delete')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>
    </Box>
  );
};
