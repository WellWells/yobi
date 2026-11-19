/*
 * What an `officecli` call from the model may do. OfficeCLI's MCP server has one tool that runs any
 * command line with the whole computer in reach: it reads and writes any path, and some verbs
 * install skills into other agents, start a preview server or open a browser. So every call is
 * split here, its verb looked up, and every path in it resolved the way the /agent file tools
 * resolve it and checked against their sandbox (reads: the read folders; writes: the output folder
 * only). The argv sent is the one checked, each checked path replaced by the file it was checked as.
 */

/** OfficeCLI's one MCP tool, which Yobi's server offers under the same name. */
export const OFFICE_TOOL_NAME = 'officecli';

/**
 * Verbs that only read the document (a `--out` file they write is checked as a write).
 * `load_skill` reads OfficeCLI's own design and QA guides, built into the program: no file is named.
 */
const READ_VERBS = new Set(['help', 'view', 'get', 'query', 'validate', 'dump', 'raw', 'load_skill']);
/** Verbs that change the document named first (`merge`: the second, its output). */
const WRITE_VERBS = new Set(['create', 'set', 'add', 'remove', 'move', 'swap', 'batch', 'import', 'merge', 'raw-set', 'add-part', 'save', 'close']);

/** Options that never take a value; every other `--name` takes the next word unless written `--name=value`. */
const BARE_OPTIONS = new Set([
  'json', 'force', 'header', 'browser', 'minimal', 'stdin', 'page-count', 'stop-on-error', 'best-effort', 'help', 'compact', 'h', '?',
]);
/** Opens something outside the call: a browser window. */
const REFUSED_OPTIONS = new Set(['browser']);
const OUT_OPTIONS = new Set(['o', 'out']);
const DOCUMENT_EXT = /\.(docx|xlsx|pptx)$/i;
/** What a write may create in the output folder: documents and what `view`/`dump` render. */
const WRITABLE_EXT = /\.(docx|xlsx|pptx|html?|svg|png|pdf|json|txt|md|csv|tsv)$/i;
/** File types a word can name; such a word is checked as a path wherever it appears. */
const FILE_EXT = /\.(docx|xlsx|pptx|docm|xlsm|pptm|dotx|xltx|potx|csv|tsv|json|png|jpe?g|gif|bmp|svg|webp|emf|wmf|tiff?|html?|pdf|txt|md|mmd|xml|zip)$/i;
const MAX_ARGS = 400;
const MAX_ARG_CHARS = 200_000;

const WINDOWS_ABSOLUTE = /(?:^|[^A-Za-z0-9])([A-Za-z]:[\\/][^"'<>|*?\r\n,;]*)/g;
/** `\\server\share` or `//server/share` as a word, a `key=` value or a JSON string (`"\\\\server`); a URL's `://` is not one. */
const NETWORK_PATH = /(?:^|["'=\s,[])(?:\\\\\\\\|\\\\|\/\/)[^\s"'\\/]/;
/** Props whose value is a file to load (a picture, an embedded object, a Mermaid or Markdown source). */
const SOURCE_PROP = /^(src|path)=(.*)$/is;
const SOURCE_IN_JSON = /"(?:src|path)"\s*:\s*"(?:https?|ftp):/i;

const WEB_SOURCE_DENIAL = 'access denied: this tool does not load pictures or files from the web. Save the file into the output folder first (or use a file the user attached) and point src at it.';
const NETWORK_DENIAL = 'access denied: network paths are not allowed.';
const RESPONSE_FILE_DENIAL = 'access denied: a word starting with @ is not allowed. Write the whole command inline.';
const MALFORMED_OPTION = (word: string): string =>
  `invalid option "${word.slice(0, 80)}": write options as --name value or --name=value (one-letter: -x value), and a value starting with "-" as --name=value.`;
const BATCH_INPUT_DENIAL = 'access denied: batch --input is not available here. Pass the commands inline with --commands \'[...]\'.';
const MERGE_DATA_DENIAL = 'access denied: merge --data takes inline JSON here, not a file. Pass the data as --data \'{...}\'.';
const INVALID_COMMAND ='invalid command: pass one officecli command line as a string, or its words as an array of strings.';

export type OfficeAccess = 'read' | 'write';

export interface CheckedOfficeCommand {
  /** What is sent: the call's words with every checked path replaced by the file it was checked as. */
  argv: string[];
  verb: string;
  access: OfficeAccess;
  /** `--force`: an existing file is replaced. */
  overwrites: boolean;
  /** Absolute paths of the files this call writes, for the answer. */
  writes: string[];
  /** `view <file> pdf`: the checked document to print (OfficeCLI has no PDF exporter, Yobi prints it). */
  pdfOf?: string;
  /** `load_skill`: the page of its text to return (Yobi's `--page`, never sent to OfficeCLI). */
  skillPage?: number;
}

export interface OfficePathPolicy {
  platform: NodeJS.Platform;
  /** Where a path the model wrote points, resolved exactly as the /agent file tools do. */
  resolve: (word: string) => Promise<string>;
  /** Null when the model may read the file, else the reason to show it (in the model's own words). */
  checkRead: (abs: string, asked: string) => Promise<string | null>;
  checkWrite: (abs: string, asked: string) => Promise<string | null>;
  /** POSIX only: does `/<segment>` exist at the filesystem root (then `/segment/…` is a file, not a document path). */
  isRootDir?: (segment: string) => boolean;
}

export type OfficeCheck = { ok: CheckedOfficeCommand } | { denied: string };

/**
 * A command line split the way a terminal would split it: whitespace separates, "…" and '…'
 * group, a backslash escapes only a quote (Windows paths keep theirs). Null when a quote is left open.
 */
export function splitCommandLine(text: string): string[] | null {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && text[i + 1] === quote) {
        current += quote;
        i++;
      } else if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) args.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (quote) return null;
  if (started) args.push(current);
  return args;
}

/**
 * One word of a `command` array: a string as it is, a JSON array or object as its JSON text — so
 * `"--commands", [{…}]` needs no JSON written inside a string. A model escaping that
 * inner JSON a third time breaks it: the words split at its quotes, OfficeCLI answers with its
 * usage text, and the run goes round in circles.
 */
function commandWord(item: unknown): string | null {
  if (typeof item === 'string') return item;
  return typeof item === 'object' && item !== null ? JSON.stringify(item) : null;
}

/** The tool's `command` argument as argv, a leading `officecli` dropped; null when it is not one. */
export function commandArgv(raw: unknown): string[] | null {
  let argv: string[] | null;
  if (typeof raw === 'string') argv = splitCommandLine(raw);
  else if (Array.isArray(raw)) {
    const words = raw.map(commandWord);
    if (words.some((word) => word === null)) return null;
    argv = words as string[];
  } else return null;
  if (!argv) return null;
  if (argv[0] && /^officecli(\.exe)?$/i.test(argv[0])) argv = argv.slice(1);
  if (argv.length === 0 || argv.length > MAX_ARGS || argv.some((arg) => arg.length > MAX_ARG_CHARS || arg.includes('\0'))) return null;
  return argv;
}

/** `read`/`write` for a verb Yobi lets through, null for any other. */
export function verbAccess(verb: string): OfficeAccess | null {
  const name = verb.toLowerCase();
  if (READ_VERBS.has(name)) return 'read';
  if (WRITE_VERBS.has(name)) return 'write';
  return null;
}

interface Word {
  /** Index in argv. */
  at: number;
  value: string;
  /** For `--name=value`, the text before the value. */
  prefix: string;
  /** The option this word is the value of, lower-case without dashes; '' for a positional. */
  option: string;
}

/**
 * `--name`, `--name=value`, or a one-letter `-x`/`-x=value`. OfficeCLI's parser also reads
 * `--name:value` and `-xvalue`, so any other word starting with a dash is refused rather than
 * guessed: guessed as a plain word, `--out:C:\elsewhere\x.html` would be checked as a read and
 * written as an --out.
 */
const OPTION_WORD = /^(--([A-Za-z][A-Za-z0-9-]*)|-([A-Za-z?]))(?:=(.*))?$/s;

function parseArgs(argv: readonly string[]): { positionals: Word[]; values: Word[]; bare: string[]; malformed?: string } {
  const positionals: Word[] = [];
  const values: Word[] = [];
  const bare: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-')) {
      positionals.push({ at: i, value: arg, prefix: '', option: '' });
      continue;
    }
    const match = OPTION_WORD.exec(arg);
    if (!match) return { positionals, values, bare, malformed: arg };
    const [, flag, long, short, inline] = match;
    const name = (long ?? short).toLowerCase();
    if (inline !== undefined) values.push({ at: i, value: inline, prefix: `${flag}=`, option: name });
    else if (BARE_OPTIONS.has(name) || i + 1 >= argv.length) bare.push(name);
    else {
      values.push({ at: i + 1, value: argv[i + 1], prefix: '', option: name });
      i++;
    }
  }
  return { positionals, values, bare };
}

/** The file a `src=`/`path=` prop names, or null for any other word. */
function sourceProp(word: string): string | null {
  return SOURCE_PROP.exec(word.trim())?.[2]?.trim() ?? null;
}

/** A source prop (or one inside batch/merge JSON) that would make OfficeCLI download from the web. */
function fetchesFromWeb(word: string): boolean {
  const source = sourceProp(word);
  return (source !== null && /^(https?|ftp):/i.test(source)) || SOURCE_IN_JSON.test(word);
}

/** A whole word that names a file: by its type, or as an absolute, home or `..` path. */
function isPathWord(word: string, policy: OfficePathPolicy): boolean {
  const text = word.trim();
  if (!text || text.includes('\n') || text.length > 1_024 || /^[{[]/.test(text)) return false;
  if (FILE_EXT.test(text) || /^~([\\/]|$)/.test(text) || /(^|[\\/])\.\.([\\/]|$)/.test(text)) return true;
  if (/^[A-Za-z]:[\\/]/.test(text)) return true;
  if (policy.platform !== 'win32' && text.startsWith('/')) return policy.isRootDir?.(text.split('/')[1] ?? '') === true;
  return false;
}

/** Paths written inside a longer value (inline batch or merge JSON) that the call would read. */
function embeddedPaths(word: string, policy: OfficePathPolicy): string[] {
  const found: string[] = [];
  for (const match of word.matchAll(WINDOWS_ABSOLUTE)) found.push(match[1].trim().replace(/\\\\/g, '\\'));
  if (policy.platform !== 'win32') {
    for (const match of word.matchAll(/["'=\s](\/[^"'\s,;]*)/g)) {
      if (policy.isRootDir?.(match[1].split('/')[1] ?? '')) found.push(match[1]);
    }
  }
  // Every JSON string that climbs out (`../x`, `a/../../x`) or starts at home (`~/x`).
  for (const match of word.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    const text = match[1].replace(/\\\\/g, '\\');
    if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(text) || /^~(?:[\\/]|$)/.test(text)) found.push(text);
  }
  return [...new Set(found)];
}

const NOT_ALLOWED = (verb: string): string =>
  `access denied: "${verb}" is not available here. Use help, load_skill, create, view, get, query, set, add, remove, move, swap, batch, import, merge, dump, raw, raw-set, add-part, validate, save or close.`;

/*
 * OfficeCLI's skills (the design rules, layouts and delivery checks for decks, reports, workbooks)
 * are compiled into the program, so they come with whichever copy the user has and always match
 * its version: no files to import or keep in step. One is 6-67 KB, past what one /agent
 * observation keeps, so Yobi hands it out in pages of the size `use_skill` pages a skill.
 */
/** One page of a skill's text: `use_skill`'s `SKILL_PAGE_CHARS` (a browser provider's latest observation holds 24,000). */
export const OFFICE_SKILL_PAGE_CHARS = 12_000;
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/i;
/** A file bundled with a skill (`reference/styles/INDEX.md`): relative, `/`-separated, never climbing out. */
const SKILL_FILE = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const MAX_SKILL_PAGE = 1_000;
/** The deck skill is named after its extension (`pptx`), so models ask for `docx` and `xlsx` too. */
const SKILL_BY_EXTENSION: Readonly<Record<string, string>> = { docx: 'word', xlsx: 'excel' };
const LOAD_SKILL_USAGE =
  'invalid command: use ["load_skill"] to list the skills, ["load_skill","<name>"] for one (a later page: add "--page","2"), or ["load_skill","<name>","--path","<file from its list>"].';

/** `load_skill [name] [--path relpath] [--page n]`: names a skill and its bundled file, never a file on disk. */
function checkLoadSkill(argv: readonly string[]): OfficeCheck {
  const sent = ['load_skill'];
  let name: string | undefined;
  let file: string | undefined;
  let page = 1;
  for (let i = 1; i < argv.length; i++) {
    const match = /^--(path|page)(?:=(.*))?$/is.exec(argv[i]);
    if (!match) {
      if (name !== undefined || !SKILL_NAME.test(argv[i])) return { denied: LOAD_SKILL_USAGE };
      name = SKILL_BY_EXTENSION[argv[i].toLowerCase()] ?? argv[i];
      continue;
    }
    const value = match[2] ?? argv[++i];
    if (value === undefined) return { denied: LOAD_SKILL_USAGE };
    if (match[1].toLowerCase() === 'page') {
      page = Number(value);
      if (!Number.isInteger(page) || page < 1 || page > MAX_SKILL_PAGE) return { denied: LOAD_SKILL_USAGE };
      continue;
    }
    if (file !== undefined || !SKILL_FILE.test(value)) return { denied: LOAD_SKILL_USAGE };
    file = value;
  }
  if (file !== undefined && name === undefined) return { denied: LOAD_SKILL_USAGE };
  if (name !== undefined) sent.push(name);
  if (file !== undefined) sent.push('--path', file);
  return { ok: { argv: sent, verb: 'load_skill', access: 'read', overwrites: false, writes: [], skillPage: page } };
}

/**
 * One page of a skill's text, cut at a line end where one falls in the page's last sixth (a
 * command example broken in two reads as two wrong commands), with how to ask for the next.
 * `next` is the call that returns the following page.
 */
export function officeSkillPage(text: string, page: number, next: (page: number) => string): string {
  const starts = [0];
  while (starts[starts.length - 1] + OFFICE_SKILL_PAGE_CHARS < text.length) {
    const from = starts[starts.length - 1];
    const limit = from + OFFICE_SKILL_PAGE_CHARS;
    const lineEnd = text.lastIndexOf('\n', limit - 1);
    starts.push(lineEnd > limit - OFFICE_SKILL_PAGE_CHARS / 6 ? lineEnd + 1 : limit);
  }
  const pages = starts.length;
  if (pages === 1) return text;
  const shown = Math.min(page, pages);
  const slice = text.slice(starts[shown - 1], starts[shown] ?? text.length);
  const more = shown < pages ? `; for more call officecli with ${next(shown + 1)}` : '';
  return `${slice}\n[page ${shown} of ${pages}${more}]`;
}

/** The `load_skill` call that returns `page` of the same skill or file. */
export function loadSkillCall(argv: readonly string[], page: number): string {
  return JSON.stringify([...argv, '--page', String(page)]);
}

/** Checks one call; `ok` carries the exact argv to send. */
export async function checkOfficeCommand(raw: unknown, policy: OfficePathPolicy): Promise<OfficeCheck> {
  const argv = commandArgv(raw);
  if (!argv) return { denied: INVALID_COMMAND };
  const verb = argv[0].toLowerCase();
  const access = verbAccess(verb);
  if (!access) return { denied: NOT_ALLOWED(argv[0]) };
  if (verb === 'load_skill') return checkLoadSkill(argv);
  if (argv.some((arg) => NETWORK_PATH.test(arg))) return { denied: NETWORK_DENIAL };
  if (argv.some(fetchesFromWeb)) return { denied: WEB_SOURCE_DENIAL };
  // `@file` makes OfficeCLI's parser read more words from that file, past every check here.
  if (argv.some((arg) => arg.startsWith('@'))) return { denied: RESPONSE_FILE_DENIAL };
  const { positionals, values, bare, malformed } = parseArgs(argv);
  if (malformed !== undefined) return { denied: MALFORMED_OPTION(malformed) };
  // A command or data file's contents are not checked here: those come inline only.
  if (verb === 'batch' && values.some((value) => value.option === 'input')) return { denied: BATCH_INPUT_DENIAL };
  if (verb === 'merge' && values.some((value) => value.option === 'data' && !/^\s*[{[]/.test(value.value))) return { denied: MERGE_DATA_DENIAL };
  const refused = [...bare, ...values.map((value) => value.option)].find((name) => REFUSED_OPTIONS.has(name));
  if (refused) return { denied: `access denied: --${refused} is not available here.` };

  const sent = [...argv];
  const writes: string[] = [];
  const handled = new Set<number>();

  // What the call writes: the document of a write verb (merge: its output) and any --out file.
  const documentWord = access === 'write' ? positionals[verb === 'merge' ? 1 : 0] : undefined;
  const writeWords = [
    ...(documentWord ? [documentWord] : []),
    ...values.filter((value) => OUT_OPTIONS.has(value.option)),
  ];
  for (const word of writeWords) {
    const isDocument = word === documentWord;
    if (isDocument ? !DOCUMENT_EXT.test(word.value) : !WRITABLE_EXT.test(word.value)) {
      return { denied: `access denied: "${word.value}" is not a file type this tool may write here (${isDocument ? '.docx, .xlsx or .pptx' : 'a document, or what view and dump render'}).` };
    }
    const abs = await policy.resolve(word.value);
    const reason = await policy.checkWrite(abs, word.value);
    if (reason) return { denied: reason };
    sent[word.at] = `${word.prefix}${abs}`;
    writes.push(abs);
    handled.add(word.at);
  }

  // Everything else that names a file is read: a read verb's document, merge's template, import's
  // CSV, batch's --input, a picture a src= prop points at, a path inside inline JSON.
  const readDocument = access === 'read' && verb !== 'help' ? positionals[0] : undefined;
  for (const word of [...positionals, ...values]) {
    if (handled.has(word.at)) continue;
    const source = sourceProp(word.value);
    if (source !== null) {
      if (/^data:/i.test(source) || !source) continue;
      const abs = await policy.resolve(source);
      const reason = await policy.checkRead(abs, source);
      if (reason) return { denied: reason };
      sent[word.at] = `${word.prefix}${word.value.slice(0, word.value.indexOf('=') + 1)}${abs}`;
      continue;
    }
    if (word === readDocument || isPathWord(word.value, policy)) {
      const abs = await policy.resolve(word.value);
      const reason = await policy.checkRead(abs, word.value);
      if (reason) return { denied: reason };
      sent[word.at] = `${word.prefix}${abs}`;
      continue;
    }
    for (const file of embeddedPaths(word.value, policy)) {
      const reason = await policy.checkRead(await policy.resolve(file), file);
      if (reason) return { denied: reason };
    }
  }

  const pdfOf = verb === 'view' && positionals.length > 1 && positionals[1].value.toLowerCase() === 'pdf' ? sent[positionals[0].at] : undefined;
  return { ok: { argv: sent, verb, access, overwrites: bare.includes('force'), writes: [...new Set(writes)], ...(pdfOf ? { pdfOf } : {}) } };
}

/** A shell command that runs officecli itself (bare, by path, or with .exe). */
export function shellRunsOfficecli(command: unknown): boolean {
  return typeof command === 'string' && /^\s*(?:"?[^\s"]*[\\/])?officecli(?:\.exe)?"?(?:\s|$)/i.test(command);
}

/**
 * How to run officecli where the office connector is in the run. Even with the
 * connector named and listed in full, a model can load the user's own "officecli" skill — written
 * for a terminal — and run `officecli load_skill word` through shell, which asks for a confirmation on
 * every command and leaves the connector's path checks behind.
 */
export function officeViaConnector(server: string): string {
  return `In this run officecli runs through its connector: "call_mcp", "server": "${server}", "name": "${OFFICE_TOOL_NAME}", "arguments": {"command": [the command's words, without "officecli"]} — never through "shell".`;
}

/** Whether an officecli call's `arguments` only read one of its built-in skills (`load_skill`). */
export function readsOfficeSkill(args: unknown): boolean {
  let parsed: unknown = args;
  if (typeof args === 'string') {
    try {
      parsed = JSON.parse(args);
    } catch {
      return false;
    }
  }
  const command = (parsed as { command?: unknown } | null)?.command;
  return Array.isArray(command) && command[0] === 'load_skill';
}
