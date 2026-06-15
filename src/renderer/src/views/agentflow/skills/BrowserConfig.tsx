import React from 'react';
import { Stack, Text } from '@mantine/core';
import { Image as ImageIcon } from 'lucide-react';
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
        label={t('agentflow.skill.browser.url')}
        placeholder={t('agentflow.skill.browser.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        error={urlError ? t('agentflow.skill.browser.url.error') : undefined}
      />

      <SettingRow
        icon={<ImageIcon size={13} />}
        label={t('agentflow.skill.includeImage')}
        hint={t('agentflow.skill.includeImage.hint')}
        control={
          <ToggleSwitch
            checked={includeImage}
            onChange={(e) => onChange({ ...step.config, includeImage: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />

      <Text fz="xs" c="dimmed">
        {t('agentflow.skill.browser.outputHint').replace('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
