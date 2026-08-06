import React from 'react';
import { Stack, Text } from '@mantine/core';
import { Image as ImageIcon, ShieldAlert } from 'lucide-react';
import { AppTextInput } from '../../../components/AppTextInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import { isValidUrlListOrVar } from './validation';
import type { SkillConfigProps } from './types';

export const BrowserConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const urlError = !isValidUrlListOrVar(url);
  const includeImage = step.config.includeImage === 'true';

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.browser.url')}
        placeholder={t('flow.skill.browser.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        error={urlError ? t('flow.skill.browser.url.error') : undefined}
      />

      <SettingRow
        icon={<ImageIcon size={13} />}
        label={t('flow.skill.includeImage')}
        hint={t('flow.skill.includeImage.hint')}
        control={
          <ToggleSwitch
            checked={includeImage}
            onChange={(e) => onChange({ ...step.config, includeImage: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />

      <SettingRow
        icon={<ShieldAlert size={13} />}
        label={t('flow.skill.browser.emitFailFlag')}
        hint={t('flow.skill.browser.emitFailFlag.hint')}
        control={
          <ToggleSwitch
            checked={step.config.emitFailFlag === 'true'}
            onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />

      <Text fz="xs" c="dimmed">
        {t('flow.skill.browser.outputHint').replace('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
