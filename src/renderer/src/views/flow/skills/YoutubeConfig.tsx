import React, { useEffect, useState } from 'react';
import { Stack, Text } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { byokApi } from '../../../api/electronApi';
import { selectHiddenSources, useAppStore } from '../../../store/appStore';
import { geminiFallbackChoices } from './youtubeFallback';
import { isValidYoutubeUrlOrVar } from './validation';
import type { ByokSettingsSnapshot } from '../../../../../shared/types';
import type { SkillConfigProps } from './types';

export const YoutubeConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const urlError = !isValidYoutubeUrlOrVar(url);
  const fallback = step.config.fallbackProvider ?? '';

  const hidden = useAppStore(useShallow(selectHiddenSources));
  // Both lists are replaced whenever BYOK settings are saved, so they double as a change signal.
  const byokModels = useAppStore((s) => s.byokModels);
  const byokGroupModels = useAppStore((s) => s.byokGroupModels);
  const [snapshot, setSnapshot] = useState<ByokSettingsSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    void byokApi.getSettings().then((next) => { if (!cancelled) setSnapshot(next); });
    return () => { cancelled = true; };
  }, [byokModels, byokGroupModels]);

  const { groups, keys } = snapshot
    ? geminiFallbackChoices(snapshot, hidden, fallback)
    : { groups: [], keys: [] };
  const hasChoice = groups.length > 0 || keys.length > 0;
  const noKey = snapshot !== null && !hasChoice;

  const fallbackOptions = [
    { value: '', label: t('flow.skill.youtube.fallback.none') },
    ...(groups.length > 0 ? [{ group: t('settings.byok.group.title'), items: groups }] : []),
    ...(keys.length > 0 ? [{ group: t('settings.byok.title'), items: keys }] : []),
  ];

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.youtube.url')}
        placeholder={t('flow.skill.youtube.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        error={urlError ? t('flow.skill.youtube.url.error') : undefined}
      />
      <SelectDropdown
        label={t('flow.skill.youtube.fallback')}
        description={noKey ? t('flow.skill.youtube.fallback.needKey') : t('flow.skill.youtube.fallback.desc')}
        options={fallbackOptions}
        value={fallback}
        onChange={(value) => onChange({ ...step.config, fallbackProvider: value })}
        disabled={noKey && !fallback}
        size="sm"
      />
      <Text fz="xs" c="dimmed">{t('flow.skill.youtube.hint')}</Text>
    </Stack>
  );
};
