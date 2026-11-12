import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { useGeminiChoices } from './useGeminiChoices';
import { isValidVideoUrlOrVar, videoSiteOf } from './validation';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';

/**
 * Where the "no captions" choice applies: Gemini watches YouTube videos only, so a fixed link to
 * another site hides it (its value stays saved); a variable shows it, the run decides the site.
 */
export function youtubeFallbackShown(url: string): 'yes' | 'variable' | 'no' {
  const trimmed = url.trim();
  if (trimmed.includes('{{')) return 'variable';
  if (!trimmed) return 'yes';
  const site = videoSiteOf(trimmed);
  return site === null || site === 'youtube' ? 'yes' : 'no';
}

export const YoutubeConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const urlError = !isValidVideoUrlOrVar(url);
  const fallback = step.config.fallbackProvider ?? '';
  const fallbackShown = youtubeFallbackShown(url);

  const { groups, keys, loaded } = useGeminiChoices(fallback);
  const noKey = loaded && groups.length === 0 && keys.length === 0;

  const fallbackOptions = [
    { value: '', label: t('flow.skill.youtube.fallback.none') },
    ...(groups.length > 0 ? [{ group: t('settings.byok.group.title'), items: groups }] : []),
    ...(keys.length > 0 ? [{ group: t('settings.byok.title'), items: keys }] : []),
  ];
  let fallbackDesc = t('flow.skill.youtube.fallback.desc');
  if (fallbackShown === 'variable') fallbackDesc = t('flow.skill.youtube.fallback.desc.youtubeOnly');
  if (noKey) fallbackDesc = t('flow.skill.youtube.fallback.needKey');
  const output = `{{${step.outputKey}}}`;

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.youtube.url')}
        placeholder={t('flow.skill.youtube.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        mono
        error={urlError ? t('flow.skill.youtube.url.error') : undefined}
      />
      {fallbackShown !== 'no' && (
        <SelectDropdown
          label={t('flow.skill.youtube.fallback')}
          description={fallbackDesc}
          options={fallbackOptions}
          value={fallback}
          onChange={(value) => onChange({ ...step.config, fallbackProvider: value })}
          disabled={noKey && !fallback}
          size="sm"
        />
      )}
      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.youtube.hint'), {
          output,
          title: `{{${step.outputKey}.title}}`,
          flag: `{{${step.outputKey}.isFailed}}`,
        })}
      </Text>
    </Stack>
  );
};
