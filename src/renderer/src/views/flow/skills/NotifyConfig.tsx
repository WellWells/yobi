import React, { useEffect, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Settings } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppTextarea } from '../../../components/AppTextarea';
import { ipcEvents, settingsApi } from '../../../api/electronApi';
import { useAppStore } from '../../../store/appStore';
import type { SkillConfigProps } from './types';

/** The "notify me" switch in Settings › Notifications: off, a notify step shows nothing. */
function useNotificationsOn(): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    let live = true;
    void settingsApi.getNotifyOnComplete().then((value) => { if (live) setOn(value); });
    const off = ipcEvents.onNotifyOnCompleteChanged(setOn);
    return () => { live = false; off(); };
  }, []);
  return on;
}

export const NotifyConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const notificationsOn = useNotificationsOn();
  const openSettingsCategory = useAppStore((s) => s.openSettingsCategory);
  // Said once a field is left, so a new step is not called wrong before anything is typed.
  const [checked, setChecked] = useState(false);
  const empty = !(step.config.title ?? '').trim() && !(step.config.body ?? '').trim();
  return (
    <Stack gap="xs">
      {!notificationsOn && (
        <Group gap="xs" align="center" wrap="nowrap">
          <Text fz="xs" c="var(--mantine-color-warning)" style={{ flex: 1 }}>{t('flow.skill.notify.off')}</Text>
          <AppButton
            variant="light"
            size="compact-xs"
            leftSection={<Settings size={12} />}
            onClick={() => openSettingsCategory('notifications')}
            style={{ flexShrink: 0 }}
          >
            {t('flow.setup.openSettings')}
          </AppButton>
        </Group>
      )}
      <AppTextInput
        label={t('flow.skill.notify.title')}
        placeholder={t('flow.skill.notify.title.placeholder')}
        value={step.config.title ?? ''}
        onChange={(e) => onChange({ ...step.config, title: e.currentTarget.value })}
        onBlur={() => setChecked(true)}
        size="sm"
      />
      <AppTextarea
        label={t('flow.skill.notify.body')}
        value={step.config.body ?? ''}
        onChange={(e) => onChange({ ...step.config, body: e.currentTarget.value })}
        onBlur={() => setChecked(true)}
        error={checked && empty ? t('flow.skill.notify.empty') : undefined}
        minRows={2}
        autosize
        size="sm"
      />
    </Stack>
  );
};
