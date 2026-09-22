import React from 'react';
import { ActionIcon, Badge, Box, Group, Loader, Menu, Stack, Text, Tooltip } from '@mantine/core';
import { KeyRound, LogIn, MoreVertical, Pencil, Plus, Trash2, Unplug } from 'lucide-react';
import { connectorTint, renderConnectorIcon } from '../../../../config/connectorIcons';
import { Z_POPOVER } from '../../../../config/zLayers';
import { useThemeStore } from '../../../../store/themeStore';
import classes from './ConnectorCard.module.css';
import type { McpCatalogEntry } from '../../../../../../shared/mcpCatalog';
import type { McpServerView } from '../../../../../../shared/types';

export interface ConnectorCardProps {
  entry?: McpCatalogEntry;
  server?: McpServerView;
  name: string;
  description: string;
  busy: boolean;
  t: (key: string) => string;
  onAdd: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onOpenTools: () => void;
}

export const ConnectorCard: React.FC<ConnectorCardProps> = ({
  entry, server, name, description, busy, t,
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

  return (
    <Box
      p={12}
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
                <Badge variant="light" color="teal" radius="sm" size="sm" tt="none" fw={500}>
                  {t('settings.mcp.toolCount').replace('{{count}}', String(toolCount))}
                </Badge>
              )}
              {needsAuth && (
                <Badge
                  variant="light"
                  color={status === 'error' ? 'red' : 'yellow'}
                  radius="sm"
                  size="sm"
                  tt="none"
                  fw={500}
                >
                  {t(status === 'error' ? 'settings.mcp.status.error' : 'settings.mcp.status.needsAuth')}
                </Badge>
              )}
            </Group>
            <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5} lineClamp={2}>
              {server?.error && !connected ? server.error : description}
            </Text>
          </Stack>
        </Group>

        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          {pending && <Loader size={16} />}
          {!pending && !server && (
            <Tooltip label={entry?.auth === 'token' ? t('settings.mcp.auth.token') : t('settings.mcp.connect')} position="top">
              <ActionIcon variant="default" size={30} aria-label={t('settings.mcp.connect')} onClick={onAdd}>
                {entry?.auth === 'token' ? <KeyRound size={14} /> : <Plus size={15} />}
              </ActionIcon>
            </Tooltip>
          )}
          {!pending && server && !connected && (
            <Tooltip label={t('settings.mcp.signIn')} position="top">
              <ActionIcon variant="default" size={30} aria-label={t('settings.mcp.signIn')} onClick={onConnect}>
                <LogIn size={14} />
              </ActionIcon>
            </Tooltip>
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
