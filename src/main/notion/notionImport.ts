import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { notionDocParts, buildNotionDocFile } from '../../shared/notion/notionDoc';
import { parseNotionPageId, type NotionSearchHit } from '../../shared/notion/notionFetch';
import type { NotionBrowseResult, NotionImportResult, NotionSearchResult } from '../../shared/notion/notionSyncTypes';
import { writeFileAtomic } from '../atomicWrite';
import { buildSafeFileNameFromTitle, getOutputDir, getUniquePath, listOutputFiles } from '../files';
import { newConversationId } from '../history/conversationHistory';
import { notionApi } from './notionSync';
import { updateNotionSync } from './notionSyncStore';

/** Each Notion page kept as a document, with the first document kept for it. */
async function keptDocs(): Promise<Map<string, string>> {
  const kept = new Map<string, string>();
  for (const file of await listOutputFiles()) {
    if (!file.notion) continue;
    const raw = await fs.readFile(file.path, 'utf-8').catch(() => null);
    const page = raw === null ? undefined : notionDocParts(raw)?.thread.notion.page;
    if (page && !kept.has(page)) kept.set(page, file.path);
  }
  return kept;
}

/** The document already kept for `page`, so importing a page twice opens the one there is. */
async function existingDocFor(page: string): Promise<string | null> {
  return (await keptDocs()).get(page) ?? null;
}

async function markKept(hits: NotionSearchHit[]): Promise<NotionSearchHit[]> {
  if (hits.length === 0) return hits;
  const kept = await keptDocs();
  return hits.map((hit) => (kept.has(hit.page) ? { ...hit, kept: true } : hit));
}

/** Reads a page through the connected Notion connector and keeps it as a document in outputs. */
export async function importNotionPage(input: string): Promise<NotionImportResult> {
  const page = parseNotionPageId(input);
  if (!page) return { ok: false, reason: 'invalid' };
  const existing = await existingDocFor(page);
  if (existing) return { ok: true, path: existing, existing: true };

  const api = notionApi();
  if (!api) return { ok: false, reason: 'notConnected' };
  const fetched = await api.fetch(page);
  if ('error' in fetched) return { ok: false, reason: fetched.error };

  const id = newConversationId();
  const now = new Date().toISOString();
  const outputDir = await getOutputDir();
  const target = await getUniquePath(path.join(outputDir, `${buildSafeFileNameFromTitle(fetched.title)}.md`), '');
  // The file first: one written without its state is merely "unsynced" (the next read finds the
  // texts equal); a state with no file would be left behind.
  await writeFileAtomic(target, buildNotionDocFile(fetched, api.server, id, now));
  await updateNotionSync(id, () => ({
    v: 1,
    base: fetched.body,
    baseTitle: fetched.title,
    baseEditedAt: fetched.editedAt,
    syncedAt: now,
    conflicts: [],
    ...(fetched.partial ? { partial: true } : {}),
  }));
  return { ok: true, path: target, existing: false };
}

export async function searchNotionPages(query: string): Promise<NotionSearchResult> {
  const text = query.trim();
  const api = notionApi();
  if (!api) return { ok: false, reason: 'notConnected' };
  // A pasted link is a page, not a search term: read it, so the user sees what they will import.
  const page = parseNotionPageId(text);
  if (page) {
    const fetched = await api.fetch(page);
    if ('error' in fetched) return { ok: false, reason: fetched.error };
    return { ok: true, hits: await markKept([{ page: fetched.page, url: fetched.url, title: fetched.title, ...(fetched.icon ? { icon: fetched.icon } : {}) }]) };
  }
  if (!text) return { ok: true, hits: [] };
  const hits = await api.search(text);
  return Array.isArray(hits) ? { ok: true, hits: await markKept(hits) } : { ok: false, reason: hits.error };
}

/** Favorites rarely run long; all of them come in the first answer. */
const FAVORITES_LIMIT = 50;
const RECENT_PAGE_SIZE = 20;

/**
 * The page picker's list before anything is typed. Without a cursor: favorites and the first
 * stretch of recently viewed pages, a favorite listed once. With one: the next stretch of recent.
 * A list the server does not offer is empty, and failing favorites still leave recent to pick from.
 */
export async function browseNotionPages(cursor?: string): Promise<NotionBrowseResult> {
  const api = notionApi();
  if (!api) return { ok: false, reason: 'notConnected' };
  const [favorites, recent] = await Promise.all([
    cursor ? null : api.list('favorites', FAVORITES_LIMIT),
    api.list('recent', RECENT_PAGE_SIZE, cursor),
  ]);
  if (recent && 'error' in recent) return { ok: false, reason: recent.error };
  const favoriteHits = favorites && !('error' in favorites) ? favorites.hits : [];
  const shown = new Set(favoriteHits.map((hit) => hit.page));
  const recentHits = (recent?.hits ?? []).filter((hit) => !shown.has(hit.page));
  const marked = await markKept([...favoriteHits, ...recentHits]);
  return {
    ok: true,
    favorites: marked.slice(0, favoriteHits.length),
    recent: marked.slice(favoriteHits.length),
    next: recent?.next ?? null,
  };
}
