import React, { useEffect, useId } from 'react';
import { Group, Input, SimpleGrid, Stack, Text } from '@mantine/core';
import { Settings } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { AppTextarea } from '../../../components/AppTextarea';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppSegmentedControl } from '../../../components/AppSegmentedControl';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { MultiSelectDropdown } from '../../../components/MultiSelectDropdown';
import { GroupHeader } from '../../../components/GroupHeader';
import { SettingDivider } from '../../../components/SettingDivider';
import { StatusLine } from '../../../components/StatusLine';
import { LlmFieldLabel, LlmOption } from './LlmConfigHelp';
import { buildCapturePaletteOptions, withCapturePalette } from './captureConfig';
import { PAIR_FIELDS_FROM } from './fieldLayout';
import { bareOutputUsers, withAnswerText } from './llmOutputUsers';
import { PROVIDER_DROPDOWN_MAX_HEIGHT, providerSectionsToSelectData } from '../../../config/models';
import { useProviderModels } from '../../../hooks/useProviderModels';
import { useAppStore } from '../../../store/appStore';
import { useExportSettingsStore } from '../../../store/exportSettingsStore';
import { useFlowStore } from '../../../store/useFlowStore';
import { useUserMemoryStore } from '../../../store/userMemoryStore';
import { llmProviderLabel } from '../flowCapabilities';
import { useNamedModels } from '../useNamedModels';
import {
  BYOK_IMAGE_PROVIDER_LABELS, CAPTURE_WIDTHS, UPLOAD_CAPABLE_PROVIDER_LABELS, captureWidthLabelKey, isByokTargetUrl, snapCaptureWidth,
} from '../../../../../shared/types';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { parseLlmExportFormats } from '../../../../../shared/fileOutputStep';
import type { SkillConfigProps } from './types';

/** The later steps that read this step's bare output, as "6, 9", for the export warning. */
function useBareOutputUsers(stepId: string, outputKey: string, active: boolean): string {
  return useFlowStore((s) => (active
    ? bareOutputUsers(s.flows.find((flow) => flow.id === s.selectedFlowId), stepId, outputKey).join(', ')
    : ''));
}

/** Rewrites every later bare `{{key}}` as `{{key.text}}`: an edit the user asked for, saved with the rest. */
function readAnswerTextInLaterSteps(stepId: string, outputKey: string): void {
  const state = useFlowStore.getState();
  const flow = state.flows.find((entry) => entry.id === state.selectedFlowId);
  if (!flow) return;
  const users = new Set(bareOutputUsers(flow, stepId, outputKey));
  flow.steps.forEach((step, index) => {
    if (users.has(index + 1)) state.updateStep(flow.id, step.id, { config: withAnswerText(step, outputKey) });
  });
}

export const LlmConfig: React.FC<SkillConfigProps> = ({ step, onChange, t, insertData, draftButton }) => {
  const provider = step.config.provider ?? '';
  const { sections, hiddenSuffix } = useProviderModels(provider);
  const namedModels = useNamedModels();
  const chatModelUrl = useAppStore((s) => s.aiUrl);
  const openSettingsCategory = useAppStore((s) => s.openSettingsCategory);
  const captureWidth = useExportSettingsStore((state) => state.capture.width);
  const loadExportSettings = useExportSettingsStore((state) => state.load);
  const usesUserMemory = step.config.useUserMemory === 'true';
  const userMemoryOff = useUserMemoryStore((s) => s.snapshot !== null && !s.snapshot.enabled);
  const exportWidth = (step.config.exportWidth ?? '').trim();
  const width = snapCaptureWidth(CAPTURE_WIDTHS.find((value) => String(value) === exportWidth) ?? captureWidth);
  const exportFormats = parseLlmExportFormats(step.config.exportFormat);
  const hasExports = exportFormats.length > 0;
  const hasImageExport = exportFormats.some((format) => format !== 'pdf');
  const bareUsers = useBareOutputUsers(step.id, step.outputKey, hasExports);
  const exportId = useId();
  const promptId = useId();
  const sizeLabelId = useId();
  const outputHints = [
    fillTemplate(t('flow.skill.llm.output.hint'), { text: `{{${step.outputKey}.text}}` }),
    ...(hasExports ? [
      fillTemplate(t('flow.skill.llm.exportOutputs.hint'), { files: exportFormats.map((format) => `{{${step.outputKey}.${format}}}`).join(', ') }),
      fillTemplate(t('flow.skill.llm.exportOutput.hint'), { file: `{{${step.outputKey}.file}}` }),
    ] : []),
    ...(hasImageExport ? [fillTemplate(t('flow.skill.llm.exportFallback.hint'), { file: `{{${step.outputKey}.pdf}}` })] : []),
  ];

  useEffect(() => {
    if (hasExports) void loadExportSettings();
  }, [loadExportSettings, hasExports]);

  // The master switch lives in Settings; read it only once the step asks for personal memory.
  useEffect(() => {
    if (usesUserMemory) useUserMemoryStore.getState().initialize();
  }, [usesUserMemory]);

  const pickerModels = sections.flatMap((section) => section.models);
  // A BYOK key deleted in Settings is gone from the list: show it by name and say so, instead of
  // a blank field over a step that still asks for it.
  const providerMissing = provider !== '' && !pickerModels.some((model) => model.url === provider);
  const providerOptions = [
    { value: '', label: t('flow.skill.llm.providerCurrent') },
    ...providerSectionsToSelectData(sections, hiddenSuffix),
    ...(providerMissing ? [{
      value: provider,
      label: isByokTargetUrl(provider) ? t('flow.skill.llm.providerMissing') : (llmProviderLabel(provider, namedModels) || provider),
    }] : []),
  ];
  const chatModel = pickerModels.find((model) => model.url === chatModelUrl)?.label
    ?? llmProviderLabel(chatModelUrl, namedModels);

  return (
  <Stack gap="xs">
    <Group justify="space-between" align="flex-end" wrap="nowrap" mb={-4}>
      <Input.Label htmlFor={promptId}>{t('flow.skill.llm.prompt')}</Input.Label>
      <Group gap={6} wrap="nowrap">
        {draftButton?.('prompt', 'flowPrompt', t('flow.skill.llm.prompt'))}
        {insertData}
      </Group>
    </Group>
    {/* Grows with the prompt up to a cap, then scrolls inside, so one field never outgrows the screen. */}
    <AppTextarea
      id={promptId}
      placeholder={t('flow.skill.llm.prompt.placeholder')}
      value={step.config.prompt ?? ''}
      onChange={(e) => onChange({ ...step.config, prompt: e.currentTarget.value })}
      autosize
      minRows={6}
      maxRows={18}
      resize="vertical"
      size="sm"
    />
    <Stack gap={4}>
      <SelectDropdown
        label={t('flow.skill.llm.provider')}
        options={providerOptions}
        value={provider}
        onChange={(value) => onChange({ ...step.config, provider: value })}
        error={providerMissing && isByokTargetUrl(provider) ? t('flow.skill.llm.providerMissing.hint') : undefined}
        maxDropdownHeight={PROVIDER_DROPDOWN_MAX_HEIGHT}
        size="sm"
      />
      {provider === '' && (
        <Text fz="xs" c="var(--text-muted)" data-llm-current-model="">
          {chatModel
            ? fillTemplate(t('flow.skill.llm.providerCurrent.hint'), { model: chatModel })
            : t('flow.skill.llm.providerCurrent.hintUnnamed')}
        </Text>
      )}
    </Stack>
    <AppTextarea
      label={t('flow.skill.llm.attachments')}
      placeholder={t('flow.skill.llm.attachments.placeholder')}
      value={step.config.attachments ?? ''}
      onChange={(e) => onChange({ ...step.config, attachments: e.currentTarget.value })}
      autosize
      minRows={1}
      maxRows={4}
      size="sm"
      mono
    />
    {(step.config.attachments ?? '').trim() && (
      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.llm.attachments.hint'), {
          providers: UPLOAD_CAPABLE_PROVIDER_LABELS,
          byok: BYOK_IMAGE_PROVIDER_LABELS,
        })}
      </Text>
    )}
    <Stack gap={4}>
      <LlmFieldLabel htmlFor={exportId} label={t('flow.skill.llm.exportFormat')} hint={outputHints} t={t} />
      <MultiSelectDropdown
        id={exportId}
        aria-label={t('flow.skill.llm.exportFormat')}
        placeholder={hasExports ? undefined : t('flow.skill.llm.exportFormat.none')}
        options={[
          { value: 'png', label: 'PNG' },
          { value: 'webp', label: 'WEBP' },
          { value: 'pdf', label: 'PDF' },
        ]}
        value={exportFormats}
        onChange={(values) => onChange({ ...step.config, exportFormat: values.join(',') })}
        clearable
        size="sm"
      />
      {bareUsers && (
        <Stack gap={4} align="flex-start" data-llm-bare-users={bareUsers}>
          <StatusLine tone="warning">
            {fillTemplate(t('flow.skill.llm.exportBareOutput'), { steps: bareUsers, token: `{{${step.outputKey}}}` })}
          </StatusLine>
          <AppButton variant="default" size="compact-xs" onClick={() => readAnswerTextInLaterSteps(step.id, step.outputKey)}>
            {fillTemplate(t('flow.skill.llm.exportBareOutput.fix'), { token: `{{${step.outputKey}.text}}` })}
          </AppButton>
        </Stack>
      )}
    </Stack>
    {hasExports && (
      <>
        <SimpleGrid type="container" cols={{ base: 1, [PAIR_FIELDS_FROM]: 2 }} spacing="xs" verticalSpacing="xs">
          <Stack gap={4}>
            <Group justify="space-between" wrap="nowrap" mih={22}>
              <Input.Label id={sizeLabelId}>{t('capture.size')}</Input.Label>
              {exportWidth && (
                <AppButton
                  variant="subtle"
                  size="compact-xs"
                  onClick={() => onChange({ ...step.config, exportWidth: '' })}
                >
                  {t('flow.skill.llm.paletteCardStyle')}
                </AppButton>
              )}
            </Group>
            <AppSegmentedControl
              aria-labelledby={sizeLabelId}
              value={String(width)}
              options={CAPTURE_WIDTHS.map((value) => ({ value: String(value), label: t(captureWidthLabelKey(value)) }))}
              onChange={(value) => onChange({ ...step.config, exportWidth: value })}
              size="sm"
            />
          </Stack>
          <SelectDropdown
            label={t('common.background')}
            options={[
              { value: '', label: t('flow.skill.llm.paletteCardStyle') },
              ...buildCapturePaletteOptions(t),
            ]}
            value={(step.config.palette ?? '').trim()}
            onChange={(value) => onChange(withCapturePalette(step.config, value))}
            size="sm"
          />
        </SimpleGrid>
        <SimpleGrid type="container" cols={{ base: 1, [PAIR_FIELDS_FROM]: 2 }} spacing="xs" verticalSpacing="xs">
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
        </SimpleGrid>
        <LlmOption
          label={t('capture.showProvider')}
          hint={t('flow.skill.llm.exportShowProvider.hint')}
          t={t}
          checked={step.config.exportShowProvider !== 'false'}
          onChange={(e) => onChange({ ...step.config, exportShowProvider: e.currentTarget.checked ? 'true' : 'false' })}
        />
        <LlmOption
          label={t('capture.showTimestamp')}
          hint={t('flow.skill.llm.exportShowTimestamp.hint')}
          t={t}
          checked={step.config.exportShowTimestamp !== 'false'}
          onChange={(e) => onChange({ ...step.config, exportShowTimestamp: e.currentTarget.checked ? 'true' : 'false' })}
        />
      </>
    )}
    <SettingDivider my={4} />
    <GroupHeader variant="plain" label={t('flow.skill.llm.executionOptions')} />
    <LlmOption
      label={t('flow.skill.llm.saveToHistory')}
      hint={t('flow.skill.llm.saveToHistory.hint')}
      t={t}
      checked={step.config.saveToHistory === 'true'}
      onChange={(e) => onChange({ ...step.config, saveToHistory: e.currentTarget.checked ? 'true' : 'false' })}
    />
    <LlmOption
      label={t('flow.skill.llm.useMemory')}
      hint={t('flow.skill.llm.useMemory.hint')}
      t={t}
      checked={step.config.useMemory === 'true'}
      onChange={(e) => onChange({ ...step.config, useMemory: e.currentTarget.checked ? 'true' : 'false' })}
    />
    <LlmOption
      label={t('flow.skill.llm.useUserMemory')}
      hint={t('flow.skill.llm.useUserMemory.hint')}
      t={t}
      checked={usesUserMemory}
      onChange={(e) => onChange({ ...step.config, useUserMemory: e.currentTarget.checked ? 'true' : 'false' })}
    />
    {usesUserMemory && userMemoryOff && (
      <Group gap={8} wrap="nowrap" align="flex-start" justify="space-between" data-llm-user-memory-off="">
        <StatusLine tone="warning">{t('flow.skill.llm.useUserMemory.off')}</StatusLine>
        <AppButton
          variant="default"
          size="compact-xs"
          leftSection={<Settings size={12} />}
          onClick={() => openSettingsCategory('memory')}
          style={{ flexShrink: 0 }}
        >
          {t('flow.setup.openSettings')}
        </AppButton>
      </Group>
    )}
    <LlmOption
      label={t('flow.skill.llm.emitFailFlag')}
      hint={fillTemplate(t('flow.skill.llm.emitFailFlag.hint'), { flag: `{{${step.outputKey}.isFailed}}` })}
      t={t}
      checked={step.config.emitFailFlag === 'true'}
      onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
    />
  </Stack>
  );
};
