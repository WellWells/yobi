import React from 'react';
import { Group, Input } from '@mantine/core';

/** A field label with actions at the right end of its row (the draft button), as the AI step's prompt has. */
export const FieldLabelRow: React.FC<{ htmlFor: string; label: string; children?: React.ReactNode }> = ({ htmlFor, label, children }) => (
  <Group justify="space-between" align="flex-end" wrap="nowrap" mb={-4}>
    <Input.Label htmlFor={htmlFor}>{label}</Input.Label>
    {children}
  </Group>
);
