import React from 'react';
import { Group } from '@mantine/core';
import { AppButton } from '../../../components/AppButton';

export interface QuickValue {
  /** What a click writes into the field, exactly as the executor reads it. */
  value: string;
  label: string;
}

/**
 * A row of shortcuts under a free-text field: a click writes that value into it. Not a choice
 * between them: a typed value or a `{{variable}}` stays as it is until a shortcut is clicked, and
 * the one matching the field is only shown as current.
 */
export const QuickValueButtons: React.FC<{
  values: readonly QuickValue[];
  current: string;
  onPick: (value: string) => void;
  label: string;
}> = ({ values, current, onPick, label }) => (
  <Group gap={6} wrap="wrap" role="group" aria-label={label} mt={-2}>
    {values.map((item) => (
      <AppButton
        key={item.value || '(blank)'}
        size="compact-xs"
        variant={current.trim() === item.value ? 'light' : 'default'}
        aria-pressed={current.trim() === item.value}
        onClick={() => onPick(item.value)}
      >
        {item.label}
      </AppButton>
    ))}
  </Group>
);
