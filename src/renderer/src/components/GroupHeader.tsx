import React from 'react';
import { Divider, Group } from '@mantine/core';

interface GroupHeaderProps {
  label: string;
  /** `divider` heads a list section with a rule; `plain` names a sub-group inside a panel, card or picker. */
  variant?: 'divider' | 'plain';
  icon?: React.ReactNode;
  mb?: number;
}

// The one small heading: sentence case, no letter-spacing (tracking pulls CJK labels apart).
const LABEL_SIZE = 'var(--font-size-sm)';
const LABEL_WEIGHT = 600;
// Same muted colour as `.mantine-Menu-label`; Mantine's `dimmed` is the disabled colour, under 3:1
// on most cards.
const LABEL_COLOR = 'var(--text-muted)';

export const GroupHeader: React.FC<GroupHeaderProps> = ({ label, variant = 'divider', icon, mb }) => {
  if (variant === 'plain') {
    return (
      <Group gap={6} wrap="nowrap" mb={mb} fz={LABEL_SIZE} fw={LABEL_WEIGHT} c={LABEL_COLOR}>
        {icon}
        {label}
      </Group>
    );
  }
  return (
    <Divider
      label={label}
      labelPosition="left"
      mb={mb ?? 10}
      mt={6}
      styles={{
        label: {
          fontSize: LABEL_SIZE,
          fontWeight: LABEL_WEIGHT,
          color: LABEL_COLOR,
        },
      }}
    />
  );
};
