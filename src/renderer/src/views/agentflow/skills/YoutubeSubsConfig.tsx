import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import { Trash2, BookmarkCheck, Clapperboard } from 'lucide-react';
import { ytSubsApi, ipcEvents } from '../../../api/electronApi';
import { isValidYoutubeChannelListOrVar } from './validation';
import type { SkillConfigProps } from './types';

export const YoutubeSubsConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const channels = step.config.channels ?? '';
  const channelsError = !isValidYoutubeChannelListOrVar(channels);
  const perChannel = step.config.perChannel ?? '3';
  const skipShorts = step.config.skipShorts !== 'false';
  const cacheDays = step.config.cacheDays ?? '3';
  const [hasCheckpoint, setHasCheckpoint] = useState(false);

  useEffect(() => {
    void ytSubsApi.hasCheckpoint(step.id).then(setHasCheckpoint);
  }, [step.id]);

  useEffect(() => {
    const unsub = ipcEvents.onFlowExecutionEnded(() => {
      void ytSubsApi.hasCheckpoint(step.id).then(setHasCheckpoint);
    });
    return unsub;
  }, [step.id]);

  const handleClearCheckpoint = useCallback(async () => {
    await ytSubsApi.clearCheckpoint(step.id);
    setHasCheckpoint(false);
  }, [step.id]);

  return (
    <Stack gap="xs">
      <AppTextarea
        label={t('agentflow.skill.youtube_subs.channels')}
        placeholder={t('agentflow.skill.youtube_subs.channels.placeholder')}
        value={channels}
        onChange={(e) => onChange({ ...step.config, channels: e.currentTarget.value })}
        autosize
        minRows={3}
        maxRows={8}
        resize="vertical"
        mono
        error={channelsError ? t('agentflow.skill.youtube_subs.channels.error') : undefined}
      />

      <Text fz="xs" c="dimmed">
        {t('agentflow.skill.youtube_subs.channels.hint')}
      </Text>

      <AppNumberInput
        label={t('agentflow.skill.youtube_subs.perChannel')}
        value={perChannel}
        onChange={(v) => onChange({ ...step.config, perChannel: v === '' ? '' : String(v) })}
        size="sm"
        min={1}
        step={1}
        allowDecimal={false}
        allowNegative={false}
      />

      <SettingRow
        icon={<Clapperboard size={13} />}
        label={t('agentflow.skill.youtube_subs.skipShorts')}
        hint={t('agentflow.skill.youtube_subs.skipShorts.hint')}
        control={
          <ToggleSwitch
            checked={skipShorts}
            onChange={(e) => onChange({ ...step.config, skipShorts: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />

      <AppNumberInput
        label={t('agentflow.skill.cacheDays')}
        value={cacheDays}
        onChange={(v) => onChange({ ...step.config, cacheDays: v === '' ? '' : String(v) })}
        size="sm"
        min={1}
        step={1}
        allowDecimal={false}
        allowNegative={false}
      />

      <Text fz="xs" c="dimmed">
        {t('agentflow.skill.cacheDays.hint')}
      </Text>

      <Text fz="xs" c="dimmed">
        {t('agentflow.skill.youtube_subs.hint')}
      </Text>

      {hasCheckpoint && (
        <Group gap="xs" align="center">
          <Badge
            variant="light"
            color="teal"
            size="sm"
            leftSection={<BookmarkCheck size={12} />}
            radius="sm"
          >
            {t('agentflow.skill.youtube_subs.stateActive')}
          </Badge>
        </Group>
      )}

      <Button
        variant="light"
        color="red"
        size="xs"
        leftSection={<Trash2 size={14} />}
        onClick={() => void handleClearCheckpoint()}
        disabled={!hasCheckpoint}
      >
        {t('agentflow.skill.youtube_subs.clearState')}
      </Button>

      <Text fz="xs" c="dimmed">
        {t('agentflow.skill.browser.outputHint').replace('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
