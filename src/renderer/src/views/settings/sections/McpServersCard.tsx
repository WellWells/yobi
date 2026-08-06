import React, { useState } from 'react';
import { ActionIcon, Badge, Box, Group, Stack, Text } from '@mantine/core';
import { Bot, Pencil, Plug, PlugZap, Plus, Server, ShieldCheck, Trash2, Unplug } from 'lucide-react';
import { SectionCard, SectionTitle, SettingRow, ToggleSwitch } from '../components';
import { AppButton } from '../../../components/AppButton';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppPasswordInput } from '../../../components/AppPasswordInput';
import { WebDialog } from '../../../components/WebDialog';
import type { useMcpServers } from '../hooks/useMcpServers';
import { MCP_PRESETS } from '../../../../../shared/types';
import type { McpConnectionStatus, McpServerView } from '../../../../../shared/types';

type McpServers = ReturnType<typeof useMcpServers>;

interface Props {
  mcp: McpServers;
  t: (key: string) => string;
  sectionGap: number;
}

const STATUS_COLOR: Record<McpConnectionStatus, string> = {
  connected: 'teal',
  connecting: 'blue',
  needs_auth: 'yellow',
  error: 'red',
  disconnected: 'gray',
};

const STATUS_KEY: Record<McpConnectionStatus, string> = {
  connected: 'settings.mcp.status.connected',
  connecting: 'settings.mcp.status.connecting',
  needs_auth: 'settings.mcp.status.needsAuth',
  error: 'settings.mcp.status.error',
  disconnected: 'settings.mcp.status.disconnected',
};

function subtitle(server: McpServerView, t: (key: string) => string): string {
  const parts = [server.url];
  if (server.status === 'connected') parts.push(t('settings.mcp.toolCount').replace('{{count}}', String(server.toolCount)));
  if (server.error) parts.push(server.error);
  return parts.join(' · ');
}

export const McpServersCard: React.FC<Props> = ({ mcp, t, sectionGap }) => {
  const [confirmDelete, setConfirmDelete] = useState<McpServerView | null>(null);
  const { form, servers } = mcp;
  const editing = form?.id ? servers.find((s) => s.id === form.id) : undefined;

  return (
    <Box>
      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle icon={<Server size={15} />} label={t('settings.mcp.title')} />
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mb={14}>
          {t('settings.mcp.hint')}
        </Text>

        {mcp.error && (
          <Text fz="var(--font-size-sm)" c="red" mb={12}>{mcp.error}</Text>
        )}

        {servers.length === 0 && !form && (
          <Text fz="var(--font-size-sm)" c="dimmed" mb={12}>{t('settings.mcp.empty')}</Text>
        )}

        <Stack gap={0}>
          {servers.map((server, index) => {
            const connected = server.status === 'connected';
            const connecting = mcp.busyId === server.id || server.status === 'connecting';
            const connectLabel = server.status === 'needs_auth' ? t('settings.mcp.signIn') : t('settings.mcp.connect');
            return (
              <Box
                key={server.id}
                py={12}
                style={index > 0 ? { borderTop: '1px solid var(--mantine-color-default-border)' } : undefined}
              >
                <Group justify="space-between" align="center" wrap="nowrap" gap={12}>
                  <Group gap={10} align="flex-start" wrap="nowrap" flex={1} miw={0}>
                    <Box c="var(--mantine-color-default-color)" mt={2} style={{ flexShrink: 0 }}>
                      <Server size={16} />
                    </Box>
                    <Stack gap={4} miw={0}>
                      <Group gap={8} wrap="nowrap">
                        <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-default-color)" truncate>
                          {server.name}
                        </Text>
                        <Badge variant="light" color={STATUS_COLOR[server.status]} radius="sm" size="sm" tt="none" fw={500}>
                          {t(STATUS_KEY[server.status])}
                        </Badge>
                        {server.agentEnabled === false && (
                          <Badge variant="light" color="gray" radius="sm" size="sm" tt="none" fw={500}>
                            {t('settings.mcp.agentEnabled.off')}
                          </Badge>
                        )}
                        {server.autoApproveWrites === true && (
                          <Badge variant="light" color="yellow" radius="sm" size="sm" tt="none" fw={500}>
                            {t('settings.mcp.autoApprove.on')}
                          </Badge>
                        )}
                      </Group>
                      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5} truncate>
                        {subtitle(server, t)}
                      </Text>
                    </Stack>
                  </Group>

                  <Group gap={6} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
                    {connected ? (
                      <AppButton
                        variant="default"
                        size="xs"
                        leftSection={<Unplug size={13} />}
                        onClick={() => { void mcp.disconnect(server.id); }}
                      >
                        {t('settings.mcp.disconnect')}
                      </AppButton>
                    ) : (
                      <AppButton
                        variant="default"
                        size="xs"
                        leftSection={connecting ? <PlugZap size={13} /> : <Plug size={13} />}
                        loading={connecting}
                        onClick={() => { void mcp.connect(server.id); }}
                      >
                        {connectLabel}
                      </AppButton>
                    )}
                    <ActionIcon
                      variant="default"
                      size={30}
                      aria-label={t('settings.mcp.edit')}
                      onClick={() => mcp.openEdit(server)}
                    >
                      <Pencil size={14} />
                    </ActionIcon>
                    <ActionIcon
                      variant="default"
                      size={30}
                      c="red"
                      aria-label={t('settings.mcp.delete')}
                      onClick={() => setConfirmDelete(server)}
                    >
                      <Trash2 size={14} />
                    </ActionIcon>
                  </Group>
                </Group>
              </Box>
            );
          })}
        </Stack>

        {form ? (
          <Stack
            gap="xs"
            mt={servers.length > 0 ? 12 : 0}
            p={12}
            style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--mantine-radius-sm)' }}
          >
            {MCP_PRESETS.length > 0 && (
              <Box>
                <Text fz="var(--font-size-sm)" c="dimmed" mb={6}>{t('settings.mcp.presets')}</Text>
                <Group gap={6}>
                  {MCP_PRESETS.map((preset) => (
                    <AppButton
                      key={preset.url}
                      variant="default"
                      size="xs"
                      onClick={() => mcp.updateForm({ name: preset.name, url: preset.url })}
                    >
                      {preset.name}
                    </AppButton>
                  ))}
                </Group>
              </Box>
            )}
            <AppTextInput
              label={t('settings.mcp.url')}
              placeholder={t('settings.mcp.url.placeholder')}
              value={form.url}
              onChange={(e) => mcp.updateForm({ url: e.target.value })}
              mono
              size="sm"
            />
            <AppTextInput
              label={t('settings.mcp.name')}
              placeholder={t('settings.mcp.name.placeholder')}
              value={form.name}
              onChange={(e) => mcp.updateForm({ name: e.target.value })}
              size="sm"
            />
            <AppPasswordInput
              label={t('settings.mcp.token')}
              placeholder={editing?.hasToken ? t('settings.mcp.token.placeholder.keep') : t('settings.mcp.token.placeholder')}
              value={form.token}
              onChange={(e) => mcp.updateForm({ token: e.target.value })}
              mono
              size="sm"
            />
            <AppTextInput
              label={t('settings.mcp.header')}
              placeholder={t('settings.mcp.header.placeholder')}
              value={form.headerName}
              onChange={(e) => mcp.updateForm({ headerName: e.target.value })}
              mono
              size="sm"
            />
            <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t('settings.mcp.token.hint')}</Text>
            <SettingRow
              icon={<Bot size={13} />}
              label={t('settings.mcp.agentEnabled')}
              hint={t('settings.mcp.agentEnabled.hint')}
              control={
                <ToggleSwitch
                  checked={form.agentEnabled}
                  onChange={(e) => mcp.updateForm({ agentEnabled: e.currentTarget.checked })}
                />
              }
            />
            <SettingRow
              icon={<ShieldCheck size={13} />}
              label={t('settings.mcp.autoApprove')}
              hint={t('settings.mcp.autoApprove.hint')}
              control={
                <ToggleSwitch
                  checked={form.autoApproveWrites}
                  onChange={(e) => mcp.updateForm({ autoApproveWrites: e.currentTarget.checked })}
                />
              }
            />
            <Group justify="flex-end" gap={8} mt={4} wrap="nowrap">
              <AppButton variant="default" size="xs" onClick={mcp.closeForm} disabled={mcp.saving}>
                {t('dialog.cancel')}
              </AppButton>
              <AppButton
                variant="filled"
                size="xs"
                leftSection={<Server size={13} />}
                loading={mcp.saving}
                disabled={!mcp.formValid}
                onClick={() => { void mcp.saveForm(); }}
              >
                {t('settings.mcp.save')}
              </AppButton>
            </Group>
          </Stack>
        ) : (
          <Group mt={servers.length > 0 ? 12 : 0}>
            <AppButton variant="default" size="xs" leftSection={<Plus size={13} />} onClick={mcp.openAdd}>
              {t('settings.mcp.add')}
            </AppButton>
          </Group>
        )}
      </SectionCard>

      <WebDialog
        open={confirmDelete !== null}
        title={t('settings.mcp.delete.confirm.title').replace('{{name}}', confirmDelete?.name ?? '')}
        description={t('settings.mcp.delete.confirm.detail')}
        confirmText={t('settings.mcp.delete')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => {
          const server = confirmDelete;
          setConfirmDelete(null);
          if (server) void mcp.removeServer(server.id);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </Box>
  );
};
