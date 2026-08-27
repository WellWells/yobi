import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Bot, Server, ShieldCheck } from 'lucide-react';
import { SettingRow, ToggleSwitch } from '../../components';
import { AppButton } from '../../../../components/AppButton';
import { AppModal } from '../../../../components/AppModal';
import { AppTextInput } from '../../../../components/AppTextInput';
import { AppPasswordInput } from '../../../../components/AppPasswordInput';
import type { useMcpServers } from '../../hooks/useMcpServers';

type McpServers = ReturnType<typeof useMcpServers>;

interface Props {
  mcp: McpServers;
  t: (key: string) => string;
}

export const ConnectorFormModal: React.FC<Props> = ({ mcp, t }) => {
  const { form, servers } = mcp;
  const editing = form?.id ? servers.find((s) => s.id === form.id) : undefined;
  const title = form?.id ? t('settings.mcp.edit') : t('settings.mcp.addCustom');

  return (
    <AppModal
      opened={form !== null}
      onClose={mcp.closeForm}
      icon={<Server size={16} />}
      title={title}
      size="lg"
    >
      {form && (
        <Stack gap="xs">
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
          {mcp.error && <Text fz="var(--font-size-sm)" c="red">{mcp.error}</Text>}
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
              {t('settings.mcp.saveAndConnect')}
            </AppButton>
          </Group>
        </Stack>
      )}
    </AppModal>
  );
};
