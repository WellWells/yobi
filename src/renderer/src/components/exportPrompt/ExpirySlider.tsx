import React from 'react';
import { Group, Slider, Stack, Text } from '@mantine/core';
import type { ShareExpire } from '../../../../shared/types';

interface Props {
  label: string;
  options: Array<{ value: ShareExpire; label: string }>;
  value: ShareExpire;
  onChange: (value: ShareExpire) => void;
}

export const ExpirySlider: React.FC<Props> = ({ label, options, value, onChange }) => {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const current = options[index];
  const last = options.length - 1;

  return (
    <Stack gap={2}>
      <Group justify="space-between" wrap="nowrap" gap={12}>
        <Text fz="var(--font-size-sm)" c="dimmed">{label}</Text>
        <Text fz="var(--font-size-sm)" c="var(--mantine-color-text)">{current?.label ?? ''}</Text>
      </Group>
      <Slider
        mb={16}
        value={index}
        onChange={(next) => { const picked = options[next]; if (picked) onChange(picked.value); }}
        min={0}
        max={Math.max(0, last)}
        step={1}
        marks={options.map((option, at) => ({
          value: at,
          label: at === 0 || at === last ? option.label : undefined,
        }))}
        label={(at) => options[at]?.label ?? ''}
        size="sm"
        color="brand"
        aria-label={label}
        styles={{
          markLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' },
          mark: { borderColor: 'var(--border)' },
        }}
      />
    </Stack>
  );
};
