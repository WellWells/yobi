import React, { useMemo, useRef } from 'react';
import { Box, Checkbox, Flex, Stack, Text, Tooltip } from '@mantine/core';
import { Circle } from 'lucide-react';
import type { OutputFile } from '../../../../shared/types';
import type { ModelIcon } from '../../config/models';
import { RenameInput } from '../RenameInput';
import { RowMoreButton } from '../RowMoreButton';
import type { MenuAnchor } from '../RowMoreButton';
import { SwipeRow } from '../SwipeRow';
import { menuAnchorUnderRow, swipeAnchorElement } from '../../utils/rowSwipe';
import { conversationLeadingActions, conversationTrailingActions } from '../../utils/rowSwipeActions';
import type { ConversationSwipeLabels } from '../../utils/rowSwipeActions';
import styles from '../Sidebar.module.css';

interface FileItemProps {
  file: OutputFile;
  selected: boolean;
  unread: boolean;
  unreadLabel: string;
  /** The title (H1) is being edited in place; an editing row always shows its input. */
  isEditing: boolean;
  editingText: string;
  setEditingText: (title: string) => void;
  selectMode: boolean;
  checked: boolean;
  onToggleSelect: (path: string) => void;
  onRowClick: (f: OutputFile, mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  onOpenMenu: (e: React.MouseEvent<HTMLElement>, f: OutputFile) => void;
  /** The hover "⋯" button and the swipe's "More": the same menu as a right-click, at a point. */
  onOpenMenuAt: (f: OutputFile, at: MenuAnchor) => void;
  /** This row's menu is open (the "⋯" stays visible). */
  menuOpen: boolean;
  moreLabel: string;
  /** The row is being dragged out of the window; the OS takes over from here. */
  onDragOut: (f: OutputFile) => void;
  /** The context menu's delete path. */
  onDelete: (f: OutputFile) => void;
  /** The context menu's pin toggle (the right swipe). */
  onTogglePin: (f: OutputFile) => void;
  swipeLabels: ConversationSwipeLabels;
  onCommitEdit: () => Promise<void>;
  onCancelEdit: () => void;
  /** Whose answer it holds (`providerIconFor`). */
  providerIcon: ModelIcon;
  /** The hover card's second line: provider · time · turns, whichever are known. */
  detail: string;
  registerItemRef: (path: string, node: HTMLDivElement | null) => void;
}

/**
 * A saved conversation in the sidebar, one line as in ChatGPT's, Claude's and Perplexity's
 * sidebars: the provider's mark and the title. The provider's name, the time and the number of
 * turns are in the card that opens on hover (and in the conversation itself, ⋮ › info, and the
 * search palette); the row never grows to show them.
 */
export const FileItem: React.FC<FileItemProps> = React.memo(({
  file, selected, unread, unreadLabel, isEditing, editingText, setEditingText,
  selectMode, checked, onToggleSelect,
  onRowClick, onOpenMenu, onOpenMenuAt, menuOpen, moreLabel, onDragOut, onDelete, onTogglePin, swipeLabels,
  onCommitEdit, onCancelEdit, providerIcon: ProviderIcon, detail, registerItemRef,
}) => {
  const highlighted = selectMode ? checked : selected;
  const rowRef = useRef<HTMLDivElement | null>(null);
  // Left swipe (macOS): More, Delete.
  const trailing = useMemo(() => conversationTrailingActions(swipeLabels, {
    onMore: () => {
      const row = rowRef.current;
      if (row) onOpenMenuAt(file, menuAnchorUnderRow(swipeAnchorElement(row).getBoundingClientRect()));
    },
    onDelete: () => onDelete(file),
  }), [swipeLabels, onOpenMenuAt, onDelete, file]);
  // Right swipe (macOS): pin or unpin, as in Apple Notes.
  const leading = useMemo(() => conversationLeadingActions(swipeLabels, {
    onTogglePin: () => onTogglePin(file),
    pinned: Boolean(file.pinned),
  }), [swipeLabels, onTogglePin, file]);
  const title = file.preview || '...';
  const body = (
    <Flex align="center" gap={8} wrap="nowrap" miw={0} flex={1}>
      <Box className={styles.providerMark} data-selected={String(highlighted)} role="img" aria-label={file.provider}>
        <ProviderIcon size={15} />
      </Box>
      {isEditing ? (
        <RenameInput
          autoFocus
          value={editingText}
          onChange={setEditingText}
          ai={{ kind: 'conversation', path: file.path }}
          onClick={(e) => e.stopPropagation()}
          commitOnBlur
          onCommit={() => { void onCommitEdit(); }}
          onCancel={onCancelEdit}
          tone="accent"
          size="xs"
          style={{ flex: 1, minWidth: 0 }}
        />
      ) : (
        <Text fz="var(--font-size-base)" className={styles.preview}>
          {title}
        </Text>
      )}
      {unread && (
        <Box className={styles.unreadDot}>
          <Circle size={9} fill="var(--mantine-color-accent)" stroke="var(--mantine-color-accent)" strokeWidth={1.5} aria-label={unreadLabel} />
        </Box>
      )}
    </Flex>
  );

  const card = (
    <Stack gap={2}>
      <Text fz="var(--font-size-sm)" fw={500}>{title}</Text>
      {detail && <Text fz="var(--font-size-xs)" className={styles.timestamp}>{detail}</Text>}
    </Stack>
  );

  return (
    <SwipeRow leading={leading} trailing={trailing} disabled={selectMode || isEditing}>
    <Tooltip
      label={card}
      position="right"
      multiline
      maw={300}
      disabled={selectMode || isEditing || menuOpen}
    >
    <Stack
      gap={0}
      ref={(node) => {
        rowRef.current = node as HTMLDivElement | null;
        registerItemRef(file.path, node as HTMLDivElement | null);
      }}
      tabIndex={0}
      onClick={(e) => {
        if (isEditing) return;
        onRowClick(file, { ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey });
      }}
      onContextMenu={(e) => onOpenMenu(e, file)}
      draggable={!isEditing}
      onDragStart={(e) => {
        // The browser's own drag would carry text, not the file; main starts a native one.
        e.preventDefault();
        onDragOut(file);
      }}
      aria-selected={highlighted}
      data-selected={String(highlighted)}
      data-editing={String(isEditing)}
      data-menu-open={menuOpen || undefined}
      // Which file the row is, for finding it from outside the list.
      data-file={file.name}
      className={styles.fileItem}
    >
      {!selectMode && !isEditing && (
        <RowMoreButton
          label={moreLabel}
          menuOpen={menuOpen}
          onOpen={(at) => onOpenMenuAt(file, at)}
          className={styles.rowMore}
        />
      )}
      {selectMode ? (
        <Flex align="center" gap={8} wrap="nowrap">
          <Checkbox
            size="xs"
            checked={checked}
            onChange={() => onToggleSelect(file.path)}
            onClick={(e) => e.stopPropagation()}
            aria-label={file.name}
            style={{ flexShrink: 0 }}
          />
          {body}
        </Flex>
      ) : body}
    </Stack>
    </Tooltip>
    </SwipeRow>
  );
});
