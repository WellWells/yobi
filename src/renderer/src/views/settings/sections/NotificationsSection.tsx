import React from 'react';
import { Box, Stack } from '@mantine/core';
import { Bell, CheckCircle2, MessageSquare, MessageSquareX, XCircle } from 'lucide-react';
import { SectionCard, SettingRow, ToggleSwitch, SectionTitle, SettingDivider } from '../components';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useSystemSettings } from '../hooks/useSystemSettings';

type SystemSettings = ReturnType<typeof useSystemSettings>;

interface Props {
  system: SystemSettings;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'general') => boolean;
  sectionGap: number;
}

export const NotificationsSection: React.FC<Props> = ({ system, t, showSection, sectionGap }) => {
  const enabled = system.notifyOnComplete;

  return (
    <Box display={showSection(TAG_SETS.notify, 'general') ? 'block' : 'none'}>
      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle icon={<Bell size={15} />} label={t('settings.notifications')} />
        <Stack gap={14}>
          <SettingRow
            icon={<Bell size={13} />}
            label={t('settings.notifications.master')}
            hint={t('settings.notifications.master.hint')}
            control={<ToggleSwitch checked={enabled} onChange={() => { void system.handleToggleNotification(); }} />}
          />
          <SettingDivider />
          {/*
            The master switch already drops every notification before it is sent
            (`sendWebNotification` returns early), so these rows are inert while it is off —
            they dim and stop responding rather than look live and do nothing. Same treatment
            as the quick-export hotkey field; `disabled` carries it to keyboard and AT users,
            which `pointerEvents` alone would not.
          */}
          <Box style={{ opacity: enabled ? 1 : 0.45, pointerEvents: enabled ? 'auto' : 'none' }}>
            <Stack gap={14}>
              <SettingRow
                icon={<MessageSquare size={13} />}
                label={t('settings.notifications.chatComplete')}
                hint={t('settings.notifications.chatComplete.hint')}
                control={(
                  <ToggleSwitch
                    checked={system.notifyEvents.chatComplete}
                    disabled={!enabled}
                    onChange={() => { void system.handleToggleNotifyEvent('chatComplete'); }}
                  />
                )}
              />
              <SettingRow
                icon={<MessageSquareX size={13} />}
                label={t('settings.notifications.chatFailure')}
                hint={t('settings.notifications.chatFailure.hint')}
                control={(
                  <ToggleSwitch
                    checked={system.notifyEvents.chatFailure}
                    disabled={!enabled}
                    onChange={() => { void system.handleToggleNotifyEvent('chatFailure'); }}
                  />
                )}
              />
              <SettingRow
                icon={<CheckCircle2 size={13} />}
                label={t('settings.notifications.flowSuccess')}
                hint={t('settings.notifications.flowSuccess.hint')}
                control={(
                  <ToggleSwitch
                    checked={system.notifyEvents.flowSuccess}
                    disabled={!enabled}
                    onChange={() => { void system.handleToggleNotifyEvent('flowSuccess'); }}
                  />
                )}
              />
              <SettingRow
                icon={<XCircle size={13} />}
                label={t('settings.notifications.flowFailure')}
                hint={t('settings.notifications.flowFailure.hint')}
                control={(
                  <ToggleSwitch
                    checked={system.notifyEvents.flowFailure}
                    disabled={!enabled}
                    onChange={() => { void system.handleToggleNotifyEvent('flowFailure'); }}
                  />
                )}
              />
            </Stack>
          </Box>
        </Stack>
      </SectionCard>
    </Box>
  );
};
