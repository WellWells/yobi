import React from 'react';
import { ActionIcon, Box, Group, Text, Tooltip } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import { BookOpen, Minus, Palette, Plus, RotateCcw, ZoomIn } from 'lucide-react';
import { SectionCard, SettingRow, GroupHeader, SectionTitle, SettingDivider, SegmentedControl } from '../components';
import { TAG_SETS } from '../hooks/useSettingsNav';
import { useAppStore } from '../../../store/appStore';
import { useThemeStore } from '../../../store/themeStore';
import type { LayoutMode } from '../../../store/appStore';
import { THEME_SWATCHES, AUTO_THEME_SWATCH } from '../../../theme';

const SWATCH_SIZE = 30;

interface SwatchButtonProps {
  label: string;
  background: string;
  accent: string;
  border: string;
  selected: boolean;
  /** Ring color when selected — must be a solid color (accent may be a gradient). */
  ring: string;
  onClick: () => void;
  /** Fires on hover/focus to live-preview this theme (Word-style). */
  onPreview: () => void;
}

const SwatchButton: React.FC<SwatchButtonProps> = ({ label, background, accent, border, selected, ring, onClick, onPreview }) => (
  <Tooltip label={label} position="top">
    <ActionIcon
      onClick={onClick}
      onMouseEnter={onPreview}
      onFocus={onPreview}
      aria-label={label}
      size={SWATCH_SIZE}
      radius="xl"
      variant="transparent"
      style={{
        background,
        border: `1px solid ${border}`,
        boxShadow: selected
          ? `0 0 0 2px var(--mantine-color-body), 0 0 0 4px ${ring}`
          : 'none',
        transition: 'box-shadow 0.15s ease',
      }}
    >
      <Box w={11} h={11} style={{ borderRadius: '50%', background: accent }} />
    </ActionIcon>
  </Tooltip>
);

interface Props {
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'appearance') => boolean;
  isSearching: boolean;
  sectionGap: number;
}

export const AppearanceSection: React.FC<Props> = ({ t, showSection, isSearching, sectionGap }) => {
  const { preference, setTheme, previewTheme } = useThemeStore();
  // A hover preview restores on mouse-leave, but leaving Settings by keyboard or
  // the sidebar can skip that event; snap back whenever Settings goes hidden.
  const settingsVisible = useAppStore((s) => s.currentView === 'settings');
  React.useEffect(() => {
    if (!settingsVisible) previewTheme(null);
  }, [settingsVisible, previewTheme]);
  const { layoutMode, markdownZoom, setLayoutMode, zoomInMarkdown, zoomOutMarkdown, resetMarkdownZoom } = useAppStore(
    useShallow((s) => ({
      layoutMode: s.layoutMode,
      markdownZoom: s.markdownZoom,
      setLayoutMode: s.setLayoutMode,
      zoomInMarkdown: s.zoomInMarkdown,
      zoomOutMarkdown: s.zoomOutMarkdown,
      resetMarkdownZoom: s.resetMarkdownZoom,
    })),
  );

  return (
    <Box display={showSection(TAG_SETS.theme, 'appearance') || showSection(TAG_SETS.reading, 'appearance') ? 'block' : 'none'}>
      {isSearching && <GroupHeader label={t('settings.group.appearance')} />}

      <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.theme, 'appearance') ? 'block' : 'none' }}>
        <SectionTitle icon={<Palette size={15} />} label={t('settings.theme')} />
        {/* Edge-style swatches: outer circle = theme background, inner dot =
            accent. Hovering live-previews a theme across the whole app; clicking
            commits it. Restoring on leave is bound to the Group (not each swatch)
            so sweeping the pointer across the gaps doesn't flicker back. */}
        <Group
          gap={10}
          wrap="wrap"
          onMouseLeave={() => previewTheme(null)}
          onBlur={() => previewTheme(null)}
        >
          <SwatchButton
            label={t('settings.theme.auto')}
            background={AUTO_THEME_SWATCH.background}
            accent={AUTO_THEME_SWATCH.accent}
            border={AUTO_THEME_SWATCH.border}
            selected={preference === 'auto'}
            ring="var(--accent)"
            onClick={() => setTheme('auto')}
            onPreview={() => previewTheme('auto')}
          />
          {THEME_SWATCHES.map((swatch) => (
            <SwatchButton
              key={swatch.theme}
              label={t(`settings.theme.${swatch.theme}`)}
              background={swatch.background}
              accent={swatch.accent}
              border={swatch.border}
              selected={swatch.theme === preference}
              ring={swatch.accent}
              onClick={() => setTheme(swatch.theme)}
              onPreview={() => previewTheme(swatch.theme)}
            />
          ))}
        </Group>
        <Text fz="var(--font-size-sm)" c="dimmed" mt={12}>
          {t('settings.theme.current').replace('{{name}}', t(`settings.theme.${preference}`))}
        </Text>
      </SectionCard>

      <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.reading, 'appearance') ? 'block' : 'none' }}>
        <SectionTitle icon={<BookOpen size={15} />} label={t('settings.appearance.reading')} />
        <SettingRow
          icon={<BookOpen size={13} />}
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
          icon={<ZoomIn size={13} />}
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
      </SectionCard>
    </Box>
  );
};
