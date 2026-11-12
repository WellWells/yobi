import { MOVIE_PLATFORMS, readFigures, type MovieFigure, type MoviePlatform } from './movieFigures';

/*
 * Which work a film title means, and its rating figures read now from each platform's own page.
 *
 * Identity comes from Wikidata (public, keyless): a title in any language lists every work that
 * carries it (the 1984 and 2021 "Dune" films, the novel), and each film's item holds its IMDb,
 * Rotten Tomatoes and Metacritic ids, so the platform pages are opened by id, never by a guessed
 * or searched address. Its release dates need care: a postponed film keeps the old dates marked
 * deprecated ("Dune: Part Two" 2023-10 vs 2024-03), so the year is the earliest non-deprecated one.
 *
 * The figures come off the pages as the page reader returns their text (`readFigures`); a page
 * that refused, timed out, named a different work or carried no figure is reported as such.
 */

export interface FilmCandidate {
  qid: string;
  /** In the interface language when Wikidata has it. */
  label: string;
  originalTitle: string;
  /** Its English title: the platform pages name it so. */
  englishTitle: string;
  year?: number;
  directors: string[];
  description: string;
  imdb?: string;
  rottenTomatoes: string[];
  metacritic?: string;
  /** The search matched the title the user wrote exactly (a label or alias). */
  exact: boolean;
}

export interface PlatformRead {
  platform: MoviePlatform;
  url?: string;
  figures: MovieFigure[];
  /** Why there is no figure: no page known, refused, unreadable, a different work, none on the page. */
  missing?: string;
}

export interface MovieInfoDeps {
  fetchJson: (url: string) => Promise<unknown>;
  readPage: (url: string) => Promise<{ title: string; text: string }>;
}

const API = 'https://www.wikidata.org/w/api.php';
const SEARCH_LIMIT = 12;
export const MAX_CANDIDATES = 5;
const MAX_DIRECTORS = 2;

type Claims = Record<string, Array<{ rank?: string; mainsnak?: { datavalue?: { value?: unknown } } }>>;
interface Entity { id: string; labels?: Record<string, { value: string }>; descriptions?: Record<string, { value: string }>; claims?: Claims }
interface SearchHit { id: string; match?: { text?: string } }

/** The Wikidata language chain for an interface locale: the first that has a label wins. */
export function languageChain(locale: string): string[] {
  if (/^zh-(TW|HK|MO)|zh-Hant/i.test(locale)) return ['zh-tw', 'zh-hant', 'zh-hk', 'zh', 'en', 'mul'];
  if (/^zh/i.test(locale)) return ['zh-cn', 'zh-hans', 'zh', 'en', 'mul'];
  const base = locale.split('-')[0].toLowerCase();
  return [...new Set([base, 'en', 'mul'])];
}

/** The language to search a title in, by its script; Latin and others search English labels. */
export function searchLanguage(title: string, locale: string): string {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title)) return 'ja';
  if (/\p{Script=Hangul}/u.test(title)) return 'ko';
  if (/\p{Script=Han}/u.test(title)) return /^zh-(CN|SG)|zh-Hans/i.test(locale) ? 'zh-cn' : 'zh-tw';
  return 'en';
}

/** A title the user wrote, with a year they put in it ("沙丘 2021", "Dune (1984)") taken out. */
export function splitTitleYear(text: string): { title: string; year?: number } {
  const match = /[\s(（]*((?:18|19|20)\d{2})[)）]?\s*$/.exec(text.trim());
  if (!match || match.index === 0) return { title: text.trim() };
  return { title: text.trim().slice(0, match.index).trim(), year: Number(match[1]) };
}

function normalized(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

function claimValues(entity: Entity, property: string, ranked = false): unknown[] {
  const claims = entity.claims?.[property] ?? [];
  const live = claims.filter((claim) => claim.rank !== 'deprecated');
  const preferred = live.filter((claim) => claim.rank === 'preferred');
  return (ranked && preferred.length ? preferred : live).map((claim) => claim.mainsnak?.datavalue?.value).filter((value) => value !== undefined);
}

function strings(entity: Entity, property: string): string[] {
  return claimValues(entity, property).filter((value): value is string => typeof value === 'string');
}

function labelIn(entity: Entity | undefined, chain: readonly string[]): string {
  for (const lang of chain) {
    const value = entity?.labels?.[lang]?.value;
    if (value) return value;
  }
  return Object.values(entity?.labels ?? {})[0]?.value ?? '';
}

function descriptionIn(entity: Entity, chain: readonly string[]): string {
  for (const lang of chain) {
    const value = entity.descriptions?.[lang]?.value;
    if (value) return value;
  }
  return '';
}

/** The earliest release year among the dates not marked deprecated. */
export function releaseYear(entity: Entity): number | undefined {
  const years = claimValues(entity, 'P577')
    .map((value) => (value as { time?: string })?.time)
    .map((time) => (time ? Number(/^[+-](\d{4})/.exec(time)?.[1]) : Number.NaN))
    .filter((year) => Number.isFinite(year) && year > 0);
  return years.length ? Math.min(...years) : undefined;
}

function originalTitleOf(entity: Entity): string {
  const titles = claimValues(entity, 'P1476') as Array<{ text?: string }>;
  return titles.find((title) => title?.text)?.text ?? labelIn(entity, ['en', 'mul']);
}

async function entities(ids: readonly string[], props: string, chain: readonly string[], deps: MovieInfoDeps): Promise<Record<string, Entity>> {
  if (ids.length === 0) return {};
  const params = new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props, languages: [...new Set([...chain, 'en'])].join('|'), format: 'json' });
  const data = await deps.fetchJson(`${API}?${params}`) as { entities?: Record<string, Entity> };
  return data.entities ?? {};
}

async function search(title: string, language: string, deps: MovieInfoDeps): Promise<SearchHit[]> {
  const params = new URLSearchParams({ action: 'wbsearchentities', search: title, language, uselang: language, type: 'item', limit: String(SEARCH_LIMIT), format: 'json' });
  const data = await deps.fetchJson(`${API}?${params}`) as { search?: SearchHit[] };
  return data.search ?? [];
}

/** Items that are works on IMDb (films, series): a person or a novel has no `tt` id. */
async function candidatesFrom(hits: readonly SearchHit[], wanted: string, chain: readonly string[], deps: MovieInfoDeps): Promise<FilmCandidate[]> {
  const found = await entities(hits.map((hit) => hit.id), 'labels|descriptions|claims', chain, deps);
  const works = hits.map((hit) => ({ hit, entity: found[hit.id] }))
    .filter(({ entity }) => entity && strings(entity, 'P345').some((id) => id.startsWith('tt')));
  const directorIds = [...new Set(works.flatMap(({ entity }) => claimValues(entity, 'P57').map((value) => (value as { id?: string })?.id).filter(Boolean).slice(0, MAX_DIRECTORS) as string[]))];
  const people = await entities(directorIds, 'labels', chain, deps);
  return works.map(({ hit, entity }) => ({
    qid: entity.id,
    label: labelIn(entity, chain),
    originalTitle: originalTitleOf(entity),
    englishTitle: labelIn(entity, ['en', 'mul']),
    ...(releaseYear(entity) ? { year: releaseYear(entity) } : {}),
    directors: claimValues(entity, 'P57').map((value) => labelIn(people[(value as { id?: string })?.id ?? ''], chain)).filter(Boolean).slice(0, MAX_DIRECTORS),
    description: descriptionIn(entity, chain),
    imdb: strings(entity, 'P345').find((id) => id.startsWith('tt')),
    rottenTomatoes: strings(entity, 'P1258'),
    ...(strings(entity, 'P1712')[0] ? { metacritic: strings(entity, 'P1712')[0] } : {}),
    exact: normalized(hit.match?.text ?? '') === normalized(wanted),
  }));
}

/**
 * The works a title may mean, the likeliest first: an exact title match before a partial one, then
 * the search's own order; a work within a year of a given year comes before all of them.
 */
export async function findFilms(text: string, locale: string, deps: MovieInfoDeps, year?: number): Promise<FilmCandidate[]> {
  const split = splitTitleYear(text);
  const title = split.title || text.trim();
  const wantedYear = year ?? split.year;
  const chain = languageChain(locale);
  const first = searchLanguage(title, locale);
  let works = await candidatesFrom(await search(title, first, deps), title, chain, deps);
  if (works.length === 0 && first !== 'en') works = await candidatesFrom(await search(title, 'en', deps), title, chain, deps);
  const ranked = [...works.filter((work) => work.exact), ...works.filter((work) => !work.exact)];
  // A year picks which work comes first, never hides the others: the model adds one it guessed
  // ("Dune" → 2021), and the 1984 film would then go unmentioned.
  const inYear = wantedYear ? ranked.filter((work) => work.year !== undefined && Math.abs(work.year - wantedYear) <= 1) : [];
  return [...inYear, ...ranked.filter((work) => !inYear.includes(work))].slice(0, MAX_CANDIDATES);
}

/** One work by its IMDb id (`tt…`) or Wikidata id (`Q…`), as an earlier answer listed it. */
export async function filmById(id: string, locale: string, deps: MovieInfoDeps): Promise<FilmCandidate | null> {
  const chain = languageChain(locale);
  let qid = /^Q\d+$/i.test(id) ? id.toUpperCase() : '';
  if (!qid && /^tt\d+$/i.test(id)) {
    const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: `haswbstatement:P345=${id.toLowerCase()}`, srlimit: '1', format: 'json' });
    const data = await deps.fetchJson(`${API}?${params}`) as { query?: { search?: Array<{ title?: string }> } };
    qid = data.query?.search?.[0]?.title ?? '';
  }
  if (!qid) return null;
  const [work] = await candidatesFrom([{ id: qid }], '', chain, deps);
  return work ?? null;
}

const REFUSED = /\b(?:401|403|429)\b|captcha|verif|blocked|forbidden|denied/i;

export function platformUrls(film: FilmCandidate): Record<MoviePlatform, string[]> {
  return {
    imdb: film.imdb ? [`https://www.imdb.com/title/${film.imdb}/`] : [],
    // An item can hold an old and a current Rotten Tomatoes id; the current one is listed last.
    rottenTomatoes: [...film.rottenTomatoes].reverse().slice(0, 2).map((id) => `https://www.rottentomatoes.com/${id}`),
    metacritic: film.metacritic ? [`https://www.metacritic.com/${film.metacritic}/`] : [],
  };
}

/** A platform page is the film's when it names the film; IMDb is opened by its own id. */
function namesFilm(platform: MoviePlatform, film: FilmCandidate, body: string): boolean {
  if (platform === 'imdb') return true;
  const page = normalized(body);
  return [film.englishTitle, film.originalTitle, film.label].some((title) => title && page.includes(normalized(title)));
}

async function readPlatform(platform: MoviePlatform, film: FilmCandidate, urls: readonly string[], deps: MovieInfoDeps): Promise<PlatformRead> {
  if (urls.length === 0) return { platform, figures: [], missing: 'no page for this film is known on this platform' };
  let last: PlatformRead = { platform, figures: [] };
  for (const url of urls) {
    try {
      const page = await deps.readPage(url);
      const body = `${page.title}\n${page.text}`;
      if (!namesFilm(platform, film, body)) {
        last = { platform, url, figures: [], missing: 'the page names a different work' };
        continue;
      }
      const figures = readFigures(platform, body);
      if (figures.length) return { platform, url, figures };
      last = { platform, url, figures: [], missing: 'the page shows no score (none yet, or too few reviews)' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { platform, url, figures: [], missing: REFUSED.test(reason) ? 'the site refused this read' : 'the page could not be read this time' };
    }
  }
  return last;
}

/** Each platform's figures for one film, read now and side by side. */
export function readPlatformFigures(film: FilmCandidate, deps: MovieInfoDeps): Promise<PlatformRead[]> {
  const urls = platformUrls(film);
  return Promise.all(MOVIE_PLATFORMS.map((platform) => readPlatform(platform, film, urls[platform], deps)));
}
