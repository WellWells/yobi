import React from 'react';
import { Box, Tooltip } from '@mantine/core';
import { ToggleSwitch } from './ToggleSwitch';

interface VisibilityToggleProps {
  checked: boolean;
  blocked?: boolean;
  busy?: boolean;
  label: string;
  size?: 'xs' | 'sm' | 'md';
  onToggle: () => void;
  t: (key: string) => string;
}

export const VisibilityToggle: React.FC<VisibilityToggleProps> = ({
  checked, blocked = false, busy = false, label, size = 'md', onToggle, t,
}) => (
  <Tooltip label={t('settings.modelSources.lastOne')} disabled={!blocked}>
    <Box style={{ display: 'flex', flexShrink: 0 }}>
      <ToggleSwitch
        checked={checked}
        disabled={busy || blocked}
        size={size}
        aria-label={label}
        onChange={onToggle}
      />
    </Box>
  </Tooltip>
);
