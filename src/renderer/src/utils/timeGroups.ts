import type { OutputFile } from '../../../shared/types';

export type TimeGroupKey = 'today' | 'yesterday' | 'past7' | 'past30' | 'older' | 'undated';

export type SidebarRow =
  | { kind: 'header'; key: TimeGroupKey }
  | { kind: 'file'; file: OutputFile; group: TimeGroupKey; fileIndex: number };

export interface SidebarRowModel {
  rows: SidebarRow[];
  rowIndexByFileIndex: number[];
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function calendarDaysBefore(then: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
}

export function resolveTimeGroup(timestamp: string, now: Date): TimeGroupKey {
  if (!timestamp) return 'undated';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'undated';

  const days = calendarDaysBefore(date, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'past7';
  if (days < 30) return 'past30';
  return 'older';
}

/**
 * The group header to draw above each timestamp, or null where the row continues the bucket above
 * it. A list that falls entirely in one bucket gets no header at all: a lone "today" over
 * everything labels nothing. Timestamps are expected in the order they will be rendered.
 */
export function buildTimeGroupHeads(timestamps: readonly string[], now: Date): (TimeGroupKey | null)[] {
  const groups = timestamps.map((timestamp) => resolveTimeGroup(timestamp, now));
  if (new Set(groups).size < 2) return groups.map(() => null);
  return groups.map((group, index) => (group === groups[index - 1] ? null : group));
}

export function buildSidebarRows(files: OutputFile[], now: Date): SidebarRowModel {
  const rows: SidebarRow[] = [];
  const rowIndexByFileIndex: number[] = [];
  let previousGroup: TimeGroupKey | null = null;

  files.forEach((file, fileIndex) => {
    const group = resolveTimeGroup(file.timestamp, now);
    if (group !== previousGroup) {
      rows.push({ kind: 'header', key: group });
      previousGroup = group;
    }
    rowIndexByFileIndex.push(rows.length);
    rows.push({ kind: 'file', file, group, fileIndex });
  });

  return { rows, rowIndexByFileIndex };
}
