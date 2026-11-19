import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mantine/core';
import { FolderPlus, Sparkles, Workflow } from 'lucide-react';
import {
  closestCenter, DndContext, DragOverlay, pointerWithin, useDroppable,
  type CollisionDetection, type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { FlowDefinition } from '../../../../shared/types';
import type { FlowIssue } from '../../../../shared/flowIssues';
import type { FlowFolder } from '../../../../shared/flowFolders';
import { categoryAiSource } from '../../../../shared/aiName';
import type { AiNameSource } from '../../../../shared/aiName';
import { MemoFlowSidebarItem, type FlowRowHandlers } from './MemoFlowSidebarItem';
import { FlowAttentionMark } from './FlowAttentionMark';
import { useFlowIssues } from '../../hooks/useFlowIssues';
import { useFlowLastRuns, useFlowNextRuns } from './useFlowRowFacts';
import { flowRowStatus } from './flowRowStatus';
import {
  FLOWS_SECTION_DROP_ID, attentionOf, dragOutcome, flowFolderDropId, folderOfDropId, folderOfFlow, isFlowDropTargetId,
} from './flowSidebarRows';
import type { FlowSectionKey, FlowSidebarRow } from './flowSidebarRows';
import { useScrollEdgeFade } from '../../hooks/useScrollEdgeFade';
import { useDndAccessibility, useFlowSensors } from './dnd';
import { flowRowKey, flowTreeKeys, handleFlowTreeKey } from './flowSidebarKeys';
import { useRovingRow } from '../../components/sidebar/useRovingRow';
import { folderRowKey } from '../../utils/sidebarOrder';
import { sectionRowKey } from '../../utils/timeGroups';
import { EmptyState } from '../../components/EmptyState';
import { SectionRow } from '../../components/sidebar/SectionRow';
import { FolderRow } from '../../components/sidebar/FolderRow';
import { SectionActionButton } from '../../components/sidebar/SectionActionButton';
import type { MenuAnchor } from '../../components/RowMoreButton';
import styles from './FlowSidebarItem.module.css';

const LONG_PRESS_MS = 500;

/** Shared empty array so a healthy row does not get a new prop identity each render. */
const EMPTY_ISSUES: FlowIssue[] = [];
/** A flow in a category the ✨ names: its name and this much of its description. */
const FLOW_ITEM_DESCRIPTION_CHARS = 60;

/**
 * Bring the row of `flowId` into view inside `container`. `block: 'nearest'` leaves an
 * already-visible row untouched, so this never yanks the list while the user is reading it.
 */
export function scrollFlowRowIntoView(container: HTMLElement | null, flowId: string): boolean {
  if (!container) return false;
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-flow-id]'));
  const row = rows.find((el) => el.dataset.flowId === flowId);
  row?.scrollIntoView({ block: 'nearest' });
  return Boolean(row);
}

/**
 * Follows the selection with the scroll position: a newly created / duplicated / imported flow is
 * selected below the fold, and one picked from search may be in a closed folder that opens on a
 * later render. So the scroll waits for the row to be drawn (`rows` changes), then happens once.
 */
export function useFollowSelectedRow(
  listRef: React.RefObject<HTMLElement | null>,
  selectedFlowId: string | null,
  rows: unknown,
): void {
  const pending = useRef<string | null>(null);
  useEffect(() => {
    pending.current = selectedFlowId;
  }, [selectedFlowId]);
  useEffect(() => {
    const flowId = pending.current;
    if (!flowId || flowId !== selectedFlowId) return;
    if (scrollFlowRowIntoView(listRef.current, flowId)) pending.current = null;
  }, [listRef, selectedFlowId, rows]);
}

/**
 * A folder row or the flows heading under the pointer takes the drop (into that folder, out to the
 * top level); otherwise the flow row nearest the dragged one does.
 */
const collision: CollisionDetection = (args) => {
  const targets = args.droppableContainers.filter((container) => isFlowDropTargetId(String(container.id)));
  const hit = pointerWithin({ ...args, droppableContainers: targets });
  if (hit.length > 0) return hit;
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((container) => !isFlowDropTargetId(String(container.id))),
  });
};

/** Folder rows and section headings have no list walk: their own keys open and close them. */
function toggleKeys(e: React.KeyboardEvent<HTMLElement>, expanded: boolean, toggle: () => void): void {
  if (e.target !== e.currentTarget.querySelector('[aria-expanded]')) return;
  const wanted = e.key === 'Enter' || e.key === ' ' ? !expanded
    : e.key === 'ArrowRight' ? true
      : e.key === 'ArrowLeft' ? false : null;
  if (wanted === null) return;
  e.preventDefault();
  if (wanted !== expanded) toggle();
}

export interface FlowFolderRowUi {
  renaming: string | null;
  renameText: string;
  setRenameText: (text: string) => void;
  commitRename: () => void;
  cancelRename: () => void;
  /** The folder whose menu is open, if any. */
  menuName: string | null;
  openMenu: (e: React.MouseEvent<HTMLElement>, folder: FlowFolder, flowIds: string[]) => void;
  openMenuAt: (folder: FlowFolder, flowIds: string[], at: MenuAnchor) => void;
  onToggleFolder: (name: string) => void;
  onToggleSection: (key: FlowSectionKey) => void;
  onNewFolder: () => void;
  /** Opens "smart sort" for the flows in no folder; unset when every flow is already filed. */
  onSmartSort?: () => void;
  /** `folder`: '' = the top level. */
  onMove: (flowIds: string[], folder: string, before?: string) => void;
}

export interface FlowSidebarListProps {
  flows: FlowDefinition[];
  rows: FlowSidebarRow[];
  folders: FlowFolder[];
  folderUi: FlowFolderRowUi;
  selectedFlowId: string | null;
  runningFlowIds: string[];
  t: (k: string) => string;
  selectMode: boolean;
  isSelected: (flowId: string) => boolean;
  onToggleSelect: (flowId: string) => void;
  onRowClick: (flowId: string, mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  onContextMenu: (e: React.MouseEvent, flowId: string) => void;
  /** A row's "⋯" button or swipe "More": the right-click menu, at a point. */
  onOpenMenuAt: (flowId: string, at: MenuAnchor) => void;
  /** The flow whose menu is open, if any. */
  menuFlowId: string | null;
  onToggleEnabled: (flow: FlowDefinition, enabled: boolean) => void;
  onDelete: (flowId: string) => void;
  onReorder: (orderedIds: string[]) => void;
}

const SortableFlowRow: React.FC<{
  flow: FlowDefinition;
  renderItem: (flow: FlowDefinition, inFolder?: string) => React.ReactNode;
  inFolder?: string;
  /** The tree's one Tab stop (roving focus). */
  tabbable: boolean;
  selected: boolean;
  registerItemRef: (key: string, node: HTMLDivElement | null) => void;
}> = ({ flow, renderItem, inFolder, tabbable, selected, registerItemRef }) => {
  // A tree item (not dnd-kit's default role="button", which may not hold the row's switch: axe
  // nested-interactive), still the sortable's handle.
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: flow.id, attributes: { role: 'treeitem', tabIndex: tabbable ? 0 : -1 } });
  const ref = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
    registerItemRef(flowRowKey(flow.id), node);
  }, [setNodeRef, registerItemRef, flow.id]);
  // While dragged, the row stays in its list as the placeholder; the copy in the overlay moves.
  return (
    <Box
      ref={ref}
      {...attributes}
      {...listeners}
      aria-selected={selected}
      aria-level={inFolder ? 3 : 2}
      className={styles.sortableWrap}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      {renderItem(flow, inFolder)}
    </Box>
  );
};

/** A drop target that is not a flow: a folder row (into it) or the flows heading (out to the top level). */
const DropZone: React.FC<{ id: string; disabled: boolean; children: React.ReactNode }> = ({ id, disabled, children }) => {
  const { setNodeRef } = useDroppable({ id, disabled });
  return <Box ref={setNodeRef}>{children}</Box>;
};

/** The flows of one list (a folder's, or the top level's), each list sortable on its own. */
interface FlowRun { key: string; inFolder?: string; flows: FlowDefinition[] }

export const FlowSidebarList: React.FC<FlowSidebarListProps> = ({
  flows, rows, folders, folderUi, selectedFlowId, runningFlowIds, t,
  selectMode, isSelected, onToggleSelect,
  onRowClick, onContextMenu, onOpenMenuAt, menuFlowId, onToggleEnabled, onDelete, onReorder,
}) => {
  const sensors = useFlowSensors({ delay: LONG_PRESS_MS, enterOpens: true });
  // Drag announcements name a flow, a category, or the "Flows" heading — never a raw id.
  const dragNameOf = useCallback((id: string): string | null => {
    if (id === FLOWS_SECTION_DROP_ID) return t('flow.section.flows');
    const folder = folderOfDropId(id);
    if (folder !== null) return folder;
    return flows.find((flow) => flow.id === id)?.name ?? null;
  }, [flows, t]);
  const dndAccessibility = useDndAccessibility(dragNameOf, t);
  // Rows by key, for the tree's keys and its roving Tab stop.
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const registerItemRef = useCallback((key: string, node: HTMLElement | null) => {
    if (node) itemRefs.current.set(key, node);
    else itemRefs.current.delete(key);
  }, []);
  const treeKeys = useMemo(() => flowTreeKeys(rows), [rows]);
  const rowKeyOf = useCallback((node: Element): string | null => {
    const item = node.closest('[role="treeitem"]');
    for (const [key, el] of itemRefs.current.entries()) if (el === item) return key;
    return null;
  }, []);
  const roving = useRovingRow(treeKeys, selectedFlowId ? flowRowKey(selectedFlowId) : null, rowKeyOf);
  // While selecting, every row stays a stop (the checkboxes carry the keys then).
  const isTabStop = (key: string): boolean => selectMode || roving.tabKey === key;
  const listRef = useRef<HTMLDivElement>(null);
  const fadeClass = useScrollEdgeFade(listRef);
  const [overId, setOverId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Read from the store rather than the `flows` prop: which flow wins a duplicated
  // command depends on the whole list, so a filtered view would name the wrong one.
  const issues = useFlowIssues();
  const lastRuns = useFlowLastRuns();
  const nextRuns = useFlowNextRuns();

  useFollowSelectedRow(listRef, selectedFlowId, rows);

  // A closed folder or section shows the warning and running marks of the flows it hides.
  const attentionFor = useCallback((flowIds: readonly string[]) => attentionOf(
    flowIds,
    flows,
    (id) => (issues.get(id)?.length ?? 0) > 0 || ['error', 'warning'].includes(flowRowStatus({ last: lastRuns[id] }, t)?.tone ?? ''),
    (id) => runningFlowIds.includes(id),
  ), [flows, issues, lastRuns, runningFlowIds, t]);

  const handlers = useRef<FlowRowHandlers>({ onToggleSelect, onRowClick, onContextMenu, onOpenMenuAt, onToggleEnabled, onDelete });
  handlers.current = { onToggleSelect, onRowClick, onContextMenu, onOpenMenuAt, onToggleEnabled, onDelete };

  const renderItem = (flow: FlowDefinition, inFolder?: string): React.ReactNode => (
    <MemoFlowSidebarItem
      handlers={handlers}
      flow={flow}
      indented={Boolean(inFolder)}
      selected={selectedFlowId === flow.id}
      isRunning={runningFlowIds.includes(flow.id)}
      issues={issues.get(flow.id) ?? EMPTY_ISSUES}
      status={flowRowStatus({ last: lastRuns[flow.id], next: nextRuns[flow.id] }, t)}
      t={t}
      selectMode={selectMode}
      checked={isSelected(flow.id)}
      menuOpen={menuFlowId === flow.id}
      tabStop={isTabStop(flowRowKey(flow.id))}
    />
  );

  const renderHeading = (row: Extract<FlowSidebarRow, { kind: 'section' }>, first: boolean): React.ReactNode => {
    const heading = (
      <Box
        className={styles.groupRow}
        data-section-gap={!first || undefined}
        data-drop-target={(row.key === 'flows' && overId === FLOWS_SECTION_DROP_ID) || undefined}
        onKeyDown={(e) => toggleKeys(e, !row.collapsed, () => folderUi.onToggleSection(row.key))}
      >
        <SectionRow
          section={row.key}
          label={t(row.key === 'folders' ? 'sidebar.section.folders' : 'flow.section.flows')}
          collapsed={row.collapsed}
          empty={row.empty}
          status={row.collapsed ? <FlowAttentionMark {...attentionFor(row.flowIds)} t={t} /> : undefined}
          actions={row.key === 'folders' && !selectMode
            ? (
              <>
                {folderUi.onSmartSort && <SectionActionButton icon={Sparkles} label={t('flow.folder.sort.title')} onClick={folderUi.onSmartSort} />}
                <SectionActionButton icon={FolderPlus} label={t('sidebar.folder.new')} onClick={folderUi.onNewFolder} />
              </>
            )
            : undefined}
          onToggle={folderUi.onToggleSection}
          registerItemRef={registerItemRef}
          tabbable={isTabStop(sectionRowKey(row.key))}
        />
      </Box>
    );
    if (row.key !== 'flows') return heading;
    return <DropZone id={FLOWS_SECTION_DROP_ID} disabled={selectMode}>{heading}</DropZone>;
  };

  // The ✨ in a category's rename box names it from its flows: each one's name and how it begins.
  const folderAiSource = (name: string, flowIds: readonly string[]): AiNameSource | null => {
    const byId = new Map(flows.map((flow) => [flow.id, flow]));
    const items = flowIds.flatMap((id) => {
      const flow = byId.get(id);
      if (!flow) return [];
      const description = flow.description?.trim().slice(0, FLOW_ITEM_DESCRIPTION_CHARS);
      return [description ? `${flow.name} — ${description}` : flow.name];
    });
    return categoryAiSource('flow', name, items, folders.map((folder) => folder.name));
  };

  const renderFolder = (row: Extract<FlowSidebarRow, { kind: 'folder' }>): React.ReactNode => {
    const { folder, flowIds, expanded } = row;
    const dropId = flowFolderDropId(folder.name);
    return (
      <DropZone id={dropId} disabled={selectMode}>
        <Box className={styles.groupRow} onKeyDown={(e) => toggleKeys(e, expanded, () => folderUi.onToggleFolder(folder.name))}>
          <FolderRow
            folder={folder}
            label={folder.name}
            count={flowIds.length}
            expanded={expanded}
            isRenaming={folderUi.renaming === folder.name}
            renameText={folderUi.renameText}
            setRenameText={folderUi.setRenameText}
            onCommitRename={folderUi.commitRename}
            onCancelRename={folderUi.cancelRename}
            aiSource={folderUi.renaming === folder.name ? folderAiSource(folder.name, flowIds) : null}
            menuOpen={folderUi.menuName === folder.name}
            moreLabel={t('common.moreActions')}
            dropTarget={overId === dropId}
            status={expanded ? undefined : <FlowAttentionMark {...attentionFor(flowIds)} t={t} />}
            onToggle={() => folderUi.onToggleFolder(folder.name)}
            onOpenMenu={(e) => { if (!selectMode) folderUi.openMenu(e, folder, flowIds); }}
            onOpenMenuAt={(_, at) => folderUi.openMenuAt(folder, flowIds, at)}
            registerItemRef={registerItemRef}
            tabbable={isTabStop(folderRowKey(folder.name))}
          />
        </Box>
      </DropZone>
    );
  };

  // The rows in order, the flow rows of each list gathered so each list is sortable on its own.
  const blocks = useMemo(() => {
    const out: (FlowSidebarRow | FlowRun)[] = [];
    for (const row of rows) {
      if (row.kind !== 'flow') { out.push(row); continue; }
      const last = out[out.length - 1];
      if (last && 'flows' in last && last.inFolder === row.inFolder) last.flows.push(row.flow);
      else out.push({ key: `run:${row.inFolder ?? ''}`, inFolder: row.inFolder, flows: [row.flow] });
    }
    return out;
  }, [rows]);

  const endDrag = (): void => {
    setOverId(null);
    setActiveId(null);
  };

  const activeFlow = activeId ? flows.find((flow) => flow.id === activeId) ?? null : null;

  const handleDragEnd = (e: DragEndEvent) => {
    endDrag();
    const { active, over } = e;
    if (!over) return;
    const outcome = dragOutcome(String(active.id), String(over.id), flows, folders);
    if (!outcome) return;
    if (outcome.kind === 'reorder') onReorder(outcome.order);
    else folderUi.onMove([String(active.id)], outcome.folder, outcome.before);
  };

  const renderBlocks = (): React.ReactNode => blocks.map((block, index) => {
    if ('flows' in block) {
      const items = block.flows.map((flow) => flow.id);
      // While selecting, the row's checkbox is the stop; the row is still the tree's item.
      if (selectMode) {
        return block.flows.map((flow) => (
          <Box key={flow.id} role="treeitem" aria-level={block.inFolder ? 3 : 2} aria-selected={isSelected(flow.id)}>
            {renderItem(flow, block.inFolder)}
          </Box>
        ));
      }
      return (
        <SortableContext key={block.key} items={items} strategy={verticalListSortingStrategy}>
          {block.flows.map((flow) => (
            <SortableFlowRow
              key={flow.id}
              flow={flow}
              inFolder={block.inFolder}
              renderItem={renderItem}
              tabbable={isTabStop(flowRowKey(flow.id))}
              selected={selectedFlowId === flow.id}
              registerItemRef={registerItemRef}
            />
          ))}
        </SortableContext>
      );
    }
    if (block.kind === 'section') return <React.Fragment key={`section:${block.key}`}>{renderHeading(block, index === 0)}</React.Fragment>;
    if (block.kind === 'folder') return <React.Fragment key={`folder:${block.folder.name}`}>{renderFolder(block)}</React.Fragment>;
    return null;
  });

  return (
    <Box
      ref={listRef}
      flex={1}
      className={fadeClass}
      style={{ overflowY: 'auto', padding: '4px 0' }}
      // A tree (WCAG 1.3.1, 4.1.2), one Tab stop whose arrows walk it (2.1.1, 2.4.3).
      role={rows.length > 0 ? 'tree' : undefined}
      aria-label={rows.length > 0 ? t('a11y.c.flowList') : undefined}
      aria-multiselectable={(rows.length > 0 && selectMode) || undefined}
      onFocus={roving.onFocus}
      onKeyDown={selectMode ? undefined : (e) => handleFlowTreeKey(e, {
        rows,
        refs: itemRefs.current,
        dragging: activeId !== null,
        openFlow: (flowId) => onRowClick(flowId, { ctrlKey: false, metaKey: false, shiftKey: false }),
        openFlowMenu: onOpenMenuAt,
        openFolderMenu: folderUi.openMenuAt,
      })}
    >
      {rows.length === 0 ? (
        <EmptyState icon={Workflow} label={t('flow.flowList.empty')} />
      ) : selectMode ? (
        renderBlocks()
      ) : (
        <DndContext
          sensors={sensors}
          accessibility={dndAccessibility}
          collisionDetection={collision}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={(e) => setActiveId(String(e.active.id))}
          onDragOver={(e: DragOverEvent) => setOverId(e.over ? String(e.over.id) : null)}
          onDragCancel={endDrag}
          onDragEnd={handleDragEnd}
        >
          {renderBlocks()}
          {/* No drop animation: a drop into another list redraws the row there, not back home. */}
          <DragOverlay modifiers={[restrictToVerticalAxis]} dropAnimation={null}>
            {activeFlow && (
              <Box className={styles.sortableWrap} data-dragging aria-hidden style={{ cursor: 'grabbing' }}>
                {renderItem(activeFlow, folderOfFlow(folders, activeFlow.id) || undefined)}
              </Box>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </Box>
  );
};
