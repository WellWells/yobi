import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { CAPTURE_PALETTES, buildCaptureBackground } from '../../../hooks/useCaptureExport';
import type { SkillConfigProps } from './types';

export const UtilityConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <SelectDropdown
      label={t('agentflow.skill.utility.action')}
      options={[
        { value: 'delay', label: t('agentflow.skill.utility.delay') },
        { value: 'notify', label: t('agentflow.skill.utility.notify') },
        { value: 'export', label: t('agentflow.skill.utility.export') },
      ]}
      value={step.config.action ?? 'delay'}
      onChange={(value) => onChange({ ...step.config, action: value })}
      size="sm"
    />
    {(step.config.action ?? 'delay') === 'delay' && (
      <AppTextInput
        label={t('agentflow.skill.utility.delayMs')}
        value={step.config.delayMs ?? '1000'}
        onChange={(e) => onChange({ ...step.config, delayMs: e.currentTarget.value })}
        size="sm"
      />
    )}
    {step.config.action === 'notify' && (
      <>
        <AppTextInput
          label={t('agentflow.skill.utility.title')}
          value={step.config.title ?? ''}
          onChange={(e) => onChange({ ...step.config, title: e.currentTarget.value })}
          size="sm"
        />
        <AppTextarea
          label={t('agentflow.skill.utility.body')}
          value={step.config.body ?? ''}
          onChange={(e) => onChange({ ...step.config, body: e.currentTarget.value })}
          minRows={2}
          autosize
          size="sm"
        />
      </>
    )}
    {step.config.action === 'export' && (
      <>
        <SelectDropdown
          label={t('agentflow.skill.utility.export.format')}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'webp', label: 'WEBP' },
            { value: 'pdf', label: 'PDF' },
          ]}
          value={step.config.format ?? 'png'}
          onChange={(value) => onChange({ ...step.config, format: value })}
          size="sm"
        />
        <AppTextInput
          label={t('agentflow.skill.utility.export.title')}
          placeholder={t('agentflow.skill.utility.export.title.placeholder')}
          value={step.config.title ?? ''}
          onChange={(e) => onChange({ ...step.config, title: e.currentTarget.value })}
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
        <AppTextarea
          label={t('agentflow.skill.utility.export.content')}
          description={t('agentflow.skill.utility.export.content.hint')}
          value={step.config.content ?? ''}
          onChange={(e) => onChange({ ...step.config, content: e.currentTarget.value })}
          minRows={3}
          resize="vertical"
          autosize
          size="sm"
        />
        <Text fz="xs" c="dimmed">{t('agentflow.skill.utility.export.output.hint')}</Text>
      </>
    )}
  </Stack>
);
