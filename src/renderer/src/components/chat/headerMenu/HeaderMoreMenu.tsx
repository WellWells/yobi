import React from 'react';
import { ActionIcon, Menu as MMenu, Tooltip } from '@mantine/core';
import { MoreVertical } from 'lucide-react';

interface HeaderMoreMenuProps {
  opened: boolean;
  onToggle: () => void;
  onClose: () => void;
  t: (key: string) => string;
  /** The dropdown's content: `HeaderMenuDropdown`. */
  children: React.ReactNode;
}

const MENU_STYLES = {
  dropdown: {
    background: 'var(--mantine-color-default)',
    borderColor: 'var(--mantine-color-default-border)',
    minWidth: 232,
  },
  item: {
    fontSize: 'var(--font-size-md)',
  },
} as const;

/** The header's ⋮ button and its menu: a conversation's and a Notion document's are the same one. */
export const HeaderMoreMenu: React.FC<HeaderMoreMenuProps> = ({ opened, onToggle, onClose, t, children }) => (
  <MMenu
    opened={opened}
    onChange={(next) => { if (!next) onClose(); }}
    position="bottom-end"
    offset={8}
    withinPortal
    zIndex={120}
    styles={MENU_STYLES}
  >
    <MMenu.Target>
      {/* No tooltip over the open menu: it would sit on top of the menu's search box. */}
      <Tooltip label={t('common.moreActions')} position="bottom" disabled={opened}>
        <ActionIcon onClick={onToggle} aria-label={t('common.moreActions')} variant="subtle" size="md" radius="xl" c="dimmed">
          <MoreVertical size={16} />
        </ActionIcon>
      </Tooltip>
    </MMenu.Target>
    <MMenu.Dropdown>{children}</MMenu.Dropdown>
  </MMenu>
);
