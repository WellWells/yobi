import React from 'react';
import { Menu } from '@mantine/core';
import { Pencil, Power, PowerOff, Trash } from 'lucide-react';
import { ContextMenuPortal } from '../../components/ContextMenuPortal';

export interface FlowFolderMenuState {
  x: number;
  y: number;
  name: string;
  /** The flows in it, as drawn. */
  flowIds: string[];
}

interface FlowFolderMenuProps {
  menu: FlowFolderMenuState | null;
  /** Whether any flow in it is off, and any on: 「全部啟用」 and 「全部停用」 have something to do. */
  anyOff: boolean;
  anyOn: boolean;
  onClose: () => void;
  onRename: (name: string) => void;
  onSetEnabled: (flowIds: string[], enabled: boolean) => void;
  onDelete: (name: string) => void;
  t: (key: string) => string;
}

/**
 * A flow folder's right-click menu and "⋯": rename, turn every flow in it on or off, delete. Deleting
 * does not ask: the flows go back to the top level, and the notice has an undo.
 */
export const FlowFolderMenu: React.FC<FlowFolderMenuProps> = ({
  menu, anyOff, anyOn, onClose, onRename, onSetEnabled, onDelete, t,
}) => {
  if (!menu) return null;
  return (
    <ContextMenuPortal position={{ x: menu.x, y: menu.y }} onClose={onClose}>
      <Menu.Item leftSection={<Pencil size={13} />} onClick={() => { onClose(); onRename(menu.name); }}>
        {t('sidebar.folder.rename')}
      </Menu.Item>
      <Menu.Item leftSection={<Power size={13} />} disabled={!anyOff} onClick={() => { onClose(); onSetEnabled(menu.flowIds, true); }}>
        {t('flow.folder.enableAll')}
      </Menu.Item>
      <Menu.Item leftSection={<PowerOff size={13} />} disabled={!anyOn} onClick={() => { onClose(); onSetEnabled(menu.flowIds, false); }}>
        {t('flow.folder.disableAll')}
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item leftSection={<Trash size={13} />} color="red" onClick={() => { onClose(); onDelete(menu.name); }}>
        {t('flow.folder.delete')}
      </Menu.Item>
    </ContextMenuPortal>
  );
};
