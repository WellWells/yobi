import React, { useState } from 'react';
import { Menu, Text } from '@mantine/core';
import { Check } from 'lucide-react';
import { CHAT_MODES, DEFAULT_CHAT_MODE, findChatMode, type ChatMode } from '../../config/chatModes';
import { ComposerPill } from './ComposerPill';

interface ModeDropdownProps {
  value: ChatMode;
  onChange: (mode: ChatMode) => void;
  t: (key: string) => string;
}

const MENU_WIDTH = 300;
export const ModeDropdown: React.FC<ModeDropdownProps> = ({ value, onChange, t }) => {
  const [open, setOpen] = useState(false);
  const current = findChatMode(value);
  const CurrentIcon = current.icon;
  const accented = value !== DEFAULT_CHAT_MODE;

  return (
    <Menu
      opened={open}
      onChange={setOpen}
      position="top-start"
      offset={6}
      withinPortal
      zIndex={20}
      styles={{
        dropdown: {
          background: 'var(--mantine-color-default)',
          borderColor: 'var(--mantine-color-default-border)',
          width: MENU_WIDTH,
          maxWidth: '100%',
        },
        itemSection: {
          alignSelf: 'flex-start',
          marginTop: 2,
        },
      }}
    >
      <Menu.Target>
        <ComposerPill
          icon={<CurrentIcon size={14} />}
          label={t(current.labelKey)}
          open={open}
          accent={accented}
          onClick={() => setOpen((prev) => !prev)}
        />
      </Menu.Target>

      <Menu.Dropdown>
        {CHAT_MODES.map((option) => {
          const Icon = option.icon;
          const isSelected = option.mode === value;
          return (
            <Menu.Item
              key={option.mode}
              onClick={() => onChange(option.mode)}
              leftSection={<Icon size={15} />}
              rightSection={isSelected ? <Check size={13} color="var(--mantine-color-accent)" /> : null}
              style={{
                background: isSelected ? 'var(--mantine-color-accent-dim)' : undefined,
                color: isSelected ? 'var(--mantine-color-accent)' : undefined,
              }}
            >
              <Text fz="var(--font-size-md)" fw={isSelected ? 600 : 400} lh={1.3}>
                {t(option.labelKey)}
              </Text>
              {
}
              <Text fz="var(--font-size-sm)" c="var(--mantine-color-dimmed)" lh={1.35} mt={2}>
                {t(option.descriptionKey)}
              </Text>
            </Menu.Item>
          );
        })}
      </Menu.Dropdown>
    </Menu>
  );
};
