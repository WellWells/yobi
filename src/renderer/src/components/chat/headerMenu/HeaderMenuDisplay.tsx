import React, { useEffect } from 'react';
import { ActionIcon, Box, Button, Group, Menu as MMenu, Stack, Text, Tooltip } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import { Minus, MoveHorizontal, Plus, Type, ZoomIn } from 'lucide-react';
import { READING_FONTS, isReadingFont } from '../../../../../shared/readingPrefs';
import { useAppStore, type LayoutMode } from '../../../store/appStore';
import { previewReadingFont, useReadingStore } from '../../../store/readingStore';
import { AppSegmentedControl } from '../../AppSegmentedControl';
import { ToggleSwitch } from '../../ToggleSwitch';
import { SUB_POSITION } from './headerMenuModel';
import { searchRowLabel } from './headerMenuSearch';

type Translate = (key: string) => string;

export interface HeaderMenuDisplayProps {
  t: Translate;
  /** The layout switch only means something with content to lay out. */
  showLayout: boolean;
  /** Something is typed in the search box: Font ▸ is drawn as flat rows. */
  searching: boolean;
  /** Whether a row (by its search id) is drawn. */
  show: (id: string) => boolean;
  onClose: () => void;
}

/** Drops a hover preview when the font submenu closes some other way than the pointer leaving it. */
const ClearPreviewOnClose: React.FC = () => {
  useEffect(() => () => previewReadingFont(null), []);
  return null;
};

/** The ⋮ menu's display settings, below the divider. They are global, and the last line says so. */
export const HeaderMenuDisplay: React.FC<HeaderMenuDisplayProps> = ({ t, showLayout, searching, show, onClose }) => {
  const { markdownZoom, layoutMode, setLayoutMode, zoomIn, zoomOut, zoomReset } = useAppStore(
    useShallow((s) => ({
      markdownZoom: s.markdownZoom,
      layoutMode: s.layoutMode,
      setLayoutMode: s.setLayoutMode,
      zoomIn: s.zoomInMarkdown,
      zoomOut: s.zoomOutMarkdown,
      zoomReset: s.resetMarkdownZoom,
    })),
  );
  const prefs = useReadingStore((s) => s.prefs);
  const setReadingPrefs = useReadingStore((s) => s.setReadingPrefs);

  // A hover preview never outlives the menu.
  useEffect(() => () => previewReadingFont(null), []);

  const fonts = searching ? READING_FONTS.filter((font) => show(`font.${font}`)) : READING_FONTS;
  const fontGroup = (
    <MMenu.RadioGroup
      value={prefs.font}
      onChange={(value) => { if (isReadingFont(value)) setReadingPrefs({ font: value }); }}
    >
      {fonts.map((font) => (
        <MMenu.RadioItem
          key={font}
          value={font}
          onMouseEnter={() => previewReadingFont(font)}
          onFocus={() => previewReadingFont(font)}
          // Flat rows have no submenu whose mouse-leave ends the preview, so each row ends its own.
          {...(searching ? { onMouseLeave: () => previewReadingFont(null), onBlur: () => previewReadingFont(null) } : {})}
        >
          {searching ? searchRowLabel([t('reading.font')], t(`reading.font.${font}`)) : t(`reading.font.${font}`)}
        </MMenu.RadioItem>
      ))}
    </MMenu.RadioGroup>
  );

  const showZoom = show('zoom');
  const showLayoutControl = showLayout && show('layout');

  return (
    <>
      {searching ? (fonts.length > 0 && fontGroup) : (
        <MMenu.Sub position={SUB_POSITION}>
          <MMenu.Sub.Target>
            <MMenu.Sub.Item
              leftSection={<Type size={14} />}
              rightSection={<Text fz="var(--font-size-sm)" c="var(--text-muted)">{t(`reading.font.${prefs.font}`)}</Text>}
            >
              {t('reading.font')}
            </MMenu.Sub.Item>
          </MMenu.Sub.Target>
          <MMenu.Sub.Dropdown miw={160} onMouseLeave={() => previewReadingFont(null)}>
            <ClearPreviewOnClose />
            {fontGroup}
          </MMenu.Sub.Dropdown>
        </MMenu.Sub>
      )}

      {/* The same switch as the settings page; the whole row toggles it and the menu stays open. */}
      {show('fullWidth') && (
        <MMenu.Item
          closeMenuOnClick={false}
          leftSection={<MoveHorizontal size={14} />}
          rightSection={(
            // Mantine fixes the row's role to menuitem, so the switch (out of the tab order) carries the state.
            <Box style={{ pointerEvents: 'none' }}>
              <ToggleSwitch
                size="sm"
                checked={prefs.fullWidth}
                onChange={() => {}}
                tabIndex={-1}
                aria-label={t('reading.fullWidth')}
              />
            </Box>
          )}
          onClick={() => setReadingPrefs({ fullWidth: !prefs.fullWidth })}
        >
          {t('reading.fullWidth')}
        </MMenu.Item>
      )}

      {(showZoom || showLayoutControl) && (
        <Box px={10} py={6}>
          <Stack gap={8}>
            {showZoom && (
              <Group justify="space-between" gap={10} wrap="nowrap">
                <Group gap={6} fz="var(--font-size-md)" c="dimmed" align="center" wrap="nowrap">
                  <ZoomIn size={14} />
                  {t('header.menu.zoom')}
                </Group>
                <Group gap={4} wrap="nowrap">
                  <Tooltip label={t('zoom.out')} position="top">
                    <ActionIcon variant="default" size={26} radius={6} onClick={zoomOut} aria-label={t('zoom.out')}>
                      <Minus size={13} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('zoom.reset')} position="top">
                    <Button
                      variant="subtle"
                      size="compact-xs"
                      radius={6}
                      onClick={zoomReset}
                      miw={52}
                      fw={700}
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {`${markdownZoom}%`}
                    </Button>
                  </Tooltip>
                  <Tooltip label={t('zoom.in')} position="top">
                    <ActionIcon variant="default" size={26} radius={6} onClick={zoomIn} aria-label={t('zoom.in')}>
                      <Plus size={13} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            )}

            {showLayoutControl && (
              <AppSegmentedControl
                value={layoutMode}
                onChange={(value) => {
                  setLayoutMode(value as LayoutMode);
                  onClose();
                }}
                options={[
                  { label: t('layout.stacked'), value: 'stacked' },
                  { label: t('layout.sideBySide'), value: 'side-by-side' },
                ]}
                size="xs"
                fullWidth
              />
            )}
          </Stack>
        </Box>
      )}

      {/* Its own line at the end of the section it describes, not glued to the conversation's numbers. */}
      <Text px={12} pt={2} pb={6} maw={280} fz="var(--font-size-sm)" c="var(--text-muted)">
        {t('header.menu.global')}
      </Text>
    </>
  );
};
