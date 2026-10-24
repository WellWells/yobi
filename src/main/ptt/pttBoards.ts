import { load } from 'cheerio';

/*
 * The board directory of www.ptt.cc: /cls/<n> pages (a tree of classes) and /bbs/hotboards.html
 * share one markup, `a.board` rows. A row linking /cls/<n> is a sub-class, one linking
 * /bbs/<board>/index.html is a board. Pure: the walk itself lives in pttService.ts.
 */

/** The directory's file name in the user-data folder; a rebuildable cache (see data-lifecycle). */
export const PTT_BOARDS_FILE = 'ptt-boards.json';

export interface PttBoardEntry {
  board: string;
  /** The class column ('綜合'). */
  cls: string;
  /** The board's title without the leading circle. */
  title: string;
  /** The text inside the title's leading brackets ('省錢'), '' when there are none. */
  short: string;
}

const DEFAULT_LIMIT = 10;

/** The sub-class ids and the boards on one class (or hot boards) page, page order. */
export function parseClassPage(html: string): { classIds: string[]; boards: PttBoardEntry[] } {
  const $ = load(html);
  const classIds: string[] = [];
  const boards: PttBoardEntry[] = [];
  for (const el of $('a.board').toArray()) {
    const row = $(el);
    const href = row.attr('href') ?? '';
    const classId = /^\/cls\/(\d+)$/.exec(href)?.[1];
    if (classId) {
      if (!classIds.includes(classId)) classIds.push(classId);
      continue;
    }
    const board = row.find('div.board-name').first().text().trim();
    if (!board || !/^\/bbs\/[^/]+\/index\.html$/.test(href)) continue;
    const title = row.find('div.board-title').first().text().replace(/^\s*◎\s*/, '').trim();
    boards.push({
      board,
      cls: row.find('div.board-class').first().text().trim(),
      title,
      short: /^\[([^\]]*)\]/.exec(title)?.[1].trim() ?? '',
    });
  }
  return { classIds, boards };
}

function rankOf(entry: PttBoardEntry, query: string): number {
  const name = entry.board.toLowerCase();
  if (name === query) return 0;
  if (entry.short !== '' && entry.short.toLowerCase() === query) return 1;
  if (name.startsWith(query)) return 2;
  const fields = [entry.short, entry.title, entry.cls, entry.board];
  return fields.some((field) => field.toLowerCase().includes(query)) ? 3 : -1;
}

/**
 * Boards matching `query`: exact English name, exact short name, name prefix, then a substring of
 * the short name, title, class or name. Equal ranks keep the directory's order.
 */
export function findBoards(entries: readonly PttBoardEntry[], query: string, limit = DEFAULT_LIMIT): PttBoardEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  return entries
    .map((entry, index) => ({ entry, index, rank: rankOf(entry, needle) }))
    .filter((hit) => hit.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map((hit) => hit.entry);
}
