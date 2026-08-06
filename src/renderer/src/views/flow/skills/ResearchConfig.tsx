import React from 'react';
import { Stack, Text } from '@mantine/core';
import { ShieldAlert } from 'lucide-react';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import type { SkillConfigProps } from './types';

const DEPTH_OPTIONS = ['standard', 'quick'] as const;

export const ResearchConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const query = step.config.query ?? '';
  const depth = step.config.depth ?? 'standard';
  const sources = step.config.sources ?? '';

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.research.query')}
        placeholder={t('flow.skill.research.query.placeholder')}
        value={query}
        onChange={(e) => onChange({ ...step.config, query: e.currentTarget.value })}
        size="sm"
      />

      <SelectDropdown
        label={t('flow.skill.research.depth')}
        value={DEPTH_OPTIONS.includes(depth as typeof DEPTH_OPTIONS[number]) ? depth : 'standard'}
        onChange={(v) => onChange({ ...step.config, depth: v || 'standard' })}
        options={DEPTH_OPTIONS.map((value) => ({ value, label: t(`flow.skill.research.depth.${value}`) }))}
        size="sm"
      />

      <AppNumberInput
        label={t('flow.skill.research.sources')}
        description={t('flow.skill.research.sources.hint')}
        placeholder={t('flow.skill.research.sources.placeholder')}
        value={sources}
        onChange={(v) => onChange({ ...step.config, sources: v === '' ? '' : String(v) })}
        size="sm"
        min={1}
        max={8}
        step={1}
        allowDecimal={false}
        allowNegative={false}
      />

      <SettingRow
        icon={<ShieldAlert size={13} />}
        label={t('flow.skill.research.emitFailFlag')}
        hint={t('flow.skill.research.emitFailFlag.hint')}
        control={
          <ToggleSwitch
            checked={step.config.emitFailFlag === 'true'}
            onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />

      <Text fz="xs" c="dimmed">
        {t('flow.skill.research.outputHint').replaceAll('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
