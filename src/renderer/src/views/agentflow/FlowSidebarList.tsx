import React, { useMemo } from 'react';
import { Box, Text } from '@mantine/core';
import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { FlowDefinition } from '../../../../shared/types';
import { FlowSidebarItem } from './FlowSidebarItem';
import { useFlowSensors } from './dnd';

const LONG_PRESS_MS = 500;

export interface FlowSidebarListProps {
  flows: FlowDefinition[];
  visibleFlows: FlowDefinition[];
  isSearching: boolean;
  selectedFlowId: string | null;
  runningFlowIds: string[];
  t: (k: string) => string;
  onSelect: (flowId: string) => void;
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
  flows, visibleFlows, isSearching, selectedFlowId, runningFlowIds, t,
  onSelect, onContextMenu, onToggleEnabled, onReorder,
}) => {
  const sensors = useFlowSensors({ delay: LONG_PRESS_MS });
  const ids = useMemo(() => flows.map((f) => f.id), [flows]);

  const renderItem = (flow: FlowDefinition): React.ReactNode => (
    <FlowSidebarItem
      flow={flow}
      selected={selectedFlowId === flow.id}
      isRunning={runningFlowIds.includes(flow.id)}
      t={t}
      onSelect={() => onSelect(flow.id)}
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
    <Box flex={1} style={{ overflowY: 'auto', padding: '4px 0' }}>
      {flows.length === 0 ? (
        <Text p="20px 14px" c="dimmed" fz="sm" ta="center">{t('agentflow.flowList.empty')}</Text>
      ) : isSearching ? (
        visibleFlows.length === 0 ? (
          <Text p="20px 14px" c="dimmed" fz="sm" ta="center">{t('agentflow.search.empty')}</Text>
        ) : (
          visibleFlows.map((flow) => <React.Fragment key={flow.id}>{renderItem(flow)}</React.Fragment>)
        )
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
