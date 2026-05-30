import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { CAPTURE_PALETTES, buildCaptureBackground } from '../../../hooks/useCaptureExport';
import { MODELS } from '../../../config/models';
import { useAppStore } from '../../../store/appStore';
import type { SkillConfigProps } from './types';

export const LlmConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const duckaiModels = useAppStore((state) => state.duckaiModels);

  const providerOptions = [
    { value: '', label: t('agentflow.skill.llm.providerCurrent') },
    ...MODELS.map((m) => ({ value: m.url, label: m.label })),
    ...duckaiModels.map((m) => ({ value: m.url, label: m.label })),
  ];

  return (
  <Stack gap="xs">
    <SelectDropdown
      label={t('agentflow.skill.llm.provider')}
      description={t('agentflow.skill.llm.providerCurrent')}
      options={providerOptions}
      value={step.config.provider ?? ''}
      onChange={(value) => onChange({ ...step.config, provider: value })}
      size="sm"
    />
    <AppTextarea
      label={t('agentflow.skill.llm.prompt')}
      placeholder={t('agentflow.skill.llm.prompt.placeholder')}
      value={step.config.prompt ?? ''}
      onChange={(e) => onChange({ ...step.config, prompt: e.currentTarget.value })}
      rows={6}
      resize="vertical"
      size="sm"
    />
    <SelectDropdown
      label={t('agentflow.skill.utility.export.format')}
      options={[
        { value: '', label: t('agentflow.skill.bot.sendAs.text') },
        { value: 'png', label: 'PNG' },
        { value: 'webp', label: 'WEBP' },
        { value: 'pdf', label: 'PDF' },
      ]}
      value={step.config.exportFormat ?? ''}
      onChange={(value) => onChange({ ...step.config, exportFormat: value })}
      size="sm"
    />
    {step.config.exportFormat && (
      <>
        <AppTextInput
          label={t('agentflow.skill.utility.export.title')}
          placeholder={t('agentflow.skill.utility.export.title.placeholder')}
          value={step.config.exportTitle ?? ''}
          onChange={(e) => onChange({ ...step.config, exportTitle: e.currentTarget.value })}
          size="sm"
        />
        <AppTextInput
          label={t('capture.fileName')}
          placeholder={t('agentflow.skill.utility.export.fileName.placeholder')}
          value={step.config.exportFileName ?? ''}
          onChange={(e) => onChange({ ...step.config, exportFileName: e.currentTarget.value })}
          size="sm"
        />
        <SelectDropdown
          label={t('common.background')}
          options={CAPTURE_PALETTES.map((p) => ({ value: p.key, label: p.label }))}
          value={step.config.palette ?? 'aurora'}
          onChange={(value) => {
            const palette = CAPTURE_PALETTES.find((p) => p.key === value) ?? CAPTURE_PALETTES[0];
            const background = buildCaptureBackground(palette.from, palette.to, 'se');
            onChange({ ...step.config, palette: palette.key, background });
          }}
          size="sm"
        />
        <ToggleSwitch
          label={t('capture.showProvider')}
          size="sm"
          checked={step.config.exportShowProvider !== 'false'}
          onChange={(e) => onChange({ ...step.config, exportShowProvider: e.currentTarget.checked ? 'true' : 'false' })}
        />
        <ToggleSwitch
          label={t('capture.showTimestamp')}
          size="sm"
          checked={step.config.exportShowTimestamp !== 'false'}
          onChange={(e) => onChange({ ...step.config, exportShowTimestamp: e.currentTarget.checked ? 'true' : 'false' })}
        />
      </>
    )}
    {step.config.exportFormat && <Text fz="xs" c="dimmed">{t('agentflow.skill.utility.export.output.hint')}</Text>}
    <ToggleSwitch
      label={t('agentflow.skill.llm.saveToHistory')}
      size="sm"
      checked={step.config.saveToHistory === 'true'}
      onChange={(e) => onChange({ ...step.config, saveToHistory: e.currentTarget.checked ? 'true' : 'false' })}
    />
  </Stack>
  );
};
