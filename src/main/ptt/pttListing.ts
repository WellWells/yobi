import { load } from 'cheerio';

// The step's form checks keywords too, so the rule lives in shared/.
export { pttKeywordHasOperator } from '../../shared/pttBoard';

/*
 * What www.ptt.cc/bbs/<board>/index.html and /search show, and the URLs that ask for them. Pure:
 * no network here. The page markup and the `q` syntax were measured on 2026-10-24 (see the PTT
 * board subscription design).
 */

const PTT_ORIGIN = 'https://www.ptt.cc';
const MAX_SCORE = 100;

export interface PttListing {
  title: string;
  link: string;
  board: string;
  author: string;
  /** PTT's net score (pushes minus boos), -100..100. */
  score: number;
  /** ms, from the article code. */
  postedAt: number;
}

export interface PttQuery {
  board: string;
  /** A substring of the title, spaces included (PTT does not split it into words). */
  keyword?: string;
  /** Positive: net score >= N. Negative: net score <= N. 0 or absent: no condition. */
  minScore?: number;
  /** An exact title; the whole `q` is then this term and nothing else. */
  thread?: string;
  /** Page from 1: of the search, or with no condition of the index counted back from the newest. */
  page?: number;
}

/** The `nrec` column: '' = 0, 爆 = 100, X1..X9 = -10..-90, XX = -100, else the number. */
export function parseNrec(text: string): number {
  const value = text.trim();
  if (value === '') return 0;
  if (value === '爆') return MAX_SCORE;
  if (value === 'XX') return -MAX_SCORE;
  const boo = /^X([1-9])$/.exec(value);
  if (boo) return -Number(boo[1]) * 10;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 'M.1792725290.A.C32' -> 1792725290000; null when the id is not an article code. */
export function postedAtFromId(id: string): number | null {
  const match = /^[MG]\.(\d+)\.A\./.exec(id);
  return match ? Number(match[1]) * 1000 : null;
}

/** The posts of one list or search page, page order; deleted rows and everything after r-list-sep left out. */
export function parsePttListPage(html: string, board: string): PttListing[] {
  const $ = load(html);
  const posts: PttListing[] = [];
  for (const el of $('div.r-ent, div.r-list-sep').toArray()) {
    if ($(el).hasClass('r-list-sep')) break;
    const row = $(el);
    const anchor = row.find('div.title a').first();
    const href = anchor.attr('href');
    if (!href) continue;
    const id = /\/([^/]+)\.html$/.exec(href)?.[1] ?? '';
    const postedAt = postedAtFromId(id);
    if (postedAt === null) continue;
    posts.push({
      title: anchor.text().replace(/\s+/g, ' ').trim(),
      link: new URL(href, PTT_ORIGIN).href,
      board,
      author: row.find('div.author').first().text().trim(),
      score: parseNrec(row.find('div.nrec').first().text()),
      postedAt,
    });
  }
  return posts;
}

/**
 * The number in the index's 「‹ 上頁」 link (`/bbs/<board>/index<N>.html`): the page just older
 * than the one shown. null when the link is disabled (the board has one page) or missing.
 */
export function previousIndexPage(html: string): number | null {
  const $ = load(html);
  for (const el of $('div.btn-group-paging a.btn').toArray()) {
    const link = $(el);
    if (!link.text().includes('上頁')) continue;
    const number = /\/index(\d+)\.html$/.exec(link.attr('href') ?? '')?.[1];
    return number ? Number(number) : null;
  }
  return null;
}

/**
 * Whether the page's 「‹ 上頁」 button leads on: true when it links on, false when the page marks it
 * disabled (the last page of a search, index1.html), null when there is no such button and the
 * page says nothing. An empty page can still have older ones: deleted rows have no link, so a page
 * of only deleted posts parses to none.
 */
export function hasOlderPage(html: string): boolean | null {
  const $ = load(html);
  for (const el of $('div.btn-group-paging a.btn').toArray()) {
    const link = $(el);
    if (link.text().includes('上頁')) return !link.hasClass('disabled');
  }
  return null;
}

/** The absolute URL of a board's numbered index page (`index<N>.html`, oldest = 1). */
export function pttIndexPageUrl(board: string, n: number): string {
  return `${PTT_ORIGIN}/bbs/${encodeURIComponent(board)}/index${Math.trunc(n)}.html`;
}

/** The `q` value PTT's search takes; '' when the query has no condition. */
export function pttSearchTerms(q: PttQuery): string {
  const thread = q.thread?.trim();
  if (thread) return `thread:${thread}`;
  const terms: string[] = [];
  const keyword = q.keyword?.trim();
  if (keyword) terms.push(keyword);
  const raw = q.minScore ?? 0;
  const score = Number.isFinite(raw) ? Math.trunc(raw) : 0;
  if (score !== 0) terms.push(`recommend:${Math.max(-MAX_SCORE, Math.min(MAX_SCORE, score))}`);
  return terms.join(' ');
}

/** The absolute URL that lists the query: the board index with no condition, else its search. */
export function pttListUrl(q: PttQuery): string {
  const base = `${PTT_ORIGIN}/bbs/${encodeURIComponent(q.board)}`;
  const terms = pttSearchTerms(q);
  if (terms === '') return `${base}/index.html`;
  const params = new URLSearchParams({ q: terms });
  const page = Math.trunc(q.page ?? 1);
  if (page > 1) params.set('page', String(page));
  return `${base}/search?${params.toString()}`;
}
