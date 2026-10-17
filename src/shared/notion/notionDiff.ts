import { fnv1a } from '../fnv1a';
import { isLockedNotionText } from './notionBlocks';

/*
 * Block-level changes between versions of a Notion page, the three-way merge that brings someone
 * else's edits in beside the user's, and the search-and-replace pair `update_content` takes for one
 * change. Blocks are the strings `splitNotionBlocks` returns.
 */

/** `base[start, end)` becomes `next`. */
export interface BlockHunk {
  id: string;
  start: number;
  end: number;
  next: string[];
}

/** Above this many LCS cells the changed middle is treated as one change rather than diffed. */
const MAX_CELLS = 2_000_000;

function hunkId(base: readonly string[], start: number, end: number, next: readonly string[]): string {
  return `${start}-${end}-${fnv1a(base.slice(start, end).join('\n'))}-${fnv1a(next.join('\n'))}`;
}

function makeHunk(base: readonly string[], start: number, end: number, next: string[]): BlockHunk {
  return { id: hunkId(base, start, end, next), start, end, next };
}

/** The changes that turn `base` into `next`, in order, never overlapping. */
export function diffBlocks(base: readonly string[], next: readonly string[]): BlockHunk[] {
  let head = 0;
  while (head < base.length && head < next.length && base[head] === next[head]) head += 1;
  let tail = 0;
  while (
    tail < base.length - head && tail < next.length - head
    && base[base.length - 1 - tail] === next[next.length - 1 - tail]
  ) tail += 1;

  const a = base.slice(head, base.length - tail);
  const b = next.slice(head, next.length - tail);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0 || b.length === 0 || (a.length + 1) * (b.length + 1) > MAX_CELLS) {
    return [makeHunk(base, head, head + a.length, [...b])];
  }

  // lcs[i][j]: length of the longest common subsequence of a[i..] and b[j..].
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * width + j] = a[i] === b[j]
        ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0);
    }
  }

  const hunks: BlockHunk[] = [];
  let i = 0;
  let j = 0;
  let open: { start: number; next: string[] } | null = null;
  const close = (at: number): void => {
    if (open) hunks.push(makeHunk(base, head + open.start, head + at, open.next));
    open = null;
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      close(i);
      i += 1;
      j += 1;
    } else if (j < b.length && (i >= a.length || (lcs[i * width + j + 1] ?? 0) >= (lcs[(i + 1) * width + j] ?? 0))) {
      open ??= { start: i, next: [] };
      open.next.push(b[j] ?? '');
      j += 1;
    } else {
      open ??= { start: i, next: [] };
      i += 1;
    }
  }
  close(i);
  return hunks;
}

/** Applies non-overlapping hunks (in order) to `base`. */
export function applyHunks(base: readonly string[], hunks: readonly BlockHunk[]): string[] {
  const out: string[] = [];
  let at = 0;
  for (const hunk of [...hunks].sort((x, y) => x.start - y.start || x.end - y.end)) {
    out.push(...base.slice(at, hunk.start), ...hunk.next);
    at = hunk.end;
  }
  out.push(...base.slice(at));
  return out;
}

export interface NotionUpdate {
  old_str: string;
  new_str: string;
}

function occurrences(haystack: string, needle: string): number {
  if (!needle) return Infinity;
  let count = 0;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    count += 1;
    if (count > 1) return count;
  }
  return count;
}

function segment(blocks: readonly string[], before: boolean, after: boolean, collapse: boolean): string {
  if (blocks.length === 0) return collapse && before && after ? '\n' : '';
  return `${before ? '\n' : ''}${blocks.join('\n')}${after ? '\n' : ''}`;
}

/**
 * The `update_content` pair for one change. The old text is whole lines (a newline on each side
 * where there is a neighbour), widened with unchanged neighbours until it occurs once on the page as
 * `base` has it; `extra` widens it further, for a page someone else has since given a duplicate.
 * A pure insertion anchors on the block before it (the one after, at the top of the page). Null for
 * a page with no blocks at all, which takes `insert_content` instead.
 */
export function buildUpdate(base: readonly string[], hunk: BlockHunk, extra = 0): NotionUpdate | null {
  if (base.length === 0) return null;
  const page = base.join('\n');
  const old = base.slice(hunk.start, hunk.end);
  // A table or child page is never part of what is sent, not even as an anchor: Notion would
  // rebuild it from the Markdown. Neighbours on that side are not used.
  const usable = (index: number): boolean => index >= 0 && index < base.length && !isLockedNotionText(base[index] ?? '');
  let left = 0;
  let right = 0;
  if (old.length === 0) {
    if (usable(hunk.start - 1)) left = 1;
    else if (usable(hunk.end)) right = 1;
    else if (hunk.start > 0) left = 1;
    else right = 1;
  }
  const build = (): NotionUpdate => {
    const prefix = base.slice(hunk.start - left, hunk.start);
    const suffix = base.slice(hunk.end, hunk.end + right);
    const before = hunk.start - left > 0;
    const after = hunk.end + right < base.length;
    return {
      old_str: segment([...prefix, ...old, ...suffix], before, after, false),
      new_str: segment([...prefix, ...hunk.next, ...suffix], before, after, true),
    };
  };
  const grow = (): boolean => {
    const canLeft = usable(hunk.start - left - 1);
    const canRight = usable(hunk.end + right);
    if (!canLeft && !canRight) return false;
    if (canLeft && (left <= right || !canRight)) left += 1;
    else right += 1;
    return true;
  };
  while (occurrences(page, build().old_str) > 1 && grow()) { /* widen until unique */ }
  for (let n = 0; n < extra && grow(); n += 1) { /* widen past unique on request */ }
  return build();
}

export interface MergeConflict {
  base: string[];
  local: string[];
  remote: string[];
  /** Where `remote` starts in Notion's text (the new base): conflicts are told apart by place, not by text. */
  at: number;
  /** Where `local` starts in the local text. */
  localAt: number;
}

export interface MergeResult {
  merged: string[];
  conflicts: MergeConflict[];
  /** Places where only the remote side changed and its change was taken. */
  remoteChanged: number;
  /** Those places as `base` ranges with Notion's text there, so a caller can tell Notion's rewrite of its own push apart. */
  remoteSpans: Array<{ start: number; end: number; next: string[] }>;
}

interface SidedHunk extends BlockHunk {
  side: 'local' | 'remote';
}

function overlaps(a: BlockHunk, b: BlockHunk): boolean {
  const aEmpty = a.start === a.end;
  const bEmpty = b.start === b.end;
  if (aEmpty && bEmpty) return a.start === b.start;
  if (aEmpty) return b.start < a.start && a.start < b.end;
  if (bEmpty) return a.start < b.start && b.start < a.end;
  return a.start < b.end && b.start < a.end;
}

function sameBlocks(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((block, index) => block === b[index]);
}

/**
 * Three-way merge at block level. What only one side changed is taken from that side; the same
 * change on both sides is taken once; different changes to the same blocks are a conflict, and
 * the merged text keeps the local version there until the user decides.
 */
export function mergeBlocks(base: readonly string[], local: readonly string[], remote: readonly string[]): MergeResult {
  const hunks: SidedHunk[] = [
    ...diffBlocks(base, local).map((hunk) => ({ ...hunk, side: 'local' as const })),
    ...diffBlocks(base, remote).map((hunk) => ({ ...hunk, side: 'remote' as const })),
  ].sort((x, y) => x.start - y.start || x.end - y.end);

  const clusters: SidedHunk[][] = [];
  for (const hunk of hunks) {
    const last = clusters.at(-1);
    if (last && last.some((other) => overlaps(other, hunk))) last.push(hunk);
    else clusters.push([hunk]);
  }

  const merged: string[] = [];
  const conflicts: MergeConflict[] = [];
  const remoteSpans: Array<{ start: number; end: number; next: string[] }> = [];
  let at = 0;
  // How far the remote text has moved from the base by the start of the current cluster.
  let remoteShift = 0;
  for (const cluster of clusters) {
    const start = Math.min(...cluster.map((hunk) => hunk.start));
    const end = Math.max(...cluster.map((hunk) => hunk.end));
    merged.push(...base.slice(at, start));
    const localAt = merged.length;
    const remoteAt = start + remoteShift;
    const span = base.slice(start, end);
    const shift = (hunk: BlockHunk): BlockHunk => ({ ...hunk, start: hunk.start - start, end: hunk.end - start });
    const localHunks = cluster.filter((hunk) => hunk.side === 'local').map(shift);
    const remoteHunks = cluster.filter((hunk) => hunk.side === 'remote').map(shift);
    const mine = applyHunks(span, localHunks);
    const theirs = applyHunks(span, remoteHunks);
    if (remoteHunks.length === 0) {
      merged.push(...mine);
    } else if (localHunks.length === 0) {
      merged.push(...theirs);
      remoteSpans.push({ start, end, next: theirs });
    } else if (sameBlocks(mine, theirs)) {
      merged.push(...mine);
    } else {
      merged.push(...mine);
      conflicts.push({ base: span, local: mine, remote: theirs, at: remoteAt, localAt });
    }
    remoteShift += theirs.length - span.length;
    at = end;
  }
  merged.push(...base.slice(at));
  return { merged, conflicts, remoteChanged: remoteSpans.length, remoteSpans };
}

/**
 * When there is no common ancestor (the sync state was lost, or the file is a copy), nothing can
 * be said about who changed what: every place the two texts differ is a conflict for the user.
 */
export function conflictsWithoutBase(local: readonly string[], remote: readonly string[]): MergeConflict[] {
  let shift = 0;
  return diffBlocks(local, remote).map((hunk) => {
    const conflict: MergeConflict = {
      base: [],
      local: local.slice(hunk.start, hunk.end),
      remote: hunk.next,
      at: hunk.start + shift,
      localAt: hunk.start,
    };
    shift += hunk.next.length - (hunk.end - hunk.start);
    return conflict;
  });
}

/** Whether two block ranges touch: overlap, or an empty one inside (or at the edge of) the other. */
export function rangesTouch(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  if (a.start === a.end || b.start === b.end) return a.start <= b.end && b.start <= a.end;
  return a.start < b.end && b.start < a.end;
}

/** Where `needle` sits in `blocks` as a contiguous run, the occurrence nearest `near`; -1 if none. */
export function nearestRun(blocks: readonly string[], needle: readonly string[], near: number): number {
  if (needle.length === 0) return -1;
  let best = -1;
  for (let i = 0; i + needle.length <= blocks.length; i += 1) {
    if (!needle.every((block, k) => blocks[i + k] === block)) continue;
    if (best < 0 || Math.abs(i - near) < Math.abs(best - near)) best = i;
  }
  return best;
}

/** Whether `blocks` holds `run` starting exactly at `at` (an empty run fits anywhere in range). */
export function runAt(blocks: readonly string[], run: readonly string[], at: number): boolean {
  if (at < 0 || at + run.length > blocks.length) return false;
  return run.every((block, k) => blocks[at + k] === block);
}

/**
 * Where index `at` of `before` lands in `after`, given the changes between them; null when a
 * change touches it (the place itself was edited).
 */
export function mapIndex(at: number, length: number, hunks: readonly BlockHunk[]): number | null {
  let shift = 0;
  for (const hunk of hunks) {
    const insertion = hunk.start === hunk.end;
    // Blocks inserted right at either edge of a non-empty place leave the place itself alone.
    const atEdge = insertion && length > 0 && (hunk.start === at || hunk.start === at + length);
    if (!atEdge && rangesTouch({ start: at, end: at + length }, hunk)) return null;
    if (hunk.end <= at) shift += hunk.next.length - (hunk.end - hunk.start);
  }
  return at + shift;
}
