import React from 'react';
import { Menu } from '@mantine/core';
import { Pencil, Play, Power, PowerOff, Square, Trash } from 'lucide-react';
import { ContextMenuPortal } from '../../components/ContextMenuPortal';
import { DangerMenuItem } from '../../components/DangerMenuItem';
import { fillTemplate } from '../../../../shared/fillTemplate';
import type { FlowFolderRunState } from '../../../../shared/flowFolderRun';

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
  /** Its 「全部執行」 batch, while one runs. */
  run: FlowFolderRunState | null;
  onClose: () => void;
  /** Opens the confirmation that lists what will run. */
  onRunFolder: (name: string) => void;
  onStopFolderRun: (name: string) => void;
  onRename: (name: string) => void;
  onSetEnabled: (flowIds: string[], enabled: boolean) => void;
  onDelete: (name: string) => void;
  t: (key: string) => string;
}

/**
 * A flow folder's right-click menu and "⋯": run its flows one after another (stop while they run),
 * rename, turn every flow in it on or off, delete. Deleting does not ask: the flows go back to the
 * top level, and the notice has an undo.
 */
export const FlowFolderMenu: React.FC<FlowFolderMenuProps> = ({
  menu, anyOff, anyOn, run, onClose, onRunFolder, onStopFolderRun, onRename, onSetEnabled, onDelete, t,
}) => {
  if (!menu) return null;
  return (
    <ContextMenuPortal position={{ x: menu.x, y: menu.y }} onClose={onClose}>
      {run ? (
        <Menu.Item leftSection={<Square size={13} />} onClick={() => { onClose(); onStopFolderRun(menu.name); }}>
          {fillTemplate(t('flow.folder.run.stop'), { done: String(run.done), total: String(run.flowIds.length) })}
        </Menu.Item>
      ) : (
        <Menu.Item leftSection={<Play size={13} />} disabled={menu.flowIds.length === 0} onClick={() => { onClose(); onRunFolder(menu.name); }}>
          {t('flow.folder.runAll')}
        </Menu.Item>
      )}
      <Menu.Divider />
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
      <DangerMenuItem leftSection={<Trash size={13} />} onClick={() => { onClose(); onDelete(menu.name); }}>
        {t('flow.folder.delete')}
      </DangerMenuItem>
    </ContextMenuPortal>
  );
};
