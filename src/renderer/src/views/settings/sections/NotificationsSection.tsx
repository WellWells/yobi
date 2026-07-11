import React from 'react';
import { Box, Stack } from '@mantine/core';
import { Bell, CheckCircle2, MessageSquare, MessageSquareX, XCircle } from 'lucide-react';
import { SectionCard, SettingRow, ToggleSwitch, GroupHeader, SectionTitle, SettingDivider } from '../components';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useSystemSettings } from '../hooks/useSystemSettings';

type SystemSettings = ReturnType<typeof useSystemSettings>;

interface Props {
  system: SystemSettings;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'notify') => boolean;
  isSearching: boolean;
  sectionGap: number;
}

export const NotificationsSection: React.FC<Props> = ({ system, t, showSection, isSearching, sectionGap }) => (
  <Box display={showSection(TAG_SETS.notify, 'notify') ? 'block' : 'none'}>
    {isSearching && <GroupHeader label={t('settings.group.notify')} />}

    <SectionCard style={{ marginBottom: sectionGap }}>
      <SectionTitle icon={<Bell size={15} />} label={t('settings.notifications')} />
      <Stack gap={14}>
        <SettingRow
          icon={<Bell size={13} />}
          label={t('settings.notifications.master')}
          hint={t('settings.notifications.master.hint')}
          control={<ToggleSwitch checked={system.notifyOnComplete} onChange={() => { void system.handleToggleNotification(); }} />}
        />
        <SettingDivider />
        <SettingRow
          icon={<MessageSquare size={13} />}
          label={t('settings.notifications.chatComplete')}
          hint={t('settings.notifications.chatComplete.hint')}
          control={<ToggleSwitch checked={system.notifyEvents.chatComplete} onChange={() => { void system.handleToggleNotifyEvent('chatComplete'); }} />}
        />
        <SettingRow
          icon={<MessageSquareX size={13} />}
          label={t('settings.notifications.chatFailure')}
          hint={t('settings.notifications.chatFailure.hint')}
          control={<ToggleSwitch checked={system.notifyEvents.chatFailure} onChange={() => { void system.handleToggleNotifyEvent('chatFailure'); }} />}
        />
        <SettingRow
          icon={<CheckCircle2 size={13} />}
          label={t('settings.notifications.flowSuccess')}
          hint={t('settings.notifications.flowSuccess.hint')}
          control={<ToggleSwitch checked={system.notifyEvents.flowSuccess} onChange={() => { void system.handleToggleNotifyEvent('flowSuccess'); }} />}
        />
        <SettingRow
          icon={<XCircle size={13} />}
          label={t('settings.notifications.flowFailure')}
          hint={t('settings.notifications.flowFailure.hint')}
          control={<ToggleSwitch checked={system.notifyEvents.flowFailure} onChange={() => { void system.handleToggleNotifyEvent('flowFailure'); }} />}
        />
      </Stack>
    </SectionCard>
  </Box>
);
