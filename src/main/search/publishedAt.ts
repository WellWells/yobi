import { load } from 'cheerio';
import { formatPromptDate } from '../../shared/promptDate';

/**
 * Publication dates for search sources. Without one the synthesis prompt cannot tell a 2019
 * page from last week's, so "the latest X" is answered from whichever page ranked best.
 *
 * Only machine-readable publisher metadata is trusted — meta tags and JSON-LD. A `<time>`
 * element is deliberately NOT read: on most templates the first one belongs to a comment or
 * a "related posts" rail, and a confidently wrong date is worse for the answer than none,
 * because the model will reason about staleness from it.
 *
 * The SERP is not a source of dates either. A reader would reasonably expect the result list
 * to supply them, but html.duckduckgo.com emits no date anywhere in a result block — not as
 * a snippet prefix, not as a field — so a parser for one would be code that never runs.
 * Pages that declare nothing simply reach the prompt undated.
 */

const MIN_YEAR = 1990;
/** Clock skew and timezone spread, not a real publishing window. */
const MAX_FUTURE_DAYS = 1;

const META_SELECTORS: readonly string[] = [
  'meta[property="article:published_time"]',
  'meta[name="article:published_time"]',
  'meta[property="og:article:published_time"]',
  'meta[itemprop="datePublished"]',
  'meta[name="datePublished"]',
  'meta[name="parsely-pub-date"]',
  'meta[name="pubdate"]',
  'meta[name="publish-date"]',
  'meta[name="DC.date.issued"]',
  'meta[name="date"]',
];

const ISO_PREFIX = /^(\d{4})-(\d{1,2})-(\d{1,2})/;

function isPlausible(year: number, month: number, day: number, now: Date): boolean {
  if (year < MIN_YEAR || month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Noon, so neither a DST shift nor a timezone offset can move the comparison a day.
  const candidate = new Date(year, month - 1, day, 12);
  if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return false;
  const limit = new Date(now.getTime() + MAX_FUTURE_DAYS * 86_400_000);
  return candidate.getTime() <= limit.getTime();
}

/**
 * Normalizes one publisher-supplied date string to `YYYY-MM-DD`, or `''` when it is not a
 * date a page could plausibly have been published on.
 *
 * An ISO prefix is read TEXTUALLY rather than parsed: `Date.parse('2026-01-05')` yields UTC
 * midnight, which formats as the 4th for every timezone west of Greenwich. Anything else
 * ("Jan 5, 2026") has no timezone and parses to local midnight, where local getters are
 * correct.
 */
export function toPlausibleDate(raw: string, now: Date = new Date()): string {
  const text = raw.trim();
  if (!text) return '';

  const iso = ISO_PREFIX.exec(text);
  if (iso) {
    const [, year, month, day] = iso;
    return isPlausible(Number(year), Number(month), Number(day), now)
      ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
      : '';
  }

  const parsed = new Date(text);
  const time = parsed.getTime();
  if (Number.isNaN(time)) return '';
  return isPlausible(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate(), now)
    ? formatPromptDate(parsed)
    : '';
}

const JSON_LD_DATE = /"datePublished"\s*:\s*"([^"]{4,64})"/;

/** The publication date a page declares about itself, or `''`. */
export function extractPublishedAt(html: string, now: Date = new Date()): string {
  let $: ReturnType<typeof load>;
  try {
    $ = load(html);
  } catch {
    return '';
  }

  for (const selector of META_SELECTORS) {
    const content = $(selector).first().attr('content') ?? '';
    const date = toPlausibleDate(content, now);
    if (date) return date;
  }

  // Read with a pattern rather than JSON.parse: `datePublished` hides at a different depth
  // in every schema (Article, NewsArticle, @graph arrays), and a single malformed block
  // must not cost the ones after it.
  let found = '';
  $('script[type="application/ld+json"]').each((_, element) => {
    if (found) return;
    const match = JSON_LD_DATE.exec($(element).text());
    if (match) found = toPlausibleDate(match[1], now);
  });
  return found;
}
