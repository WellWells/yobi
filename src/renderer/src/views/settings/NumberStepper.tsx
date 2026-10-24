import React from 'react';
import { ActionIcon, Box, Group, Text } from '@mantine/core';
import { Minus, Plus } from 'lucide-react';
import { AppTextInput } from '../../components/AppTextInput';

interface Props {
  /** The saved value. */
  value: number;
  /** What is typed in the box right now (digits only). */
  input: string;
  onInputChange: (text: string) => void;
  /** A step, or leaving the box: the caller clamps and saves. */
  onCommit: (value: number) => void;
  min: number;
  max: number;
  /** The unit inside the box, e.g. "sec". */
  unit: string;
  unitWidth?: number;
  /** Shown after the + button, e.g. "(15–300)". */
  range?: string;
  decreaseLabel: string;
  increaseLabel: string;
  error?: boolean;
  disabled?: boolean;
}

/**
 * What a step or leaving the box starts from: the typed number when the box holds one,
 * otherwise the saved value (an empty or half-typed box steps from what is saved).
 */
export function stepperBase(input: string, value: number): number {
  const typed = input.trim();
  return /^\d+$/.test(typed) ? Number(typed) : value;
}

/** − [ n unit ] ＋ (range): the settings page's one control for a small whole number. */
export const NumberStepper: React.FC<Props> = ({
  value, input, onInputChange, onCommit, min, max, unit, unitWidth = 30, range,
  decreaseLabel, increaseLabel, error, disabled,
}) => (
  <Group gap={10} align="center">
    <ActionIcon
      variant="default"
      size={32}
      aria-label={decreaseLabel}
      onClick={() => onCommit(stepperBase(input, value) - 1)}
      disabled={disabled || value <= min}
    >
      <Minus size={14} />
    </ActionIcon>

    <Box pos="relative" w={120}>
      <AppTextInput
        type="text"
        inputMode="numeric"
        tone="body"
        numeric
        value={input}
        onChange={(e) => onInputChange(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => onCommit(stepperBase(input, value))}
        error={error}
        disabled={disabled}
        rightSection={
          <Text component="span" fz="var(--font-size-base)" c="dimmed">
            {unit}
          </Text>
        }
        rightSectionWidth={unitWidth}
      />
    </Box>

    <ActionIcon
      variant="default"
      size={32}
      aria-label={increaseLabel}
      onClick={() => onCommit(stepperBase(input, value) + 1)}
      disabled={disabled || value >= max}
    >
      <Plus size={14} />
    </ActionIcon>

    {range && (
      <Text fz="var(--font-size-sm)" c="dimmed">
        {range}
      </Text>
    )}
  </Group>
);
