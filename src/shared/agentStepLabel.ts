import { cleanRecap } from './recap';
import { maskSecrets } from './secretMask';

/** The tool that reads another tool's entry: what it returns is catalog text, written for the model. */
export const AGENT_HELP_TOOL = 'tool_help';

/** Everything that does not show as itself in a chat line: format controls, separators, C0/C1. */
export const UNSEEN_CHARACTER = /[\p{Cf}\p{Zl}\p{Zp}\p{Cc}]/gu;

/** Prose with the unseen characters taken out and line breaks turned into spaces (the model's own sentence). */
export function withoutUnseen(text: string): string {
  return text.replace(UNSEEN_CHARACTER, (char) => (char === '\n' || char === '\r' || char === '\t' ? ' ' : ''));
}

/** A word only a program writes: `rail_trip`, `mcp:notion-fetch`. Never a status a person should read. */
export const IDENTIFIER = /[a-z0-9]_[a-z0-9]|\bmcp:/i;

/** A letter of any alphabet but the Latin one: a line that has one is not plain English. */
export const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u;

/** An id that is one lowercase word could be plain English; `notion-fetch` or `searchMessages` never is. */
const PLAIN_WORD = /^[a-z]+$/;

/**
 * Whether a line calls a step by its tool's id. A one-word id ("weather") is an everyday word in an
 * English line, so it only counts inside a line with non-Latin letters. Any other id counts in every
 * line, spelled as it is: an English title may start a word with a capital. `tool` is '' for a line
 * that belongs to no tool.
 */
export function namesToolId(line: string, tool: string): boolean {
  if (!tool) return false;
  if (NON_LATIN_LETTER.test(line)) return line.toLowerCase().split(/[^a-z0-9_-]+/).includes(tool.toLowerCase());
  return !PLAIN_WORD.test(tool) && line.split(/[^A-Za-z0-9_-]+/).includes(tool);
}

/** Dots to a browser, and ordinary punctuation in Chinese text, so a host can hide behind one. */
const WIDE_DOT = /[。．｡]/g;
const WEB_ADDRESS = /https?:|www\.|\b\d{1,3}(?:\.\d{1,3}){3}\b|[\p{L}\p{N}-]+\.[a-z]{2,}\b/iu;
/** Checked on the line as written: after `WIDE_DOT`, every Chinese full stop would read as a host. */
const NON_LATIN_HOST = /[\p{L}\p{N}-]+\.\p{L}{2,}/u;

/** Whether a line holds a web address. A status line never does: page text can steer a model. */
export function holdsWebAddress(line: string): boolean {
  return WEB_ADDRESS.test(line.replace(WIDE_DOT, '.')) || NON_LATIN_HOST.test(line);
}

/** `saveDraft` → "Save draft", `create_issue` → "Create issue": the last resort, never a raw id. */
export function readableToolId(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.:/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : id;
}

const STEP_PARAM_MAX = 60;
/** How much of a value is read at all: a model's field has no length limit, and these run on regexes. */
const STEP_PARAM_SCAN = STEP_PARAM_MAX * 8;

/** The last name of a path, on either separator: the folders above it can hold the account name. */
function pathTail(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
}

/** Host only: a link's path and query can carry a token, and the site is what the row has to say. */
function urlHost(value: string): string {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`).hostname;
  } catch {
    return '';
  }
}

/**
 * One long run with a digit in it: a chat or page id (33 and 36 characters), which LINE prefers for
 * `to`. Long enough to spare what a person searches for, like the part number `LBUA0VG2BP-EVK-P`.
 */
const OPAQUE_ID = /^(?=.*\d)[a-z0-9_-]{24,}$/i;

/** A name the user would know, with any key in it masked: this text runs in the renderer too. */
function asWritten(value: string): string {
  return OPAQUE_ID.test(value) ? '' : maskSecrets(value, false);
}

/** Text the model composed: beside the spinner it reads as the app's status, like a title does. */
function asProse(value: string): string {
  return holdsWebAddress(value) ? '' : asWritten(value);
}

/**
 * The only fields a step may show beside its name, in the order tried. An allow-list on purpose:
 * `command`, `prompt`, `content`, `message`, `text`, `task` and every id stay in the copied log.
 * `symbol` (`2330.TW`) and `to` (a mail address) are written like hosts, so they skip that check.
 */
const STEP_PARAMS: readonly (readonly [string, (value: string) => string])[] = [
  ['query', asProse],
  ['location', asProse],
  ['symbol', asWritten],
  ['url', urlHost],
  ['path', pathTail],
  ['directory', pathTail],
  ['board', asProse],
  ['to', asWritten],
  // An installed Agent Skill's name (`use_skill`, and `shell` running its script).
  ['skill', asWritten],
];

/** A connector call keeps its fields as JSON in `arguments`; only its plain strings can be shown. */
function stepFields(tool: string, config: Record<string, string>): Record<string, unknown> {
  if (!tool.startsWith('mcp:')) return config;
  try {
    const parsed: unknown = JSON.parse(config.arguments ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** What a step is working on, in a few words, or undefined when none of its fields may be shown. */
export function stepParam(tool: string, config: Record<string, string> | undefined): string | undefined {
  if (!config) return undefined;
  const fields = stepFields(tool, config);
  for (const [key, shown] of STEP_PARAMS) {
    const value = fields[key];
    if (typeof value !== 'string') continue;
    const line = cleanRecap(shown(withoutUnseen(value).trim().slice(0, STEP_PARAM_SCAN)), STEP_PARAM_MAX);
    if (line) return line;
  }
  return undefined;
}
