import type React from 'react';
import type { FlowFolder } from '../../../../shared/flowFolders';
import type { FlowSidebarRow } from './flowSidebarRows';
import { folderRowKey } from '../../utils/sidebarOrder';
import { sectionRowKey } from '../../utils/timeGroups';
import { isMenuKey, walkTarget } from '../../components/sidebar/sidebarKeyNav';
import type { MenuAnchor } from '../../components/RowMoreButton';
import { menuAnchorUnderRow } from '../../utils/rowSwipe';

/** A flow row's key in the flow tree (section and folder rows use the chat list's keys). */
export function flowRowKey(flowId: string): string {
  return `flow:${flowId}`;
}

/** Every row's key in drawn order: what ↑ ↓ Home End walk. */
export function flowTreeKeys(rows: readonly FlowSidebarRow[]): string[] {
  return rows.map((row) => {
    if (row.kind === 'section') return sectionRowKey(row.key);
    if (row.kind === 'folder') return folderRowKey(row.folder.name);
    return flowRowKey(row.flow.id);
  });
}

export interface FlowTreeKeyDeps {
  rows: readonly FlowSidebarRow[];
  refs: ReadonlyMap<string, HTMLElement>;
  /** A row is being dragged with the keyboard: the arrows move it, not the focus. */
  dragging: boolean;
  openFlow: (flowId: string) => void;
  openFlowMenu: (flowId: string, at: MenuAnchor) => void;
  openFolderMenu: (folder: FlowFolder, flowIds: string[], at: MenuAnchor) => void;
}

function keyOfFocused(refs: ReadonlyMap<string, HTMLElement>): string | null {
  for (const [key, node] of refs.entries()) if (node === document.activeElement) return key;
  return null;
}

/**
 * The flow tree's keys (WCAG 2.1.1, 2.4.3; ARIA APG tree view): ↑ ↓ Home End move focus through
 * headings, categories and flows; Enter opens the focused flow (Space still picks it up for keyboard
 * sorting); ← on a flow in a category goes to the category; Shift+F10 / the menu key opens the
 * row's "⋯" menu. Headings and categories fold through their own keys (they handle → ← Enter
 * Space first and mark the event handled).
 */
export function handleFlowTreeKey(e: React.KeyboardEvent<HTMLElement>, deps: FlowTreeKeyDeps): void {
  if (e.defaultPrevented || deps.dragging || e.nativeEvent.isComposing) return;
  const key = keyOfFocused(deps.refs);
  if (key === null) return;
  const order = flowTreeKeys(deps.rows);
  const index = order.indexOf(key);
  const row = deps.rows[index];
  const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
  const target = plain ? walkTarget(e.key, index, order.length) : null;
  if (target !== null) {
    e.preventDefault();
    const next = order[target];
    if (next !== undefined && target !== index) deps.refs.get(next)?.focus();
    return;
  }
  if (!row) return;
  if (isMenuKey(e)) {
    const node = deps.refs.get(key);
    if (!node) return;
    e.preventDefault();
    const at = menuAnchorUnderRow(node.getBoundingClientRect());
    if (row.kind === 'flow') deps.openFlowMenu(row.flow.id, at);
    else if (row.kind === 'folder') deps.openFolderMenu(row.folder, row.flowIds, at);
    return;
  }
  if (row.kind !== 'flow' || !plain) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    deps.openFlow(row.flow.id);
    return;
  }
  if (e.key === 'ArrowLeft' && row.inFolder) {
    e.preventDefault();
    deps.refs.get(folderRowKey(row.inFolder))?.focus();
  }
}
