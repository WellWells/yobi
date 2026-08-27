import { load } from 'cheerio';
import { formatPromptDate } from '../../shared/promptDate';

const MIN_YEAR = 1990;
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
  const candidate = new Date(year, month - 1, day, 12);
  if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return false;
  const limit = new Date(now.getTime() + MAX_FUTURE_DAYS * 86_400_000);
  return candidate.getTime() <= limit.getTime();
}

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

  let found = '';
  $('script[type="application/ld+json"]').each((_, element) => {
    if (found) return;
    const match = JSON_LD_DATE.exec($(element).text());
    if (match) found = toPlausibleDate(match[1], now);
  });
  return found;
}
