import { Group, Stack, Text } from '@mantine/core';
import { MapPin, RotateCcw } from 'lucide-react';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { PROMPT_PLACEHOLDERS, PROMPT_TEMPLATE_MAX_CHARS } from '../../../../../shared/promptAuthor';
import { AppButton } from '../../../components/AppButton';
import { AppTextarea } from '../../../components/AppTextarea';
import { StatusLine } from '../../../components/StatusLine';
import { PromptAuthorButton } from '../../../components/PromptAuthorButton';
import { SectionCard, SectionTitle, SegmentedControl, SettingField } from '../components';
import { mapsPresetOf, mapsPresetText } from '../hooks/useLinkAnalysisPreferences';
import type { MapsPreset, useLinkAnalysisPreferences } from '../hooks/useLinkAnalysisPreferences';
import { replacePromptWithUndo } from '../replacePromptWithUndo';

interface Props {
  analysis: ReturnType<typeof useLinkAnalysisPreferences>;
  t: (key: string) => string;
  visible: boolean;
  sectionGap: number;
}

const PRESETS: readonly MapsPreset[] = ['default', 'positive', 'avoid'];

export function MapsPromptSetting({ analysis, t, visible, sectionGap }: Props) {
  const disabled = !analysis.ready || analysis.busy;
  const preset = mapsPresetOf(analysis.mapsPromptText);
  // A plain list of tokens, not a sentence: no "and" before the last one.
  const variables = PROMPT_PLACEHOLDERS.maps
    .map((slot) => `{{${slot}}}`)
    .join(t('settings.mapsPrompt.variableSeparator'));

  function replaceWith(next: MapsPreset): void {
    void replacePromptWithUndo({
      previous: analysis.mapsPromptText,
      next: mapsPresetText(next),
      edited: preset === null,
      commit: analysis.commitMapsPrompt,
      message: t('settings.mapsPrompt.replaced'),
      undoLabel: t('settings.mapsPrompt.undo'),
    });
  }

  return (
    <SectionCard style={{ marginBottom: sectionGap, display: visible ? 'block' : 'none' }}>
      <SectionTitle
        icon={<MapPin size={15} />}
        label={t('settings.mapsPrompt.title')}
        rightSection={(
          <Group gap={8}>
            <PromptAuthorButton kind="maps" currentPrompt={analysis.mapsPromptText} t={t} onApply={analysis.commitMapsPrompt} disabled={!analysis.ready} />
            {analysis.mapsCustomized && (
              <AppButton
                variant="default"
                size="xs"
                leftSection={<RotateCcw size={13} />}
                disabled={!analysis.ready}
                onClick={() => replaceWith('default')}
              >
                {t('settings.mapsPrompt.reset')}
              </AppButton>
            )}
          </Group>
        )}
      />
      <Stack gap={10}>
        <SettingField label={t('settings.mapsPrompt.preset')}>
          <SegmentedControl
            value={preset ?? ''}
            fullWidth={false}
            options={PRESETS.map((value) => ({ value, label: t(`settings.mapsPrompt.${value}`) }))}
            onChange={(value) => {
              const next = PRESETS.find((candidate) => candidate === value);
              if (next && analysis.ready) replaceWith(next);
            }}
          />
        </SettingField>
        <SettingField label={t('settings.mapsPrompt.label')} hint={t('settings.mapsPrompt.hint')}>
          <AppTextarea
            value={analysis.mapsPromptText}
            onChange={(event) => analysis.setMapsDraft(event.currentTarget.value)}
            onBlur={(event) => { void analysis.commitMapsPrompt(event.currentTarget.value); }}
            aria-label={t('settings.mapsPrompt.label')}
            disabled={disabled}
            maxLength={PROMPT_TEMPLATE_MAX_CHARS}
            autosize
            minRows={4}
            maxRows={12}
          />
        </SettingField>
        <Text fz="var(--font-size-sm)" c="dimmed">{fillTemplate(t('settings.mapsPrompt.variables'), { variables })}</Text>
        {analysis.saveFailed && <StatusLine tone="error">{t('settings.modelDefaults.saveFailed')}</StatusLine>}
      </Stack>
    </SectionCard>
  );
}
