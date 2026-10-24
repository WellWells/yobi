import React from 'react';
import { ActionIcon, Box, Group, Text, Tooltip } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import { BookOpen, Minus, Palette, Plus, RotateCcw } from 'lucide-react';
import { SectionCard, SettingRow, SectionTitle, SettingDivider, SegmentedControl, ToggleSwitch } from '../components';
import { TAG_SETS } from '../hooks/useSettingsNav';
import { useAppStore } from '../../../store/appStore';
import { useThemeStore } from '../../../store/themeStore';
import { useReadingStore } from '../../../store/readingStore';
import { READING_FONTS, isReadingFont } from '../../../../../shared/readingPrefs';
import type { LayoutMode } from '../../../store/appStore';
import { ThemePicker } from './ThemePicker';

interface Props {
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'appearance') => boolean;
  sectionGap: number;
}

export const AppearanceSection: React.FC<Props> = ({ t, showSection, sectionGap }) => {
  const { preference, setTheme, previewTheme } = useThemeStore();
  const reading = useReadingStore((s) => s.prefs);
  const setReadingPrefs = useReadingStore((s) => s.setReadingPrefs);
  const settingsVisible = useAppStore((s) => s.currentView === 'settings');
  React.useEffect(() => {
    if (!settingsVisible) previewTheme(null);
  }, [settingsVisible, previewTheme]);
  const {
    layoutMode, markdownZoom, showTokenUsage,
    setLayoutMode, zoomInMarkdown, zoomOutMarkdown, resetMarkdownZoom, setShowTokenUsage,
  } = useAppStore(
    useShallow((s) => ({
      layoutMode: s.layoutMode,
      markdownZoom: s.markdownZoom,
      showTokenUsage: s.showTokenUsage,
      setShowTokenUsage: s.setShowTokenUsage,
      setLayoutMode: s.setLayoutMode,
      zoomInMarkdown: s.zoomInMarkdown,
      zoomOutMarkdown: s.zoomOutMarkdown,
      resetMarkdownZoom: s.resetMarkdownZoom,
    })),
  );

  return (
    <Box display={showSection(TAG_SETS.theme, 'appearance') || showSection(TAG_SETS.reading, 'appearance') ? 'block' : 'none'}>
      <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.theme, 'appearance') ? 'block' : 'none' }}>
        <SectionTitle icon={<Palette size={15} />} label={t('settings.theme')} />
        <ThemePicker preference={preference} onPick={setTheme} onPreview={previewTheme} t={t} />
      </SectionCard>

      <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.reading, 'appearance') ? 'block' : 'none' }}>
        <SectionTitle icon={<BookOpen size={15} />} label={t('settings.appearance.reading')} />
        <SettingRow
          label={t('settings.appearance.layout')}
          hint={t('settings.appearance.layout.hint')}
          control={
            <SegmentedControl
              value={layoutMode}
              onChange={(value) => setLayoutMode(value as LayoutMode)}
              fullWidth={false}
              options={[
                { label: t('layout.stacked'), value: 'stacked' },
                { label: t('layout.sideBySide'), value: 'side-by-side' },
              ]}
            />
          }
        />
        <SettingDivider my={14} />
        <SettingRow
          label={t('settings.appearance.font')}
          hint={t('settings.appearance.font.hint')}
          control={
            <SegmentedControl
              value={reading.font}
              onChange={(value) => { if (isReadingFont(value)) setReadingPrefs({ font: value }); }}
              fullWidth={false}
              options={READING_FONTS.map((font) => ({ label: t(`reading.font.${font}`), value: font }))}
            />
          }
        />
        <SettingDivider my={14} />
        <SettingRow
          label={t('reading.fullWidth')}
          hint={t('settings.appearance.fullWidth.hint')}
          control={<ToggleSwitch checked={reading.fullWidth} onChange={() => setReadingPrefs({ fullWidth: !reading.fullWidth })} />}
        />
        <SettingDivider my={14} />
        <SettingRow
          label={t('settings.appearance.zoom')}
          hint={t('settings.appearance.zoom.hint')}
          control={
            <Group gap={6} wrap="nowrap">
              <Tooltip label={t('zoom.out')} position="top">
                <ActionIcon variant="default" size={28} onClick={zoomOutMarkdown} aria-label={t('zoom.out')}>
                  <Minus size={14} />
                </ActionIcon>
              </Tooltip>
              <Text fz="var(--font-size-sm)" fw={600} w={44} ta="center" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {`${markdownZoom}%`}
              </Text>
              <Tooltip label={t('zoom.in')} position="top">
                <ActionIcon variant="default" size={28} onClick={zoomInMarkdown} aria-label={t('zoom.in')}>
                  <Plus size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('zoom.reset')} position="top">
                <ActionIcon variant="default" size={28} onClick={resetMarkdownZoom} aria-label={t('zoom.reset')}>
                  <RotateCcw size={13} />
                </ActionIcon>
              </Tooltip>
            </Group>
          }
        />
        <SettingDivider my={14} />
        <SettingRow
          label={t('settings.appearance.tokenUsage')}
          hint={t('settings.appearance.tokenUsage.hint')}
          control={<ToggleSwitch checked={showTokenUsage} onChange={() => setShowTokenUsage(!showTokenUsage)} />}
        />
      </SectionCard>
    </Box>
  );
};
