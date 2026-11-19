import { parseBinaryPlist } from '../binaryPlist';
import type { PageRead } from '../pageReader';
import type { PageApiReader } from './api';
import { readerPage } from './readerPage';

/**
 * A shortcut shared through iCloud (`icloud.com/shortcuts/<id>`). Its page is a script that shows
 * the name and a button; the record behind it (the page's own `shortcuts/api/records/<id>`) names
 * the shortcut and links its file, a binary property list whose actions say what it does. The
 * actions are read as the file names them (`is.workflow.actions.` dropped) with the text and
 * variables the author put in, nested as its ifs, menus and repeats are.
 */

const HOSTS = new Set(['www.icloud.com', 'icloud.com']);
const SHORTCUT_PATH = /^\/shortcuts\/([0-9a-f]{32})\/?$/i;
/** Where the record links the file: Apple's iCloud content hosts, nothing the record could point elsewhere. */
const FILE_HOST = /\.icloud-content\.com$/i;
const ACTION_PREFIX = 'is.workflow.actions.';
/** Ids and switches, no text of the author's; a variable is read where it is used. */
const SKIPPED_KEYS = new Set(['UUID', 'GroupingIdentifier', 'WFControlFlowMode', 'CustomOutputName', 'WFSerializationType', 'Type', 'OutputUUID']);
/** Where a variable sits in a text the author typed. */
const PLACEHOLDER = String.fromCharCode(0xff_fc);
const MAX_ACTIONS = 400;
const MAX_TEXT_CHARS = 300;
const MAX_LINE_CHARS = 800;
const MAX_NESTING = 8;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function fieldValue(answer: unknown, field: string): unknown {
  return record(record(record(answer)?.fields)?.[field])?.value;
}

function variableName(attachment: unknown): string {
  const node = record(attachment);
  return text(node?.VariableName) || text(node?.OutputName) || text(node?.PropertyName) || text(node?.Type);
}

/** A text the author typed, its variables written in as `{name}`. */
function tokenText(token: Record<string, unknown>): string {
  const value = record(token.Value);
  const typed = text(value?.string);
  const variables = Object.entries(record(value?.attachmentsByRange) ?? {})
    .map(([range, attachment]) => ({ at: Number(/^\{(\d+),/.exec(range)?.[1] ?? -1), name: variableName(attachment) }))
    .sort((a, b) => a.at - b.at);
  let out = '';
  let last = 0;
  for (const { at, name } of variables) {
    if (at < last || typed[at] !== PLACEHOLDER) continue;
    out += `${typed.slice(last, at)}{${name}}`;
    last = at + 1;
  }
  return out + typed.slice(last);
}

function textsOf(value: unknown, out: string[], depth: number): void {
  if (depth > MAX_NESTING * 2) return;
  if (typeof value === 'string') {
    if (value.trim()) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) textsOf(item, out, depth + 1);
    return;
  }
  const node = record(value);
  if (!node) return;
  if (node.WFSerializationType === 'WFTextTokenString') {
    out.push(tokenText(node));
    return;
  }
  if (node.WFSerializationType === 'WFTextTokenAttachment') {
    out.push(`{${variableName(node.Value)}}`);
    return;
  }
  for (const [key, item] of Object.entries(node)) {
    if (!SKIPPED_KEYS.has(key)) textsOf(item, out, depth + 1);
  }
}

/** One parameter as `Key=text`, by the file's own key (`WF` dropped): which text is the search and which the replacement. */
function parameterText(key: string, value: unknown): string {
  const texts: string[] = [];
  textsOf(value, texts, 0);
  const said = [...new Set(texts.map((item) => item.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS)))].filter(Boolean);
  return said.length ? `${key.replace(/^WF/, '')}=${said.join(', ')}` : '';
}

function actionLine(action: Record<string, unknown>): string {
  const id = text(action.WFWorkflowActionIdentifier);
  const name = id.startsWith(ACTION_PREFIX) ? id.slice(ACTION_PREFIX.length) : id;
  const parameters = Object.entries(record(action.WFWorkflowActionParameters) ?? {})
    .filter(([key]) => !SKIPPED_KEYS.has(key))
    .map(([key, value]) => parameterText(key, value))
    .filter(Boolean);
  return (parameters.length ? `${name}: ${parameters.join(' · ')}` : name).slice(0, MAX_LINE_CHARS);
}

/** The actions, one a line, indented inside each if, menu and repeat; the block ends are left out. */
export function shortcutActions(file: unknown): string[] {
  const actions = record(file)?.WFWorkflowActions;
  if (!Array.isArray(actions)) return [];
  const lines: string[] = [];
  let depth = 0;
  for (const action of actions.slice(0, MAX_ACTIONS)) {
    const node = record(action);
    if (!node) continue;
    const mode = record(node.WFWorkflowActionParameters)?.WFControlFlowMode;
    if (mode === 2) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    const level = mode === 1 ? Math.max(0, depth - 1) : depth;
    lines.push(`${'  '.repeat(level)}- ${actionLine(node)}`);
    if (mode === 0) depth = Math.min(depth + 1, MAX_NESTING);
  }
  return lines;
}

function shortcutPage(answer: unknown, url: string, actions: readonly string[]): PageRead | null {
  const name = text(fieldValue(answer, 'name')).trim();
  if (!name) return null;
  const modified = Number(record(record(answer)?.modified)?.timestamp);
  return readerPage({
    title: name,
    author: '',
    publishedAt: Number.isFinite(modified) && modified > 0 ? new Date(modified).toISOString().slice(0, 10) : '',
    siteName: 'Shortcuts',
    url,
    text: [name, actions.join('\n')].filter(Boolean).join('\n\n'),
  });
}

export const icloudShortcutReader: PageApiReader = {
  address(url) {
    if (!HOSTS.has(url.hostname.toLowerCase())) return null;
    const id = SHORTCUT_PATH.exec(url.pathname)?.[1];
    return id ? `https://www.icloud.com/shortcuts/api/records/${id.toLowerCase()}` : null;
  },
  read(answer, url) {
    if (record(answer)?.deleted === true) return { failure: 'missing', message: 'This iCloud shortcut link no longer shares a shortcut: its author stopped sharing it.' };
    const page = shortcutPage(answer, url, []);
    // The name alone says little of what the shortcut does: the file's actions do.
    return page && { ...page, complete: false };
  },
  attachment: {
    address(answer) {
      const name = text(fieldValue(answer, 'name')).trim() || 'shortcut';
      const link = text(record(fieldValue(answer, 'shortcut'))?.downloadURL).replace('${f}', encodeURIComponent(`${name}.shortcut`));
      try {
        const url = new URL(link);
        return url.protocol === 'https:' && FILE_HOST.test(url.hostname) ? url.href : null;
      } catch {
        return null;
      }
    },
    read(bytes, answer, url) {
      const actions = shortcutActions(parseBinaryPlist(bytes));
      return actions.length ? shortcutPage(answer, url, actions) : null;
    },
  },
};
