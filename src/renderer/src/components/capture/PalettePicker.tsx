import React from 'react';
import { ActionIcon, Box, Flex, Group, Stack, Text } from '@mantine/core';
import { Check } from 'lucide-react';
import { AppSegmentedControl } from '../AppSegmentedControl';
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
    {
}
    {CAPTURE_PALETTE_GROUPS.map((group) => {
      const items = palettes.filter((p) => p.group === group);
      if (items.length === 0) return null;
      return (
        <Box key={group}>
          <Text
            fz="var(--font-size-xs)"
            fw={600}
            c="var(--text-muted)"
            mb={6}
            tt="uppercase"
            style={{ letterSpacing: '0.04em' }}
          >
            {t(`capture.palette.${group}`)}
          </Text>
          <Group gap={6} wrap="wrap">
            {items.map((item) => {
              const active = value === item.key;
              return (
                <ActionIcon
                  key={item.key}
                  onClick={() => onChange(item.key)}
                  onMouseEnter={() => onHover?.(item.key)}
                  onMouseLeave={() => onHover?.(null)}
                  title={item.label}
                  aria-label={item.label}
                  aria-pressed={active}
                  variant="transparent"
                  radius="xl"
                  size={32}
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
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: captureBackgroundCss(item.key, style, direction),
                    }}
                  />
                  {active && (
                    <Flex
                      pos="absolute"
                      align="center"
                      justify="center"
                      c="#fff"
                      style={{ inset: 0, textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}
                    >
                      <Check size={12} strokeWidth={3} />
                    </Flex>
                  )}
                </ActionIcon>
              );
            })}
          </Group>
        </Box>
      );
    })}
  </Stack>
);

export interface DirectionGridProps {
  value: string;
  onChange: (key: string) => void;
}

export const DirectionGrid: React.FC<DirectionGridProps> = ({ value, onChange }) => (
  <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 32px)', gap: 4 }}>
    {CAPTURE_DIRECTIONS.map(([key, icon]) => (
      <ActionIcon
        key={key}
        onClick={() => onChange(key)}
        aria-label={key}
        aria-pressed={value === key}
        variant={value === key ? 'light' : 'default'}
        radius="sm"
        size={32}
        style={{
          fontSize: 'var(--font-size-md)',
          fontWeight: 700,
          color: value === key ? 'var(--accent)' : 'var(--text-secondary)',
        }}
      >
        {icon}
      </ActionIcon>
    ))}
  </Box>
);
