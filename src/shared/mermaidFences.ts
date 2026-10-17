import { closesFence, parseFenceOpen } from './markdownFences';
import type { FenceOpen } from './markdownFences';

/** Spaces, then some other whitespace (a tab, NBSP, U+3000) before the line's first character. */
const OTHER_LEADING_WHITESPACE = /^ *[^\S ]/;

/*
 * The bodies found here are cache keys that must equal, byte for byte, what remark hands the code
 * block, and `stripIndent` can only undo space indentation. So unlike the shared reading, a line
 * indented with anything else neither opens nor closes a fence here.
 */
function openAt(line: string): FenceOpen | null {
  return OTHER_LEADING_WHITESPACE.test(line) ? null : parseFenceOpen(line);
}

function closesAt(line: string, open: FenceOpen): boolean {
  return !OTHER_LEADING_WHITESPACE.test(line) && closesFence(line, open);
}

function infoLanguage(info: string): string {
  const trimmed = info.trim();
  if (!trimmed) return '';
  const end = trimmed.search(/[\s{]/);
  return (end === -1 ? trimmed : trimmed.slice(0, end)).toLowerCase();
}

function stripIndent(line: string, amount: number): string {
  let removed = 0;
  while (removed < amount && line[removed] === ' ') removed += 1;
  return line.slice(removed);
}

export function isMermaidLanguage(language: string | undefined): boolean {
  return (language ?? '').toLowerCase() === 'mermaid';
}

export function extractMermaidFences(markdown: string): string[] {
  if (!markdown || !/mermaid/i.test(markdown)) return [];
  const lines = markdown.split('\n');
  const found: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const open = openAt(lines[index] ?? '');
    index += 1;
    if (!open) continue;

    const body: string[] = [];
    while (index < lines.length && !closesAt(lines[index] ?? '', open)) {
      body.push(stripIndent(lines[index] ?? '', open.indent));
      index += 1;
    }
    index += 1;

    if (isMermaidLanguage(infoLanguage(open.info)) && body.length > 0) {
      found.push(body.join('\n'));
    }
  }

  return found;
}
