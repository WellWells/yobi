import React from 'react';
import type { MenuAnchor } from '../../components/RowMoreButton';
import type { FlowDefinition } from '../../../../shared/types';
import { FlowSidebarItem, type FlowSidebarItemProps } from './FlowSidebarItem';

type RowMods = Parameters<FlowSidebarItemProps['onRowClick']>[0];

/** The list's handlers, by flow: read when a row is used, so a row never holds an old one. */
export interface FlowRowHandlers {
  onToggleSelect: (id: string) => void;
  onRowClick: (id: string, mods: RowMods) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onOpenMenuAt: (id: string, at: MenuAnchor) => void;
  onToggleEnabled: (flow: FlowDefinition, enabled: boolean) => void;
  onDelete: (id: string) => void;
}

type HandlerKey = 'onToggleSelect' | 'onRowClick' | 'onContextMenu' | 'onOpenMenuAt' | 'onToggleEnabled' | 'onDelete';

export type MemoFlowSidebarItemProps = Omit<FlowSidebarItemProps, HandlerKey> & {
  handlers: React.RefObject<FlowRowHandlers>;
};

function sameRow(a: MemoFlowSidebarItemProps, b: MemoFlowSidebarItemProps): boolean {
  for (const key of Object.keys(b) as (keyof MemoFlowSidebarItemProps)[]) {
    if (key === 'status') continue;
    if (a[key] !== b[key]) return false;
  }
  // Worked out again for every row on every draw: equal when it says the same.
  return JSON.stringify(a.status ?? null) === JSON.stringify(b.status ?? null);
}

/**
 * A flow's sidebar row that draws again only when its own facts change. The list redraws on every
 * keystroke in the editor (it reads the flows), with a new closure per row per handler; without
 * this every row, its switch, badge and tooltip, redraws with it.
 */
export const MemoFlowSidebarItem = React.memo(({ handlers, ...props }: MemoFlowSidebarItemProps) => {
  const { flow } = props;
  return (
    <FlowSidebarItem
      {...props}
      onToggleSelect={() => handlers.current.onToggleSelect(flow.id)}
      onRowClick={(mods) => handlers.current.onRowClick(flow.id, mods)}
      onContextMenu={(e) => handlers.current.onContextMenu(e, flow.id)}
      onOpenMenuAt={(at) => handlers.current.onOpenMenuAt(flow.id, at)}
      onToggleEnabled={(enabled) => handlers.current.onToggleEnabled(flow, enabled)}
      onDelete={() => handlers.current.onDelete(flow.id)}
    />
  );
}, sameRow);
MemoFlowSidebarItem.displayName = 'MemoFlowSidebarItem';
