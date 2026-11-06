import { Marked, Renderer } from 'marked';
import { t } from '../i18n';
import { promoteDisplayMath, promoteInlineMath } from '../../shared/inlineMathDelimiters';
import { isCitationLabel } from '../../shared/citations';
import { expandableQuoteBody } from '../../shared/expandableQuote';
import { flattenFootnotes } from '../../shared/markdownFootnotes';
import { htmlAsPlainText } from '../../shared/markdownHtmlWhitelist';
import { labelledCell } from '../../shared/tableCellText';
import { mathTokenExtensions } from '../markdownMathTokens';
import { readableTex } from '../readableTex';
import { BARE_URL_STOP_CHARS, cjkBoundedUrls } from './bareUrls';

export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Telegram cannot typeset math: a formula goes out as Unicode text (`readableTex`), or, when it
// has more than that can show, as its TeX — a `$$` fence as <pre>, a `$$…$$` span as <code>.
const telegramMarked = new Marked({
  tokenizer: cjkBoundedUrls,
  extensions: mathTokenExtensions({
    display: (tex) => {
      const text = readableTex(tex);
      return text === null ? `<pre>${escapeTelegramHtml(tex)}</pre>\n` : `${escapeTelegramHtml(text)}\n\n`;
    },
    inline: (tex) => {
      const text = readableTex(tex);
      return text === null ? `<code>${escapeTelegramHtml(tex)}</code>` : escapeTelegramHtml(text);
    },
  }),
});

/** Telegram has no heading tag; bold is the one emphasis it can show. Inner <b> is dropped so a bold heading does not nest. */
function bold(html: string): string {
  return html ? `<b>${html.replace(/<\/?b>/g, '')}</b>` : '';
}

function escapeTelegramAttribute(text: string): string {
  return escapeTelegramHtml(text).replace(/"/g, '&quot;');
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let cut = Math.max(0, maxLength - 1);
  const lastCode = text.charCodeAt(cut - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut).trimEnd()}…`;
}

// A Markdown link, an autolink, a bare URL or a code span: a cut inside one shows its raw syntax.
const UNBREAKABLE_SPAN = /\[(?:\\.|[^\]\\\n])*\]\((?:<[^>\n]*>|[^)\s]*)\)|<https?:\/\/[^>\s]*>|https?:\/\/[^\s<>()]+|`[^`\n]+`/g;

/** The last of the ascending `cuts` whose prefix fits, or -1; measure grows with the prefix. */
function lastFittingCut(cuts: number[], fits: (cut: number) => boolean): number {
  let low = 0;
  let high = cuts.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (fits(cuts[mid])) {
      found = cuts[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** Where to end the next chunk of `rest`, which does not fit whole. */
export function chunkCut(rest: string, maxChunkChars: number, measure: (markdown: string) => number): number {
  const fits = (cut: number) => measure(rest.slice(0, cut)) <= maxChunkChars;
  const lineEnds = [...rest.matchAll(/\n/g)].map((match) => match.index).filter((index) => index > 0);
  const lineCut = lastFittingCut(lineEnds, fits);
  if (lineCut > 0) {
    const paragraph = rest.lastIndexOf('\n\n', lineCut);
    if (paragraph > 0 && measure(rest.slice(0, paragraph)) >= maxChunkChars / 2) return paragraph;
    if (measure(rest.slice(0, lineCut)) >= maxChunkChars / 2) return lineCut;
  }
  // No line end late enough: cut inside the line, after a space or punctuation, outside any link.
  const spans = [...rest.matchAll(UNBREAKABLE_SPAN)].map((match) => [match.index, match.index + match[0].length]);
  const insideSpan = (index: number) => spans.some(([from, to]) => index > from && index < to);
  const breaks = [...rest.matchAll(/[\s。，、；：！？|)]/g)]
    .map((match) => match.index + match[0].length)
    .filter((index) => index < rest.length && !insideSpan(index));
  const breakCut = lastFittingCut(breaks, fits);
  if (breakCut > 0) return Math.max(breakCut, lineCut);
  if (lineCut > 0) return lineCut;
  const hardCut = lastFittingCut(Array.from({ length: rest.length - 1 }, (_, i) => i + 1), fits);
  const span = spans.find(([from, to]) => hardCut > from && hardCut < to);
  return span && span[0] > 0 ? span[0] : Math.max(1, hardCut);
}

/**
 * Splits Markdown into at most `maxChunks` pieces of at most `maxChunkChars` as `measure` counts
 * them (default: Markdown characters), preferring a blank line, then a line end, then a space or
 * punctuation outside any link. Text past the last piece is dropped and marked with an ellipsis.
 */
export function splitMarkdownIntoChunks(
  text: string,
  maxChunkChars: number,
  maxChunks: number,
  measure: (markdown: string) => number = (markdown) => markdown.length,
): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let rest = normalized;
  while (rest && chunks.length < maxChunks) {
    if (measure(rest) <= maxChunkChars) {
      chunks.push(rest);
      rest = '';
      break;
    }
    const cut = chunkCut(rest, maxChunkChars, measure);
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest && chunks.length > 0) chunks[chunks.length - 1] += '…';
  return chunks.filter(Boolean);
}

// Telegram's undocumented entity caps: a message is
// refused (ENTITIES_TOO_LONG) once its entities pass about 10,000 — each link about 20 plus its
// URL's UTF-8 bytes, each other entity about 10 — and keeps only its first 100 entities, dropping
// the rest without an error. Costs are rounded up and the budget kept under, for headroom.
export const TELEGRAM_ENTITY_BUDGET = 9_000;
export const TELEGRAM_ENTITY_MAX = 100;
const LINK_ENTITY_COST = 24;
const OTHER_ENTITY_COST = 16;
const ENTITY_TAG = /<(a|b|i|u|s|code|pre|blockquote|tg-spoiler)(\s[^>]*)?>/g;

function decodeHref(href: string): string {
  return href.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** What a message's entities weigh against `TELEGRAM_ENTITY_BUDGET`. */
export function telegramEntityCost(html: string): number {
  let cost = 0;
  for (const [, tag, attributes] of html.matchAll(ENTITY_TAG)) {
    const href = tag === 'a' ? /href="([^"]*)"/.exec(attributes ?? '')?.[1] : undefined;
    cost += href === undefined ? OTHER_ENTITY_COST : LINK_ENTITY_COST + Buffer.byteLength(decodeHref(href));
  }
  return cost;
}

export function telegramEntityCount(html: string): number {
  return [...html.matchAll(ENTITY_TAG)].length;
}

/** Whether Telegram takes this HTML as one message, every link and style intact. */
export function telegramHtmlFits(html: string, maxVisibleChars: number): boolean {
  return telegramVisibleLength(html) <= maxVisibleChars
    && telegramEntityCost(html) <= TELEGRAM_ENTITY_BUDGET
    && telegramEntityCount(html) <= TELEGRAM_ENTITY_MAX;
}

/**
 * What Markdown weighs against `maxVisibleChars`, as Telegram counts a message: the visible text
 * after its HTML is parsed (a citation link costs its label there), or its entities when those are
 * nearer their own caps.
 */
export function telegramMessageWeight(markdown: string, maxVisibleChars: number): number {
  const html = formatResponseForTelegramHtml(markdown);
  return Math.max(
    telegramVisibleLength(html),
    (telegramEntityCost(html) * maxVisibleChars) / TELEGRAM_ENTITY_BUDGET,
    (telegramEntityCount(html) * maxVisibleChars) / TELEGRAM_ENTITY_MAX,
  );
}

/** Chunks for an answer, each weighed as Telegram counts a message. */
export function telegramCompactChunks(markdown: string, maxVisibleChars: number, maxChunks: number): string[] {
  return splitMarkdownIntoChunks(markdown, maxVisibleChars, maxChunks, (chunk) => telegramMessageWeight(chunk, maxVisibleChars));
}

/** A span of a plain-text message, in UTF-16 code units as Telegram counts them. */
export interface TelegramPreEntity {
  type: 'pre' | 'expandable_blockquote';
  offset: number;
  length: number;
}

const FENCE_LINE = /^`{3,}$/;

/**
 * A message sent exactly as written (an approval): plain text with no parse mode, so nothing is
 * escaped, linkified, flattened or cut. Its first fenced block — opened by a line of three or more
 * backticks, closed by the same line — becomes a `pre` entity in place of the two fence lines; its
 * first folded quote (`expandableQuote`: a `> [!EXPANDABLE]` line, then `>` lines) becomes an
 * `expandable_blockquote` holding those lines without their `>` and without the mark.
 */
export function telegramVerbatimMessage(text: string): { text: string; entities: TelegramPreEntity[] } {
  const lines = text.split('\n');
  const out: string[] = [];
  const spans: Array<{ type: TelegramPreEntity['type']; from: number; to: number }> = [];
  let fence: string | null = null;
  let openAt = 0;
  let fenceDone = false;
  let quoteFrom = -1;
  let quoteDone = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (quoteFrom >= 0) {
      if (line.startsWith('>')) {
        out.push(line.replace(/^> ?/, ''));
        continue;
      }
      spans.push({ type: 'expandable_blockquote', from: quoteFrom, to: out.length });
      quoteFrom = -1;
      quoteDone = true;
    }
    if (fence !== null) {
      if (line === fence) {
        spans.push({ type: 'pre', from: openAt, to: out.length });
        fence = null;
        fenceDone = true;
      } else {
        out.push(line);
      }
      continue;
    }
    if (!fenceDone && FENCE_LINE.test(line) && lines.indexOf(line, index + 1) > index) {
      fence = line;
      openAt = out.length;
      continue;
    }
    if (!quoteDone && line.startsWith('>') && expandableQuoteBody(line.replace(/^> ?/, '')) !== null) {
      quoteFrom = out.length;
      continue;
    }
    out.push(line);
  }
  if (quoteFrom >= 0) spans.push({ type: 'expandable_blockquote', from: quoteFrom, to: out.length });

  const starts: number[] = [];
  let position = 0;
  for (const line of out) {
    starts.push(position);
    position += line.length + 1;
  }
  const entities = spans
    .filter((span) => span.to > span.from)
    .map((span) => {
      const offset = starts[span.from];
      const end = starts[span.to - 1] + out[span.to - 1].length;
      return { type: span.type, offset, length: end - offset };
    })
    .filter((entity) => entity.length > 0);
  return { text: out.join('\n'), entities };
}

export function telegramVisibleLength(html: string): number {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot);/g, ' ')
    .length;
}

export function extractResponseSection(raw: string, strings: Record<string, string>): string {
  const normalized = raw.replace(/\r\n?/g, '\n');
  const responseAliases = new Set<string>();
  const localizedResponseHeading = t(strings, 'md.response').trim();
  if (localizedResponseHeading && localizedResponseHeading !== 'md.response') {
    responseAliases.add(localizedResponseHeading);
  }
  if (responseAliases.size === 0) return normalized;

  const lines = normalized.split('\n');
  const responseIdx = lines.findIndex((line) => {
    const match = line.trim().match(/^##\s+(.+)$/);
    if (!match) return false;
    return responseAliases.has(match[1].trim());
  });
  if (responseIdx < 0) return normalized;
  return lines.slice(responseIdx + 1).join('\n').trim();
}

export function formatResponseForTelegramHtml(input: string): string {
  const normalized = input.trim().replace(/\r\n?/g, '\n');
  if (!normalized) return '';

  const renderer = new Renderer();
  const renderInline = (tokens: Parameters<typeof renderer.parser.parseInline>[0]): string =>
    renderer.parser.parseInline(tokens);
  const renderBlock = (tokens: Parameters<typeof renderer.parser.parse>[0]): string =>
    renderer.parser.parse(tokens);

  renderer.strong = ({ tokens }) => `<b>${renderInline(tokens)}</b>`;
  renderer.em = ({ tokens }) => `<i>${renderInline(tokens)}</i>`;
  renderer.codespan = ({ text }) => `<code>${escapeTelegramHtml(text)}</code>`;
  renderer.code = ({ text, lang }) => {
    const escapedCode = escapeTelegramHtml(text);
    if (lang?.trim()) {
      return `<pre><code class="language-${escapeTelegramAttribute(lang.trim())}">${escapedCode}</code></pre>\n`;
    }
    return `<pre><code>${escapedCode}</code></pre>\n`;
  };
  renderer.del = (token) => escapeTelegramHtml(token.raw);
  // The app's own `$`/`$$` repair, so what renders as a formula there is sent as one here.
  const prepared = promoteInlineMath(promoteDisplayMath(flattenFootnotes(normalized)));
  // A URL is linked once: a citation number keeps its link only where nothing else links its URL
  // (see `isCitationLabel`), so repeated [1][2] do not spend Telegram's entity caps.
  const linkedByWords = new Set<string>();
  telegramMarked.walkTokens(telegramMarked.lexer(prepared, { gfm: true, breaks: true }), (token) => {
    if (token.type === 'link' && !isCitationLabel(token.text)) linkedByWords.add(normalizeSourceUrl(token.href));
  });
  const cited = new Set<string>();
  renderer.link = ({ href, tokens, text: linkText }) => {
    const safeHref = normalizeSourceUrl(href);
    const text = renderInline(tokens).trim();
    if (!safeHref) return text;
    if (isCitationLabel(linkText)) {
      if (linkedByWords.has(safeHref) || cited.has(safeHref)) return text;
      cited.add(safeHref);
    }
    const plainText = text.replace(/<[^>]+>/g, '').trim();
    const anchorText = !plainText || /^https?:\/\//i.test(plainText)
      ? escapeTelegramHtml(getSourceLabel(safeHref))
      : text;
    return `<a href="${escapeTelegramAttribute(safeHref)}">${anchorText}</a>`;
  };
  // A forwarded post's text folds (`expandableQuote`). Telegram quotes do not nest: a quote
  // inside the folded one (a post it shares) keeps only its words.
  let folding = false;
  renderer.blockquote = ({ tokens, text }) => {
    if (folding) return renderBlock(tokens);
    const body = expandableQuoteBody(text);
    if (body === null) return `<blockquote>${renderBlock(tokens).trim()}</blockquote>\n`;
    folding = true;
    try {
      const inner = renderBlock(telegramMarked.lexer(body, { gfm: true, breaks: true })).trim();
      return inner ? `<blockquote expandable>${inner}</blockquote>\n` : '';
    } finally {
      folding = false;
    }
  };
  renderer.paragraph = ({ tokens }) => `${renderInline(tokens)}\n\n`;
  // Telegram has no checkbox: marked's default renders `<input type="checkbox">`, which is not
  // in Telegram's tag set and fails the WHOLE send with a 400.
  renderer.checkbox = ({ checked }) => (checked ? '☑ ' : '☐ ');
  // An ordered list keeps its numbers: a citation [2] is read against the second source.
  renderer.list = ({ items, ordered, start }) => {
    const first = Number(start) || 1;
    return `${items.map((item, index) => {
      const rendered = renderBlock(item.tokens).trim();
      const compact = rendered.replace(/\n{2,}/g, '\n').replace(/\n/g, ' ').trim();
      // A task item already leads with its own ☐/☑; a bullet as well reads as two markers.
      if (item.task) return `${compact}\n`;
      return `${ordered ? `${first + index}.` : '•'} ${compact}\n`;
    }).join('')}\n`;
  };
  renderer.heading = ({ tokens }) => `${bold(renderInline(tokens).trim())}\n`;
  renderer.hr = () => '\n';
  renderer.image = ({ text, href }) => {
    const altText = escapeTelegramHtml((text || '').trim());
    const safeHref = normalizeSourceUrl(href);
    if (safeHref && altText) return `${altText} (${escapeTelegramHtml(safeHref)})`;
    if (safeHref) return escapeTelegramHtml(safeHref);
    return altText;
  };
  renderer.br = () => '\n';
  // `<kbd>Ctrl</kbd>`, `<details>` and comments keep only their words; any other HTML stays visible text.
  renderer.html = ({ text, block }) => {
    const plain = htmlAsPlainText(text);
    if (plain === null) return escapeTelegramHtml(text);
    if (!block) return escapeTelegramHtml(plain);
    return plain.trim() ? `${escapeTelegramHtml(plain.trim())}\n` : '';
  };
  renderer.text = (token) => {
    if (token.type === 'text' && token.tokens?.length) return renderInline(token.tokens);
    return escapeTelegramHtml(token.text);
  };
  // Telegram has no table, and ` | ` rows wrap into a run on a phone: each row is a block, its
  // first cell as a bold name, every other cell a "label：value" line (as LINE writes a row).
  renderer.table = ({ header, rows }) => {
    const labels = header.map((cell) => renderInline(cell.tokens).replace(/<\/?b>/g, '').trim());
    if (rows.length === 0) return `${labels.filter(Boolean).join(' · ')}\n\n`;
    const blocks = rows.map((row) => {
      const cells = row.map((cell) => renderInline(cell.tokens).trim());
      if (cells.length === 1) return labelledCell(labels[0] ?? '', cells[0]);
      const lines = [bold(cells[0])];
      for (const [index, value] of cells.entries()) {
        if (index > 0) lines.push(labelledCell(labels[index] ?? '', value));
      }
      return lines.filter(Boolean).join('\n');
    });
    return `${blocks.filter(Boolean).join('\n\n')}\n\n`;
  };

  const parsed = telegramMarked.parse(prepared, {
    renderer,
    gfm: true,
    breaks: true,
    async: false,
  });
  if (typeof parsed !== 'string') return '';
  return escapeUnsupportedTags(linkifyRawUrlsInHtml(parsed)).replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Exactly the tags this formatter emits. Deliberately narrower than Telegram's own list:
 * anything else appearing in the output did not come from here.
 */
const SUPPORTED_TAG =
  /^<\/(?:a|b|i|code|pre|blockquote)>$|^<(?:b|i|code|pre|blockquote|blockquote expandable)>$|^<a href="[^"<>]*">$|^<code class="language-[^"<>]*">$/;

/**
 * Last line of defence before parse_mode='HTML': Telegram rejects the whole message on one unknown
 * tag, so any tag outside the whitelist is escaped into visible text instead of losing the send.
 */
export function escapeUnsupportedTags(html: string): string {
  return html.replace(/<[^<>]*>/g, (tag) => (SUPPORTED_TAG.test(tag) ? tag : escapeTelegramHtml(tag)));
}

function normalizeSourceUrl(rawHref: string | null | undefined): string {
  const href = (rawHref || '').trim();
  if (!href) return '';
  try {
    const parsed = href.startsWith('//') ? new URL(`https:${href}`) : new URL(href);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function getSourceLabel(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return (url.hostname || 'source').replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

const RAW_URL = new RegExp(`(^|[\\s(>])(https?://[^\\s<)${BARE_URL_STOP_CHARS}]+[^\\s<).,!?;:${BARE_URL_STOP_CHARS}])`, 'gu');

function linkifyRawUrlsInHtml(html: string): string {
  return html.replace(RAW_URL, (match, prefix: string, rawUrl: string) => {
    const safeUrl = normalizeSourceUrl(rawUrl);
    if (!safeUrl) return match;
    const label = escapeTelegramHtml(getSourceLabel(safeUrl));
    return `${prefix}<a href="${escapeTelegramAttribute(safeUrl)}">${label}</a>`;
  });
}
