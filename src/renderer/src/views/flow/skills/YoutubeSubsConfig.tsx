import React, { useCallback, useEffect, useState } from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import { ytSubsApi, ipcEvents } from '../../../api/electronApi';
import { firstBadYoutubeChannelLine } from './validation';
import { CheckpointRow } from './CheckpointRow';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { YOUTUBE_SUBS_MAX_PER_RUN } from '../../../../../shared/flowFeedCaps';

export const YoutubeSubsConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const channels = step.config.channels ?? '';
  const badLine = firstBadYoutubeChannelLine(channels);
  const perChannel = step.config.perChannel ?? '3';
  const skipShorts = step.config.skipShorts !== 'false';
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
        label={t('flow.skill.youtube_subs.channels')}
        description={t('flow.skill.youtube_subs.channels.hint')}
        placeholder={t('flow.skill.youtube_subs.channels.placeholder')}
        value={channels}
        onChange={(e) => onChange({ ...step.config, channels: e.currentTarget.value })}
        autosize
        minRows={3}
        maxRows={8}
        resize="vertical"
        mono
        error={badLine > 0 ? fillTemplate(t('flow.skill.youtube_subs.channels.error'), { line: String(badLine) }) : undefined}
      />

      <AppNumberInput
        label={t('flow.skill.youtube_subs.perChannel')}
        description={fillTemplate(t('flow.skill.youtube_subs.perChannel.desc'), { max: String(YOUTUBE_SUBS_MAX_PER_RUN) })}
        value={perChannel}
        onChange={(v) => onChange({ ...step.config, perChannel: v === '' ? '' : String(v) })}
        size="sm"
        min={1}
        step={1}
        allowDecimal={false}
        allowNegative={false}
      />

      <SettingRow
        label={t('flow.skill.youtube_subs.skipShorts')}
        hint={t('flow.skill.youtube_subs.skipShorts.hint')}
        control={
          <ToggleSwitch
            checked={skipShorts}
            onChange={(e) => onChange({ ...step.config, skipShorts: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />

      <CheckpointRow
        label={t('flow.skill.youtube_subs.checkpoint')}
        status={hasCheckpoint ? t('flow.skill.youtube_subs.stateActive') : t('flow.skill.youtube_subs.stateEmpty')}
        resetLabel={t('flow.skill.youtube_subs.clearState')}
        hasCheckpoint={hasCheckpoint}
        onReset={() => void handleClearCheckpoint()}
      />

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.youtube_subs.hint'), { output: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
