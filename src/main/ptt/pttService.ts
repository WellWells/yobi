import { app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { writeFileAtomic } from '../atomicWrite';
import { sendLog } from '../helpers';
import { fetchRawResponse } from '../pageLoader';
import { raceAbort } from '../promiseRace';
import { userAgentForUrl } from '../userAgent';
import { PTT_HOST } from '../../shared/linkSites/pttLinks';
import { NAVIGATION_HEADERS, stayOnHosts } from '../flow/skills/siteFetch';
import { PTT_BOARDS_FILE, findBoards, parseClassPage, type PttBoardEntry } from './pttBoards';
import {
  hasOlderPage, parsePttListPage, previousIndexPage, pttIndexPageUrl, pttListUrl, pttSearchTerms, type PttListing, type PttQuery,
} from './pttListing';

export { PTT_BOARDS_FILE };

/*
 * Reading www.ptt.cc for the flow step and the /agent connector: a board's posts, and the board
 * directory (the /cls tree, 13k boards, ~1,200 pages). Plain GETs with no cookie. The crawl runs
 * at most two requests at a time and never at app start, only when a caller asks for boards, so
 * it does not hold up other reads. Raw reads, the hot boards included, do not go through a lane
 * or the crawl's limiter (RSS reads do not either): each is one short GET.
 */

const PTT_ORIGIN = `https://${PTT_HOST}`;
const STALE_MS = 7 * 24 * 3_600_000;
const CRAWL_RETRY_MS = 3_600_000;
const CRAWL_CONCURRENCY = 2;
/** PTT board names start with an ASCII letter or digit (8words, 2nd_NTUCCC), so `.` and `..` are never one. */
const BOARD_NAME = /^[A-Za-z0-9][\w.-]{0,39}$/;
const NON_ASCII = /\P{ASCII}/u;
/** 「八卦版」, 「省錢板」: the word for board people add after the short name. */
const BOARD_SUFFIX = /[版板]$/;

export interface PttListPage {
  url: string;
  posts: PttListing[];
  /**
   * true when the page's 上頁 links on; false when the page says it is the oldest (its 上頁 is
   * disabled) or it is past the end; null when the page has no paging bar and says nothing.
   */
  hasOlder: boolean | null;
}

export interface PttService {
  /** Throws PttBoardMissingError when the board does not exist. */
  listPosts(q: PttQuery, signal?: AbortSignal): Promise<PttListPage>;
  /** From the directory when one is saved, else the hot boards; refreshes a stale directory in the background. */
  findBoards(query: string, limit?: number): Promise<PttBoardEntry[]>;
  /** The board's name as the directory spells it; null when there is no such board. */
  resolveBoard(name: string, signal?: AbortSignal): Promise<string | null>;
}

export class PttBoardMissingError extends Error {
  constructor(readonly board: string) {
    super(`PTT board not found: ${board}`);
    this.name = 'PttBoardMissingError';
  }
}

/** PTT answered a status other than 404 with an error. */
export class PttHttpError extends Error {
  constructor(readonly status: number) {
    super(`PTT answered HTTP ${status}`);
    this.name = 'PttHttpError';
  }
}

/** The one board whose short name (`省錢`) is `typed`, a trailing 版 or 板 allowed; null when none or several. */
function boardByShortName(entries: readonly PttBoardEntry[], typed: string): string | null {
  const names = new Set([typed, typed.replace(BOARD_SUFFIX, '')].map((name) => name.toLowerCase()));
  const hits = entries.filter((entry) => entry.short !== '' && names.has(entry.short.toLowerCase()));
  return hits.length === 1 ? hits[0].board : null;
}

export interface PttServiceDeps {
  fetchHtml: (url: string, signal?: AbortSignal) => Promise<{ status: number; text: string }>;
  cacheFile: string;
  now: () => number;
}

interface Directory {
  fetchedAt: number;
  boards: PttBoardEntry[];
}

function isEntry(value: unknown): value is PttBoardEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return typeof e.board === 'string' && typeof e.cls === 'string' && typeof e.title === 'string' && typeof e.short === 'string';
}

async function readDirectory(file: string): Promise<Directory | null> {
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf-8')) as { fetchedAt?: unknown; boards?: unknown } | null;
    const { fetchedAt, boards } = data ?? {};
    if (typeof fetchedAt !== 'number' || !Array.isArray(boards) || !boards.every(isEntry)) return null;
    return { fetchedAt, boards };
  } catch {
    return null;
  }
}

/** Runs at most `limit` tasks at once; the rest wait in call order. */
function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

export function createPttService(deps: PttServiceDeps): PttService {
  const limited = createLimiter(CRAWL_CONCURRENCY);
  let loaded: Promise<Directory | null> | undefined;
  let hotBoards: PttBoardEntry[] | null = null;
  let hotRead: Promise<PttBoardEntry[]> | null = null;
  let crawling: Promise<void> | null = null;
  let crawlFailedAt = 0;

  /**
   * One page of the walk. The retry runs in the same limiter slot, so a failing page is known to
   * have failed for good before the queued pages start; once one has (`walk.failed`) no other
   * page starts a request.
   */
  async function fetchClass(id: string, walk: { failed: boolean }): Promise<{ classIds: string[]; boards: PttBoardEntry[] }> {
    const url = `${PTT_ORIGIN}/cls/${id}`;
    return limited(async () => {
      for (let attempt = 0; ; attempt++) {
        if (walk.failed) throw new Error('PTT class crawl stopped');
        try {
          const { status, text } = await deps.fetchHtml(url);
          if (status >= 400) throw new Error(`HTTP ${status} for ${url}`);
          return parseClassPage(text);
        } catch (err) {
          if (attempt >= 1) {
            walk.failed = true;
            throw err;
          }
        }
      }
    });
  }

  /** Breadth-first from /cls/1, one level at a time; a page that fails twice fails the crawl. */
  async function crawl(): Promise<Directory> {
    const seen = new Set(['1']);
    const boards = new Map<string, PttBoardEntry>();
    const walk = { failed: false };
    let frontier = ['1'];
    while (frontier.length > 0) {
      const pages = await Promise.all(frontier.map((id) => fetchClass(id, walk)));
      frontier = [];
      for (const page of pages) {
        for (const board of page.boards) {
          const key = board.board.toLowerCase();
          if (!boards.has(key)) boards.set(key, board);
        }
        for (const id of page.classIds) {
          if (seen.has(id)) continue;
          seen.add(id);
          frontier.push(id);
        }
      }
    }
    if (boards.size === 0) throw new Error('PTT class tree held no boards');
    return { fetchedAt: deps.now(), boards: [...boards.values()] };
  }

  function startCrawl(): void {
    if (crawling) return;
    if (crawlFailedAt !== 0 && deps.now() - crawlFailedAt < CRAWL_RETRY_MS) return;
    crawling = crawl()
      .then(async (directory) => {
        // Kept for the session even when the file cannot be written.
        loaded = Promise.resolve(directory);
        crawlFailedAt = 0;
        await writeFileAtomic(deps.cacheFile, JSON.stringify(directory)).catch((err: unknown) => {
          sendLog(`📰 [PTT] Could not save the board directory — ${err instanceof Error ? err.message : String(err)}`);
        });
        sendLog(`📰 [PTT] Board directory refreshed — ${directory.boards.length} boards`);
      })
      .catch((err: unknown) => {
        crawlFailedAt = deps.now();
        sendLog(`📰 [PTT] Board directory refresh failed (keeping the old one) — ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        crawling = null;
      });
  }

  async function readHot(): Promise<PttBoardEntry[]> {
    try {
      const { status, text } = await deps.fetchHtml(`${PTT_ORIGIN}/bbs/hotboards.html`);
      if (status >= 400) return [];
      hotBoards = parseClassPage(text).boards;
      return hotBoards;
    } catch {
      return [];
    }
  }

  /**
   * Not through the crawl's limiter: the hot boards stand in while the crawl runs, so they must not
   * wait behind its queued pages. Callers arriving together share one read; a failed one is not
   * kept, the next caller asks again. The read takes no caller's signal (it is one short GET): a
   * caller that aborts stops waiting, the read goes on for the others.
   */
  function hot(signal?: AbortSignal): Promise<PttBoardEntry[]> {
    if (hotBoards) return Promise.resolve(hotBoards);
    hotRead ??= readHot().finally(() => {
      hotRead = null;
    });
    return raceAbort(hotRead, signal);
  }

  /** The directory when one is saved (refreshing it in the background once stale), else the hot boards. */
  async function entries(signal?: AbortSignal): Promise<readonly PttBoardEntry[]> {
    loaded ??= readDirectory(deps.cacheFile);
    const directory = await loaded;
    if (!directory || deps.now() - directory.fetchedAt > STALE_MS) startCrawl();
    return directory ? directory.boards : hot(signal);
  }

  /**
   * Page 2 and on of a board with no condition: the newest index's 「‹ 上頁」 link names page 2
   * (index<P>.html), each older page one less. Past index1 is an empty page.
   */
  async function olderIndexPage(board: string, page: number, signal?: AbortSignal): Promise<PttListPage> {
    const newestUrl = pttListUrl({ board });
    const newest = await deps.fetchHtml(newestUrl, signal);
    if (newest.status === 404) throw new PttBoardMissingError(board);
    if (newest.status >= 400) throw new PttHttpError(newest.status);
    const previous = previousIndexPage(newest.text);
    const n = previous === null ? 0 : previous - page + 2;
    if (n < 1) return { url: newestUrl, posts: [], hasOlder: false };
    const url = pttIndexPageUrl(board, n);
    const { status, text } = await deps.fetchHtml(url, signal);
    // The board has the newest index, so a missing older one is a page that is not there any more.
    if (status === 404) return { url, posts: [], hasOlder: false };
    if (status >= 400) throw new PttHttpError(status);
    return { url, posts: parsePttListPage(text, board), hasOlder: hasOlderPage(text) };
  }

  return {
    async listPosts(q, signal) {
      const page = Math.trunc(q.page ?? 1);
      if (page > 1 && pttSearchTerms(q) === '') return olderIndexPage(q.board, page, signal);
      const url = pttListUrl(q);
      const { status, text } = await deps.fetchHtml(url, signal);
      // Past the last page of a search the site answers 404 too: that is an empty page, not a missing board.
      if (status === 404) {
        if (pttSearchTerms(q) !== '' && (q.page ?? 1) > 1) return { url, posts: [], hasOlder: false };
        throw new PttBoardMissingError(q.board);
      }
      if (status >= 400) throw new PttHttpError(status);
      return { url, posts: parsePttListPage(text, q.board), hasOlder: hasOlderPage(text) };
    },

    async findBoards(query, limit) {
      return findBoards(await entries(), query, limit);
    },

    async resolveBoard(name, signal) {
      const typed = name.trim();
      // 八卦, 省錢版: the short name the board list shows, never a name the site can be asked about.
      if (!BOARD_NAME.test(typed)) return NON_ASCII.test(typed) ? boardByShortName(await entries(signal), typed) : null;
      const known = (await entries(signal)).find((entry) => entry.board.toLowerCase() === typed.toLowerCase());
      if (known) return known.board;
      // Not in the directory: it may have opened since, so ask the site.
      const { status } = await deps.fetchHtml(pttListUrl({ board: typed }), signal);
      if (status === 404) return null;
      if (status >= 400) throw new PttHttpError(status);
      return typed;
    },
  };
}

const stayOnPtt = stayOnHosts('PTT', (host) => host === PTT_HOST);

async function fetchPttHtml(url: string, signal?: AbortSignal): Promise<{ status: number; text: string }> {
  const { status, text, finalUrl } = await fetchRawResponse(url, {
    headers: { 'User-Agent': userAgentForUrl(url), ...NAVIGATION_HEADERS },
    validateRedirectHost: stayOnPtt,
    signal,
  });
  // The over18 question served by the site itself: not answered, like the article reader.
  if (new URL(finalUrl, url).pathname.startsWith('/ask/')) throw new Error('PTT asked a question before the page');
  return { status, text };
}

let instance: PttService | undefined;

/** The one service of the app; nothing is read until a method is called. */
export function pttService(): PttService {
  instance ??= createPttService({
    fetchHtml: fetchPttHtml,
    cacheFile: path.join(app.getPath('userData'), PTT_BOARDS_FILE),
    now: Date.now,
  });
  return instance;
}
