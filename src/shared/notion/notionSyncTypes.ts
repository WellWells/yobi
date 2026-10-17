import type { MergeConflict } from './notionDiff';
import type { NotionCallError, NotionSearchHit } from './notionFetch';

/** Why a Notion call could not be made or did not go through, as the renderer words it. */
export type NotionSyncError = NotionCallError | 'notPage' | 'invalid' | 'missing';

/** One local change waiting to be sent, as the document marks it. */
export interface NotionPendingChange {
  id: string;
  /** The nearest heading above it, for "where on the page" (empty at the top). */
  heading: string;
  /** Notion's text there now (the base), and what it would become. */
  before: string;
  after: string;
  /**
   * Where `after` sits among the local file's top-level blocks (`splitNotionBlocks` of the body),
   * `localEnd` exclusive; equal for a removal, which sits just before block `localStart`.
   */
  localStart: number;
  localEnd: number;
  /** Holds a table, a child page or another block Yobi does not send: edit it in Notion. */
  locked: boolean;
  /** Notion changed the same place: decide in the conflict card first. */
  conflict: boolean;
}

export interface NotionConflictView extends MergeConflict {
  /** Names this conflict for resolving it (`conflictKey`): a list gone stale cannot pick another one. */
  key: string;
}

export interface NotionDocStatus {
  url: string;
  pending: NotionPendingChange[];
  conflicts: NotionConflictView[];
  /** The H1 differs from Notion's title. */
  titleChange: { from: string; to: string } | null;
  syncedAt: string | null;
  lastError: NotionCallError | null;
  /** A connected Notion connector can reach the page. */
  connected: boolean;
  /** Notion left blocks out when the page was read. */
  partial: boolean;
  /** No record of what the document last agreed on with Notion (a copy, or a lost state): the next read compares the two texts. */
  unsynced: boolean;
}

export type NotionPullResult =
  | { ok: true; updated: number; conflicts: number }
  | { ok: false; reason: NotionSyncError };

export type NotionPushResult =
  /**
   * `updated`: someone else's changes merged in when the page was read (Notion's rewrite of what
   * was sent does not count). `refreshed`: Notion had changed since the last sync, so nothing was
   * sent; its changes were merged in for the user to look at the preview again.
   */
  | { ok: true; pushed: number; updated: number; conflicts: number; failed: NotionCallError | null; refreshed?: true }
  | { ok: false; reason: NotionSyncError };

export type NotionImportResult =
  | { ok: true; path: string; existing: boolean }
  | { ok: false; reason: NotionSyncError };

export type NotionSearchResult =
  | { ok: true; hits: NotionSearchHit[] }
  | { ok: false; reason: NotionSyncError };

/**
 * The page picker before anything is typed: the user's favorites, then the pages they viewed
 * recently. `next` continues `recent` (a page asked for with a cursor has no favorites).
 */
export type NotionBrowseResult =
  | { ok: true; favorites: NotionSearchHit[]; recent: NotionSearchHit[]; next: string | null }
  | { ok: false; reason: NotionSyncError };
