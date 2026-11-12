import { getAppVersion } from '../../appVersion';
import { config } from '../../config';
import { sendLog } from '../../helpers';
import { describeFigure, PLATFORM_NAMES } from '../../movieFigures';
import { filmById, findFilms, readPlatformFigures, type FilmCandidate, type MovieInfoDeps, type PlatformRead } from '../../movieInfo';
import { fetchAndParse } from '../../urlParser';
import { fetchJson } from '../skills/skillFetch';
import { pageFetchLane } from '../lanes';
import { FlowAbortError } from '../runtime';
import type { ResearchSource } from './agentCitations';

/*
 * `movie_info` for `/agent`: which work a film title means and its ratings, read now from IMDb,
 * Rotten Tomatoes and Metacritic. No model call — the model should not do this part: told to read
 * the rating pages, it seldom does, takes figures off search titles and labels them checked, and
 * answers "Dune" for 2021 without a word on 1984. Here the program finds the works (Wikidata), opens each
 * platform page by the film's own id and reads the figures; the model only writes the answer.
 *
 * Only figures and identity reach the model, never page text (a film page carries its synopsis),
 * and the sources it cites are named by the program ("IMDb — Dune (2021)"), not by the page title.
 * The tool is not in the catalog: the movie guide skill names it, so the catalog every run pays for
 * stays the same (`agentToolTiers`); `tool_help` describes it like any other.
 */

export const MOVIE_INFO_LINE = '- "movie_info": Which film or series a title means, and its IMDb, Rotten Tomatoes and Metacritic figures read now from each platform\'s page, each with its own scale and count. Lists the other works with the same title. config keys: "title" (as the user wrote it, any language; a year may follow; REQUIRED), "year" (when known), "id" (an IMDb tt… id or Wikidata Q… id from an earlier result, to pick that work) → returns: the work, the other works with that title, and each platform\'s figures or why there are none, with [n] markers to cite.';

const PROJECT_URL = 'https://github.com/WellWells/yobi';
const PAGE_TIMEOUT_MS = 45_000;
const LOOKUP_TIMEOUT_MS = 15_000;
const RETRY_PAUSE_MS = 2_000;

export interface MovieToolOutcome {
  observation: string;
  status: 'ok' | 'error';
  /** The pages the observation's markers link, named by the program. */
  sources?: ResearchSource[];
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1_000}s`)), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * Wikidata answers a burst with HTTP 429 or a plain-text "You are making too many requests" body
 * (which fails JSON parsing): one more try after a pause, then the error stands.
 */
export async function withOneRetry<T>(request: () => Promise<T>, pauseMs = RETRY_PAUSE_MS): Promise<T> {
  try {
    return await request();
  } catch (err) {
    const reason = err instanceof Error ? `${err.name} ${err.message}` : String(err);
    if (!/\b429\b|\b503\b|SyntaxError|JSON/i.test(reason)) throw err;
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
    return request();
  }
}

export function movieInfoDeps(): MovieInfoDeps {
  // Wikimedia asks automated clients for a User-Agent naming the client and where to find it (a
  // generic one was rate-limited within ten requests); it names the app, never the user.
  const headers = { 'User-Agent': `Yobi/${getAppVersion()} (${PROJECT_URL})`, Accept: 'application/json' };
  return {
    fetchJson: (url) => withOneRetry(() => fetchJson(url, LOOKUP_TIMEOUT_MS, headers)),
    readPage: async (url) => {
      // A hidden page window, like every other page read: one at a time with research and flows.
      const page = await pageFetchLane.runExclusive(() => withTimeout(fetchAndParse(url, { bodyText: true }), PAGE_TIMEOUT_MS));
      return { title: page.title, text: page.cleanedText };
    },
  };
}

/** "沙丘 — "Dune", 2021, Denis Villeneuve": enough to tell the works apart. */
export function describeWork(film: FilmCandidate): string {
  const facts = [
    film.originalTitle && film.originalTitle !== film.label ? `"${film.originalTitle}"` : '',
    film.englishTitle && film.englishTitle !== film.originalTitle && film.englishTitle !== film.label ? `English "${film.englishTitle}"` : '',
    film.year ? String(film.year) : '',
    film.directors.length ? `directed by ${film.directors.join(', ')}` : '',
    film.description,
  ].filter(Boolean);
  return `${film.label || film.originalTitle}${facts.length ? ` — ${facts.join(', ')}` : ''}`;
}

function sourceTitle(platform: PlatformRead['platform'], film: FilmCandidate): string {
  const name = film.englishTitle || film.originalTitle || film.label;
  return `${PLATFORM_NAMES[platform]} — ${name}${film.year ? ` (${film.year})` : ''}`;
}

/** The observation: the work, the others with its title, and each platform's figures with a marker. */
export function movieObservation(film: FilmCandidate, others: readonly FilmCandidate[], reads: readonly PlatformRead[]): { text: string; sources: ResearchSource[] } {
  const sources: ResearchSource[] = [];
  const lines = [`WORK: ${describeWork(film)}${film.imdb ? `; id ${film.imdb}` : ''}.`];
  if (others.length) {
    lines.push('OTHER WORKS WITH THIS TITLE (different works: never mix their figures; name them in one line, or ask which one when it changes the answer; call again with its "id" to read it):');
    for (const other of others) lines.push(`- ${describeWork(other)}; id ${other.imdb ?? other.qid}`);
  }
  lines.push('RATINGS, read now from each platform\'s page (each on its own scale: never average, convert or combine them; a missing one stays missing):');
  for (const read of reads) {
    const name = PLATFORM_NAMES[read.platform];
    if (!read.figures.length || !read.url) {
      lines.push(`- ${name}: not obtained — ${read.missing ?? 'no figure'}.`);
      continue;
    }
    sources.push({ title: sourceTitle(read.platform, film), link: read.url });
    lines.push(`- ${name}: ${read.figures.map(describeFigure).join('; ')} [\\[${sources.length}\\]](<${read.url}>)`);
  }
  return { text: lines.join('\n'), sources };
}

/** One `movie_info` call: the work and its figures, or why there are none. */
export async function runMovieInfo(config_: Record<string, string>, deps: MovieInfoDeps, signal?: AbortSignal): Promise<MovieToolOutcome> {
  if (signal?.aborted) throw new FlowAbortError();
  const title = (config_.title ?? '').trim();
  const id = (config_.id ?? '').trim();
  const year = Number(config_.year);
  if (!title && !id) return { observation: 'ERROR: "title" is required: the film\'s title as the user wrote it.', status: 'error' };
  let film: FilmCandidate | null = null;
  let others: FilmCandidate[] = [];
  try {
    if (id) film = await filmById(id, config.locale, deps);
    if (!film && title) {
      const found = await findFilms(title, config.locale, deps, Number.isFinite(year) && year > 1800 ? year : undefined);
      [film = null, ...others] = found;
    }
  } catch (err) {
    sendLog(`🎬 [Agent] movie_info lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    return { observation: 'ERROR: The film lookup is unavailable right now. Find the platform pages with "search" and read them with "browser".', status: 'error' };
  }
  if (signal?.aborted) throw new FlowAbortError();
  if (!film) {
    return {
      observation: `No film or series titled "${title || id}" was found. Search for its original title and year, then call again with that title or its IMDb id (tt…).`,
      status: 'ok',
    };
  }
  const reads = await readPlatformFigures(film, deps);
  if (signal?.aborted) throw new FlowAbortError();
  sendLog(`🎬 [Agent] movie_info: ${film.imdb ?? film.qid} — ${reads.map((read) => `${read.platform} ${read.figures.length ? 'ok' : read.missing}`).join(', ')}`);
  const { text, sources } = movieObservation(film, others, reads);
  return { observation: text, status: 'ok', ...(sources.length ? { sources } : {}) };
}
