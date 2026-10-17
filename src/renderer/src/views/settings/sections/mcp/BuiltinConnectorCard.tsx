import React from 'react';
import { Badge, Box, Group, Loader, Stack, Text } from '@mantine/core';
import { ToggleSwitch } from '../../../../components/ToggleSwitch';
import { renderServerIcon, serverTint } from '../../../../config/connectorIcons';
import { useThemeStore } from '../../../../store/themeStore';
import { findBuiltinConnector } from '../../../../../../shared/builtinConnectors';
import classes from './ConnectorCard.module.css';
import { BotAccessCaption } from '../BotAccessCaption';
import { CommandClashNotice } from './CommandClashNotice';
import type { useMcpServers } from '../../hooks/useMcpServers';

interface Props {
  mcp: ReturnType<typeof useMcpServers>;
  t: (key: string) => string;
  id: string;
  title: string;
  description: string;
  toggleLabel: string;
  onOpenTools: (id: string) => void;
  /** The error meaning "waiting for another app to start" rather than a failure; it gets no error badge. */
  waitingError?: string;
  /** Shown under the card while the connector is on but not connected. */
  setup?: React.ReactNode;
  /** Always shown under the card, on or off — for what other features use too (X's sign-in serves flows). */
  footer?: React.ReactNode;
  /** Who may use this connector through the bots (read-only); omitted while no bot is on. */
  botAccess?: string;
  /** Why this connector has no slash command, or which connector went without the name it kept. */
  commandNotice?: readonly string[];
}

// An opt-in connector hosted by the app. Once on it behaves like any other connector (its tools
// drive chat and its slash command), but it is switched rather than added by URL.
export const BuiltinConnectorCard: React.FC<Props> = ({
  mcp, t, id, title, description, toggleLabel, onOpenTools, waitingError, setup, footer, botAccess, commandNotice,
}) => {
  const server = mcp.servers.find((s) => s.id === id);
  // The same mark and colour the chat menus show, from the one resolver both read.
  const url = findBuiltinConnector(id)?.descriptor().url ?? '';
  const theme = useThemeStore((state) => state.theme);
  const tint = serverTint(url, theme);
  const enabled = Boolean(server);
  const connected = server?.status === 'connected';
  const pending = mcp.busyId === id || server?.status === 'connecting';
  const toolCount = server?.toolCount ?? 0;
  const interactive = connected && toolCount > 0;
  const waiting = waitingError !== undefined && server?.error === waitingError;

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
      onClick={interactive ? () => onOpenTools(id) : undefined}
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
            {renderServerIcon(url)}
          </Box>
          <Stack gap={3} miw={0}>
            <Group gap={6} wrap="nowrap" miw={0}>
              <Text fz="var(--font-size-base)" fw={600} c="var(--text-primary)" truncate>
                {title}
              </Text>
              {connected && (
                <Badge variant="light" color="var(--mantine-color-success)" size="sm">
                  {t('settings.mcp.toolCount').replace('{{count}}', String(toolCount))}
                </Badge>
              )}
              {server?.status === 'error' && !waiting && (
                <Badge variant="light" color="var(--mantine-color-error)" size="sm">
                  {t('settings.mcp.status.error')}
                </Badge>
              )}
            </Group>
            {/* The descriptions carry the setup requirements, so they are never cut; a server error can be long. */}
            <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5} lineClamp={server?.error && !connected ? 2 : undefined}>
              {/* Yobi's own messages arrive as i18n keys; `t()` returns anything else unchanged. */}
              {server?.error && !connected ? t(server.error) : description}
            </Text>
            {commandNotice && <CommandClashNotice lines={commandNotice} />}
            {botAccess && <BotAccessCaption text={botAccess} />}
          </Stack>
        </Group>

        <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          {pending && <Loader size={16} />}
          {!pending && (
            <ToggleSwitch
              checked={enabled}
              onChange={(e) => void mcp.setBuiltin(id, e.currentTarget.checked)}
              aria-label={toggleLabel}
            />
          )}
        </Group>
      </Group>

      {setup && enabled && !connected && !pending && (
        <Box mt={10} pl={40}>
          {setup}
        </Box>
      )}

      {footer && (
        <Box mt={10} pl={40} onClick={(e) => e.stopPropagation()}>
          {footer}
        </Box>
      )}
    </Box>
  );
};
