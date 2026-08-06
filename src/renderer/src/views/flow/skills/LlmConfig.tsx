import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { applyCapturePalette, buildCapturePaletteOptions } from './captureConfig';
import { PROVIDER_DROPDOWN_MAX_HEIGHT, providerSectionsToSelectData } from '../../../config/models';
import { useProviderModels } from '../../../hooks/useProviderModels';
import type { SkillConfigProps } from './types';

export const LlmConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const { sections, hiddenSuffix } = useProviderModels(step.config.provider ?? '');

  const providerOptions = [
    { value: '', label: t('flow.skill.llm.providerCurrent') },
    ...providerSectionsToSelectData(sections, hiddenSuffix),
  ];

  return (
  <Stack gap="xs">
    <SelectDropdown
      label={t('flow.skill.llm.provider')}
      description={t('flow.skill.llm.providerCurrent')}
      options={providerOptions}
      value={step.config.provider ?? ''}
      onChange={(value) => onChange({ ...step.config, provider: value })}
      maxDropdownHeight={PROVIDER_DROPDOWN_MAX_HEIGHT}
      size="sm"
    />
    <AppTextarea
      label={t('flow.skill.llm.prompt')}
      placeholder={t('flow.skill.llm.prompt.placeholder')}
      value={step.config.prompt ?? ''}
      onChange={(e) => onChange({ ...step.config, prompt: e.currentTarget.value })}
      rows={6}
      resize="vertical"
      size="sm"
    />
    <AppTextInput
      label={t('flow.skill.llm.attachments')}
      placeholder={t('flow.skill.llm.attachments.placeholder')}
      value={step.config.attachments ?? ''}
      onChange={(e) => onChange({ ...step.config, attachments: e.currentTarget.value })}
      size="sm"
      mono
    />
    {(step.config.attachments ?? '').trim() && (
      <Text fz="xs" c="dimmed">{t('flow.skill.llm.attachments.hint')}</Text>
    )}
    <SelectDropdown
      label={t('flow.skill.utility.export.format')}
      options={[
        { value: '', label: t('flow.skill.bot.sendAs.text') },
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
          label={t('flow.skill.utility.export.title')}
          placeholder={t('flow.skill.utility.export.title.placeholder')}
          value={step.config.exportTitle ?? ''}
          onChange={(e) => onChange({ ...step.config, exportTitle: e.currentTarget.value })}
          size="sm"
        />
        <AppTextInput
          label={t('capture.fileName')}
          placeholder={t('flow.skill.utility.export.fileName.placeholder')}
          value={step.config.exportFileName ?? ''}
          onChange={(e) => onChange({ ...step.config, exportFileName: e.currentTarget.value })}
          size="sm"
        />
        <SelectDropdown
          label={t('common.background')}
          options={buildCapturePaletteOptions(t)}
          value={step.config.palette || 'aurora'}
          onChange={(value) => onChange(applyCapturePalette(step.config, value))}
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
    {step.config.exportFormat && <Text fz="xs" c="dimmed">{t('flow.skill.utility.export.output.hint')}</Text>}
    <ToggleSwitch
      label={t('flow.skill.llm.saveToHistory')}
      size="sm"
      checked={step.config.saveToHistory === 'true'}
      onChange={(e) => onChange({ ...step.config, saveToHistory: e.currentTarget.checked ? 'true' : 'false' })}
    />
    <ToggleSwitch
      label={t('flow.skill.llm.useMemory')}
      size="sm"
      checked={step.config.useMemory === 'true'}
      onChange={(e) => onChange({ ...step.config, useMemory: e.currentTarget.checked ? 'true' : 'false' })}
    />
    {step.config.useMemory === 'true' && (
      <Text fz="xs" c="dimmed">{t('flow.skill.llm.useMemory.hint')}</Text>
    )}
    <ToggleSwitch
      label={t('flow.skill.llm.emitFailFlag')}
      size="sm"
      checked={step.config.emitFailFlag === 'true'}
      onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
    />
    {step.config.emitFailFlag === 'true' && (
      <Text fz="xs" c="dimmed">{t('flow.skill.llm.emitFailFlag.hint')}</Text>
    )}
  </Stack>
  );
};
