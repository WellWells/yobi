import React from 'react';
import { ActionIcon, Box, Flex, Group, Stack, Tooltip } from '@mantine/core';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Check,
  CircleDot,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AppSegmentedControl } from '../AppSegmentedControl';
import { GroupHeader } from '../GroupHeader';
import {
  CAPTURE_BACKGROUND_STYLES,
  CAPTURE_DIRECTIONS,
  CAPTURE_PALETTE_GROUPS,
  CAPTURE_PALETTES,
  captureBackgroundCss,
} from '../../../../shared/capturePalettes';
import type {
  CaptureBackgroundStyle,
  CaptureDirection,
  CapturePalette,
} from '../../../../shared/capturePalettes';

export interface BackgroundStylePickerProps {
  value: CaptureBackgroundStyle;
  onChange: (value: CaptureBackgroundStyle) => void;
  t: (key: string) => string;
}

export const BackgroundStylePicker: React.FC<BackgroundStylePickerProps> = ({ value, onChange, t }) => (
  <AppSegmentedControl
    value={value}
    options={CAPTURE_BACKGROUND_STYLES.map((style) => ({
      value: style,
      label: t(`capture.background.${style}`),
    }))}
    onChange={(next) => onChange(next as CaptureBackgroundStyle)}
    size="sm"
  />
);

export interface PaletteSwatchProps {
  palette: CapturePalette;
  active: boolean;
  style: CaptureBackgroundStyle;
  direction: CaptureDirection;
  size?: number;
  onSelect: (key: string) => void;
  onHover?: (key: string | null) => void;
}

export const PaletteSwatch: React.FC<PaletteSwatchProps> = ({
  palette, active, style, direction, size = 32, onSelect, onHover,
}) => (
  <ActionIcon
    onClick={() => onSelect(palette.key)}
    onMouseEnter={() => onHover?.(palette.key)}
    onMouseLeave={() => onHover?.(null)}
    title={palette.label}
    aria-label={palette.label}
    aria-pressed={active}
    variant="transparent"
    radius="xl"
    size={size}
    style={{
      position: 'relative',
      padding: 0,
      border: active ? '2px solid var(--accent)' : '2px solid var(--border)',
      overflow: 'hidden',
      boxShadow: active ? '0 0 0 3px var(--accent-dim)' : 'none',
      transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
      flexShrink: 0,
    }}
  >
    <Box
      component="span"
      style={{ position: 'absolute', inset: 0, background: captureBackgroundCss(palette.key, style, direction) }}
    />
    {active && (
      <Flex
        pos="absolute"
        align="center"
        justify="center"
        c="#fff"
        style={{ inset: 0, textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}
      >
        <Check size={Math.round(size * 0.38)} strokeWidth={3} />
      </Flex>
    )}
  </ActionIcon>
);

export interface PaletteSwatchGridProps {
  palettes?: readonly CapturePalette[];
  value: string;
  onChange: (key: string) => void;
  style: CaptureBackgroundStyle;
  direction: CaptureDirection;
  onHover?: (key: string | null) => void;
  t: (key: string) => string;
}

export const PaletteSwatchGrid: React.FC<PaletteSwatchGridProps> = ({
  palettes = CAPTURE_PALETTES,
  value,
  onChange,
  style,
  direction,
  onHover,
  t,
}) => (
  <Stack gap={12}>
    {CAPTURE_PALETTE_GROUPS.map((group) => {
      const items = palettes.filter((p) => p.group === group);
      if (items.length === 0) return null;
      return (
        <Box key={group}>
          <GroupHeader variant="plain" label={t(`capture.palette.${group}`)} mb={6} />
          <Group gap={6} wrap="wrap">
            {items.map((item) => (
              <PaletteSwatch
                key={item.key}
                palette={item}
                active={value === item.key}
                style={style}
                direction={direction}
                onSelect={onChange}
                onHover={onHover}
              />
            ))}
          </Group>
        </Box>
      );
    })}
  </Stack>
);

/**
 * One lucide stroke per cell, so all nine share a size and weight (typed arrows mix fonts and
 * widths, and the diagonals render as emoji). The centre is a ring with a dot
 * ("from the centre"): plain Circle already means pending/unread elsewhere in the app.
 */
const DIRECTION_ICONS: Record<CaptureDirection, LucideIcon> = {
  nw: ArrowUpLeft, n: ArrowUp, ne: ArrowUpRight,
  w: ArrowLeft, c: CircleDot, e: ArrowRight,
  sw: ArrowDownLeft, s: ArrowDown, se: ArrowDownRight,
};

export interface DirectionGridProps {
  value: string;
  onChange: (key: string) => void;
  t: (key: string) => string;
}

export const DirectionGrid: React.FC<DirectionGridProps> = ({ value, onChange, t }) => (
  <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 32px)', gap: 4 }}>
    {CAPTURE_DIRECTIONS.map((key) => {
      const Icon = DIRECTION_ICONS[key];
      const label = t(`capture.direction.${key}`);
      return (
        <Tooltip key={key} label={label}>
          <ActionIcon
            onClick={() => onChange(key)}
            aria-label={label}
            aria-pressed={value === key}
            variant={value === key ? 'light' : 'default'}
            radius="sm"
            size={32}
            style={{ color: value === key ? 'var(--accent)' : 'var(--text-secondary)' }}
          >
            <Icon size={14} />
          </ActionIcon>
        </Tooltip>
      );
    })}
  </Box>
);
