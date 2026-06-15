import React from 'react';
import { Badge, Box, Flex, Stack, Text } from '@mantine/core';
import { Circle } from 'lucide-react';
import type { OutputFile } from '../../../../shared/types';
import { AppTextInput } from '../AppTextInput';
import styles from '../Sidebar.module.css';

export type EditMode = 'filename' | 'h1' | null;

interface FileItemProps {
  file: OutputFile;
  selected: boolean;
  unread: boolean;
  unreadLabel: string;
  isEditing: boolean;
  editingMode: EditMode;
  editingText: string;
  setEditingText: (title: string) => void;
  onSelect: (f: OutputFile) => void | Promise<void>;
  onOpenMenu: (e: React.MouseEvent<HTMLElement>, f: OutputFile) => void;
  onCommitEdit: () => Promise<void>;
  onCancelEdit: () => void;
  formatTime: (ts: string) => string;
  registerItemRef: (path: string, node: HTMLDivElement | null) => void;
}

export const FileItem: React.FC<FileItemProps> = React.memo(({
  file, selected, unread, unreadLabel, isEditing, editingMode, editingText,
  setEditingText, onSelect, onOpenMenu, onCommitEdit, onCancelEdit, formatTime, registerItemRef,
}) => {
  return (
    <Stack
      gap={3}
      ref={(node) => registerItemRef(file.path, node as HTMLDivElement | null)}
      tabIndex={0}
      onClick={() => { if (!isEditing) void onSelect(file); }}
      onContextMenu={(e) => onOpenMenu(e, file)}
      aria-selected={selected}
      data-selected={String(selected)}
      data-editing={String(isEditing)}
      className={styles.fileItem}
    >
      <Flex align="center" gap={6}>
        {file.provider && (
          <Badge
            variant="outline"
            size="s"
            radius="xl"
            tt="none"
            fw={500} fz="var(--font-size-sm)" lh={1.6} px={6} py={1}
            data-selected={String(selected)}
            className={styles.providerBadge}
          >
            {file.provider}
          </Badge>
        )}
        <Text
          component="span"
          fz="var(--font-size-xs)"
          data-selected={String(selected)}
          className={styles.timestamp}
        >
          {formatTime(file.timestamp)}
        </Text>
        {unread && (
          <Box ml="auto">
            <Circle size={9} fill="var(--mantine-color-accent)" stroke="var(--mantine-color-accent)" strokeWidth={1.5} aria-label={unreadLabel} />
          </Box>
        )}
      </Flex>

      {isEditing && editingMode === 'h1' ? (
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
          fz="var(--font-size-xs)"
          title={file.name}
          className={styles.preview}
        >
          {file.preview || '...'}
        </Text>
      )}
    </Stack>
  );
});
