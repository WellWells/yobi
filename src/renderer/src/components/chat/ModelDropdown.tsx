import React, { useState } from 'react';
import { Menu, Tooltip } from '@mantine/core';
import type { ModelOption } from '../../config/models';
import { PROVIDER_DROPDOWN_MAX_HEIGHT, findModelOption, getModelIconByUrl } from '../../config/models';
import { useProviderModels } from '../../hooks/useProviderModels';
import { ComposerPill } from './ComposerPill';
import { ModelMenuItems } from './ModelMenuItems';

interface ModelDropdownProps {
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  menuDirection?: 'up' | 'down';
  tooltipLabel?: string;
  renderTrigger?: (ctx: {
    open: boolean;
    current: ModelOption;
    toggle: () => void;
    disabled: boolean;
  }) => React.ReactNode;
}

export const ModelDropdown: React.FC<ModelDropdownProps> = ({
  value,
  onChange,
  disabled = false,
  menuDirection = 'up',
  tooltipLabel,
  renderTrigger,
}) => {
  const [open, setOpen] = useState(false);
  const { extraModels } = useProviderModels(value);
  const current = findModelOption(value, extraModels);
  const CurrentIcon = getModelIconByUrl(current.url);
  const toggle = () => {
    if (disabled) return;
    setOpen((prev) => !prev);
  };

  const defaultTrigger = (
    <ComposerPill
      variant="subtle"
      icon={<CurrentIcon size={14} />}
      label={current.label}
      open={open}
      disabled={disabled}
      onClick={toggle}
    />
  );

  return (
    <Menu
      opened={open}
      onChange={setOpen}
      position={menuDirection === 'up' ? 'top-end' : 'bottom-end'}
      offset={6}
      withinPortal
      zIndex={20}
      styles={{
        dropdown: {
          background: 'var(--mantine-color-default)',
          borderColor: 'var(--mantine-color-default-border)',
          minWidth: 180,
          maxHeight: PROVIDER_DROPDOWN_MAX_HEIGHT,
          overflowY: 'auto',
        },
        item: {
          fontSize: 'var(--font-size-md)',
        },
      }}
    >
      <Menu.Target>
        {renderTrigger
          ? renderTrigger({ open, current, toggle, disabled })
          : tooltipLabel
            ? (
              <Tooltip label={tooltipLabel} position="top">
                {defaultTrigger}
              </Tooltip>
            )
            : defaultTrigger}
      </Menu.Target>

      <Menu.Dropdown>
        <ModelMenuItems value={value} onChange={onChange} />
      </Menu.Dropdown>
    </Menu>
  );
};
