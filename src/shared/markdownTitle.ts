const FENCE = /^\s*(?:```|~~~)/;
const ATX_HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

function plainText(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .trim();
}

/** The lines outside code fences, each with whether it is an ATX heading. */
function* proseLines(markdown: string): Generator<{ line: string; heading: RegExpExecArray | null }> {
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) yield { line, heading: ATX_HEADING.exec(line) };
  }
}

export interface MarkdownHeading {
  level: number;
  text: string;
}

/** Every heading outside code fences, in order, as plain text. */
export function markdownHeadings(markdown: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  for (const { heading } of proseLines(markdown)) {
    const text = heading ? plainText(heading[2]) : '';
    if (heading && text) headings.push({ level: heading[1].length, text });
  }
  return headings;
}

export function extractMarkdownTitle(markdown: string): string {
  const headings = markdownHeadings(markdown);
  return (headings.find((heading) => heading.level === 1) ?? headings[0])?.text ?? '';
}

const BLOCK_MARKER = /^\s*(?:>\s*)*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/;
const RULE_OR_TABLE_SEPARATOR = /^[\s|:-]*-{3,}[\s|:-]*$|^\s*(?:[*_]\s*){3,}$/;

/**
 * The text outside code fences and headings, as one line of plain words: quote and list markers,
 * table pipes and inline formatting dropped. Cut at `maxChars` characters (code points).
 */
export function markdownProse(markdown: string, maxChars: number): string {
  const words: string[] = [];
  let length = 0;
  for (const { line, heading } of proseLines(markdown)) {
    if (heading || RULE_OR_TABLE_SEPARATOR.test(line)) continue;
    const text = plainText(line.replace(BLOCK_MARKER, '').replace(/\|/g, ' ')).replace(/\s+/g, ' ');
    if (!text) continue;
    words.push(text);
    length += text.length + 1;
    if (length >= maxChars) break;
  }
  return Array.from(words.join(' ')).slice(0, maxChars).join('').trim();
}

export interface LeadingTitle {
  title: string;
  body: string;
}

export function splitLeadingTitle(markdown: string): LeadingTitle {
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const match = ATX_HEADING.exec(lines[i]);
    const title = match ? plainText(match[2]) : '';
    if (!title) break;
    return { title, body: lines.slice(i + 1).join('\n').replace(/^(?:[ \t\r]*\n)+/, '') };
  }
  return { title: '', body: markdown };
}

/**
 * The heading an exported card prints and the body under it, one rule for every card a flow
 * renders (an llm step's export, a share step's file), the same as quick export: a title the user
 * filled in wins; otherwise the heading the content opens with, lifted out of the body so the card
 * does not print it twice; otherwise no title. A filled-in title that repeats that opening heading
 * lifts it too.
 */
export function resolveCardTitle(explicitTitle: string, markdown: string): LeadingTitle {
  const leading = splitLeadingTitle(markdown);
  const title = explicitTitle.trim();
  if (!title) return leading;
  return { title, body: leading.title === title ? leading.body : markdown };
}
