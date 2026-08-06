import React from 'react';
import { Box, Tooltip } from '@mantine/core';
import { ToggleSwitch } from './ToggleSwitch';

interface VisibilityToggleProps {
  checked: boolean;
  /** The last visible source cannot be switched off — the model menu would be empty. */
  blocked?: boolean;
  busy?: boolean;
  /** Accessible name, since the switch carries no visible label of its own. */
  label: string;
  size?: 'xs' | 'sm' | 'md';
  onToggle: () => void;
  t: (key: string) => string;
}

/**
 * Show/hide for one model source. A switch rather than a checkbox: it applies the moment
 * it is flipped, and there is no bulk action to select rows for.
 */
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
