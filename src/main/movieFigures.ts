/*
 * The rating figures a film's platform page carries, read from the page's text as Yobi's page
 * reader returns it. Each platform keeps its own metric, scale and count; nothing here combines
 * them. The layouts were read live (the release self-test for movie pages checks
 * them every release): Metacritic puts the review count BEFORE its score ("Based on 62 Critic
 * Reviews 79"), and the reader runs words together ("Reviews79User"), so a figure is the number
 * that belongs to its label, never the first number after it.
 */

export type MoviePlatform = 'imdb' | 'rottenTomatoes' | 'metacritic';

export const MOVIE_PLATFORMS: readonly MoviePlatform[] = ['imdb', 'rottenTomatoes', 'metacritic'];

export const PLATFORM_NAMES: Record<MoviePlatform, string> = {
  imdb: 'IMDb',
  rottenTomatoes: 'Rotten Tomatoes',
  metacritic: 'Metacritic',
};

export interface FigureSpec {
  /** What the platform calls it. */
  metric: string;
  /** Captures `value` and `count` (and `noun` where the page names what it counted). */
  pattern: RegExp;
  /** The figure's own scale: 10, or 100 for a percentage or a Metascore. */
  max: number;
  /** What `count` counts, when the page does not say it next to the figure. */
  noun: string;
  percent?: boolean;
}

export interface MovieFigure {
  metric: string;
  value: string;
  max: number;
  count: string;
  noun: string;
  percent: boolean;
}

const COUNT = '(?<count>[\\d,.]+[KM]?\\+?)';

export const PLATFORM_FIGURES: Record<MoviePlatform, readonly FigureSpec[]> = {
  imdb: [
    { metric: 'IMDb rating', pattern: new RegExp(`IMDb RATING\\s*(?<value>\\d{1,2}(?:\\.\\d)?)\\s*/\\s*10\\s*${COUNT}`, 'i'), max: 10, noun: 'ratings' },
  ],
  rottenTomatoes: [
    { metric: 'Tomatometer', pattern: new RegExp(`(?<value>\\d{1,3})%\\s*Tomatometer\\s*${COUNT}\\s*Reviews`, 'i'), max: 100, noun: 'critic reviews', percent: true },
    {
      metric: 'Popcornmeter',
      pattern: new RegExp(`(?<value>\\d{1,3})%\\s*Popcornmeter\\s*${COUNT}\\s*(?<noun>(?:Verified\\s+)?Ratings)`, 'i'),
      max: 100,
      noun: 'ratings',
      percent: true,
    },
  ],
  metacritic: [
    { metric: 'Metascore', pattern: new RegExp(`Metascore\\s*[A-Za-z ]{0,40}?\\s*Based on ${COUNT} Critic Reviews?\\s*(?<value>\\d{1,3})(?![\\d.])`, 'i'), max: 100, noun: 'critic reviews' },
    {
      metric: 'Metacritic user score',
      pattern: new RegExp(`User score\\s*[A-Za-z ]{0,40}?\\s*Based on ${COUNT} User Ratings?\\s*(?<value>\\d{1,2}(?:\\.\\d)?)(?![\\d.])`, 'i'),
      max: 10,
      noun: 'user ratings',
    },
  ],
};

/** The figures the page text carries, each on its own scale with its count; a figure not on the page is left out. */
export function readFigures(platform: MoviePlatform, text: string): MovieFigure[] {
  const found: MovieFigure[] = [];
  for (const spec of PLATFORM_FIGURES[platform]) {
    const groups = spec.pattern.exec(text)?.groups;
    if (!groups?.count) continue;
    const value = Number(groups.value);
    if (!Number.isFinite(value) || value < 0 || value > spec.max) continue;
    found.push({
      metric: spec.metric,
      value: groups.value,
      max: spec.max,
      count: groups.count,
      noun: groups.noun ? groups.noun.replace(/\s+/g, ' ').toLowerCase() : spec.noun,
      percent: spec.percent === true,
    });
  }
  return found;
}

/** "8.4/10 from 806K ratings", "92% of 455 critic reviews": the figure with its scale and what it counts. */
export function describeFigure(figure: MovieFigure): string {
  const lowerBound = figure.count.endsWith('+') ? ' (a lower bound)' : '';
  return figure.percent
    ? `${figure.metric} ${figure.value}% of ${figure.count} ${figure.noun}${lowerBound}`
    : `${figure.metric} ${figure.value}/${figure.max} from ${figure.count} ${figure.noun}${lowerBound}`;
}
