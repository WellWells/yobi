import React, { useState } from 'react';
import { Menu, UnstyledButton } from '@mantine/core';
import { Check, ChevronDown } from 'lucide-react';
import type { ModelOption } from '../../config/models';
import { MODELS, findModelOption, getModelIconByUrl } from '../../config/models';
import { useAppStore } from '../../store/appStore';
import styles from './ModelDropdown.module.css';

interface ModelDropdownProps {
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  menuDirection?: 'up' | 'down';
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
  renderTrigger,
}) => {
  const [open, setOpen] = useState(false);
  const duckaiModels = useAppStore((state) => state.duckaiModels);
  const allModels = [...MODELS, ...duckaiModels];
  const current = findModelOption(value, duckaiModels);
  const CurrentIcon = getModelIconByUrl(current.url);
  const toggle = () => {
    if (disabled) return;
    setOpen((prev) => !prev);
  };

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
        },
        item: {
          fontSize: 'var(--font-size-md)',
        },
      }}
    >
      <Menu.Target>
        {renderTrigger ? renderTrigger({ open, current, toggle, disabled }) : (
          <UnstyledButton
            onClick={toggle}
            disabled={disabled}
            className={styles.trigger}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              border: '1px solid var(--mantine-color-default-border)',
              background: 'var(--mantine-color-default)',
              color: 'var(--mantine-color-text)',
              borderRadius: 999,
              padding: '5px 10px',
              fontSize: 'var(--font-size-base)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s ease, border-color 0.15s ease',
            }}
          >
            <CurrentIcon size={14} />
            {current.label}
            <ChevronDown
              size={12}
              style={{ color: 'var(--mantine-color-dimmed)', marginLeft: 1, transform: open ? 'rotate(180deg)' : 'none' }}
            />
          </UnstyledButton>
        )}
      </Menu.Target>

      <Menu.Dropdown>
        {allModels.map((model) => {
          const Icon = getModelIconByUrl(model.url);
          const isSelected = value === model.url;

          return (
            <Menu.Item
              key={model.url}
              onClick={() => onChange(model.url)}
              leftSection={<Icon size={15} />}
              rightSection={isSelected ? <Check size={13} color="var(--mantine-color-accent)" /> : null}
              style={{
                background: isSelected ? 'var(--mantine-color-accent-dim)' : undefined,
                color: isSelected ? 'var(--mantine-color-accent)' : undefined,
                fontWeight: isSelected ? 600 : 400,
              }}
            >
              {model.label}
            </Menu.Item>
          );
        })}
      </Menu.Dropdown>
    </Menu>
  );
};

