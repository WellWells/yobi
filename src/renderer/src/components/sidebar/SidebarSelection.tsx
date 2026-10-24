import React from 'react';
import { ActionIcon, Menu as MMenu, Tooltip } from '@mantine/core';
import { Trash2, Upload } from 'lucide-react';
import type { ConversationFolder } from '../../../../shared/conversationFolders';
import type { OutputFile } from '../../../../shared/types';
import { useResolvedCombo } from '../../store/shortcutStore';
import { ContextMenuPortal } from '../ContextMenuPortal';
import { SelectionActionBar } from '../SelectionActionBar';
import { ShortcutHint } from '../ShortcutHint';
import { MoveToFolderButton, MoveToFolderSub } from './FolderMenus';
import { SelectionPinButton, SelectionPinMenuItem } from './pinActions';
import { SelectionMenuItems } from './SelectionMenuItems';
import type { SelectionAction } from './SelectionMenuItems';

type Translate = (key: string) => string;

interface SelectionCommon {
  /** The checked conversations, in list order. */
  picked: readonly OutputFile[];
  folders: readonly ConversationFolder[];
  /** `true` pins, `false` unpins, `null` = nothing checked. */
  selectionPin: boolean | null;
  onPin: (pinned: boolean) => void;
  onAction: (action: SelectionAction) => void;
  onMove: (folder: string) => void;
  onMoveToNew: () => void;
  onDelete: () => void;
  t: Translate;
}

interface SidebarSelectionBarProps extends SelectionCommon {
  count: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onCancel: () => void;
}

/**
 * The bar under the list while selecting: export, pin, move to a folder, delete — icons with their
 * names on hover. The sidebar is 240px wide: as labelled buttons with ▾ arrows the names were cut
 * to a letter or two ("i", "移"); the menus still open on click.
 */
export const SidebarSelectionBar: React.FC<SidebarSelectionBarProps> = ({
  count, allSelected, onToggleAll, onCancel, picked, folders, selectionPin, onPin, onAction, onMove, onMoveToNew, onDelete, t,
}) => (
  <SelectionActionBar
    count={count}
    allSelected={allSelected}
    onToggleAll={onToggleAll}
    onDelete={onDelete}
    onCancel={onCancel}
    t={t}
    actionsGrow={false}
    extraActions={(
      <>
        <MMenu position="top-start" withinPortal>
          <MMenu.Target>
            <Tooltip label={t('selection.export')} position="top">
              <ActionIcon size="input-xs" variant="default" aria-label={t('selection.export')} disabled={count === 0}>
                <Upload size={14} />
              </ActionIcon>
            </Tooltip>
          </MMenu.Target>
          <MMenu.Dropdown>
            <SelectionMenuItems onAction={onAction} t={t} />
          </MMenu.Dropdown>
        </MMenu>
        <SelectionPinButton target={selectionPin} onPin={onPin} t={t} />
        <MoveToFolderButton files={picked} folders={folders} onMove={onMove} onMoveToNew={onMoveToNew} disabled={count === 0} t={t} />
      </>
    )}
  />
);

interface SelectionContextMenuProps extends SelectionCommon {
  position: { x: number; y: number } | null;
  onClose: () => void;
  /** A batch export is running: exporting and deleting wait for it. */
  busy: boolean;
}

/** Right-click while selecting: the same actions as the bar, on the checked conversations. */
export const SelectionContextMenu: React.FC<SelectionContextMenuProps> = ({
  position, onClose, busy, picked, folders, selectionPin, onPin, onAction, onMove, onMoveToNew, onDelete, t,
}) => {
  const deleteCombo = useResolvedCombo('files.delete');
  return (
    <ContextMenuPortal position={position} onClose={onClose}>
      <SelectionPinMenuItem target={selectionPin} onPin={onPin} t={t} />
      <MoveToFolderSub
        files={picked}
        folders={folders}
        onMove={(folder) => { onClose(); onMove(folder); }}
        onMoveToNew={() => { onClose(); onMoveToNew(); }}
        disabled={picked.length === 0}
        t={t}
      />
      <MMenu.Divider />
      <SelectionMenuItems onAction={onAction} disabled={busy} t={t} />
      <MMenu.Divider />
      <MMenu.Item
        leftSection={<Trash2 size={13} />}
        color="red"
        rightSection={<ShortcutHint combo={deleteCombo} />}
        disabled={busy}
        onClick={() => { onClose(); onDelete(); }}
      >
        {t('common.delete')}
      </MMenu.Item>
    </ContextMenuPortal>
  );
};
