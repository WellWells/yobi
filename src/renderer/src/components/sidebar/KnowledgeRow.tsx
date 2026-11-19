import React, { useState } from 'react';
import { isInternalFileDrag } from '../../utils/internalFileDrag';
import { Box, Group, Text, Tooltip } from '@mantine/core';
import { Library, TriangleExclamationPoint } from 'lucide-react';
import type { KnowledgeStatus } from '../../../../shared/knowledgeStatus';
import { useKnowledgeStore } from '../../store/useKnowledgeStore';
import type { SidebarKnowledgeBase } from '../../utils/timeGroups';
import { knowledgeRowKey } from '../../utils/timeGroups';
import { RenameInput } from '../RenameInput';
import { RowMoreButton } from '../RowMoreButton';
import type { MenuAnchor } from '../RowMoreButton';
import styles from '../Sidebar.module.css';

interface KnowledgeRowProps {
  base: SidebarKnowledgeBase;
  isRenaming: boolean;
  renameText: string;
  setRenameText: (text: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  menuOpen: boolean;
  moreLabel: string;
  /** What the status mark says on hover: the folder is gone, or files had no text. */
  warningFor: (status: KnowledgeStatus | undefined) => string | null;
  /** Its page is open in the main area. */
  selected: boolean;
  /** Files dropped on the row from outside the app: added to the base. */
  onDropFiles: (base: SidebarKnowledgeBase, files: File[]) => void;
  onOpen: (base: SidebarKnowledgeBase) => void;
  onOpenMenu: (e: React.MouseEvent<HTMLElement>, base: SidebarKnowledgeBase) => void;
  onOpenMenuAt: (base: SidebarKnowledgeBase, at: MenuAnchor) => void;
  registerItemRef?: (key: string, node: HTMLDivElement | null) => void;
  /** The list's one Tab stop (roving focus: the arrows walk the rest). */
  tabbable: boolean;
}

/**
 * A knowledge base in the sidebar, drawn like a folder row: its icon, name and — at the right end,
 * where a folder has its count — the indexing progress or a warning. A click opens the base's page
 * (its files, as a ChatGPT project or a NotebookLM notebook opens its own); files dropped on it from
 * outside are added to it; "⋯" and right-click open its menu; renaming happens in place.
 */
function KnowledgeRowView({
  base, isRenaming, renameText, setRenameText, onCommitRename, onCancelRename,
  menuOpen, moreLabel, warningFor, selected, onDropFiles, onOpen, onOpenMenu, onOpenMenuAt, registerItemRef, tabbable,
}: KnowledgeRowProps): React.ReactElement {
  // Its own status, read here: indexing reports after every file, and read by the sidebar each
  // report redrew the whole sidebar.
  const status = useKnowledgeStore((s) => s.statuses[base.id]);
  const warning = warningFor(status);
  const indexing = status?.state === 'indexing';
  const [dropOver, setDropOver] = useState(false);
  const takesDrop = (event: React.DragEvent): boolean => (
    Array.from(event.dataTransfer?.types ?? []).includes('Files') && !isInternalFileDrag()
  );
  return (
    <Box
      ref={(node: HTMLDivElement | null) => registerItemRef?.(knowledgeRowKey(base.id), node)}
      tabIndex={tabbable ? 0 : -1}
      role="treeitem"
      aria-level={2}
      aria-selected={selected}
      className={styles.folderItem}
      data-menu-open={menuOpen || undefined}
      data-editing={String(isRenaming)}
      data-selected={String(selected)}
      data-drop-target={String(dropOver)}
      onClick={() => { if (!isRenaming) onOpen(base); }}
      onContextMenu={(e) => onOpenMenu(e, base)}
      onDragOver={(event) => {
        if (!takesDrop(event)) return;
        event.preventDefault();
        // Over the row, it is the row's drop, not the chat's attach zone underneath.
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        if (!dropOver) setDropOver(true);
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={(event) => {
        setDropOver(false);
        if (!takesDrop(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) onDropFiles(base, files);
      }}
    >
      <Group gap={8} wrap="nowrap">
        <Library size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        {isRenaming ? (
          <RenameInput
            autoFocus
            value={renameText}
            onChange={setRenameText}
            ai={null}
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
          <Text fz="var(--font-size-base)" lh={1.4} flex={1} truncate title={base.name}>{base.name}</Text>
        )}
        {!isRenaming && warning && (
          <Tooltip label={warning} position="bottom" multiline maw={260}>
            <TriangleExclamationPoint size={13} color="var(--warning-text)" style={{ flexShrink: 0 }} aria-label={warning} />
          </Tooltip>
        )}
        {!isRenaming && indexing && status && status.total > 0 && (
          <Text component="span" fz="var(--font-size-xs)" className={`${styles.timestamp} ${styles.folderCount}`}>
            {`${status.done}/${status.total}`}
          </Text>
        )}
      </Group>
      {!isRenaming && (
        <RowMoreButton
          label={moreLabel}
          menuOpen={menuOpen}
          onOpen={(at) => onOpenMenuAt(base, at)}
          className={styles.folderMore}
          pointerOnly
        />
      )}
    </Box>
  );
}

export const KnowledgeRow = React.memo(KnowledgeRowView);
