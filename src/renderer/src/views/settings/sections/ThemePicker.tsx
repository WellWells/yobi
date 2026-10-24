import React from 'react';
import { Box, NavLink, SimpleGrid, Stack } from '@mantine/core';
import { THEME_SWATCHES } from '../../../theme';
import type { ThemePreference } from '../../../../../shared/themes';
import { GroupHeader, SegmentedControl, SettingRow } from '../components';

const SWATCH_SIZE = 18;
const THEME_COLUMNS = 3;

/*
 * The three basic modes get their own switch, the way every big app splits "light / dark / system"
 * from its colour themes. Every named theme is a complete palette that is itself light or dark, so
 * picking one simply leaves no mode highlighted.
 */
const BASE_MODES = ['auto', 'light', 'dark'] as const satisfies readonly ThemePreference[];

function isBaseMode(preference: ThemePreference): preference is (typeof BASE_MODES)[number] {
  return (BASE_MODES as readonly ThemePreference[]).includes(preference);
}

interface ThemeOptionProps {
  label: string;
  background: string;
  accent: string;
  border: string;
  selected: boolean;
  onClick: () => void;
  onPreview: () => void;
}

/** One theme: its colour dot beside its name, so every choice is readable without hovering. */
const ThemeOption: React.FC<ThemeOptionProps> = ({ label, background, accent, border, selected, onClick, onPreview }) => (
  <NavLink
    component="button"
    type="button"
    label={label}
    active={selected}
    aria-pressed={selected}
    onClick={onClick}
    onMouseEnter={onPreview}
    onFocus={onPreview}
    leftSection={(
      <Box
        w={SWATCH_SIZE}
        h={SWATCH_SIZE}
        display="flex"
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          borderRadius: '50%',
          background,
          border: `1px solid ${border}`,
        }}
      >
        <Box w={7} h={7} style={{ borderRadius: '50%', background: accent }} />
      </Box>
    )}
    styles={{
      root: {
        padding: '5px 8px',
        borderRadius: 'var(--radius)',
        color: selected ? 'var(--mantine-color-accent)' : 'var(--mantine-color-default-color)',
        background: selected ? 'var(--mantine-color-accent-dim)' : undefined,
      },
      section: { marginInlineEnd: 8 },
      body: { overflow: 'visible' },
      label: { fontSize: 'var(--font-size-sm)', whiteSpace: 'normal', overflowWrap: 'anywhere' },
    }}
  />
);

interface Props {
  preference: ThemePreference;
  onPick: (preference: ThemePreference) => void;
  /** Hovering or focusing a theme previews it; null restores the saved one. */
  onPreview: (preference: ThemePreference | null) => void;
  t: (key: string) => string;
}

/** The mode switch, then every named theme as a row in a compact grid; the saved one is highlighted. */
export const ThemePicker: React.FC<Props> = ({ preference, onPick, onPreview, t }) => (
  <Stack gap={14}>
    <SettingRow
      label={t('settings.theme.mode')}
      control={(
        <SegmentedControl
          fullWidth={false}
          value={isBaseMode(preference) ? preference : ''}
          options={BASE_MODES.map((mode) => ({ value: mode, label: t(`settings.theme.${mode}`) }))}
          onChange={(value) => onPick(value as ThemePreference)}
        />
      )}
    />
    <Box>
      <GroupHeader label={t('settings.theme.more')} />
      <SimpleGrid
        cols={THEME_COLUMNS}
        spacing={4}
        verticalSpacing={2}
        onMouseLeave={() => onPreview(null)}
        onBlur={() => onPreview(null)}
      >
        {THEME_SWATCHES.filter((swatch) => !isBaseMode(swatch.theme)).map((swatch) => (
          <ThemeOption
            key={swatch.theme}
            label={t(`settings.theme.${swatch.theme}`)}
            background={swatch.background}
            accent={swatch.accent}
            border={swatch.border}
            selected={swatch.theme === preference}
            onClick={() => onPick(swatch.theme)}
            onPreview={() => onPreview(swatch.theme)}
          />
        ))}
      </SimpleGrid>
    </Box>
  </Stack>
);
