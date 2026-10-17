import { splitNotionBlocks, type NotionBlock } from './notionBlocks';

/*
 * What a Notion document looks like on screen: its Notion-flavored Markdown turned into the
 * Markdown Yobi already renders. Display only — the file and everything sent to Notion keep the
 * original text. Raw HTML stays inert in the renderer, so nothing here can inject markup: a tag this
 * does not know becomes its text or a "Notion block" note.
 */

export interface NotionDisplayLabels {
  /** Shown for a block Yobi cannot show (table of contents, custom blocks…). */
  unsupported: string;
}

const ATTR_LIST_RE = /\s*\{[a-z-]+="[^"]*"(?:\s+[a-z-]+="[^"]*")*\}\s*$/i;
const TAG_ONLY_LINE_RE = /^\s*<\/?[a-z][a-z_-]*(?:\s[^>]*)?\/?>\s*$/i;
const FENCE_RE = /^(`{3,}|~{3,})/;

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? match[1] ?? '' : null;
}

function isHttp(url: string | null): url is string {
  return Boolean(url && /^https?:\/\//i.test(url));
}

function link(text: string, url: string | null): string {
  const label = text.trim() || url || '';
  // Parentheses and spaces encoded by hand: encodeURIComponent leaves `(` `)` alone, and a `)`
  // would end the link and let the rest of the URL read as Markdown.
  const target = isHttp(url) ? url.replace(/[()\s<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`) : '';
  return target ? `[${label.replace(/[[\]]/g, '\\$&')}](${target})` : label;
}

/** Where the code spans of a line are, so delimiters inside them are left alone. */
function codeSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') {
      i += 1;
      continue;
    }
    let run = 1;
    while (text[i + run] === '`') run += 1;
    const fence = '`'.repeat(run);
    let close = text.indexOf(fence, i + run);
    while (close >= 0 && text[close + run] === '`') close = text.indexOf(fence, close + run + 1);
    if (close < 0) {
      i += run;
      continue;
    }
    spans.push([i, close + run]);
    i = close + run;
  }
  return spans;
}

/**
 * Notion writes every differently styled run on its own, so a bold line holding code comes out as
 * runs side by side — "**`pwd`**** (Print Working Directory)**" — and a run may start or end with
 * a space. Notion reads that as one bold line; CommonMark reads neither the "****" seam nor a "**"
 * followed by a space, and shows the asterisks. For display only, touching runs are joined and
 * the spaces at a run's edges moved outside it.
 */
export function tidyEmphasis(text: string, delimiter: '**' | '~~'): string {
  const inCode = codeSpans(text);
  const positions: number[] = [];
  for (let at = text.indexOf(delimiter); at >= 0; at = text.indexOf(delimiter, at + delimiter.length)) {
    let slashes = 0;
    while (text[at - 1 - slashes] === '\\') slashes += 1;
    if (slashes % 2 === 1 || inCode.some(([start, end]) => at >= start && at < end)) continue;
    positions.push(at);
  }
  if (positions.length < 2) return text;
  // Pairs in order; a pair that opens where the previous one closed continues it.
  const runs: Array<{ open: number; close: number; seams: number[] }> = [];
  for (let k = 0; k + 1 < positions.length; k += 2) {
    const open = positions[k]!;
    const close = positions[k + 1]!;
    const last = runs.at(-1);
    if (last && last.close + delimiter.length === open) {
      last.seams.push(last.close);
      last.close = close;
    } else {
      runs.push({ open, close, seams: [] });
    }
  }
  let out = '';
  let at = 0;
  for (const run of runs) {
    // The run's text without the close-and-open pairs where its pieces met.
    let inner = '';
    let from = run.open + delimiter.length;
    for (const seam of run.seams) {
      inner += text.slice(from, seam);
      from = seam + delimiter.length * 2;
    }
    inner += text.slice(from, run.close);
    const lead = /^\s*/.exec(inner)?.[0] ?? '';
    const trail = /\s*$/.exec(inner)?.[0] ?? '';
    const core = inner.slice(lead.length, inner.length - trail.length);
    out += text.slice(at, run.open) + lead + (core ? `${delimiter}${core}${delimiter}` : '') + trail;
    at = run.close + delimiter.length;
  }
  return out + text.slice(at);
}

/**
 * A page title as words. Notion's title is rich text ("**Linux Command Guide**" when the user
 * made it bold); the file keeps it so, and sends it back so, but the header and the sidebar show
 * the words without the markers.
 */
export function plainNotionTitle(title: string): string {
  return notionInline(title)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|[^\\*])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!~|<>$^])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Inline Notion syntax in one line of rich text. */
export function notionInline(text: string): string {
  return tidyEmphasis(tidyEmphasis(text, '**'), '~~')
    .replace(/<mention-date\b([^>]*)\/>/g, (_whole, attrs: string) => {
      const start = attr(attrs, 'start') ?? '';
      const startTime = attr(attrs, 'startTime');
      const end = attr(attrs, 'end');
      const endTime = attr(attrs, 'endTime');
      const from = startTime ? `${start} ${startTime}` : start;
      const to = end ? (endTime ? `${end} ${endTime}` : end) : '';
      return to ? `${from} – ${to}` : from;
    })
    .replace(/<mention-(page|database|data-source)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mention-\1>)/g, (_whole, _kind, attrs: string, name?: string) =>
      link(name ?? '', attr(attrs, 'url')))
    .replace(/<mention-(user|agent)\b[^>]*?(?:\/>|>([\s\S]*?)<\/mention-\1>)/g, (_whole, _kind, name?: string) => (name ? `@${name}` : '@'))
    .replace(/<span\b[^>]*>([\s\S]*?)<\/span>/g, '$1')
    .replace(/\$`([^`]+)`\$/g, (_whole, math: string) => `$$${math}$$`)
    .replace(/\[\^(https?:\/\/[^\]\s]+)\]/g, (_whole, url: string) => ` ${link('↗', url)}`);
}

function stripAttrs(line: string): string {
  return line.replace(ATTR_LIST_RE, '');
}

/**
 * Removes one level of tab indent. A code block's own lines are left as they are: Notion writes
 * them unindented (only the fences carry the tabs), and a leading tab there is the code's.
 */
function dedent(lines: readonly string[]): string[] {
  let fence: string | null = null;
  return lines.map((line) => {
    if (fence !== null) {
      if (line.trim().startsWith(fence) && /^[`~]+$/.test(line.trim())) {
        fence = null;
        return line.replace(/^\t/, '');
      }
      return line;
    }
    const opened = FENCE_RE.exec(line.replace(/^\t+/, ''));
    if (opened) fence = opened[1] ?? null;
    return line.replace(/^\t/, '');
  });
}

/**
 * A list item's children as CommonMark nests them: tabs become four spaces, and the lines of a
 * code block (unindented, as Notion writes them) take its fence's indent so they stay in the item.
 */
function listChildren(children: readonly string[]): string[] {
  let fence: { marker: string; indent: string } | null = null;
  return children.map((child) => {
    if (fence) {
      const trimmed = child.replace(/^\t+/, '');
      if (trimmed.startsWith(fence.marker) && /^[`~]+\s*$/.test(trimmed)) {
        const indent = fence.indent;
        fence = null;
        return `${indent}${trimmed}`;
      }
      return `${fence.indent}${child}`;
    }
    const tabs = /^\t*/.exec(child)?.[0].length ?? 0;
    const indent = '    '.repeat(tabs);
    const rest = child.slice(tabs);
    const opened = FENCE_RE.exec(rest);
    if (opened) {
      fence = { marker: opened[1] ?? '```', indent };
      return `${indent}${rest}`;
    }
    return `${indent}${notionInline(stripAttrs(rest))}`;
  });
}

function convertTable(text: string): string {
  const rows = [...text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...(row[1] ?? '').matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) =>
      notionInline((cell[1] ?? '').trim()).replace(/\|/g, '\\|').replace(/\n/g, '<br>')));
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]): string => `| ${[...row, ...Array<string>(width - row.length).fill('')].join(' | ')} |`;
  const headerRow = /\bheader-row="true"/.test(text.split('\n', 1)[0] ?? '');
  const header = headerRow ? rows[0]! : Array<string>(width).fill(' ');
  const body = headerRow ? rows.slice(1) : rows;
  return [pad(header), `|${' --- |'.repeat(width)}`, ...body.map(pad)].join('\n');
}

function quote(markdown: string): string {
  return markdown.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
}

function convertContainer(block: NotionBlock, labels: NotionDisplayLabels): string {
  const lines = block.text.split('\n');
  const open = lines[0] ?? '';
  const tag = /^<([a-z_-]+)/.exec(open)?.[1] ?? '';
  const inner = dedent(lines.slice(1, -1));
  if (tag === 'callout') {
    const icon = attr(open, 'icon');
    const body = notionToDisplay(inner.join('\n'), labels);
    const shownIcon = icon && !icon.startsWith('icons/') && !/^https?:/.test(icon) ? icon : '';
    // Before ordinary text the icon leads the line; before a heading, list or code it gets a line
    // of its own, or the block below would no longer start its line.
    if (!shownIcon) return quote(body);
    return quote(/^(?:#|[-*+] |\d+[.)] |>|```|~~~|\||\$\$|<)/.test(body) ? `${shownIcon}\n\n${body}` : `${shownIcon} ${body}`);
  }
  if (tag === 'details') {
    const summaryLine = inner.findIndex((line) => /^\s*<summary>/.test(line));
    const summary = summaryLine >= 0 ? (/<summary>([\s\S]*?)<\/summary>/.exec(inner[summaryLine] ?? '')?.[1] ?? '') : '';
    // `inner` is already one tab in: the children's own indent (nested lists) stays.
    const children = inner.filter((_, index) => index !== summaryLine);
    // Bare tags only: the renderer rebuilds `<details>`/`<summary>` with no attributes and leaves
    // the Markdown between them to render as Markdown.
    return `<details>\n<summary>${notionInline(summary).replace(/[<>]/g, '')}</summary>\n\n${notionToDisplay(children.join('\n'), labels)}\n\n</details>`;
  }
  if (tag === 'table') return convertTable(block.text);
  // Columns, tabs, synced blocks, meeting notes: their content, one block after another.
  const content = lines.filter((line) => !TAG_ONLY_LINE_RE.test(line)).map((line) => line.replace(/^\t+/, ''));
  return notionToDisplay(content.join('\n'), labels);
}

function convertLineBlock(block: NotionBlock, labels: NotionDisplayLabels): string {
  const [first = '', ...children] = block.text.split('\n');
  const head = stripAttrs(first);
  const single = /^<(page|database)\b([^>]*)>([\s\S]*?)<\/\1>\s*$/.exec(head);
  if (single) return link(single[3] ?? '', attr(single[2] ?? '', 'url'));
  const media = /^<(audio|video|file|pdf|embed)\b([^>]*)>([\s\S]*?)<\/\1>\s*$/.exec(head);
  if (media) {
    const src = attr(media[2] ?? '', 'src');
    return link(media[3] || (src ?? '').split('/').pop() || media[1] || '', src);
  }
  if (/^<(?:unknown|custom-block|table_of_contents|synced_block_reference)\b/.test(head)) return `*${labels.unsupported}*`;

  const line = notionInline(head);
  if (children.length === 0) return line;
  if (block.kind === 'list') return [line, ...listChildren(children)].join('\n');
  // A heading or paragraph with children (a toggle heading): the children follow as blocks of their own.
  return `${line}\n\n${notionToDisplay(dedent(children).join('\n'), labels)}`;
}

function convertBlock(block: NotionBlock, labels: NotionDisplayLabels): string {
  if (block.kind === 'empty') return '';
  if (block.kind === 'code' || FENCE_RE.test(block.text) || block.text.startsWith('$$')) return block.text;
  if (/^<[a-z_-]+[\s>]/.test(block.text) && block.text.includes('\n')) return convertContainer(block, labels);
  return convertLineBlock(block, labels);
}

/** A Notion document's text (spaced or not) as Markdown the chat renderer shows. */
export function notionToDisplay(text: string, labels: NotionDisplayLabels): string {
  const blocks = splitNotionBlocks(text);
  let out = '';
  blocks.forEach((block, index) => {
    const shown = convertBlock(block, labels);
    if (!shown) return;
    if (out) out += block.kind === 'list' && blocks[index - 1]?.kind === 'list' ? '\n' : '\n\n';
    out += shown;
  });
  return out;
}
