import { sendLog } from '../../helpers';
import { makeCheckpointStore } from '../checkpoint';
import { cacheWindowMs, reconcileSeenCache, type SeenCheckpoint } from '../seenCache';
import { FlowUserError } from '../userError';
import { RSS_BURST_CAP } from './rssRead';
import { PttBoardMissingError, PttHttpError, pttService, type PttService } from '../../ptt/pttService';
import { pttListUrl, type PttListing, type PttQuery } from '../../ptt/pttListing';
import { pttKeywordHasOperator, pttMinScore } from '../../../shared/pttBoard';
import { localIsoString } from '../../../shared/localTime';

/*
 * One PTT board's first page (20 articles), PTT's own search narrowing it by a title substring
 * and the net score; only the articles not seen before go on, as with rss.
 */

const pttBoardCheckpoints = makeCheckpointStore<SeenCheckpoint>('ptt_board');

const FIRST_RUN_COUNT = 1;

/** The step's fields checked, before anything is read; the board is still as typed. */
export function pttBoardQuery(config: Record<string, string>): PttQuery {
  const board = (config.board ?? '').trim();
  if (!board) throw new FlowUserError('flow.error.pttBoardEmpty', {}, 'PTT board: no board given');
  const keyword = (config.keyword ?? '').trim();
  if (pttKeywordHasOperator(keyword)) {
    throw new FlowUserError('flow.error.pttKeywordOperator', { keyword }, `PTT board: the keyword "${keyword}" holds a PTT search operator`);
  }
  const minScore = pttMinScore(config.scoreMode, config.score);
  if (minScore === null) {
    throw new FlowUserError('flow.error.pttScore', {}, `PTT board: the score must be a whole number from 1 to 100, not "${config.score ?? ''}"`);
  }
  return { board, ...(keyword ? { keyword } : {}), ...(minScore !== 0 ? { minScore } : {}) };
}

function boardMissing(board: string): FlowUserError {
  return new FlowUserError('flow.error.pttBoardMissing', { board }, `PTT board not found: ${board}`);
}

/**
 * The query with the board's name as the directory spells it, and that board's first page newest
 * first. Shared with the setup preview, so it lists what the step reads.
 */
export async function readPttBoard(
  config: Record<string, string>,
  signal: AbortSignal | undefined,
  service: PttService,
): Promise<{ query: PttQuery; url: string; posts: PttListing[] }> {
  const typed = pttBoardQuery(config);
  try {
    const board = await service.resolveBoard(typed.board, signal);
    if (!board) throw boardMissing(typed.board);
    const query = { ...typed, board };
    const { url, posts } = await service.listPosts(query, signal);
    return { query, url, posts: [...posts].sort((a, b) => b.postedAt - a.postedAt) };
  } catch (err) {
    if (err instanceof PttBoardMissingError) throw boardMissing(err.board);
    // ptt_hot runs every 10 minutes: an outage reaches the notification in the user's language.
    if (err instanceof PttHttpError) {
      throw new FlowUserError('flow.error.pttUnavailable', { status: String(err.status) }, `PTT is not answering (HTTP ${err.status})`);
    }
    throw err;
  }
}

export function pttBoardItem(post: PttListing): Record<string, string> {
  return {
    title: post.title,
    link: post.link,
    board: post.board,
    author: post.author,
    score: String(post.score),
    date: localIsoString(new Date(post.postedAt)),
  };
}

export async function execPttBoard(
  config: Record<string, string>,
  stepId: string,
  signal?: AbortSignal,
  service: PttService = pttService(),
): Promise<string> {
  const { query, url, posts } = await readPttBoard(config, signal, service);
  sendLog(`📰 [Flow] PTT board step — ${url}: ${posts.length} article(s) on the first page`);

  // The query is a seen key of its own: a new board, keyword or score seeds like a first run. Board
  // names are case-blind on PTT, and resolveBoard answers a board outside the hot boards as typed
  // until the directory is crawled, then as the directory spells it: the key must not change then.
  const queryKey = `ptt-query:${pttListUrl({ ...query, board: query.board.toLowerCase() })}`;
  const { fresh } = await reconcileSeenCache(pttBoardCheckpoints, stepId, [queryKey, ...posts.map((p) => p.link)], undefined);
  const freshLinks = new Set(fresh);
  const oldest = Date.now() - cacheWindowMs(undefined);
  const inWindow = (post: PttListing): boolean => post.postedAt >= oldest;

  let out: PttListing[];
  if (freshLinks.has(queryKey)) {
    out = posts.slice(0, FIRST_RUN_COUNT).filter(inWindow);
    sendLog(`📰 [Flow] PTT board: new query — seeding the checkpoint, returning ${out.length} article(s)`);
  } else {
    const unseen = posts.filter((p) => freshLinks.has(p.link));
    const recent = unseen.filter(inWindow);
    if (recent.length < unseen.length) {
      sendLog(`📰 [Flow] PTT board: ${unseen.length - recent.length} unseen article(s) posted before the seen window — dropped`);
    }
    out = recent.slice(0, RSS_BURST_CAP);
    if (recent.length > RSS_BURST_CAP) sendLog(`📰 [Flow] PTT board: burst of ${recent.length} — returning the newest ${RSS_BURST_CAP}`);
    sendLog(`📰 [Flow] PTT board: ${out.length} new article(s) since the last run`);
  }
  return out.length === 0 ? '[]' : JSON.stringify(out.map(pttBoardItem));
}
