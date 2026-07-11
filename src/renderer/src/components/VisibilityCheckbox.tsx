import React from 'react';
import { Box, Checkbox, Tooltip } from '@mantine/core';

interface VisibilityCheckboxProps {
  checked: boolean;
  /** Some children are hidden: renders Mantine's dash instead of a tick. */
  indeterminate?: boolean;
  /** Unchecking this would empty every model picker, so it is held down. */
  blocked?: boolean;
  busy?: boolean;
  label?: React.ReactNode;
  size?: string;
  onToggle: () => void;
  t: (key: string) => string;
}

// The single "show this source in the model menus" control, shared by the built-in
// provider rows, the Duck.ai model sub-list, and the BYOK key / group cards. One
// component so the three lists cannot drift into different controls for one action.
export const VisibilityCheckbox: React.FC<VisibilityCheckboxProps> = ({
  checked, indeterminate = false, blocked = false, busy = false, label, size = 'sm', onToggle, t,
}) => (
  // Tooltip only when held down — an explanation on every row would be noise. The
  // wrapper Box gives the tooltip a hoverable target while the input is disabled.
  <Tooltip label={t('settings.modelSources.lastOne')} disabled={!blocked}>
    <Box style={{ display: 'flex', flexShrink: 0 }}>
      <Checkbox
        size={size}
        label={label}
        checked={checked}
        indeterminate={indeterminate}
        disabled={busy || blocked}
        // aria-label wins over the visible label in Mantine, so only name the control
        // when it has no label of its own — otherwise every row reads the same.
        aria-label={label === undefined ? t('settings.modelSources.visible') : undefined}
        onChange={onToggle}
      />
    </Box>
  </Tooltip>
);
