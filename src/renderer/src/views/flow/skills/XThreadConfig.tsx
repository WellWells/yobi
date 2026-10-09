import React from 'react';
import { Stack, Text } from '@mantine/core';
import { ShieldAlert } from 'lucide-react';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import { isValidXPostUrlOrVar } from './validation';
import { XSignInNotice } from './XSignInNotice';
import type { SkillConfigProps } from './types';

export const XThreadConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const urlError = !isValidXPostUrlOrVar(url);
  const maxReplies = step.config.maxReplies ?? '20';

  return (
    <Stack gap="xs">
      <XSignInNotice limit="replies" t={t} />

      <AppTextInput
        label={t('flow.skill.x_thread.url')}
        placeholder="https://x.com/…/status/…"
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        error={urlError ? t('flow.skill.x_thread.url.error') : undefined}
      />

      <AppNumberInput
        label={t('flow.skill.x_thread.maxReplies')}
        value={maxReplies}
        onChange={(v) => onChange({ ...step.config, maxReplies: v === '' ? '' : String(v) })}
        size="sm"
        min={0}
        step={5}
        allowDecimal={false}
        allowNegative={false}
      />

      <SettingRow
        icon={<ShieldAlert size={13} />}
        label={t('flow.skill.x_thread.emitFailFlag')}
        hint={t('flow.skill.x_thread.emitFailFlag.hint')}
        control={
          <ToggleSwitch
            checked={step.config.emitFailFlag === 'true'}
            onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />

      <Text fz="xs" c="dimmed">
        {t('flow.skill.x_thread.outputHint').replaceAll('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
