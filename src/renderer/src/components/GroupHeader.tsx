import React from 'react';
import { Divider } from '@mantine/core';

export const GroupHeader: React.FC<{ label: string }> = ({ label }) => (
  <Divider
    label={label}
    labelPosition="left"
    mb={10}
    mt={6}
    styles={{
      label: {
        fontSize: 'var(--font-size-sm)',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--mantine-color-dimmed)',
      },
    }}
  />
);
