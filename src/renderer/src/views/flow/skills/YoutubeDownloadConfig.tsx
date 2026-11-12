import React from 'react';
import { Autocomplete, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { SettingRow } from '../../../components/SettingRow';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { buildInputStyles } from '../../../components/inputStyles';
import { Z_POPOVER } from '../../../config/zLayers';
import { isValidDownloadQuality, isValidVideoUrlOrVar, videoSiteOf } from './validation';
import { YtdlToolsNotice } from './YtdlToolsNotice';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { parseQualityToken } from '../../../../../shared/ytdl';
import { videoIsAudioOnly } from '../../../../../shared/linkSites/rows';

/** The qualities offered as you type; any other word the menu reads, or a variable, can still be typed. */
const QUALITY_PICKS = ['best', '1080', '720', '480', '360', 'mp3', 'srt'] as const;

const QUALITY_INPUT_STYLES = {
  ...buildInputStyles({ tone: 'default', mono: true }),
  dropdown: {
    background: 'var(--mantine-color-bg-tertiary)',
    borderColor: 'var(--mantine-color-default-border)',
  },
  option: { fontSize: 'var(--font-size-base)', fontFamily: 'var(--font-sans)' },
};

function qualityLabel(value: string, t: (key: string) => string): string {
  if (value === 'best') return t('flow.skill.youtube_download.quality.best');
  if (value === 'mp3') return t('flow.skill.youtube_download.quality.mp3');
  if (value === 'srt') return t('flow.skill.youtube_download.quality.srt');
  return `${value}p`;
}

export const YoutubeDownloadConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const quality = step.config.quality ?? '';
  const urlError = !isValidVideoUrlOrVar(url);
  const qualityError = !isValidDownloadQuality(quality);
  const site = videoSiteOf(url);
  const audioOnly = site !== null && videoIsAudioOnly(site);
  // A subtitles file is written from the captions without yt-dlp or FFmpeg.
  const needsTools = parseQualityToken(quality) !== 'srt';
  const setQuality = (value: string) => onChange({ ...step.config, quality: value });

  return (
    <Stack gap="xs">
      <YtdlToolsNotice t={t} needsTools={needsTools} />
      <AppTextInput
        label={t('flow.skill.youtube.url')}
        placeholder={t('flow.skill.youtube.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        mono
        error={urlError ? t('flow.skill.youtube.url.error') : undefined}
      />
      <Autocomplete
        label={t('flow.skill.youtube_download.quality')}
        description={audioOnly ? t('flow.skill.youtube_download.quality.audioOnly') : undefined}
        placeholder={t('flow.skill.youtube_download.quality.placeholder')}
        value={quality}
        onChange={setQuality}
        onOptionSubmit={setQuality}
        data={[...QUALITY_PICKS]}
        renderOption={({ option }) => <Text fz="sm">{qualityLabel(option.value, t)}</Text>}
        comboboxProps={{ zIndex: Z_POPOVER }}
        size="sm"
        spellCheck={false}
        styles={QUALITY_INPUT_STYLES}
        error={qualityError ? t('flow.skill.youtube_download.quality.error') : undefined}
      />
      <SelectDropdown
        label={t('flow.skill.ytdl.destination')}
        description={t('flow.skill.youtube_download.destination.desc')}
        options={[
          { value: 'auto', label: t('flow.skill.ytdl.destination.auto') },
          { value: 'telegram', label: t('flow.skill.ytdl.destination.telegram') },
          { value: 'local', label: t('flow.skill.ytdl.destination.local') },
        ]}
        value={step.config.destination || 'auto'}
        onChange={(value) => onChange({ ...step.config, destination: value })}
        size="sm"
      />
      <AppTextInput
        label={t('flow.skill.youtube_download.folder')}
        placeholder={t('flow.skill.youtube_download.folder.placeholder')}
        value={step.config.folder ?? ''}
        onChange={(e) => onChange({ ...step.config, folder: e.currentTarget.value })}
        size="sm"
        mono
      />
      <SettingRow
        label={t('flow.skill.browser.emitFailFlag')}
        hint={fillTemplate(t('flow.skill.youtube_download.emitFailFlag.hint'), { flag: `{{${step.outputKey}.isFailed}}` })}
        control={
          <ToggleSwitch
            checked={step.config.emitFailFlag === 'true'}
            onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />
      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.youtube_download.hint'), { output: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
