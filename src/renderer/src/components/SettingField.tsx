import React, { useId } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { FieldLabelContext } from './fieldLabel';

export interface SettingFieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
  /** A small control at the right end of the label row (the custom instructions' "Tidy"). */
  action?: React.ReactNode;
}

// Like SettingRow, a field's label carries no icon. The label names the text field inside
// (`FieldLabelContext`): a plain Text above an input is not its label to a screen reader.
export const SettingField: React.FC<SettingFieldProps> = ({ label, hint, children, action }) => {
  const labelId = useId();
  const title = <Text id={labelId} fz="var(--font-size-base)" fw={600} c="var(--mantine-color-default-color)">{label}</Text>;
  return (
    <Stack gap={6}>
      {action ? (
        <Group justify="space-between" align="center" wrap="nowrap" gap={8}>
          {title}
          {action}
        </Group>
      ) : title}
      <FieldLabelContext value={labelId}>{children}</FieldLabelContext>
      {hint && <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{hint}</Text>}
    </Stack>
  );
};
