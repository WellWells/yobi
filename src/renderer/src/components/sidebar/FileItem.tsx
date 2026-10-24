import React, { useMemo, useRef } from 'react';
import { Box, Checkbox, Flex, Stack, Text } from '@mantine/core';
import { Circle } from 'lucide-react';
import type { OutputFile } from '../../../../shared/types';
import { AppTextInput } from '../AppTextInput';
import { ProviderTag } from '../ProviderTag';
import { RowMoreButton } from '../RowMoreButton';
import type { MenuAnchor } from '../RowMoreButton';
import { SwipeRow } from '../SwipeRow';
import { menuAnchorUnderRow, swipeAnchorElement } from '../../utils/rowSwipe';
import { conversationLeadingActions, conversationTrailingActions } from '../../utils/rowSwipeActions';
import type { ConversationSwipeLabels } from '../../utils/rowSwipeActions';
import styles from '../Sidebar.module.css';
import { fillTemplate } from '../../../../shared/fillTemplate';

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
  timeLabel: string;
  turnsLabel: string;
  registerItemRef: (path: string, node: HTMLDivElement | null) => void;
}

export const FileItem: React.FC<FileItemProps> = React.memo(({
  file, selected, unread, unreadLabel, isEditing, editingText, setEditingText,
  selectMode, checked, onToggleSelect,
  onRowClick, onOpenMenu, onOpenMenuAt, menuOpen, moreLabel, onDragOut, onDelete, onTogglePin, swipeLabels,
  onCommitEdit, onCancelEdit, timeLabel, turnsLabel, registerItemRef,
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
  const body = (
    <>
      <Flex align="center" gap={6}>
        {file.provider && <ProviderTag provider={file.provider} selected={highlighted} />}
        {timeLabel && (
          <Text
            component="span"
            fz="var(--font-size-xs)"
            data-selected={String(highlighted)}
            className={styles.timestamp}
          >
            {timeLabel}
          </Text>
        )}
        {(file.turns ?? 1) > 1 && (
          <Text
            component="span"
            fz="var(--font-size-xs)"
            data-selected={String(highlighted)}
            className={styles.timestamp}
          >
            {fillTemplate(turnsLabel, { count: String(file.turns) })}
          </Text>
        )}
        {unread && (
          <Box ml="auto" className={styles.unreadDot}>
            <Circle size={9} fill="var(--mantine-color-accent)" stroke="var(--mantine-color-accent)" strokeWidth={1.5} aria-label={unreadLabel} />
          </Box>
        )}
      </Flex>

      {isEditing ? (
        <AppTextInput
          autoFocus
          value={editingText}
          onChange={(e) => setEditingText(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => { void onCommitEdit(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void onCommitEdit(); }
            else if (e.key === 'Escape') { e.preventDefault(); onCancelEdit(); }
          }}
          tone="accent"
          size="xs"
        />
      ) : (
        <Text
          fz="var(--font-size-sm)"
          fw={500}
          title={file.name}
          className={styles.preview}
        >
          {file.preview || '...'}
        </Text>
      )}
    </>
  );

  return (
    <SwipeRow leading={leading} trailing={trailing} disabled={selectMode || isEditing}>
    <Stack
      gap={3}
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
        <Flex align="center" gap={8}>
          <Checkbox
            size="xs"
            checked={checked}
            onChange={() => onToggleSelect(file.path)}
            onClick={(e) => e.stopPropagation()}
            aria-label={file.name}
            style={{ flexShrink: 0 }}
          />
          <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>{body}</Stack>
        </Flex>
      ) : body}
    </Stack>
    </SwipeRow>
  );
});
