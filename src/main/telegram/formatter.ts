import { marked, Renderer } from 'marked';
import { t } from '../i18n';

export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
  renderer.link = ({ href, tokens }) => {
    const safeHref = normalizeSourceUrl(href);
    const text = renderInline(tokens).trim();
    if (!safeHref) return text;
    const plainText = text.replace(/<[^>]+>/g, '').trim();
    const anchorText = !plainText || /^https?:\/\//i.test(plainText)
      ? escapeTelegramHtml(getSourceLabel(safeHref))
      : text;
    return `<a href="${escapeTelegramAttribute(safeHref)}">${anchorText}</a>`;
  };
  renderer.blockquote = ({ tokens }) => `<blockquote>${renderBlock(tokens).trim()}</blockquote>\n`;
  renderer.paragraph = ({ tokens }) => `${renderInline(tokens)}\n\n`;
  renderer.list = ({ items }) => `${items.map((item) => renderer.listitem(item)).join('')}\n`;
  renderer.listitem = (item) => {
    const rendered = renderBlock(item.tokens).trim();
    const compact = rendered.replace(/\n{2,}/g, '\n').replace(/\n/g, ' ').trim();
    return `• ${compact}\n`;
  };
  renderer.heading = ({ tokens }) => `${renderInline(tokens)}\n`;
  renderer.hr = () => '\n';
  renderer.image = ({ text, href }) => {
    const altText = escapeTelegramHtml((text || '').trim());
    const safeHref = normalizeSourceUrl(href);
    if (safeHref && altText) return `${altText} (${escapeTelegramHtml(safeHref)})`;
    if (safeHref) return escapeTelegramHtml(safeHref);
    return altText;
  };
  renderer.br = () => '\n';
  renderer.html = ({ text }) => escapeTelegramHtml(text);
  renderer.text = (token) => {
    if (token.type === 'text' && token.tokens?.length) return renderInline(token.tokens);
    return escapeTelegramHtml(token.text);
  };
  renderer.table = ({ header, rows }) => {
    const lines = [header.map((cell) => renderInline(cell.tokens).trim()).join(' | ')];
    for (const row of rows) {
      lines.push(row.map((cell) => renderInline(cell.tokens).trim()).join(' | '));
    }
    return `${lines.join('\n')}\n`;
  };

  const parsed = marked.parse(normalized, {
    renderer,
    gfm: true,
    breaks: true,
    async: false,
  });
  if (typeof parsed !== 'string') return '';
  return linkifyRawUrlsInHtml(parsed).replace(/\n{3,}/g, '\n\n').trim();
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

function linkifyRawUrlsInHtml(html: string): string {
  return html.replace(/(^|[\s(>])(https?:\/\/[^\s<)]+[^\s<).,!?;:])/g, (match, prefix: string, rawUrl: string) => {
    const safeUrl = normalizeSourceUrl(rawUrl);
    if (!safeUrl) return match;
    const label = escapeTelegramHtml(getSourceLabel(safeUrl));
    return `${prefix}<a href="${escapeTelegramAttribute(safeUrl)}">${label}</a>`;
  });
}
