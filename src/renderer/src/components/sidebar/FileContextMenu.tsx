import React from 'react';
import { Menu as MMenu } from '@mantine/core';
import {
  AppWindow, Copy, ExternalLink, FileCode, FileText, Files, FolderOpen, Image, Link2, ListChecks, Pencil, Pin, PinOff, Trash2, Upload,
} from 'lucide-react';
import type { BatchCaptureFormat, OutputFile } from '../../../../shared/types';
import { fileApi } from '../../api/electronApi';
import { useResolvedCombo } from '../../store/shortcutStore';
import { exportConversationMarkdown } from '../../utils/conversationMarkdownExport';
import { hostPlatform } from '../../utils/hostPlatform';
import { isMac } from '../../utils/keyLabels';
import { ContextMenuPortal } from '../ContextMenuPortal';
import { ShortcutHint } from '../ShortcutHint';
import { copyFilesWithNotice, copyFullTextWithNotice, copyPathWithNotice } from './fileMenuActions';
import { MoveToFolderSub } from './FolderMenus';
import type { ConversationFolder } from '../../../../shared/conversationFolders';

export interface FileContextMenuState {
  x: number;
  y: number;
  file: OutputFile;
}

interface FileContextMenuProps {
  menu: FileContextMenuState | null;
  onClose: () => void;
  t: (key: string) => string;
  /** "Select multiple" needs at least two rows to be worth entering. */
  canSelectMultiple: boolean;
  /** A batch export is running; PDF and image wait for it (one capture at a time). */
  exportBusy: boolean;
  onEditH1: (file: OutputFile) => void;
  onTogglePin: (file: OutputFile) => void;
  onStartSelection: (file: OutputFile) => void;
  onDelete: (file: OutputFile) => void;
  onExportCards: (format: BatchCaptureFormat, file: OutputFile) => void;
  /** The folders 「移至資料夾 ▸」 offers; without a mover the submenu is not drawn. */
  folders?: readonly ConversationFolder[];
  /** `''` moves it out to the top level. */
  onMoveTo?: (file: OutputFile, folder: string) => void;
  onMoveToNewFolder?: (file: OutputFile) => void;
}

/** The sidebar sits at the window's left edge, so its submenu opens to the right. */
const SUB_POSITION = 'right-start' as const;

/** Right-click on one conversation row, or its hover "⋯" button (outside select mode). */
export const FileContextMenu: React.FC<FileContextMenuProps> = ({
  menu, onClose, t, canSelectMultiple, exportBusy, onEditH1, onTogglePin, onStartSelection, onDelete, onExportCards,
  folders = [], onMoveTo, onMoveToNewFolder,
}) => {
  const pinCombo = useResolvedCombo('files.togglePin');
  const editTitleCombo = useResolvedCombo('files.editTitle');
  const revealCombo = useResolvedCombo('files.revealInFolder');
  const deleteCombo = useResolvedCombo('files.delete');

  if (!menu) return null;
  const { file } = menu;

  const run = (action: (filePath: string) => Promise<unknown>): void => {
    onClose();
    void action(file.path);
  };

  return (
    <ContextMenuPortal position={{ x: menu.x, y: menu.y }} onClose={onClose}>
      <MMenu.Item
        leftSection={file.pinned ? <PinOff size={13} /> : <Pin size={13} />}
        rightSection={<ShortcutHint combo={pinCombo} />}
        onClick={() => { onClose(); onTogglePin(file); }}
      >
        {t(file.pinned ? 'context.unpin' : 'context.pin')}
      </MMenu.Item>
      <MMenu.Item
        leftSection={<Pencil size={13} />}
        rightSection={<ShortcutHint combo={editTitleCombo} />}
        onClick={() => onEditH1(file)}
      >
        {t('context.editH1')}
      </MMenu.Item>
      {onMoveTo && onMoveToNewFolder && (
        <MoveToFolderSub
          files={[file]}
          folders={folders}
          onMove={(folder) => { onClose(); onMoveTo(file, folder); }}
          onMoveToNew={() => { onClose(); onMoveToNewFolder(file); }}
          t={t}
        />
      )}
      <MMenu.Divider />
      {/* Three groups, as Apple's HIG asks: the file's own places (Finder, Open With ▸, Copy ▸,
          Export ▸) share one, their variants live one level down. */}
      <MMenu.Item
        leftSection={<FolderOpen size={13} />}
        rightSection={<ShortcutHint combo={revealCombo} />}
        onClick={() => run(fileApi.showInFolder)}
      >
        {t(isMac ? 'context.showInFolder.mac' : 'context.showInFolder')}
      </MMenu.Item>
      <MMenu.Sub position={SUB_POSITION}>
        <MMenu.Sub.Target>
          <MMenu.Sub.Item leftSection={<ExternalLink size={13} />}>{t('context.openMenu')}</MMenu.Sub.Item>
        </MMenu.Sub.Target>
        <MMenu.Sub.Dropdown>
          <MMenu.Item leftSection={<ExternalLink size={13} />} onClick={() => run(fileApi.openPath)}>
            {t('context.openDefault')}
          </MMenu.Item>
          {hostPlatform !== 'linux' && (
            <MMenu.Item leftSection={<AppWindow size={13} />} onClick={() => run(fileApi.openWith)}>
              {t(isMac ? 'context.openWith.mac' : 'context.openWith')}
            </MMenu.Item>
          )}
        </MMenu.Sub.Dropdown>
      </MMenu.Sub>
      <MMenu.Sub position={SUB_POSITION}>
        <MMenu.Sub.Target>
          <MMenu.Sub.Item leftSection={<Copy size={13} />}>{t('context.copyMenu')}</MMenu.Sub.Item>
        </MMenu.Sub.Target>
        <MMenu.Sub.Dropdown>
          <MMenu.Item leftSection={<Link2 size={13} />} onClick={() => run((path) => copyPathWithNotice(path, t))}>
            {t('context.copyPath')}
          </MMenu.Item>
          <MMenu.Item leftSection={<Files size={13} />} onClick={() => run((path) => copyFilesWithNotice([path], t))}>
            {t('context.copyFile')}
          </MMenu.Item>
          <MMenu.Item leftSection={<Copy size={13} />} onClick={() => run((path) => copyFullTextWithNotice(path, t))}>
            {t('context.copyContent')}
          </MMenu.Item>
        </MMenu.Sub.Dropdown>
      </MMenu.Sub>
      <MMenu.Sub position={SUB_POSITION}>
        <MMenu.Sub.Target>
          <MMenu.Sub.Item leftSection={<Upload size={13} />}>{t('header.menu.export')}</MMenu.Sub.Item>
        </MMenu.Sub.Target>
        <MMenu.Sub.Dropdown>
          {/* Under "Export ▸" the rows name only the format; the flat select-mode menu keeps "Export as …". */}
          <MMenu.Item
            leftSection={<FileText size={13} />}
            disabled={exportBusy}
            onClick={() => { onClose(); onExportCards('pdf', file); }}
          >
            {t('context.export.pdf')}
          </MMenu.Item>
          <MMenu.Item
            leftSection={<Image size={13} />}
            disabled={exportBusy}
            onClick={() => { onClose(); onExportCards('png', file); }}
          >
            {t('context.export.png')}
          </MMenu.Item>
          <MMenu.Item leftSection={<FileCode size={13} />} onClick={() => run((path) => exportConversationMarkdown(path, t))}>
            {t('header.menu.export.markdown')}
          </MMenu.Item>
        </MMenu.Sub.Dropdown>
      </MMenu.Sub>
      <MMenu.Divider />
      <MMenu.Item
        leftSection={<ListChecks size={13} />}
        disabled={!canSelectMultiple}
        onClick={() => onStartSelection(file)}
      >
        {t('selection.selectMultiple')}
      </MMenu.Item>
      <MMenu.Item
        leftSection={<Trash2 size={13} />}
        color="red"
        rightSection={<ShortcutHint combo={deleteCombo} />}
        onClick={() => onDelete(file)}
      >
        {t('common.delete')}
      </MMenu.Item>
    </ContextMenuPortal>
  );
};
