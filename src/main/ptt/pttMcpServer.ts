/**
 * In-process MCP server for PTT (www.ptt.cc): find a board, list or search one board's posts, read
 * a post with its pushes. Takes the PTT service and the article reader as parameters, so the tool
 * surface is tested offline with fakes; the real ones are wired in pttConnection.ts.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { fitPushes, pushLineText, taipeiTime } from '../flow/skills/pushThread';
import { tallyPushes } from '../flow/skills/pttPosts';
import type { XThread } from '../flow/skills/xPosts';
import type { XRead } from '../flow/skills/xReader';
import { createToolServer } from '../mcp/inProcessServer';
import type { PttBoardEntry } from './pttBoards';
import { pttKeywordHasOperator, pttSearchTerms, type PttListing, type PttQuery } from './pttListing';
import { PttBoardMissingError, type PttListPage, type PttService } from './pttService';

export const PTT_SERVER_NAME = 'PTT';

export interface PttMcpDeps {
  service: Pick<PttService, 'listPosts' | 'findBoards' | 'resolveBoard'>;
  /** `readPttThread`: the article and every push; `value` null when the page held none. */
  readThread: (url: string, signal?: AbortSignal) => Promise<XRead<XThread>>;
}

const BOARDS_MAX = 10;
const PAGES_MAX = 3;
/**
 * Closes every non-empty listing. Live run 2026-10-24: asked what people say about a topic, the
 * agent answered from the titles alone; the hint sits where the next step is decided.
 */
const PUSHES_HINT = " Titles and scores only: what people said is in each post's pushes, read with ptt_read_post.";
const PUSHES_MAX = 1_000;
const ARTICLE_MAX_CHARS = 5_000;
/**
 * The whole `ptt_read_post` result, as the JSON the agent reads. Sized against the /agent
 * observation caps (agentEngine.ts): a BYOK observation is cut at 16,000 characters
 * (BYOK_OBSERVATION_LIMIT) and a browser run's newest one at 24,000
 * (BROWSER_DELTA_OBSERVATION_LIMIT, shared between up to three batched calls). 12,000 arrives
 * whole on both, and two reads batched arrive whole on a browser run as long as the 24,000 is split
 * evenly between them. When a browser run rebuilds its whole turn prompt, earlier observations are
 * kept to 3,500 each (BROWSER_OBSERVATION_LIMIT): the heading, the tally and the start of the text
 * survive that, the pushes do not. It also stays under the 14,000 the built-in push analysis gives
 * one thread.
 */
export const READ_POST_MAX_CHARS = 12_000;
/** Tries at fitting the pushes once the JSON is measured: each shrinks their room by the overflow. */
const FIT_TRIES = 6;
/** PTT's times are Taiwan's; the year a push without one belongs to is the article's, there. */
const TAIPEI_OFFSET_MS = 8 * 3_600_000;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export const PTT_TOOLS: Tool[] = [
  {
    name: 'ptt_find_board',
    description:
      'Find PTT boards by topic or name (省錢, 八卦, iPhone, stock). Returns up to 10 lines of board · class · title; the board names are what the other PTT tools take.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A topic or board name, Chinese or English' },
      },
      required: ['query'],
    },
    annotations: { title: 'Find a PTT board', ...READ_ONLY },
  },
  {
    name: 'ptt_board_posts',
    description:
      "List one PTT board's posts, newest first, 20 per page: title, link, author, net score and Taipei time. Optional filters: a title keyword, a score threshold, or one exact thread title.",
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board name (Lifeismoney, Gossiping)' },
        keyword: { type: 'string', description: 'One literal title substring, spaces included' },
        min_score: { type: 'number', description: '30 = score at least 30; -20 = score at most -20 (booed)' },
        thread: { type: 'string', description: 'An exact title: that thread only; other filters are ignored' },
        pages: { type: 'number', description: `Pages to read back from the newest, 1-${PAGES_MAX}; default 1` },
      },
      required: ['board'],
    },
    annotations: { title: 'List PTT board posts', ...READ_ONLY },
  },
  {
    name: 'ptt_read_post',
    description:
      'Read one PTT post: title, author, board, time, the tally of every push (推/噓/→), the text and the pushes (sampled when there are many).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The post link (https://www.ptt.cc/bbs/<board>/M.….html)' },
        max_pushes: { type: 'number', description: 'Most pushes to write out; 0 = the text only' },
      },
      required: ['url'],
    },
    annotations: { title: 'Read a PTT post', ...READ_ONLY },
  },
];

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required argument: ${field}`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** A number, or a numeric string the model wrote; undefined for anything else. */
function numberArg(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function chars(text: string): number {
  return Array.from(text).length;
}

function clip(text: string, max: number): string {
  const all = Array.from(text);
  return all.length > max ? `${all.slice(0, max).join('')}…` : text;
}

function boardLine(entry: PttBoardEntry): string {
  return `${entry.board} · ${entry.cls} · ${entry.title}`;
}

function signed(score: number): string {
  return score > 0 ? `+${score}` : String(score);
}

function postLine(post: PttListing): string {
  return `[${signed(post.score)}] ${taipeiTime(post.postedAt)} · ${post.author} · ${post.title} · ${post.link}`;
}

function unknownBoard(board: string): Record<string, unknown> {
  return { board, found: false, note: `There is no PTT board named "${board}". Find its exact name with ptt_find_board.` };
}

async function findBoard(deps: PttMcpDeps, args: Record<string, unknown>): Promise<unknown> {
  const query = requireString(args.query, 'query');
  const boards = await deps.service.findBoards(query, BOARDS_MAX);
  if (boards.length === 0) {
    return { query, boards: [], note: 'No board matched. Try another word for the topic (Chinese or English), or ask the user which board.' };
  }
  return { query, boards: boards.map(boardLine) };
}

async function boardPosts(deps: PttMcpDeps, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const typed = requireString(args.board, 'board');
  const keyword = optionalString(args.keyword);
  const thread = optionalString(args.thread);
  if (!thread && keyword && pttKeywordHasOperator(keyword)) {
    return {
      board: typed,
      posts: [],
      note: 'keyword is one literal title substring and cannot hold search operators (recommend:, thread:, author:). Use min_score for a score threshold and thread for an exact title; there is no author filter.',
    };
  }
  const board = await deps.service.resolveBoard(typed, signal);
  if (!board) return unknownBoard(typed);
  const query: PttQuery = { board, keyword, minScore: numberArg(args.min_score), thread };
  const searching = pttSearchTerms(query) !== '';
  const pages = Math.min(PAGES_MAX, Math.max(1, numberArg(args.pages) ?? 1));
  const seen = new Map<string, PttListing>();
  let read = 0;
  let exhausted = false;
  let url = '';
  for (let page = 1; page <= pages; page++) {
    let result: PttListPage;
    try {
      result = await deps.service.listPosts({ ...query, page }, signal);
    } catch (err) {
      if (err instanceof PttBoardMissingError) return unknownBoard(typed);
      throw err;
    }
    url ||= result.url;
    read = page;
    // A page can repeat posts of the one before when the board moved on in between.
    for (const post of result.posts) if (!seen.has(post.link)) seen.set(post.link, post);
    // A short page is no end: a search page can be short with older pages after it (19 of 20 on
    // page 1 is common), and the newest index page leaves its pinned posts out. The end is a page
    // whose own 上頁 is disabled, or an empty page when the paging bar says nothing. An empty page
    // whose 上頁 links on is no end either: its rows were all deleted posts, which have no link.
    if (result.hasOlder === false || (result.hasOlder === null && result.posts.length === 0)) {
      exhausted = true;
      break;
    }
  }
  const posts = [...seen.values()].sort((a, b) => b.postedAt - a.postedAt);
  const ignored = thread && (keyword || query.minScore) ? ' thread was given, so keyword and min_score were ignored.' : '';
  const older = exhausted ? 'There are no older ones.' : `Older ones are on later pages (pages up to ${PAGES_MAX}).`;
  const count = `${posts.length} ${searching ? 'matching ' : ''}${posts.length === 1 ? 'post' : 'posts'}`;
  let note: string;
  if (posts.length === 0 && !exhausted) {
    note = `No ${searching ? 'matching post' : 'post'} on the ${read} page(s) read (deleted and pinned posts are left out). ${older}${ignored}`;
  } else if (posts.length === 0) {
    note = searching ? `No post on this board matched.${ignored}` : 'The board has no posts.';
  } else if (searching) {
    note = `${count}, newest first, from ${read} search page(s) of up to 20. ${older}${ignored}${PUSHES_HINT}`;
  } else {
    note = `${count}, newest first, from the board's newest ${read} index page(s) (pinned posts left out). ${older}${PUSHES_HINT}`;
  }
  return { board, search: pttSearchTerms(query) || null, url, posts: posts.map(postLine), note };
}

async function readPost(deps: PttMcpDeps, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const url = requireString(args.url, 'url');
  const { status, value } = await deps.readThread(url, signal);
  if (status === 400) throw new Error(`Not a PTT post link: '${url}'. Expected https://www.ptt.cc/bbs/<board>/M.<id>.html — list a board with ptt_board_posts to get one.`);
  if (!value?.pushes) throw new Error(`Could not read the post at ${url}: it was deleted, never existed, or PTT changed its page (HTTP ${status}).`);
  const { focal, pushes } = value;
  const lines = pushes.lines;
  const tally = tallyPushes(lines);
  const maxPushes = Math.min(PUSHES_MAX, Math.max(0, numberArg(args.max_pushes) ?? PUSHES_MAX));
  const articleYear = focal.createdAt ? new Date(focal.createdAt + TAIPEI_OFFSET_MS).getUTCFullYear() : 0;
  const rendered = lines.map((line) => pushLineText(line, articleYear));
  const head = {
    board: pushes.board,
    title: pushes.title,
    author: focal.name ? `${focal.author} (${focal.name})` : focal.author,
    posted: taipeiTime(focal.createdAt),
    link: focal.link,
    push_tally: `推 ${tally.push} · 噓 ${tally.boo} · → ${tally.arrow} · ${lines.length} in all`,
    text: clip(pushes.body, ARTICLE_MAX_CHARS) || '(no text)',
  };
  const shown = (picked: readonly number[]): string => {
    if (picked.length === lines.length) return `all ${lines.length}`;
    if (picked.length === 0) return `0 of ${lines.length}`;
    return `${picked.length} of ${lines.length}: the opening ones, the 噓 and the latest ones; gaps are marked`;
  };
  const build = (picked: readonly number[], text: string): Record<string, unknown> => ({
    ...head,
    pushes_shown: shown(picked),
    pushes: text ? text.split('\n') : [],
  });
  let room = Math.max(0, READ_POST_MAX_CHARS - chars(JSON.stringify(build([], ''))));
  let result = build([], '');
  for (let tries = 0; tries < FIT_TRIES; tries++) {
    const { picked, text } = fitPushes(lines, rendered, maxPushes, room);
    result = build(picked, text);
    const over = chars(JSON.stringify(result)) - READ_POST_MAX_CHARS;
    if (over <= 0) return result;
    room = Math.max(0, room - over - 1);
    result = build([], '');
  }
  return result;
}

async function dispatch(deps: PttMcpDeps, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  switch (name) {
    case 'ptt_find_board':
      return findBoard(deps, args);
    case 'ptt_board_posts':
      return boardPosts(deps, args, signal);
    case 'ptt_read_post':
      return readPost(deps, args, signal);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function createPttMcpServer(deps: PttMcpDeps): Server {
  return createToolServer({ name: PTT_SERVER_NAME, tools: PTT_TOOLS, dispatch: (name, args, signal) => dispatch(deps, name, args, signal) });
}
