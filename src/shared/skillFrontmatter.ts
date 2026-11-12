/**
 * The YAML subset SKILL.md frontmatter uses in the wild (agentskills.io, Claude Code, Gemini CLI,
 * Codex): `key: value` scalars, quoted strings, `|` / `>` block scalars, folded plain scalars, one
 * nested map (`metadata:`), block and flow lists (`allowed-tools:`). Anything else is read as text.
 *
 * A YAML library would be one more dependency for six keys. What it cannot read is dropped key by
 * key rather than failing the file: Claude Code still loads a skill whose YAML is malformed.
 */

export type FrontmatterValue = string | string[] | Record<string, string>;

export interface Frontmatter {
  /** Null when the file opens with no `---` block at all. */
  fields: Record<string, FrontmatterValue> | null;
  body: string;
  /** Lines the reader could not place under any key. */
  unreadable: number;
}

const FENCE = /^---\s*$/;
const FENCE_END = /^(---|\.\.\.)\s*$/;
const KEY_LINE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?:\s+(.*)|\s*)$/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isBlank(line: string): boolean {
  return line.trim() === '' || line.trimStart().startsWith('#');
}

/** A plain scalar ends at ` #` (a comment); a quoted one is read whole. */
function stripComment(value: string): string {
  const hash = value.search(/\s#/);
  return (hash >= 0 ? value.slice(0, hash) : value).trim();
}

function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\/nt])/g, (_m, ch: string) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch));
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return stripComment(value);
}

/**
 * A quoted scalar that closes on this line, as written up to its closing quote: what follows may
 * only be a comment (`"Does x" # note`). Null when the quote runs on to the next line.
 */
function closedQuoted(raw: string): string | null {
  const quote = raw[0];
  for (let i = 1; i < raw.length; i++) {
    const ch = raw[i];
    if (quote === '"' && ch === '\\') { i += 1; continue; }
    if (ch !== quote) continue;
    if (quote === "'" && raw[i + 1] === "'") { i += 1; continue; }
    const after = raw.slice(i + 1).trim();
    return after === '' || after.startsWith('#') ? raw.slice(0, i + 1) : null;
  }
  return null;
}

function flowList(raw: string): string[] | null {
  const value = raw.trim();
  if (!value.startsWith('[') || !value.endsWith(']')) return null;
  return value.slice(1, -1).split(',').map((item) => unquote(item)).filter((item) => item !== '');
}

/** `|` keeps line breaks, `>` folds them into spaces; `-` drops the final break, `+` keeps all. */
function blockScalar(indicator: string, lines: string[]): string {
  const literal = indicator.startsWith('|');
  const nonBlank = lines.filter((line) => line.trim() !== '');
  const indent = nonBlank.length > 0 ? Math.min(...nonBlank.map(indentOf)) : 0;
  const stripped = lines.map((line) => line.slice(Math.min(indent, indentOf(line))));
  let text = literal
    ? stripped.join('\n')
    : stripped.reduce((out, line, i) => {
        if (i === 0) return line;
        if (line === '') return `${out}\n`;
        return out.endsWith('\n') ? `${out}${line}` : `${out} ${line}`;
      }, '');
  if (indicator.includes('+')) return `${text}\n`;
  text = text.replace(/\s+$/, '');
  return indicator.includes('-') ? text : `${text}\n`;
}

/** Splits the leading `---` block from the Markdown body and reads its keys. */
export function parseFrontmatter(source: string): Frontmatter {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (!FENCE.test(lines[0] ?? '')) return { fields: null, body: text, unreadable: 0 };
  const end = lines.findIndex((line, i) => i > 0 && FENCE_END.test(line));
  if (end < 0) return { fields: null, body: text, unreadable: 0 };

  const yaml = lines.slice(1, end);
  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '');
  const fields: Record<string, FrontmatterValue> = {};
  let unreadable = 0;
  let i = 0;

  while (i < yaml.length) {
    const line = yaml[i];
    if (isBlank(line)) { i += 1; continue; }
    const match = indentOf(line) === 0 ? KEY_LINE.exec(line) : null;
    if (!match) { unreadable += 1; i += 1; continue; }
    const key = match[1];
    const rest = (match[2] ?? '').trim();
    // The lines that belong to this key: everything indented under it, blank lines included.
    let j = i + 1;
    while (j < yaml.length && (yaml[j].trim() === '' || indentOf(yaml[j]) > 0)) j += 1;
    const child = yaml.slice(i + 1, j);
    while (child.length > 0 && child[child.length - 1].trim() === '') child.pop();
    i = j;

    // `description: | # note` is a block scalar with a comment after its indicator.
    const indicator = stripComment(rest);
    if (/^[|>][+-]?$/.test(indicator)) {
      fields[key] = blockScalar(indicator, child);
      continue;
    }
    const listed = flowList(rest);
    if (listed) { fields[key] = listed; continue; }
    if (rest !== '') {
      const quoted = /^["']/.test(rest);
      const closedQuote = quoted ? closedQuoted(rest) : null;
      const continuation = child.filter((entry) => !isBlank(entry)).map((entry) => entry.trim());
      if (closedQuote !== null) fields[key] = unquote(closedQuote);
      else if (continuation.length === 0) fields[key] = unquote(rest);
      // A quoted scalar folded over several lines: joined first, then unquoted.
      else if (quoted) fields[key] = unquote([rest, ...continuation].join(' '));
      else fields[key] = stripComment([rest, ...continuation].join(' '));
      continue;
    }
    const items = child.filter((entry) => !isBlank(entry));
    if (items.length === 0) { fields[key] = ''; continue; }
    if (items.every((entry) => entry.trimStart().startsWith('- ') || entry.trim() === '-')) {
      fields[key] = items.map((entry) => unquote(entry.trimStart().slice(1)));
      continue;
    }
    const map: Record<string, string> = {};
    for (const entry of items) {
      const pair = KEY_LINE.exec(entry.trim());
      if (pair) map[pair[1]] = unquote(pair[2] ?? '');
      else unreadable += 1;
    }
    fields[key] = map;
  }
  return { fields, body, unreadable };
}

/** A frontmatter value as one string: lists joined with spaces (`allowed-tools`), maps dropped. */
export function fieldText(value: FrontmatterValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.join(' ').trim();
  return '';
}

/** YAML 1.1 and Claude Code read all of these as booleans. */
export function fieldFlag(value: FrontmatterValue | undefined): boolean {
  return /^(true|yes|on|1)$/i.test(fieldText(value));
}
