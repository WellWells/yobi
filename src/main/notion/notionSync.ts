import * as fs from 'node:fs/promises';
import { withConversationId } from '../../shared/conversationHistory';
import { isLockedNotionText, spaceNotionBlocks, splitNotionBlocks, unspaceNotionBlocks } from '../../shared/notion/notionBlocks';
import {
  carryConflicts, conflictKey, hunkInConflict, liveConflicts, uniqueConflicts, withTheirs,
} from '../../shared/notion/notionConflicts';
import {
  applyHunks, buildUpdate, conflictsWithoutBase, diffBlocks, mergeBlocks, rangesTouch,
  type BlockHunk, type MergeConflict,
} from '../../shared/notion/notionDiff';
import type { NotionCallError, NotionPage } from '../../shared/notion/notionFetch';
import { notionDocParts, titleText, writeNotionDoc, type NotionDocParts } from '../../shared/notion/notionDoc';
import type {
  NotionDocStatus,
  NotionPendingChange,
  NotionPullResult,
  NotionPushResult,
} from '../../shared/notion/notionSyncTypes';
import { writeFileAtomic } from '../atomicWrite';
import { withConversationFile } from '../chat/conversationStore';
import { Mutex } from '../flow/lanes';
import { newConversationId, recordConversationVersion } from '../history/conversationHistory';
import type { NotionApi } from './notionClient';
import { readNotionSync, updateNotionSync, type NotionSyncState } from './notionSyncStore';

/*
 * Keeping a Notion document and its page in step. A pull merges Notion's changes three ways
 * (base = what both last agreed on). A push reads the page first and sends only when Notion has
 * not changed since the last sync — so every `old_str` is matched against exactly the text it was
 * built from — and only the changes the user confirmed, one `update_content` each; then it reads
 * the page back so the local text is what Notion stored. Without a base, every difference is a
 * conflict for the user: nothing picks a side on its own.
 */

type ApiFor = (server?: string) => NotionApi | null;

let apiFor: ApiFor = () => null;

/** Set once at start-up (the MCP-backed client). */
export function configureNotionSync(deps: { apiFor: ApiFor }): void {
  apiFor = deps.apiFor;
}

export function notionApi(server?: string): NotionApi | null {
  return apiFor(server);
}

const blocksOf = (text: string): string[] => splitNotionBlocks(text).map((block) => block.text);

interface LoadedDoc {
  raw: string;
  parts: NotionDocParts;
  /** Null for a file that has not been given one yet (a copy brought in by import). */
  id: string | null;
  state: NotionSyncState;
  /** The state was on disk: there is a base to merge against. */
  known: boolean;
}

/** Stand-in state for a document with none: base = its own text, so nothing reads as pending. */
function freshState(parts: NotionDocParts): NotionSyncState {
  return { v: 1, base: unspaceNotionBlocks(parts.body), baseTitle: parts.title, baseEditedAt: '', syncedAt: '', conflicts: [] };
}

async function loadDoc(filePath: string): Promise<LoadedDoc | null> {
  const raw = await fs.readFile(filePath, 'utf-8').catch(() => null);
  const parts = raw === null ? null : notionDocParts(raw);
  if (!raw || !parts) return null;
  const id = parts.thread.id ?? null;
  const stored = id ? await readNotionSync(id) : null;
  return { raw, parts, id, state: stored ?? freshState(parts), known: stored !== null };
}

/** The document's id, giving the file one (in its marker) when it has none. */
function ensureId(filePath: string): Promise<string | null> {
  return withConversationFile(filePath, async () => {
    const raw = await fs.readFile(filePath, 'utf-8').catch(() => null);
    if (!raw || !notionDocParts(raw)) return null;
    const versioned = withConversationId(raw, newConversationId);
    if (!versioned) return null;
    if (versioned.raw !== raw) await writeFileAtomic(filePath, versioned.raw);
    return versioned.id;
  });
}

function headingAbove(blocks: readonly string[], at: number): string {
  for (let i = at - 1; i >= 0; i -= 1) {
    const heading = /^#{1,6}\s+(.+?)(?:\s*\{[^}]*\})?\s*$/.exec(blocks[i] ?? '');
    if (heading) return heading[1] ?? '';
  }
  return '';
}

/**
 * A change that cannot go out: it touches a table, a child page or another block Yobi does not
 * send, or the text that anchors it would have to include one.
 */
function hunkLocked(hunk: BlockHunk, base: readonly string[]): boolean {
  if ([...base.slice(hunk.start, hunk.end), ...hunk.next].some(isLockedNotionText)) return true;
  const update = buildUpdate(base, hunk);
  return update !== null && (isLockedNotionText(update.old_str) || isLockedNotionText(update.new_str));
}

/** One sync at a time per document: an insertion sent twice would land twice. */
const docLocks = new Map<string, Mutex>();

function exclusive<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const key = filePath.toLowerCase();
  let lock = docLocks.get(key);
  if (!lock) {
    lock = new Mutex();
    docLocks.set(key, lock);
  }
  return lock.runExclusive(task);
}

export async function notionDocStatus(filePath: string): Promise<NotionDocStatus | null> {
  const doc = await loadDoc(filePath);
  if (!doc) return null;
  const base = blocksOf(doc.state.base);
  const local = blocksOf(unspaceNotionBlocks(doc.parts.body));
  const conflicts = liveConflicts(doc.state.conflicts, local, base);
  // Hunks come in order: each one's place in the local text is its base place moved by those before it.
  let shift = 0;
  const pending: NotionPendingChange[] = diffBlocks(base, local).map((hunk) => {
    const localStart = hunk.start + shift;
    shift += hunk.next.length - (hunk.end - hunk.start);
    return {
      id: hunk.id,
      heading: headingAbove(base, hunk.start),
      before: base.slice(hunk.start, hunk.end).join('\n'),
      after: hunk.next.join('\n'),
      localStart,
      localEnd: localStart + hunk.next.length,
      locked: hunkLocked(hunk, base),
      conflict: hunkInConflict(hunk, conflicts),
    };
  });
  const titleChanged = doc.known && doc.parts.title !== titleText(doc.state.baseTitle);
  return {
    url: doc.parts.thread.notion.url,
    pending,
    conflicts: conflicts.map((conflict) => ({ ...conflict, key: conflictKey(conflict) })),
    titleChange: titleChanged ? { from: doc.state.baseTitle, to: doc.parts.title } : null,
    syncedAt: doc.state.syncedAt || null,
    lastError: doc.state.lastError?.kind ?? null,
    connected: apiFor(doc.parts.thread.notion.server) !== null,
    partial: doc.state.partial === true,
    unsynced: !doc.known,
  };
}

async function recordError(id: string | null, kind: NotionCallError): Promise<void> {
  if (!id) return;
  await updateNotionSync(id, (state) => (state ? { ...state, lastError: { kind, at: new Date().toISOString() } } : state));
}

/** Notion stores bullets as `-` whatever was sent; nothing else is taken as its rewriting. */
function normalised(blocks: readonly string[]): string {
  return blocks.join('\n').replace(/^(\t*)[*+] /gm, '$1- ');
}

interface MergeInput {
  id: string;
  /** What the file and Notion agreed on, as this merge starts (after a push: with the sent changes). */
  base: string[] | null;
  baseTitle: string;
  /** The base the stored conflicts were placed against. */
  conflictBase: string[];
  conflicts: MergeConflict[];
  remote: NotionPage;
  /** Base ranges this sync just sent, and what was sent there. */
  pushed: ReadonlyArray<{ start: number; end: number }>;
}

/**
 * Merges Notion's text into the file as it is now (read under the file's lock, so what the user
 * saved meanwhile is kept), keeps a version of the text before, and records Notion's text as the
 * new base. With no base, the differences are all conflicts and the file keeps its own text.
 */
async function mergeRemote(filePath: string, input: MergeInput): Promise<{ updated: number; conflicts: number } | null> {
  return withConversationFile(filePath, async () => {
    const raw = await fs.readFile(filePath, 'utf-8').catch(() => null);
    const parts = raw === null ? null : notionDocParts(raw);
    if (!raw || !parts) return null;
    const local = blocksOf(unspaceNotionBlocks(parts.body));
    const remoteBlocks = blocksOf(input.remote.body);

    let merged: string[];
    let conflicts: MergeConflict[];
    let updated = 0;
    let title = parts.title;
    if (input.base === null) {
      merged = local;
      conflicts = conflictsWithoutBase(local, remoteBlocks);
    } else {
      const base = input.base;
      const result = mergeBlocks(base, local, remoteBlocks);
      merged = result.merged;
      conflicts = uniqueConflicts([
        ...carryConflicts(input.conflicts, input.conflictBase, remoteBlocks, merged),
        ...result.conflicts,
      ]);
      // A place this sync sent counts as an update only if Notion holds something other than what
      // was sent (beyond its own bullet rewriting): then someone changed it in between.
      updated = result.remoteSpans.filter((span) => !input.pushed.some((range) => rangesTouch(span, range))
        || normalised(span.next) !== normalised(base.slice(span.start, span.end))).length;
      // The title merges the same way: Notion's change is taken unless the user changed it too.
      if (parts.title === titleText(input.baseTitle)) title = input.remote.title;
    }

    const body = spaceNotionBlocks(merged.join('\n'));
    const now = new Date().toISOString();
    const titleMoved = titleText(title) !== parts.title;
    if (body !== parts.body || titleMoved) {
      await recordConversationVersion(input.id, raw, 'notion');
      const next = writeNotionDoc(raw, {
        body, title, at: now, notion: { url: input.remote.url, ...(input.remote.icon ? { icon: input.remote.icon } : {}) },
      });
      if (next !== null) await writeFileAtomic(filePath, next);
    }
    await updateNotionSync(input.id, () => ({
      v: 1,
      base: input.remote.body,
      baseTitle: input.remote.title,
      baseEditedAt: input.remote.editedAt,
      syncedAt: now,
      conflicts,
      ...(input.remote.partial ? { partial: true } : {}),
    }));
    return { updated: updated + (titleMoved ? 1 : 0), conflicts: conflicts.length };
  });
}

function mergeInputFor(doc: LoadedDoc, id: string, remote: NotionPage): MergeInput {
  const base = blocksOf(doc.state.base);
  return {
    id,
    base: doc.known ? base : null,
    baseTitle: doc.state.baseTitle,
    conflictBase: base,
    conflicts: doc.state.conflicts,
    remote,
    pushed: [],
  };
}

export function pullNotionDoc(filePath: string): Promise<NotionPullResult> {
  return exclusive(filePath, async (): Promise<NotionPullResult> => {
    const doc = await loadDoc(filePath);
    if (!doc) return { ok: false, reason: 'missing' };
    const api = apiFor(doc.parts.thread.notion.server);
    if (!api) return { ok: false, reason: 'notConnected' };
    const remote = await api.fetch(doc.parts.thread.notion.page);
    if ('error' in remote) {
      if (remote.error !== 'notPage') await recordError(doc.id, remote.error);
      return { ok: false, reason: remote.error };
    }
    if (doc.known && doc.id && remote.editedAt === doc.state.baseEditedAt) {
      await updateNotionSync(doc.id, (state) => (state ? { ...state, syncedAt: new Date().toISOString(), lastError: undefined } : state));
      return { ok: true, updated: 0, conflicts: 0 };
    }
    const id = doc.id ?? await ensureId(filePath);
    if (!id) return { ok: false, reason: 'missing' };
    const merged = await mergeRemote(filePath, mergeInputFor(doc, id, remote));
    return merged ? { ok: true, ...merged } : { ok: false, reason: 'missing' };
  });
}

/**
 * Sends the changes the user confirmed (`ids`, as `notionDocStatus` listed them) and the title
 * when `title` is the H1 the preview showed. Notion is read first: if the page changed since the
 * last sync, its changes are merged in and nothing is sent, so the user sees the new state before
 * anything goes out. Each change is its own call (a batch is all or nothing).
 */
export function pushNotionDoc(filePath: string, ids: readonly string[], title: string | null): Promise<NotionPushResult> {
  return exclusive(filePath, async (): Promise<NotionPushResult> => {
    const doc = await loadDoc(filePath);
    if (!doc) return { ok: false, reason: 'missing' };
    const api = apiFor(doc.parts.thread.notion.server);
    if (!api) return { ok: false, reason: 'notConnected' };
    const page = doc.parts.thread.notion.page;

    const before = await api.fetch(page);
    if ('error' in before) {
      if (before.error !== 'notPage') await recordError(doc.id, before.error);
      return { ok: false, reason: before.error };
    }
    if (!doc.known || !doc.id || before.editedAt !== doc.state.baseEditedAt) {
      const id = doc.id ?? await ensureId(filePath);
      if (!id) return { ok: false, reason: 'missing' };
      const merged = await mergeRemote(filePath, mergeInputFor(doc, id, before));
      if (!merged) return { ok: false, reason: 'missing' };
      return { ok: true, pushed: 0, updated: merged.updated, conflicts: merged.conflicts, failed: null, refreshed: true };
    }
    const id = doc.id;

    // Notion holds exactly the base: every update is built from, and matched against, this text.
    const base = blocksOf(before.body);
    const local = blocksOf(unspaceNotionBlocks(doc.parts.body));
    const wanted = new Set(ids);
    const conflicts = liveConflicts(doc.state.conflicts, local, base);
    const hunks = diffBlocks(base, local)
      .filter((hunk) => wanted.has(hunk.id) && !hunkLocked(hunk, base) && !hunkInConflict(hunk, conflicts));

    let current = [...base];
    const sent: BlockHunk[] = [];
    let failed: NotionCallError | null = null;
    let queued = false;
    // Last first: an edit further down never moves the blocks an earlier change refers to.
    for (const hunk of [...hunks].reverse()) {
      const update = buildUpdate(current, hunk);
      if (update && (isLockedNotionText(update.old_str) || isLockedNotionText(update.new_str))) continue;
      let result = update ? await api.update(page, update) : await api.insert(page, hunk.next.join('\n'));
      if (!result.ok && result.error === 'ambiguous' && update) {
        const wider = buildUpdate(current, hunk, 2);
        if (wider && !isLockedNotionText(wider.old_str)) result = await api.update(page, wider);
      }
      if (result.ok && result.queued) {
        // Accepted but not yet on the page: it stays pending, and nothing more goes out until
        // a read shows where the page stands.
        queued = true;
        break;
      }
      if (result.ok) {
        current = applyHunks(current, [hunk]);
        sent.push(hunk);
        continue;
      }
      failed = result.error;
      if (result.error === 'noMatch' || result.error === 'ambiguous') continue;
      break;
    }

    let baseTitle = doc.state.baseTitle;
    const titleToSend = title !== null && title === doc.parts.title && title !== titleText(baseTitle) ? title : null;
    if (titleToSend && !failed && !queued) {
      const result = await api.setTitle(page, titleToSend);
      if (result.ok && !result.queued) baseTitle = titleToSend;
      else if (!result.ok) failed = result.error;
    }

    // Where the sent changes sit in `current`, to tell Notion's rewriting of them from an edit.
    let offset = 0;
    const pushed = [...sent].sort((x, y) => x.start - y.start).map((hunk) => {
      const start = hunk.start + offset;
      offset += hunk.next.length - (hunk.end - hunk.start);
      return { start, end: start + hunk.next.length };
    });

    const after = queued ? null : await api.fetch(page);
    if (after && !('error' in after)) {
      const merged = await mergeRemote(filePath, {
        id, base: current, baseTitle, conflictBase: base, conflicts: doc.state.conflicts, remote: after, pushed,
      });
      if (!merged) return { ok: false, reason: 'missing' };
      if (failed) await recordError(id, failed);
      return { ok: true, pushed: sent.length, updated: merged.updated, conflicts: merged.conflicts, failed };
    }
    // Not read back: what landed becomes the base; the page's edit time stays old, so the next
    // pull merges whatever Notion holds by then (a queued change on both sides is taken once).
    await updateNotionSync(id, (state) => ({
      ...(state ?? freshState(doc.parts)),
      base: current.join('\n'),
      baseTitle,
      ...(failed ? { lastError: { kind: failed, at: new Date().toISOString() } } : { lastError: undefined }),
    }));
    return { ok: true, pushed: sent.length, updated: 0, conflicts: 0, failed };
  });
}

/** Puts Notion's text back over one local change (by the id `notionDocStatus` listed). */
export function revertNotionChange(filePath: string, changeId: string): Promise<boolean> {
  return exclusive(filePath, () => withConversationFile(filePath, async () => {
    const doc = await loadDoc(filePath);
    if (!doc?.id) return false;
    const base = blocksOf(doc.state.base);
    const local = blocksOf(unspaceNotionBlocks(doc.parts.body));
    let offset = 0;
    for (const hunk of diffBlocks(base, local)) {
      const at = hunk.start + offset;
      if (hunk.id === changeId) {
        const next = [...local.slice(0, at), ...base.slice(hunk.start, hunk.end), ...local.slice(at + hunk.next.length)];
        const written = writeNotionDoc(doc.raw, { body: spaceNotionBlocks(next.join('\n')), at: new Date().toISOString() });
        if (written === null) return false;
        await recordConversationVersion(doc.id, doc.raw, 'edit');
        await writeFileAtomic(filePath, written);
        return true;
      }
      offset += hunk.next.length - (hunk.end - hunk.start);
    }
    return false;
  }));
}

/**
 * Settles one conflict, named by its key. `theirs` puts Notion's text in place of the user's;
 * `mine` keeps the user's, which then waits in the preview like any other change.
 */
export function resolveNotionConflict(filePath: string, key: string, choice: 'mine' | 'theirs'): Promise<boolean> {
  return exclusive(filePath, () => withConversationFile(filePath, async () => {
    const doc = await loadDoc(filePath);
    if (!doc?.id) return false;
    const local = blocksOf(unspaceNotionBlocks(doc.parts.body));
    const conflicts = liveConflicts(doc.state.conflicts, local, blocksOf(doc.state.base));
    const conflict = conflicts.find((candidate) => conflictKey(candidate) === key);
    if (!conflict) return false;
    if (choice === 'theirs') {
      const next = withTheirs(local, conflict);
      if (!next) return false;
      const written = writeNotionDoc(doc.raw, { body: spaceNotionBlocks(next.join('\n')), at: new Date().toISOString() });
      if (written === null) return false;
      await recordConversationVersion(doc.id, doc.raw, 'edit');
      await writeFileAtomic(filePath, written);
    }
    const rest = conflicts.filter((candidate) => candidate !== conflict);
    await updateNotionSync(doc.id, (state) => (state ? { ...state, conflicts: rest } : state));
    return true;
  }));
}
