import React from 'react';
import { Box, Group, Text } from '@mantine/core';
import { ChevronRight, Folder } from 'lucide-react';
import type { ConversationFolder } from '../../../../shared/conversationFolders';
import { AppTextInput } from '../AppTextInput';
import { RowMoreButton } from '../RowMoreButton';
import type { MenuAnchor } from '../RowMoreButton';
import { folderRowKey } from '../../utils/sidebarOrder';
import styles from '../Sidebar.module.css';

interface FolderRowProps {
  folder: ConversationFolder;
  /** The name it is shown under (Yobi's flow results folder is translated). */
  label: string;
  count: number;
  expanded: boolean;
  isRenaming: boolean;
  renameText: string;
  setRenameText: (text: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  /** Its menu is open (the "⋯" stays visible). */
  menuOpen: boolean;
  moreLabel: string;
  /** Conversations dragged over it would be filed here. */
  dropTarget: boolean;
  onToggle: (folder: ConversationFolder) => void;
  onOpenMenu: (e: React.MouseEvent<HTMLElement>, folder: ConversationFolder) => void;
  onOpenMenuAt: (folder: ConversationFolder, at: MenuAnchor) => void;
  registerItemRef: (key: string, node: HTMLDivElement | null) => void;
}

/**
 * A folder in the conversation list (Apple Notes' sidebar): chevron, folder, name and how many
 * conversations are in it. A click opens or closes it; its "⋯" and right-click open the folder
 * menu; renaming happens in place, like a conversation's title.
 */
export const FolderRow: React.FC<FolderRowProps> = React.memo(({
  folder, label, count, expanded, isRenaming, renameText, setRenameText, onCommitRename, onCancelRename,
  menuOpen, moreLabel, dropTarget, onToggle, onOpenMenu, onOpenMenuAt, registerItemRef,
}) => (
  <Box
    ref={(node: HTMLDivElement | null) => registerItemRef(folderRowKey(folder.name), node)}
    tabIndex={0}
    aria-expanded={expanded}
    className={styles.folderItem}
    data-menu-open={menuOpen || undefined}
    data-drop-target={dropTarget || undefined}
    data-editing={String(isRenaming)}
    onClick={() => { if (!isRenaming) onToggle(folder); }}
    onContextMenu={(e) => onOpenMenu(e, folder)}
  >
    <Group gap={6} wrap="nowrap">
      <ChevronRight
        size={13}
        color="var(--text-muted)"
        className={styles.folderChevron}
        data-expanded={String(expanded)}
        style={{ flexShrink: 0 }}
      />
      <Folder size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
      {isRenaming ? (
        <AppTextInput
          autoFocus
          value={renameText}
          onChange={(e) => setRenameText(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') { e.preventDefault(); onCommitRename(); }
            else if (e.key === 'Escape') { e.preventDefault(); onCancelRename(); }
          }}
          tone="accent"
          size="xs"
          style={{ flex: 1, minWidth: 0 }}
        />
      ) : (
        <Text fz="var(--font-size-sm)" fw={500} flex={1} truncate title={label}>{label}</Text>
      )}
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
));
