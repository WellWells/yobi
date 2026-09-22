import React, { useEffect, useMemo, useRef } from 'react';
import { Box } from '@mantine/core';
import { Workflow } from 'lucide-react';
import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { FlowDefinition } from '../../../../shared/types';
import type { FlowIssue } from '../../../../shared/flowIssues';
import { FlowSidebarItem } from './FlowSidebarItem';
import { useFlowIssues } from '../../hooks/useFlowIssues';
import { useFlowSensors } from './dnd';
import { EmptyState } from '../../components/EmptyState';
import styles from './FlowSidebarItem.module.css';

const LONG_PRESS_MS = 500;

/** Shared empty array so a healthy row does not get a new prop identity each render. */
const EMPTY_ISSUES: FlowIssue[] = [];

/**
 * Bring the row of `flowId` into view inside `container`.
 * `block: 'nearest'` leaves an already-visible row untouched, so this never
 * yanks the list while the user is reading it.
 * Exported for the test suite.
 */
export function scrollFlowRowIntoView(container: HTMLElement | null, flowId: string): void {
  if (!container) return;
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-flow-id]'));
  const row = rows.find((el) => el.dataset.flowId === flowId);
  row?.scrollIntoView({ block: 'nearest' });
}

export interface FlowSidebarListProps {
  flows: FlowDefinition[];
  selectedFlowId: string | null;
  runningFlowIds: string[];
  t: (k: string) => string;
  selectMode: boolean;
  isSelected: (flowId: string) => boolean;
  onToggleSelect: (flowId: string) => void;
  onRowClick: (flowId: string, mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  onContextMenu: (e: React.MouseEvent, flowId: string) => void;
  onToggleEnabled: (flow: FlowDefinition, enabled: boolean) => void;
  onReorder: (orderedIds: string[]) => void;
}

const SortableFlowRow: React.FC<{
  flow: FlowDefinition;
  renderItem: (flow: FlowDefinition) => React.ReactNode;
}> = ({ flow, renderItem }) => {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: flow.id });
  return (
    <Box
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={styles.sortableWrap}
      data-dragging={isDragging || undefined}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
        zIndex: isDragging ? 2 : undefined,
        opacity: isDragging ? 0.9 : 1,
        cursor: isDragging ? 'grabbing' : undefined,
      }}
    >
      {renderItem(flow)}
    </Box>
  );
};

export const FlowSidebarList: React.FC<FlowSidebarListProps> = ({
  flows, selectedFlowId, runningFlowIds, t,
  selectMode, isSelected, onToggleSelect,
  onRowClick, onContextMenu, onToggleEnabled, onReorder,
}) => {
  const sensors = useFlowSensors({ delay: LONG_PRESS_MS });
  const ids = useMemo(() => flows.map((f) => f.id), [flows]);
  const listRef = useRef<HTMLDivElement>(null);
  // Read from the store rather than the `flows` prop: which flow wins a duplicated
  // command depends on the whole list, so a filtered view would name the wrong one.
  const issues = useFlowIssues();

  // A newly created / duplicated / imported flow is selected while sitting below
  // the fold, so follow the selection with the scroll position.
  useEffect(() => {
    if (!selectedFlowId) return;
    scrollFlowRowIntoView(listRef.current, selectedFlowId);
  }, [selectedFlowId]);

  const renderItem = (flow: FlowDefinition): React.ReactNode => (
    <FlowSidebarItem
      flow={flow}
      selected={selectedFlowId === flow.id}
      isRunning={runningFlowIds.includes(flow.id)}
      issues={issues.get(flow.id) ?? EMPTY_ISSUES}
      t={t}
      selectMode={selectMode}
      checked={isSelected(flow.id)}
      onToggleSelect={() => onToggleSelect(flow.id)}
      onRowClick={(mods) => onRowClick(flow.id, mods)}
      onContextMenu={(e) => onContextMenu(e, flow.id)}
      onToggleEnabled={(enabled) => onToggleEnabled(flow, enabled)}
    />
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <Box ref={listRef} flex={1} style={{ overflowY: 'auto', padding: '4px 0' }}>
      {flows.length === 0 ? (
        <EmptyState icon={Workflow} label={t('flow.flowList.empty')} />
      ) : selectMode ? (
        flows.map((flow) => <React.Fragment key={flow.id}>{renderItem(flow)}</React.Fragment>)
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {flows.map((flow) => <SortableFlowRow key={flow.id} flow={flow} renderItem={renderItem} />)}
          </SortableContext>
        </DndContext>
      )}
    </Box>
  );
};
