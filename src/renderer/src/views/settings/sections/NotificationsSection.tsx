import React from 'react';
import { Box, Stack } from '@mantine/core';
import { SectionCard, SettingRow, ToggleSwitch, SettingDivider } from '../components';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useSystemSettings } from '../hooks/useSystemSettings';

type SystemSettings = ReturnType<typeof useSystemSettings>;
type NotifyEvent = keyof SystemSettings['notifyEvents'];

const EVENTS: readonly NotifyEvent[] = ['chatComplete', 'chatFailure', 'flowSuccess', 'flowFailure'];

interface Props {
  system: SystemSettings;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'notifications') => boolean;
  sectionGap: number;
}

/*
 * The page title already says Notifications, so the card has no title of its own. With the master
 * switch off every event switch reads off and is disabled: a dimmed but green switch looked like
 * "on". The saved per-event choices stay and come back when the master switch is turned on again.
 */
export const NotificationsSection: React.FC<Props> = ({ system, t, showSection, sectionGap }) => {
  const enabled = system.notifyOnComplete;

  return (
    <Box display={showSection(TAG_SETS.notify, 'notifications') ? 'block' : 'none'}>
      <SectionCard style={{ marginBottom: sectionGap }}>
        <Stack gap={14}>
          <SettingRow
            label={t('settings.notifications.master')}
            hint={t('settings.notifications.master.hint')}
            control={<ToggleSwitch checked={enabled} onChange={() => { void system.handleToggleNotification(); }} />}
          />
          <SettingDivider />
          <Box style={{ opacity: enabled ? 1 : 0.45, pointerEvents: enabled ? 'auto' : 'none' }}>
            <Stack gap={14}>
              {EVENTS.map((event) => (
                <SettingRow
                  key={event}
                  label={t(`settings.notifications.${event}`)}
                  hint={t(`settings.notifications.${event}.hint`)}
                  control={(
                    <ToggleSwitch
                      checked={enabled && system.notifyEvents[event]}
                      disabled={!enabled}
                      onChange={() => { void system.handleToggleNotifyEvent(event); }}
                    />
                  )}
                />
              ))}
            </Stack>
          </Box>
        </Stack>
      </SectionCard>
    </Box>
  );
};
