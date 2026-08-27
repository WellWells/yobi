import React from 'react';
import { Box, Stack, Text } from '@mantine/core';
import { Aperture, Eye, FileDown, Frame, Image as ImageIcon, Layers, Link2, Maximize, Palette, Server, Sparkles } from 'lucide-react';
import {
  SectionCard, SettingRow, SettingField, SelectDropdown, ToggleSwitch, SectionTitle, AppTextInput,
} from '../components';
import { TAG_SETS } from '../hooks/useSettingsNav';
import { BackgroundStylePicker, DirectionGrid, PaletteSwatchGrid } from '../../../components/capture/PalettePicker';
import type { CaptureDirection } from '../../../../../shared/capturePalettes';
import { CardStyleSample } from '../../../components/capture/CardStyleSample';
import { MarginSlider } from '../../../components/capture/MarginSlider';
import { CAPTURE_WIDTHS, captureWidthLabelKey } from '../../../../../shared/types';
import type { CardLayout, QuickExportFormat } from '../../../../../shared/types';
import type { useQuickExportRecorder } from '../hooks/useQuickExportRecorder';
import type { useExportPreferences } from '../hooks/useExportPreferences';
import type { useShareSettings } from '../hooks/useShareSettings';

type QuickExportRecorder = ReturnType<typeof useQuickExportRecorder>;
type ExportPreferences = ReturnType<typeof useExportPreferences>;
type ShareSettings = ReturnType<typeof useShareSettings>;

const CAPTURE_FORMATS = [
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WEBP' },
  { value: 'pdf', label: 'PDF' },
];

interface Props {
  quickExport: QuickExportRecorder;
  preferences: ExportPreferences;
  share: ShareSettings;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'export') => boolean;
  sectionGap: number;
}

export const ExportSection: React.FC<Props> = ({
  quickExport, preferences, share, t, showSection, sectionGap,
}) => (
  <Box display={
    showSection(TAG_SETS.quickExport, 'export')
      || showSection(TAG_SETS.cardStyle, 'export')
      || showSection(TAG_SETS.shareLink, 'export')
      ? 'block' : 'none'
  }>
    <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.quickExport, 'export') ? 'block' : 'none' }}>
      <SectionTitle icon={<Sparkles size={15} />} label={t('settings.quickExport.title')} />
      <Text fz="var(--font-size-sm)" c="dimmed" mb={14} style={{ lineHeight: 1.6 }}>
        {t('settings.quickExport.hint')}
      </Text>
      {}
      <Stack gap={14}>
        <SettingRow
          icon={<ImageIcon size={13} />}
          label={t('settings.quickExport.format')}
          hint={t('settings.quickExport.format.hint')}
          control={(
            <SelectDropdown
              value={quickExport.format}
              onChange={(value) => { void quickExport.setFormat(value as QuickExportFormat); }}
              options={[...CAPTURE_FORMATS, { value: 'text', label: t('settings.quickExport.format.text') }]}
              w={130}
            />
          )}
        />
        {}
        <Box display={quickExport.format === 'text' ? 'none' : 'block'}>
          <SettingRow
            icon={<FileDown size={13} />}
            label={t('settings.quickExport.zip')}
            hint={t('settings.quickExport.zip.hint')}
            control={(
              <ToggleSwitch
                checked={quickExport.zip}
                onChange={(e) => { void quickExport.setZip(e.currentTarget.checked); }}
              />
            )}
          />
        </Box>
      </Stack>
    </SectionCard>

    <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.cardStyle, 'export') ? 'block' : 'none' }}>
      <SectionTitle icon={<Palette size={15} />} label={t('settings.cardStyle.title')} />
      <Text fz="var(--font-size-sm)" c="dimmed" mb={14} style={{ lineHeight: 1.6 }}>
        {t('settings.cardStyle.hint')}
      </Text>
      <Stack gap={14}>
        {
}
        <SettingField icon={<Palette size={13} />} label={t('common.background')}>
          <Stack gap={10}>
            <BackgroundStylePicker
              value={preferences.backgroundStyle}
              onChange={preferences.setBackgroundStyle}
              t={t}
            />
            <PaletteSwatchGrid
              value={preferences.palette}
              onChange={preferences.setPalette}
              style={preferences.backgroundStyle}
              direction={preferences.direction as CaptureDirection}
              t={t}
            />
          </Stack>
        </SettingField>
        {}
        {preferences.backgroundStyle === 'gradient' && (
          <SettingField icon={<Palette size={13} />} label={t('capture.direction')}>
            <DirectionGrid value={preferences.direction} onChange={preferences.setDirection} />
          </SettingField>
        )}
        <SettingRow
          icon={<Layers size={13} />}
          label={t('capture.layout')}
          control={(
            <SelectDropdown
              value={preferences.cardLayout}
              onChange={(value) => preferences.setCardLayout(value as CardLayout)}
              options={[
                { value: 'document', label: t('capture.layout.document') },
                { value: 'bubble', label: t('capture.layout.bubble') },
              ]}
              w={150}
            />
          )}
        />
        <SettingRow
          icon={<Maximize size={13} />}
          label={t('capture.size')}
          control={(
            <SelectDropdown
              value={String(preferences.width)}
              onChange={(value) => preferences.setWidth(Number(value))}
              options={CAPTURE_WIDTHS.map((w) => ({ value: String(w), label: `${t(captureWidthLabelKey(w))} · ${w}px` }))}
              w={130}
            />
          )}
        />
        <SettingRow
          icon={<Frame size={13} />}
          label={t('capture.margin')}
          hint={t('capture.margin.desc')}
          control={(
            <MarginSlider
              value={preferences.margin}
              onChange={preferences.setMargin}
              label={t('capture.margin')}
              w={170}
            />
          )}
        />
        <SettingRow
          icon={<Aperture size={13} />}
          label={t('capture.hiDpi')}
          hint={t('capture.hiDpi.desc')}
          control={<ToggleSwitch checked={preferences.hiDpi} onChange={(e) => preferences.setHiDpi(e.currentTarget.checked)} />}
        />
        {
}
        <SettingField icon={<Eye size={13} />} label={t('capture.preview')}>
          <CardStyleSample
            palette={preferences.palette}
            backgroundStyle={preferences.backgroundStyle}
            direction={preferences.direction}
            cardLayout={preferences.cardLayout}
            width={preferences.width}
            margin={preferences.margin}
            hiDpi={preferences.hiDpi}
            t={t}
          />
        </SettingField>
      </Stack>
    </SectionCard>

    {
}
    <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.shareLink, 'export') ? 'block' : 'none' }}>
      <SectionTitle icon={<Link2 size={15} />} label={t('settings.share.title')} />
      <SettingField icon={<Server size={13} />} label={t('settings.share.instance')} hint={t('settings.share.instanceHint')}>
        <AppTextInput
          value={share.draft}
          mono
          onChange={(event) => share.setDraft(event.currentTarget.value)}
          onBlur={share.commitInstanceUrl}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          spellCheck={false}
        />
      </SettingField>
    </SectionCard>
  </Box>
);
