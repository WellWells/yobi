import { arrayMove } from '@dnd-kit/sortable';
import { folderKey } from '../../../../shared/conversationFolders';
import type { FlowFolder } from '../../../../shared/flowFolders';
import type { FlowDefinition } from '../../../../shared/types';

/*
 * The rows of the flow sidebar, as the chat sidebar draws its folders: the 「資料夾」 heading, the
 * folders by name with the open ones' flows under them, the 「流程」 heading and the flows in no
 * folder. Every list of flows keeps the flows' own order. Pure.
 */

export const FLOW_SECTIONS = ['folders', 'flows'] as const;
export type FlowSectionKey = typeof FLOW_SECTIONS[number];

export type FlowSidebarRow =
  /** `flowIds`: every flow under the heading; `empty`: nothing to open or close. */
  | { kind: 'section'; key: FlowSectionKey; collapsed: boolean; empty?: true; flowIds: string[] }
  | { kind: 'folder'; folder: FlowFolder; flowIds: string[]; expanded: boolean }
  | { kind: 'flow'; flow: FlowDefinition; inFolder?: string };

export interface FlowSidebarRowOptions {
  /** `folderKey`s of the open folders. */
  open: ReadonlySet<string>;
  collapsed: ReadonlySet<FlowSectionKey>;
  compareNames?: (a: string, b: string) => number;
}

const defaultCompare = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** The folder a flow is in, or '' at the top level. */
export function folderOfFlow(folders: readonly FlowFolder[], flowId: string): string {
  return folders.find((folder) => folder.flowIds.includes(flowId))?.name ?? '';
}

export function buildFlowSidebarRows(
  flows: readonly FlowDefinition[],
  folders: readonly FlowFolder[],
  { open, collapsed, compareNames = defaultCompare }: FlowSidebarRowOptions,
): FlowSidebarRow[] {
  if (flows.length === 0) return [];
  const home = new Map<string, string>();
  for (const folder of folders) for (const id of folder.flowIds) if (!home.has(id)) home.set(id, folder.name);
  const inside = (name: string): FlowDefinition[] => flows.filter((flow) => home.get(flow.id) === name);
  const sorted = [...folders].sort((a, b) => compareNames(a.name, b.name));
  const filed = flows.filter((flow) => home.has(flow.id)).map((flow) => flow.id);
  const top = flows.filter((flow) => !home.has(flow.id));

  const rows: FlowSidebarRow[] = [];
  const foldersClosed = sorted.length > 0 && collapsed.has('folders');
  rows.push({ kind: 'section', key: 'folders', collapsed: foldersClosed, ...(sorted.length === 0 ? { empty: true as const } : {}), flowIds: filed });
  if (!foldersClosed) {
    for (const folder of sorted) {
      const members = inside(folder.name);
      const expanded = open.has(folderKey(folder.name));
      rows.push({ kind: 'folder', folder, flowIds: members.map((flow) => flow.id), expanded });
      if (expanded) for (const flow of members) rows.push({ kind: 'flow', flow, inFolder: folder.name });
    }
  }
  const flowsClosed = top.length > 0 && collapsed.has('flows');
  rows.push({ kind: 'section', key: 'flows', collapsed: flowsClosed, ...(top.length === 0 ? { empty: true as const } : {}), flowIds: top.map((flow) => flow.id) });
  if (!flowsClosed) for (const flow of top) rows.push({ kind: 'flow', flow });
  return rows;
}

/** The flows drawn, in drawn order: what a Shift-click range runs over. */
export function visibleFlowIds(rows: readonly FlowSidebarRow[]): string[] {
  return rows.flatMap((row) => (row.kind === 'flow' ? [row.flow.id] : []));
}

/** The flows that share a list with `flowId` (its folder, or the top level), in order. */
export function flowSiblings(flows: readonly FlowDefinition[], folders: readonly FlowFolder[], flowId: string): string[] {
  const key = folderKey(folderOfFlow(folders, flowId));
  return flows.filter((flow) => folderKey(folderOfFlow(folders, flow.id)) === key).map((flow) => flow.id);
}

/** `order` with `a` and `b` trading places: moving one up or down past its neighbour. */
export function swapInOrder(order: readonly string[], a: string, b: string): string[] {
  return order.map((id) => (id === a ? b : id === b ? a : id));
}

export interface FlowAttention {
  /** Flows with a problem, or whose last run failed. */
  attention: FlowDefinition[];
  running: FlowDefinition[];
}

/** What a closed folder or section has to show for the flows inside it. */
export function attentionOf(
  flowIds: readonly string[],
  flows: readonly FlowDefinition[],
  isProblem: (flowId: string) => boolean,
  isRunning: (flowId: string) => boolean,
): FlowAttention {
  const wanted = new Set(flowIds);
  const inside = flows.filter((flow) => wanted.has(flow.id));
  return {
    attention: inside.filter((flow) => isProblem(flow.id)),
    running: inside.filter((flow) => isRunning(flow.id)),
  };
}

const FOLDER_DROP_PREFIX = 'folder:';
/** The drop id of the 「流程」 heading: dropping there moves a flow out of its folder. */
export const FLOWS_SECTION_DROP_ID = 'section:flows';

export function flowFolderDropId(name: string): string {
  return `${FOLDER_DROP_PREFIX}${name}`;
}

export function isFlowDropTargetId(id: string): boolean {
  return id.startsWith(FOLDER_DROP_PREFIX) || id === FLOWS_SECTION_DROP_ID;
}

/** The folder a drop id names, or null for any other drop target. */
export function folderOfDropId(id: string): string | null {
  return id.startsWith(FOLDER_DROP_PREFIX) ? id.slice(FOLDER_DROP_PREFIX.length) : null;
}

export type DragOutcome =
  | { kind: 'reorder'; order: string[] }
  | { kind: 'move'; folder: string; before?: string };

/**
 * What dropping the dragged flow on `overId` does: on a folder row, into that folder (at its end);
 * on the 「流程」 heading, out to the top level, first; on a flow in another list, into that list
 * before it; on a flow in its own list, the old reorder. Null when nothing would change.
 */
export function dragOutcome(
  activeId: string,
  overId: string,
  flows: readonly FlowDefinition[],
  folders: readonly FlowFolder[],
): DragOutcome | null {
  const from = folderOfFlow(folders, activeId);
  const targetFolder = folderOfDropId(overId);
  if (targetFolder !== null) {
    return folderKey(targetFolder) === folderKey(from) ? null : { kind: 'move', folder: targetFolder };
  }
  if (overId === FLOWS_SECTION_DROP_ID) {
    if (from === '') return null;
    const first = flows.find((flow) => flow.id !== activeId && folderOfFlow(folders, flow.id) === '');
    return first ? { kind: 'move', folder: '', before: first.id } : { kind: 'move', folder: '' };
  }
  if (overId === activeId) return null;
  const ids = flows.map((flow) => flow.id);
  const fromIndex = ids.indexOf(activeId);
  const toIndex = ids.indexOf(overId);
  if (fromIndex < 0 || toIndex < 0) return null;
  const to = folderOfFlow(folders, overId);
  if (folderKey(to) === folderKey(from)) return { kind: 'reorder', order: arrayMove(ids, fromIndex, toIndex) };
  return { kind: 'move', folder: to, before: overId };
}
