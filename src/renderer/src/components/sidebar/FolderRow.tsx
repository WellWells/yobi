import React from 'react';
import { Box, Group, Text } from '@mantine/core';
import { Folder, FolderOpen } from 'lucide-react';
import type { ConversationFolder } from '../../../../shared/conversationFolders';
import type { AiNameSource } from '../../../../shared/aiName';
import { RenameInput } from '../RenameInput';
import { RowMoreButton } from '../RowMoreButton';
import type { MenuAnchor } from '../RowMoreButton';
import { folderRowKey } from '../../utils/sidebarOrder';
import styles from '../Sidebar.module.css';

interface FolderRowProps<F extends { name: string }> {
  folder: F;
  /** The name it is shown under (Yobi's flow results folder is translated). */
  label: string;
  count: number;
  expanded: boolean;
  isRenaming: boolean;
  renameText: string;
  setRenameText: (text: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  /** What the rename box's ✨ names it from (asked for only while renaming); null = nothing in it. */
  aiSource: AiNameSource | null;
  /** Its menu is open (the "⋯" stays visible). */
  menuOpen: boolean;
  moreLabel: string;
  /** Conversations dragged over it would be filed here. */
  dropTarget: boolean;
  /** What the closed folder holds that must not hide (the flow list's warning and running marks). */
  status?: React.ReactNode;
  onToggle: (folder: F) => void;
  onOpenMenu: (e: React.MouseEvent<HTMLElement>, folder: F) => void;
  onOpenMenuAt: (folder: F, at: MenuAnchor) => void;
  /** The chat list's keyboard walk; the flow list has none. */
  registerItemRef?: (key: string, node: HTMLDivElement | null) => void;
}

/**
 * A folder in the conversation list: its icon — an open folder while open, as Perplexity's and
 * Gemini's sidebars draw projects and notebooks without a disclosure chevron — the name and how
 * many conversations are in it. A click opens or closes it; its "⋯" and right-click open the
 * folder menu; renaming happens in place, like a conversation's title.
 */
function FolderRowView<F extends { name: string } = ConversationFolder>({
  folder, label, count, expanded, isRenaming, renameText, setRenameText, onCommitRename, onCancelRename, aiSource,
  menuOpen, moreLabel, dropTarget, status, onToggle, onOpenMenu, onOpenMenuAt, registerItemRef,
}: FolderRowProps<F>): React.ReactElement {
  return (
    <Box
      ref={(node: HTMLDivElement | null) => registerItemRef?.(folderRowKey(folder.name), node)}
      tabIndex={0}
      aria-expanded={expanded}
      className={styles.folderItem}
      data-menu-open={menuOpen || undefined}
      data-drop-target={dropTarget || undefined}
      data-editing={String(isRenaming)}
      onClick={() => { if (!isRenaming) onToggle(folder); }}
      onContextMenu={(e) => onOpenMenu(e, folder)}
    >
      <Group gap={8} wrap="nowrap">
        {expanded
          ? <FolderOpen size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          : <Folder size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />}
        {isRenaming ? (
          <RenameInput
            autoFocus
            value={renameText}
            onChange={setRenameText}
            ai={aiSource}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            commitOnBlur
            onCommit={onCommitRename}
            onCancel={onCancelRename}
            tone="accent"
            size="xs"
            style={{ flex: 1, minWidth: 0 }}
          />
        ) : (
          <Text fz="var(--font-size-base)" lh="18px" flex={1} truncate title={label}>{label}</Text>
        )}
        {!isRenaming && status}
        {!isRenaming && (
          <Text component="span" fz="var(--font-size-xs)" className={`${styles.timestamp} ${styles.folderCount}`}>{count}</Text>
        )}
      </Group>
      {!isRenaming && (
        <RowMoreButton
          label={moreLabel}
          menuOpen={menuOpen}
          onOpen={(at) => onOpenMenuAt(folder, at)}
          className={styles.folderMore}
        />
      )}
    </Box>
  );
}

export const FolderRow = React.memo(FolderRowView) as typeof FolderRowView;
