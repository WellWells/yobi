import React from 'react';
import { Box, Stack, Text } from '@mantine/core';
import { Eye, RotateCcw, SlidersHorizontal, Timer, MonitorPlay } from 'lucide-react';
import { NumberStepper } from '../NumberStepper';
import { AppButton } from '../../../components/AppButton';
import { AppTextarea } from '../../../components/AppTextarea';
import { AppTextInput } from '../../../components/AppTextInput';
import {
  SectionCard, SettingRow, SettingField, SegmentedControl, ToggleSwitch, SectionTitle,
} from '../components';
import { TAG_SETS } from '../hooks/useSettingsNav';
import {
  MIN_RESPONSE_TIMEOUT_SEC, MAX_RESPONSE_TIMEOUT_SEC,
} from '../hooks/useSystemSettings';
import type { useSystemSettings } from '../hooks/useSystemSettings';
import { buildPromptPreview } from '../hooks/usePromptPrefs';
import type { usePromptPrefs } from '../hooks/usePromptPrefs';
import { fillTemplate } from '../../../../../shared/fillTemplate';

type SystemSettings = ReturnType<typeof useSystemSettings>;
type PromptPrefs = ReturnType<typeof usePromptPrefs>;

const PROMPT_INPUT_STYLES = {
  input: {
    background: 'var(--mantine-color-body)',
    border: '1.5px solid var(--mantine-color-default-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--mantine-color-default-color)',
    fontSize: 'var(--font-size-base)',
  },
} as const;

interface Props {
  system: SystemSettings;
  prefs: PromptPrefs;
  t: (key: string) => string;
  localeLabel: string;
  showSection: (tags: readonly string[], category: 'ai') => boolean;
  sectionGap: number;
}

const PromptPreviewCard: React.FC<{
  prefs: PromptPrefs;
  localeLabel: string;
  t: (key: string) => string;
  sectionGap: number;
}> = ({ prefs, localeLabel, t, sectionGap }) => {
  const preview = buildPromptPreview(prefs.promptPrefs, prefs.syncSystemLanguageToModel, localeLabel, t);
  return (
    <SectionCard style={{ marginBottom: sectionGap }}>
      <SectionTitle icon={<Eye size={15} />} label={t('settings.prompt.preview.title')} mb={8} />
      {preview ? (
        <Box
          component="pre"
          bg="var(--mantine-color-bg-tertiary)"
          style={{
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 12px',
            margin: 0,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--mantine-color-default-color)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'var(--font-sans)',
            lineHeight: 1.65,
          }}
        >
          {preview}
        </Box>
      ) : (
        <Text
          fz="var(--font-size-sm)"
          c="dimmed"
          bg="var(--mantine-color-bg-tertiary)"
          fs="italic"
          p="10px 12px"
          style={{
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          {t('settings.prompt.preview.empty')}
        </Text>
      )}
    </SectionCard>
  );
};

export const AiSection: React.FC<Props> = ({
  system, prefs, t, localeLabel, showSection, sectionGap,
}) => (
  <Box>
    <Box display={showSection(TAG_SETS.prompt, 'ai') ? 'block' : 'none'}>
      <SectionCard style={{ marginBottom: sectionGap }}>

        <SectionTitle icon={<SlidersHorizontal size={15} />} label={t('settings.prompt.persona.title')} />

        <Stack gap={12}>
          <SettingRow
            label={t('settings.prompt.localeSync.title')}
            hint={fillTemplate(t('settings.prompt.localeSync.hint'), { locale: localeLabel })}
            alignStart
            control={
              <ToggleSwitch
                checked={prefs.syncSystemLanguageToModel}
                onChange={() => { void prefs.handleToggleSyncSystemLanguageToModel(); }}
              />
            }
          />

          <SettingField
            label={t('settings.prompt.nickname.label')}
            hint={t('settings.prompt.nickname.hint')}
          >
            <AppTextInput
              value={prefs.promptPrefs.nickname ?? ''}
              tone="body"
              onChange={(e) => prefs.setPromptPrefs({ ...prefs.promptPrefs, nickname: e.target.value })}
              onBlur={(e) => {
                const next = { ...prefs.promptPrefs, nickname: e.target.value };
                prefs.setPromptPrefs(next);
                void prefs.savePromptPrefs(next);
              }}
              placeholder={t('settings.prompt.nickname.placeholder')}
            />
          </SettingField>

          <SettingField label={t('settings.prompt.tone.label')}>
            <SegmentedControl
              value={prefs.promptPrefs.tone}
              options={[
                { value: 'default', label: t('settings.prompt.tone.default') },
                { value: 'professional', label: t('settings.prompt.tone.professional') },
                { value: 'casual', label: t('settings.prompt.tone.casual') },
                { value: 'direct', label: t('settings.prompt.tone.direct') },
              ]}
              onChange={prefs.handleToneChange}
            />
          </SettingField>

          <SettingField label={t('settings.prompt.length.label')}>
            <SegmentedControl
              value={prefs.promptPrefs.length}
              options={[
                { value: 'auto', label: t('settings.prompt.length.auto') },
                { value: 'concise', label: t('settings.prompt.length.concise') },
                { value: 'detailed', label: t('settings.prompt.length.detailed') },
              ]}
              onChange={prefs.handleLengthChange}
            />
          </SettingField>

          <SettingField label={t('settings.prompt.custom.label')}>
            <AppTextarea
              value={prefs.promptPrefs.customInstructions}
              onChange={(e) => prefs.setPromptPrefs({ ...prefs.promptPrefs, customInstructions: e.target.value })}
              onBlur={(e) => {
                const next = { ...prefs.promptPrefs, customInstructions: e.target.value };
                prefs.setPromptPrefs(next);
                void prefs.savePromptPrefs(next);
              }}
              placeholder={t('settings.prompt.custom.placeholder')}
              autosize
              minRows={3}
              maxRows={10}
              styles={PROMPT_INPUT_STYLES}
            />
          </SettingField>
        </Stack>
      </SectionCard>

      <PromptPreviewCard prefs={prefs} localeLabel={localeLabel} t={t} sectionGap={sectionGap} />

    </Box>

    <Box display={showSection(TAG_SETS.youtube, 'ai') ? 'block' : 'none'}>
      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle
          icon={<MonitorPlay size={15} />}
          label={t('settings.youtube.prompt.title')}
          mb={8}
          rightSection={prefs.youtubeCustomized && (
            <AppButton
              variant="default"
              size="xs"
              leftSection={<RotateCcw size={13} />}
              onClick={() => { void prefs.commitYoutubePrompt(''); }}
            >
              {t('settings.youtube.prompt.reset')}
            </AppButton>
          )}
        />
        <AppTextarea
          value={prefs.youtubePromptText}
          onChange={(e) => prefs.setYoutubeDraft(e.target.value)}
          onBlur={(e) => { void prefs.commitYoutubePrompt(e.target.value); }}
          autosize
          minRows={3}
          maxRows={12}
          styles={PROMPT_INPUT_STYLES}
        />
        <Text fz="var(--font-size-sm)" mt={6} c="dimmed">{t('settings.youtube.prompt.hint')}</Text>
      </SectionCard>
    </Box>

    <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.timeout, 'ai') ? 'block' : 'none' }}>
      <SectionTitle icon={<Timer size={15} />} label={t('settings.responseTimeout.title')} />
      <NumberStepper
        value={system.responseTimeoutSec}
        input={system.responseTimeoutInput}
        onInputChange={system.setResponseTimeoutInput}
        onCommit={(seconds) => { void system.persistResponseTimeoutSec(seconds); }}
        min={MIN_RESPONSE_TIMEOUT_SEC}
        max={MAX_RESPONSE_TIMEOUT_SEC}
        unit={t('settings.responseTimeout.seconds')}
        range={t('settings.responseTimeout.range')}
        decreaseLabel={t('settings.responseTimeout.decrease')}
        increaseLabel={t('settings.responseTimeout.increase')}
        error={system.timeoutInvalid}
      />
      <Text
        fz="var(--font-size-sm)"
        mt={8}
        lh={1.6}
        c={system.timeoutInvalid ? 'var(--mantine-color-error)' : 'dimmed'}
      >
        {system.timeoutInvalid
          ? t('settings.responseTimeout.invalid')
          : t('settings.responseTimeout.hint')}
      </Text>
    </SectionCard>
  </Box>
);
