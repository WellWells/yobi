import React from 'react';
import { ActionIcon, Menu as MMenu, Tooltip } from '@mantine/core';
import { Folder, FolderInput, FolderOutput, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import type { ConversationFolder } from '../../../../shared/conversationFolders';
import type { OutputFile } from '../../../../shared/types';
import { useResolvedCombo } from '../../store/shortcutStore';
import { ContextMenuPortal } from '../ContextMenuPortal';
import { ShortcutHint } from '../ShortcutHint';
import { folderLabel, moveMenuModel } from './folderActions';

type Translate = (key: string) => string;

/** The sidebar sits at the window's left edge, so its submenus open to the right. */
const SUB_POSITION = 'right-start' as const;

export interface FolderMenuState {
  x: number;
  y: number;
  folder: ConversationFolder;
}

interface MoveToFolderItemsProps {
  files: readonly Pick<OutputFile, 'folder'>[];
  folders: readonly ConversationFolder[];
  /** `''` moves out to the top level. */
  onMove: (folder: string) => void;
  /** Makes a new folder and files the conversations into it. */
  onMoveToNew: () => void;
  t: Translate;
}

/** The rows under 「移至資料夾 ▸」: each other folder, 「移出資料夾」, then 「新增資料夾…」. */
export const MoveToFolderItems: React.FC<MoveToFolderItemsProps> = ({ files, folders, onMove, onMoveToNew, t }) => {
  const { targets, canMoveOut } = moveMenuModel(files, folders);
  return (
    <>
      {targets.map((folder) => (
        <MMenu.Item key={folder.name} leftSection={<Folder size={13} />} onClick={() => onMove(folder.name)}>
          {folderLabel(folder.name, t)}
        </MMenu.Item>
      ))}
      {canMoveOut && (
        <MMenu.Item leftSection={<FolderOutput size={13} />} onClick={() => onMove('')}>
          {t('context.moveOutOfFolder')}
        </MMenu.Item>
      )}
      {(targets.length > 0 || canMoveOut) && <MMenu.Divider />}
      <MMenu.Item leftSection={<FolderPlus size={13} />} onClick={onMoveToNew}>
        {t('context.newFolderEllipsis')}
      </MMenu.Item>
    </>
  );
};

interface MoveToFolderSubProps extends MoveToFolderItemsProps {
  disabled?: boolean;
}

/** 「移至資料夾 ▸」 inside a row's (or the selection's) context menu. */
export const MoveToFolderSub: React.FC<MoveToFolderSubProps> = ({ disabled, ...items }) => (
  <MMenu.Sub position={SUB_POSITION}>
    <MMenu.Sub.Target>
      <MMenu.Sub.Item leftSection={<FolderInput size={13} />} disabled={disabled}>
        {items.t('context.moveToFolder')}
      </MMenu.Sub.Item>
    </MMenu.Sub.Target>
    <MMenu.Sub.Dropdown>
      <MoveToFolderItems {...items} />
    </MMenu.Sub.Dropdown>
  </MMenu.Sub>
);

/** The selection bar's 「移至資料夾」 button, beside Export: an icon, its name on hover. */
export const MoveToFolderButton: React.FC<MoveToFolderSubProps> = ({ disabled, ...items }) => (
  <MMenu position="top-start" withinPortal>
    <MMenu.Target>
      <Tooltip label={items.t('context.moveToFolder')} position="top">
        <ActionIcon size="input-xs" variant="default" aria-label={items.t('context.moveToFolder')} disabled={disabled}>
          <FolderInput size={14} />
        </ActionIcon>
      </Tooltip>
    </MMenu.Target>
    <MMenu.Dropdown>
      <MoveToFolderItems {...items} />
    </MMenu.Dropdown>
  </MMenu>
);

interface FolderContextMenuProps {
  menu: FolderMenuState | null;
  onClose: () => void;
  onRename: (folder: ConversationFolder) => void;
  onDelete: (folder: ConversationFolder) => void;
  t: Translate;
}

/**
 * A folder row's right-click menu and "⋯": rename (not Yobi's own folders, which it writes into by
 * name) and delete, which does not ask — the conversations go to Recently Deleted, with an undo.
 */
export const FolderContextMenu: React.FC<FolderContextMenuProps> = ({ menu, onClose, onRename, onDelete, t }) => {
  const editTitleCombo = useResolvedCombo('files.editTitle');
  const deleteCombo = useResolvedCombo('files.delete');
  if (!menu) return null;
  const { folder } = menu;
  return (
    <ContextMenuPortal position={{ x: menu.x, y: menu.y }} onClose={onClose}>
      {!folder.system && (
        <MMenu.Item
          leftSection={<Pencil size={13} />}
          rightSection={<ShortcutHint combo={editTitleCombo} />}
          onClick={() => { onClose(); onRename(folder); }}
        >
          {t('sidebar.folder.rename')}
        </MMenu.Item>
      )}
      <MMenu.Item
        leftSection={<Trash2 size={13} />}
        color="red"
        rightSection={<ShortcutHint combo={deleteCombo} />}
        onClick={() => { onClose(); onDelete(folder); }}
      >
        {t('sidebar.folder.delete')}
      </MMenu.Item>
    </ContextMenuPortal>
  );
};
