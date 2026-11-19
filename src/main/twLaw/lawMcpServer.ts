/**
 * In-process MCP server for Taiwan's laws and regulations (全國法規資料庫): find a law by name or
 * short name, read its articles or outline, search article text, list recent amendments. Answers
 * come from the local index (lawStore.ts), quoted as the ministry publishes them, each with its
 * official link and the date of the data. The index is a parameter, so tests use a small one.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createToolServer, type ToolServer } from '../mcp/inProcessServer';
import type { ArticleRow, LawIndex, LawRow } from './lawIndex';
import { datasetDate, lawUrl, parseArticleSpec, splitLawAndArticles, ymd } from './lawText';

export const LAW_SERVER_NAME = 'Taiwan Law';

export interface LawMcpDeps {
  /** The open index; the first call may wait for the download and build. */
  index: () => Promise<LawIndex>;
  now?: () => number;
}

const FIND_MAX = 10;
const ARTICLES_MAX = 40;
const SEARCH_DEFAULT = 10;
const SEARCH_MAX = 30;
const RECENT_DEFAULT_DAYS = 30;
const RECENT_MAX_DAYS = 366;
const RECENT_MAX = 50;
const OUTLINE_MAX = 120;
const HISTORY_MAX_CHARS = 1_500;
const SNIPPET_CHARS = 240;
/**
 * The whole result as the JSON the agent reads, sized like the PTT reader's (pttMcpServer.ts):
 * a BYOK observation is cut at 16,000 characters, a browser run's newest one at 24,000 shared by
 * up to three batched calls.
 */
export const LAW_RESULT_MAX_CHARS = 12_000;
const DAY_MS = 86_400_000;
const TAIPEI_OFFSET_MS = 8 * 3_600_000;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const LAW_TOOLS: Tool[] = [
  {
    name: 'tw_law_find',
    description:
      "Find Taiwan's laws and regulations by name or short name (勞基法, 個資法, 道路交通管理處罰條例, 施行細則). Returns up to 10: exact name, level (憲法/法律/命令), in force or abolished, last amended, article count, link.",
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'A law name, part of one, or its common short name' } },
      required: ['query'],
    },
    annotations: { title: 'Find a Taiwan law', ...READ_ONLY },
  },
  {
    name: 'tw_law_articles',
    description:
      "Read articles of one Taiwan law, word for word, each with its chapter and official link. Without articles: the law's facts, amendment history and chapter outline.",
    inputSchema: {
      type: 'object',
      properties: {
        law: { type: 'string', description: 'The law name or short name; "民法第184條" also works' },
        articles: {
          type: 'string',
          description: 'Article numbers: one (24, 184-1, 第184條之1), a list (24、32) or a range (1~5, 第24條至第26條). Leave out for the outline',
        },
      },
      required: ['law'],
    },
    annotations: { title: 'Read Taiwan law articles', ...READ_ONLY },
  },
  {
    name: 'tw_law_search',
    description:
      "Search the text of Taiwan's laws and regulations for articles holding every given word, best match first. Literal words, not meaning: use a statute's own wording.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words the article must contain, separated by spaces' },
        law: { type: 'string', description: 'Only this law (name or short name)' },
        include_orders: { type: 'boolean', description: 'Include regulations (命令: 施行細則, 規則, 辦法); default true' },
        include_abolished: { type: 'boolean', description: 'Include abolished laws; default false' },
        limit: { type: 'number', description: `Most articles to return, 1-${SEARCH_MAX}; default ${SEARCH_DEFAULT}` },
      },
      required: ['query'],
    },
    annotations: { title: 'Search Taiwan law text', ...READ_ONLY },
  },
  {
    name: 'tw_law_recent',
    description: "List Taiwan's laws and regulations amended recently, newest first, with links.",
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: `Amended within this many days, 1-${RECENT_MAX_DAYS}; default ${RECENT_DEFAULT_DAYS}` },
        include_orders: { type: 'boolean', description: 'Include regulations (命令); default false' },
      },
    },
    annotations: { title: 'Recently amended Taiwan laws', ...READ_ONLY },
  },
];

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required argument: ${field}`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberArg(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function boolArg(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  return Math.min(max, Math.max(min, value ?? fallback));
}

function chars(text: string): number {
  return Array.from(text).length;
}

function clip(text: string, max: number): string {
  const all = Array.from(text);
  return all.length > max ? `${all.slice(0, max).join('')}…` : text;
}

/** The end of the text: a history lists the newest amendment last. */
function clipStart(text: string, max: number): string {
  const all = Array.from(text);
  return all.length > max ? `…${all.slice(all.length - max).join('')}` : text;
}

function tidy(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t　]+\n/g, '\n').trim();
}

/** The data's date, from the newest export the index was built from. */
function dataAsOf(index: LawIndex): string {
  const dates = Object.values(index.meta.updates).map(datasetDate).filter(Boolean).sort();
  return dates[dates.length - 1] ?? '';
}

function source(index: LawIndex): string {
  const date = dataAsOf(index);
  return `全國法規資料庫 (law.moj.gov.tw)${date ? `, data as of ${date}` : ''}`;
}

function levelOf(law: LawRow): string {
  return law.level || (law.source === 'order' ? '命令' : '法律');
}

function lawSummary(law: LawRow): Record<string, unknown> {
  return {
    name: law.name,
    level: levelOf(law),
    status: law.abolished ? 'abolished' : 'in force',
    last_amended: ymd(law.modified),
    articles: law.articles,
    url: lawUrl(law.pcode),
  };
}

function articleOut(law: LawRow, row: ArticleRow): Record<string, unknown> {
  return {
    article: `第 ${row.no} 條`,
    ...(row.chapter ? { chapter: row.chapter } : {}),
    text: tidy(row.body),
    url: lawUrl(law.pcode, row.no),
  };
}

/** The window of an article's text around the first word found, for a search hit. */
function snippet(body: string, terms: readonly string[]): string {
  const text = tidy(body);
  const all = Array.from(text);
  if (all.length <= SNIPPET_CHARS) return text;
  const at = terms.map((term) => text.indexOf(term)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const startChar = Array.from(text.slice(0, at)).length;
  const start = Math.max(0, startChar - Math.floor(SNIPPET_CHARS / 3));
  const end = Math.min(all.length, start + SNIPPET_CHARS);
  return `${start > 0 ? '…' : ''}${all.slice(start, end).join('')}${end < all.length ? '…' : ''}`;
}

/** Drops list items from the end until the JSON fits, saying how many were left out. */
function fitList(build: (count: number) => Record<string, unknown>, total: number, noun: string): Record<string, unknown> {
  let count = total;
  let result = build(count);
  while (count > 1 && chars(JSON.stringify(result)) > LAW_RESULT_MAX_CHARS) {
    count = Math.max(1, Math.floor(count * 0.8));
    result = build(count);
  }
  if (count < total) result.note = `${[result.note, `Showing ${count} of ${total} ${noun} to fit; ask for fewer at a time to read the rest.`].filter(Boolean).join(' ')}`;
  return result;
}

function resolveLaw(index: LawIndex, typed: string): LawRow {
  const [best] = index.findLaws(typed, 1);
  if (!best) {
    throw new Error(`No Taiwan law or regulation is named like "${typed}". Find its exact name with tw_law_find, or search its text with tw_law_search.`);
  }
  return best;
}

async function find(deps: LawMcpDeps, args: Record<string, unknown>): Promise<unknown> {
  const query = requireString(args.query, 'query');
  const index = await deps.index();
  const matches = index.findLaws(splitLawAndArticles(query).law, FIND_MAX);
  if (matches.length === 0) {
    return { query, matches: [], note: 'No law name matched. Try a shorter part of the name, or search the article text with tw_law_search.', source: source(index) };
  }
  return { query, matches: matches.map(lawSummary), source: source(index) };
}

async function articles(deps: LawMcpDeps, args: Record<string, unknown>): Promise<unknown> {
  const typed = requireString(args.law, 'law');
  const split = splitLawAndArticles(typed);
  const spec = optionalString(args.articles) ?? split.articles;
  const index = await deps.index();
  const law = resolveLaw(index, split.law);
  const head = {
    law: law.name,
    level: levelOf(law),
    status: law.abolished ? 'abolished' : 'in force',
    last_amended: ymd(law.modified),
    url: lawUrl(law.pcode),
    ...(law.name !== split.law ? { matched_from: split.law } : {}),
  };
  if (!spec) return outline(index, law, head);
  const { items, unreadable } = parseArticleSpec(spec);
  if (items.length === 0) {
    throw new Error(`Could not read the article numbers "${spec}". Write them like 24, 184-1, 24、32 or 1~5.`);
  }
  const rows = index.articles(law.id, items, ARTICLES_MAX);
  const notes: string[] = [];
  if (unreadable.length > 0) notes.push(`Not article numbers, skipped: ${unreadable.join(', ')}.`);
  if (rows.length === 0) notes.push(`${law.name} has no article ${spec}; it has ${law.articles} articles. Read the outline (leave articles out) to see the numbers.`);
  if (rows.length >= ARTICLES_MAX) notes.push(`At most ${ARTICLES_MAX} articles per call; ask for the next range for more.`);
  if (law.abolished) notes.push('This law is abolished: its text is history, not the law in force.');
  return fitList(
    (count) => ({
      ...head,
      articles: rows.slice(0, count).map((row) => articleOut(law, row)),
      ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
      source: source(index),
    }),
    rows.length,
    'articles',
  );
}

function outline(index: LawIndex, law: LawRow, head: Record<string, unknown>): Record<string, unknown> {
  const detail = index.detail(law.id);
  const list = index.articleList(law.id);
  const sections: string[] = [];
  let current: { chapter: string; first: string; last: string; count: number } | null = null;
  const flush = (): void => {
    if (!current) return;
    const span = current.count > 1 ? `第 ${current.first}～${current.last} 條` : `第 ${current.first} 條`;
    sections.push(current.chapter ? `${current.chapter}：${span}` : span);
  };
  for (const { no, chapter } of list) {
    if (current && current.chapter === chapter) {
      current.last = no;
      current.count += 1;
      continue;
    }
    flush();
    current = { chapter, first: no, last: no, count: 1 };
  }
  flush();
  const shown = sections.slice(0, OUTLINE_MAX);
  return {
    ...head,
    category: law.category,
    ...(detail?.engName ? { english_name: detail.engName } : {}),
    articles_total: law.articles,
    ...(detail?.effectiveNote ? { effective_note: tidy(detail.effectiveNote) } : {}),
    ...(detail?.foreword ? { foreword: clip(tidy(detail.foreword), 600) } : {}),
    outline: shown,
    ...(sections.length > shown.length ? { outline_note: `${sections.length - shown.length} more sections not listed` } : {}),
    ...(detail && detail.attachments.length > 0 ? { attachments: detail.attachments.slice(0, 10) } : {}),
    ...(detail?.histories ? { history_latest: clipStart(tidy(detail.histories), HISTORY_MAX_CHARS) } : {}),
    note: 'Read articles by number with the articles argument.',
    source: source(index),
  };
}

async function search(deps: LawMcpDeps, args: Record<string, unknown>): Promise<unknown> {
  const query = requireString(args.query, 'query');
  const terms = [...new Set(query.normalize('NFKC').split(/[\s,，、]+/).map((term) => term.replace(/^"+|"+$/g, '')).filter(Boolean))];
  if (terms.length === 0) throw new Error('Missing required argument: query');
  const limit = clamp(numberArg(args.limit), 1, SEARCH_MAX, SEARCH_DEFAULT);
  const index = await deps.index();
  const lawName = optionalString(args.law);
  const only = lawName ? resolveLaw(index, splitLawAndArticles(lawName).law) : undefined;
  const includeOrders = boolArg(args.include_orders, true);
  const includeAbolished = boolArg(args.include_abolished, false);
  const rows = index.search({
    terms,
    lawIds: only ? [only.id] : undefined,
    // A named regulation is searched even when orders are left out.
    includeOrders: includeOrders || only?.source === 'order',
    includeAbolished: includeAbolished || Boolean(only?.abolished),
    limit,
  });
  const hits = rows.flatMap((row) => {
    const law = index.law(row.law);
    if (!law) return [];
    return [{
      law: law.name,
      article: `第 ${row.no} 條`,
      ...(row.chapter ? { chapter: row.chapter } : {}),
      text: snippet(row.body, terms),
      url: lawUrl(law.pcode, row.no),
      ...(law.abolished ? { status: 'abolished' } : {}),
    }];
  });
  const note = hits.length === 0
    ? 'No article holds all of these words. Use fewer words, or the wording a statute would use (延長工作時間 rather than 加班), or other forms of it.'
    : 'Snippets only: read the whole article with tw_law_articles before quoting it.';
  return fitList(
    (count) => ({ query: terms.join(' '), ...(only ? { law: only.name } : {}), hits: hits.slice(0, count), note, source: source(index) }),
    hits.length,
    'hits',
  );
}

function taipeiYmd(ms: number): string {
  return new Date(ms + TAIPEI_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, '');
}

async function recent(deps: LawMcpDeps, args: Record<string, unknown>): Promise<unknown> {
  const days = clamp(numberArg(args.days), 1, RECENT_MAX_DAYS, RECENT_DEFAULT_DAYS);
  const includeOrders = boolArg(args.include_orders, false);
  const index = await deps.index();
  const now = (deps.now ?? Date.now)();
  const since = taipeiYmd(now - days * DAY_MS);
  const laws = index.recent(since, includeOrders, RECENT_MAX);
  return {
    since: ymd(since),
    laws: laws.map(lawSummary),
    ...(laws.length >= RECENT_MAX ? { note: `The ${RECENT_MAX} most recent; ask for fewer days to see a shorter span.` } : {}),
    source: source(index),
  };
}

async function dispatch(deps: LawMcpDeps, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'tw_law_find':
      return find(deps, args);
    case 'tw_law_articles':
      return articles(deps, args);
    case 'tw_law_search':
      return search(deps, args);
    case 'tw_law_recent':
      return recent(deps, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function createLawMcpServer(deps: LawMcpDeps): ToolServer {
  return createToolServer({ name: LAW_SERVER_NAME, tools: LAW_TOOLS, dispatch: (name, args) => dispatch(deps, name, args) });
}
