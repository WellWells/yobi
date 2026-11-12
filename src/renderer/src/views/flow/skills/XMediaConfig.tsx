import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { AppButton } from '../../../components/AppButton';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { SettingRow } from '../../../components/SettingRow';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { useGeminiChoices } from './useGeminiChoices';
import type { SkillConfigProps } from './types';

/**
 * A destination the four fixed choices cannot show: a `{{variable}}` (the PTT template's
 * `{{var.botPlatform}}`). The select would show it blank and the first pick would overwrite it.
 */
export function isVariableDestination(destination: string | undefined): boolean {
  return (destination ?? '').includes('{{');
}

export const XMediaConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const reader = step.config.reader ?? '';
  const destination = step.config.destination ?? '';
  const { groups, keys, loaded } = useGeminiChoices(reader);
  const noKey = loaded && groups.length === 0 && keys.length === 0;
  const output = `{{${step.outputKey}}}`;

  const readerOptions = [
    { value: '', label: t('flow.skill.x_media.reader.none') },
    { value: 'auto', label: t('flow.skill.x_media.reader.auto') },
    ...(groups.length > 0 ? [{ group: t('settings.byok.group.title'), items: groups }] : []),
    ...(keys.length > 0 ? [{ group: t('settings.byok.title'), items: keys }] : []),
  ];

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.x_media.input')}
        placeholder="{{input}}"
        value={step.config.input ?? ''}
        onChange={(e) => onChange({ ...step.config, input: e.currentTarget.value })}
        size="sm"
        mono
      />
      {isVariableDestination(destination) ? (
        <Stack gap={4}>
          <AppTextInput
            label={t('flow.skill.ytdl.destination')}
            description={t('flow.skill.x_media.destination.variable')}
            value={destination}
            readOnly
            size="sm"
            mono
          />
          <Group>
            <AppButton variant="subtle" size="compact-xs" onClick={() => onChange({ ...step.config, destination: 'auto' })}>
              {t('flow.skill.x_media.destination.pickFixed')}
            </AppButton>
          </Group>
        </Stack>
      ) : (
        <SelectDropdown
          label={t('flow.skill.ytdl.destination')}
          description={t('flow.skill.x_media.destination.desc')}
          options={[
            { value: 'auto', label: t('flow.skill.x_media.destination.auto') },
            { value: 'telegram', label: t('flow.skill.ytdl.destination.telegram') },
            { value: 'line', label: t('flow.skill.x_media.destination.line') },
            { value: 'local', label: t('flow.skill.ytdl.destination.local') },
          ]}
          value={destination || 'auto'}
          onChange={(value) => onChange({ ...step.config, destination: value })}
          size="sm"
        />
      )}
      <AppTextInput
        label={t('flow.skill.youtube_download.folder')}
        placeholder={t('flow.skill.youtube_download.folder.placeholder')}
        description={destination === 'line' ? t('flow.skill.x_media.folder.line') : undefined}
        value={step.config.folder ?? ''}
        onChange={(e) => onChange({ ...step.config, folder: e.currentTarget.value })}
        size="sm"
        mono
      />
      <SelectDropdown
        label={t('flow.skill.x_media.reader')}
        description={noKey ? t('flow.skill.youtube.fallback.needKey') : t('flow.skill.x_media.reader.desc')}
        options={readerOptions}
        value={reader}
        onChange={(value) => onChange({ ...step.config, reader: value })}
        disabled={noKey && !reader}
        size="sm"
      />
      <SettingRow
        label={t('flow.skill.x_media.emitFailFlag')}
        hint={fillTemplate(t('flow.skill.x_media.emitFailFlag.hint'), { flag: `{{${step.outputKey}.isFailed}}` })}
        control={
          <ToggleSwitch
            checked={step.config.emitFailFlag === 'true'}
            onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />
      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.x_media.outputHint'), {
          outputKey: output,
          caption: `{{${step.outputKey}.caption}}`,
          lead: `{{${step.outputKey}.lead}}`,
          rest: `{{${step.outputKey}.rest}}`,
          previews: `{{${step.outputKey}.previews}}`,
        })}
      </Text>
    </Stack>
  );
};
