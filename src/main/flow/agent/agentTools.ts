import type { SkillType } from '../../../shared/types';
import { SKILL_SPECS, SKILLS_WITHOUT_OUTPUT_KEY } from '../../../shared/flowSkillSchema';
import type { SkillSpec } from '../../../shared/flowSkillSchema';
import { AGENT_BUILTIN_TOOLS, buildBuiltinCatalog, builtinRequiredFields, isBuiltinTool } from './agentBuiltins';
import type { AgentBuiltinTool } from './agentBuiltins';
import { readPlanFields, readStepBudget } from './agentPrompts';
import { readIntent } from './actionGate';
import type { GoalIntent } from './actionGate';
import type { Validation } from './structuredLlm';

export const AGENT_ALLOWED_SKILLS: readonly SkillType[] = [
  'browser',
  'search',
  'research',
  'youtube',
  'gmap_reviews',
  'llm',
  'file_read',
  'file_list',
  'file_write',
  'shell',
  'clipboard',
  'sysinfo',
  'weather',
  'air_quality',
  'stock',
  'forex',
  'random',
  'notify',
];

const ALLOWED_SET = new Set<SkillType>(AGENT_ALLOWED_SKILLS);

export function isAllowedTool(name: string): name is SkillType {
  return ALLOWED_SET.has(name as SkillType);
}

/**
 * Which tools one run may see and call. The catalog is only a suggestion — a model can name a
 * tool it remembers from training — so the same scope has to reach the validator, `tool_help`
 * and the prompt grammar, or the restriction is cosmetic.
 */
export interface AgentToolScope {
  skills: readonly SkillType[];
  builtins: boolean;
  help: boolean;
  /** Offer `delegate`. Set by the engine per run, never by a scope constant: it depends on depth and provider. */
  delegate?: boolean;
}

/**
 * Skills a delegated helper never gets. A helper reads for the main agent; every change, and every
 * question to the user, stays with the run the user is watching.
 */
export const HELPER_EXCLUDED_SKILLS: ReadonlySet<SkillType> = new Set<SkillType>(['shell', 'file_write', 'notify', 'clipboard']);

export function readOnlyScope(scope: AgentToolScope): AgentToolScope {
  return {
    skills: scope.skills.filter((skill) => !HELPER_EXCLUDED_SKILLS.has(skill)),
    builtins: false,
    help: scope.help,
    delegate: false,
  };
}

export const FULL_TOOL_SCOPE: AgentToolScope = {
  skills: AGENT_ALLOWED_SKILLS,
  builtins: true,
  help: true,
};

/**
 * What a Telegram/LINE `/agent` may call. `shell` and `file_write` are removed at SCOPE level
 * rather than left to the confirmation gate, because a bot-origin run can never be approved:
 * both entry points pass `getMainWin: () => null`, so `askRenderer` denies immediately and
 * `confirmShell` denies on origin before that. Leaving them in the catalog would only buy a
 * tool the model picks, is refused on, and burns a turn plus a queue slot on.
 */
export const BOT_TOOL_SCOPE: AgentToolScope = {
  skills: AGENT_ALLOWED_SKILLS.filter((skill) => skill !== 'shell' && skill !== 'file_write'),
  builtins: true,
  help: true,
};

/** A run driven by one MCP server alone: no Yobi skills, no flow builders, no tool_help. */
export const MCP_ONLY_TOOL_SCOPE: AgentToolScope = { skills: [], builtins: false, help: false };

/**
 * What the composer's "web" checkbox switches off.
 *
 * `browser` belongs here with the two search tools: reading a page IS going online, so leaving it
 * behind would make the toggle cosmetic — the model would simply fetch pages instead of searching.
 */
export const WEB_SKILLS: readonly SkillType[] = ['search', 'research', 'browser'];

const WEB_SKILL_SET = new Set<SkillType>(WEB_SKILLS);

/**
 * Removing these shortens the built-in catalog, and `mcpCatalogBudgetChars()` is "the cap minus
 * the built-in catalog" — so switching the web off is also how a user on a tight provider buys
 * their MCP connectors room to exist. That is a consequence of the arithmetic, not a special case.
 */
export function withWebCapability(scope: AgentToolScope, enabled: boolean): AgentToolScope {
  if (enabled) return scope;
  return { ...scope, skills: scope.skills.filter((skill) => !WEB_SKILL_SET.has(skill)) };
}

/**
 * A bot message that is not an explicit `/agent`: the user is chatting, not asking for the full
 * agent. It gets the web and the harmless read-only lookups, and nothing that touches the
 * machine — files, clipboard, hardware and notifications stay behind `/agent`, where the user
 * asked for them by name. Widening this by default would turn every paired contact's small talk
 * into something that can read local files.
 */
export const BOT_CHAT_TOOL_SCOPE: AgentToolScope = {
  skills: ['search', 'research', 'browser', 'youtube', 'gmap_reviews', 'weather', 'air_quality', 'stock', 'forex', 'random'],
  builtins: false,
  help: true,
};

export function scopeHasTools(scope: AgentToolScope): boolean {
  return scope.skills.length > 0 || scope.builtins;
}

/**
 * Thrown when a scoped run has no tools to work with; the caller turns it into a user-facing
 * message. It lives here rather than in agentEngine so that a test mocking the engine does not
 * have to re-export it just to let an unrelated error path run.
 */
export type AgentScopeFailure = 'not-connected' | 'no-room';

const SCOPE_FAILURE_TEXT: Record<AgentScopeFailure, string> = {
  'not-connected': 'MCP server is not connected',
  'no-room': 'MCP catalog does not fit',
};

export class AgentScopeError extends Error {
  constructor(readonly reason: AgentScopeFailure) {
    super(SCOPE_FAILURE_TEXT[reason]);
    this.name = 'AgentScopeError';
  }
}

export const AGENT_HELP_TOOL = 'tool_help';

export type AgentHelpTool = typeof AGENT_HELP_TOOL;

export function isHelpTool(name: string): name is AgentHelpTool {
  return name === AGENT_HELP_TOOL;
}

// `shell` and `file_write` are tier 1 deliberately, and not to save a few characters: their
// full entries cost 910 chars, which pushes a Duck.ai REPAIR prompt (catalog + 6 observations
// + a 4-step plan + the stall warning) past its 12,000-byte cap — and what falls off the end
// there is the closing `</steps>` fence and the action instruction. Briefs cost 298.
export const AGENT_BRIEF_ONLY_TOOLS: readonly SkillType[] = [
  'sysinfo', 'air_quality', 'gmap_reviews', 'forex', 'random', 'stock', 'weather',
  'file_read', 'file_list', 'file_write', 'shell', 'clipboard', 'notify',
];

const BRIEF_ONLY_SET = new Set<SkillType>(AGENT_BRIEF_ONLY_TOOLS);

// SECURITY: the workspace/sandbox wording must survive into these tier-1 briefs. A model
// that guesses a path has to be refused rather than corrected, and only the brief tells it so.
const AGENT_TOOL_BRIEFS: Partial<Record<SkillType, string>> = {
  file_read: 'Read a local text file. Only your workspace is allowed (app output folder, Documents, Downloads, Desktop); a guessed path is refused, so call file_list first.',
  file_list: 'List the files in a local folder (non-recursive). Only your workspace is allowed (app output folder, Documents, Downloads, Desktop). Use it to learn a file name before reading it.',
  stock: 'Get a stock / equity / index quote. The suffix picks the market: US as-is (AAPL), Taiwan .TW (2330.TW) or .TWO, indices with ^ (^TWII).',
  // The flow-authored brief for file_write says the path "lands in {{file}}", which is a flow
  // variable this run does not have — and `sanitizeFieldDesc` only ever cleans field
  // descriptions, never a brief. An override is mandatory here, not cosmetic.
  file_write: 'Save text to a local file and get back the path. Only the app output folder is allowed; anywhere else is refused, not corrected. Leave "folder" blank to use it.',
  shell: "Run ONE system command and return its output. The user approves every command; a refusal is final. Runs in your workspace, never as admin. Credential stores and system directories are refused. Use only when no other tool fits.",
};

const AGENT_HIDDEN_FIELDS = new Set<string>([
  'attachments',
  'emitFailFlag', 'includeImage', 'provider', 'saveToHistory', 'useMemory', 'useUserMemory',
  'exportFormat', 'exportTitle', 'exportFileName', 'exportShowProvider', 'exportShowTimestamp', 'palette',
]);

const AGENT_TOOL_DOCS: Partial<Record<SkillType, { summary: string; output?: string }>> = {
  browser: {
    summary: 'Fetch a human web PAGE and return its visible text (renders JavaScript; for articles / SPA pages). Accepts one URL, a JSON array of URLs, or a comma/newline list. NOT for JSON APIs, and NOT for running a web search — open a search engine with it and you get its chrome, not results; use search or research.',
    output: "the page's visible text (multiple URLs are joined with a '---' separator).",
  },
  search: {
    summary: 'Search the web (DuckDuckGo) and return a ranked list of results — titles, links and snippets only, NO page content. Use this only when you want the raw links yourself (e.g. to pick one specific page for browser). If you want an ANSWER from the web, use research instead.',
    output: "a JSON array of {title, link, snippet} ranked by relevance ('[]' if nothing matched); snippet is the result-page summary and may be empty.",
  },
  research: {
    summary: 'Research a focused QUESTION and return a cited answer in ONE step. Long standard-mode questions are planned into search queries; short ones are searched directly. Prefer this for evidence. Repeat only for a distinct missing fact; after weak results change keywords or read a specific source with browser/urls, rather than rephrasing the same request.',
    output: "a written answer in prose with [n] citation markers; also provides sources (a JSON array of the {title, link} pages actually read) and count (how many).",
  },
  youtube: {
    summary: "Fetch a YouTube video's transcript and title from its URL.",
    output: 'the transcript (empty if the video has no captions or the URL is invalid); also provides the video title.',
  },
  gmap_reviews: {
    summary: "Fetch Google Maps reviews for one place, plus the place-level aggregate. Accepts share links and full place URLs. sort 'mixed' (default) samples newest/lowest/highest so both good and bad reviews appear.",
    output: "a JSON array of {author, rating, date, text, reply} newest-first ('[]' if none); also provides fields place (name), rating (overall stars), total (review count), distribution (star breakdown), positive (positive share %), verdict (overall label), tier (0-9).",
  },
  llm: {
    summary: 'Ask a language model a sub-question — e.g. summarize or extract from a large piece of text you include inline in the prompt — and receive its answer as the observation. Do NOT use it for reasoning you can do yourself: it spends a whole step to tell you something you already know.',
    output: "the model's answer text.",
  },
  file_read: {
    summary: "Read a local text file and return its contents as text. Only files inside your workspace are allowed — the app output folder and your Documents, Downloads, and Desktop folders; any other path (home dotfiles like ~/.ssh, system folders) is refused. Use / as the separator (e.g. Documents/notes.txt). If you are not certain of the exact name, call file_list first — a guessed path is refused, not corrected.",
    output: "the file's text content (empty if the path is blank).",
  },
  file_list: {
    summary: "List the files in a local directory (non-recursive, files only). Only directories inside your workspace are allowed — the app output folder and your Documents, Downloads, and Desktop folders; any other path is refused. Use / as the separator (e.g. Documents).",
    output: 'a JSON array of {title, link} where title = file name and link = full path.',
  },
  clipboard: {
    summary: 'Read from or write to the system clipboard.',
    output: "the clipboard text when action='read'; empty when action='write'.",
  },
  sysinfo: {
    summary: 'Collect local system / hardware / network info (OS, CPU, GPU, memory, system language, local IP, uptime, time, app versions).',
    output: "one string (key:value lines for format='text', or a JSON document for format='json'); each collected field is also provided as an individual sub-field (e.g. locale, cpu, publicIp).",
  },
  weather: {
    summary: 'Get the current weather for a place NAME (Open-Meteo, no API key); returns current conditions plus today\'s high/low and rain chance. Use the place\'s English / Latin-script name (e.g. "Kaohsiung", not "高雄").',
    output: 'a JSON object {location, temp, feelsLike, condition, humidity, windSpeed, unit, isDay, high, low, rainChance}; the same values are also provided as individual fields.',
  },
  air_quality: {
    summary: 'Get the current air quality (AQI) for a place NAME (Open-Meteo, no API key); a location in Taiwan reads the nearest Ministry of Environment ground station instead when the user has saved a MOENV key. Use the place\'s English / Latin-script name (e.g. "Kaohsiung", not "高雄").',
    output: 'a JSON object {location, station, aqi, level, status, statusLocal, pollutant, pm2_5, pm10, ozone, no2, so2, co, gasUnits, europeanAqi, source, observedAt}; level is 1-6 (1 Good … 6 Hazardous, 0 = no reading) and status is the English band name. Gas units differ by source — read gasUnits before quoting ozone/no2/so2/co. Most values are also provided as individual fields.',
  },
  stock: {
    summary: 'Get a stock / equity quote (Yahoo Finance, no API key). Market is set by the symbol suffix: US tickers as-is (AAPL), Taiwan .TW (2330.TW) or .TWO (OTC), indices with ^ (^TWII).',
    output: 'a JSON quote object; a single symbol also provides fields symbol, name, currency, price, open, high, low, volume, previousClose, change, changePct, marketTime. Several comma/newline symbols give a JSON array.',
  },
  forex: {
    summary: 'Get a near-live foreign-exchange rate, and an optional converted amount (Yahoo Finance, falling back to a once-daily rate table; no API key).',
    output: 'a JSON object {base, target, rate, amount, converted, asOf, previousClose, changePct}; the values are also provided as individual fields. previousClose and changePct are empty when only the daily fallback source answered.',
  },
  random: {
    summary: 'Generate random WHOLE numbers within an inclusive range (both min and max can occur) — for dice, lottery numbers, picking an index, or jitter.',
    output: 'count 1 (or blank) → a single whole number as a string; count > 1 → a JSON array of whole numbers.',
  },
  notify: {
    summary: 'Show a desktop notification (system toast).',
  },
  shell: {
    summary: "Run ONE system command on the user's computer (Windows \"cmd\" or \"powershell\"; macOS/Linux the login shell) and return its combined output. The user is asked to approve every command before it runs and a refusal is FINAL — never rephrase a refused command and send it again. It runs with your workspace folder as the working directory, so a relative path or a redirect lands there. It never runs as administrator, and a command that names a credential store (.ssh, .aws, .claude, a credentials file, the Credential Manager, a registry hive) or a system directory (Windows, Program Files, System32) is refused before the user is even asked. NOT for fetching web pages (use browser or research), and NOT for reading a file that file_read can read.",
    output: "the command's stdout, trimmed — or its stderr when stdout is empty. A non-zero exit comes back as an ERROR observation carrying the message.",
  },
  file_write: {
    // No `output` clause: file_write is in SKILLS_WITHOUT_OUTPUT_KEY, so `renderAgentToolLine`
    // suppresses the "returns:" tail. The return contract is folded into the summary instead —
    // removing it from that list would change the flow-side `{{file}}` contract.
    summary: 'Write text to a local file and return the full path it wrote. Only your workspace is allowed — the app output folder and your Documents, Downloads and Desktop folders; any other destination is refused, not corrected. Leave "folder" blank to write to the app output folder; parent folders are created for you. Use it to save something the user asked to keep — not to stash notes for yourself between steps.',
  },
};

function sanitizeFieldDesc(desc: string): string {
  return desc
    .replace(/;?\s*may embed \{\{variables\}\}/gi, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function visibleFieldsOf(spec: SkillSpec) {
  return spec.fields.filter((f) => !AGENT_HIDDEN_FIELDS.has(f.key));
}

function renderAgentToolLine(spec: SkillSpec): string {
  const doc = AGENT_TOOL_DOCS[spec.type];
  const summary = doc?.summary ?? spec.summary;
  const visibleFields = visibleFieldsOf(spec);
  const fields = visibleFields.length === 0
    ? 'no config.'
    : `config keys: ${visibleFields
        .map((f) => `"${f.key}" (${sanitizeFieldDesc(f.desc)}${f.required ? '; REQUIRED' : ''})`)
        .join('; ')}`;
  const hasOutput = !SKILLS_WITHOUT_OUTPUT_KEY.includes(spec.type);
  const returns = hasOutput && doc?.output ? ` → returns: ${doc.output}` : '';
  return `- "${spec.type}": ${summary} ${fields}${returns}`;
}

export const OPTS_MARKER = '[+opts]';

function renderBriefToolLine(spec: SkillSpec): string {
  const brief = AGENT_TOOL_BRIEFS[spec.type] ?? spec.brief;
  const visibleFields = visibleFieldsOf(spec);
  const required = visibleFields.filter((f) => f.required).map((f) => `"${f.key}"`);
  const config = required.length > 0 ? `config: ${required.join(', ')} (REQUIRED).` : 'config: none required.';
  const opts = visibleFields.some((f) => !f.required) ? ` ${OPTS_MARKER}` : '';
  return `- "${spec.type}": ${brief} ${config}${opts}`;
}

function helpToolLine(): string {
  return [
    `- "${AGENT_HELP_TOOL}": Look up another tool's FULL entry — its optional config keys and its exact output —`,
    'before calling it. config keys: "tool" (the name of the tool to look up; REQUIRED)',
    "→ returns: that tool's complete catalog entry.",
  ].join(' ');
}

function optsFooter(): string {
  return `A line marked ${OPTS_MARKER} shows only its REQUIRED config; call "${AGENT_HELP_TOOL}" first if you need that tool's optional settings or its exact output shape.`;
}

function specsForAgent(scope: AgentToolScope = FULL_TOOL_SCOPE): SkillSpec[] {
  const allowed = new Set<SkillType>(scope.skills);
  return SKILL_SPECS.filter((spec) => allowed.has(spec.type));
}

function builtinNames(scope: AgentToolScope): AgentBuiltinTool[] {
  if (!scope.builtins) return [];
  return AGENT_BUILTIN_TOOLS.filter((tool) => tool !== 'delegate' || scope.delegate === true);
}

function toolNames(scope: AgentToolScope): string[] {
  return [
    ...scope.skills,
    ...builtinNames(scope),
    ...(scope.help ? [AGENT_HELP_TOOL] : []),
  ];
}

/**
 * `allBrief` puts EVERY tool on a tier-1 line, not only `AGENT_BRIEF_ONLY_TOOLS`.
 *
 * For a provider whose cap the full catalog cannot share: measured on Duck.ai (12,000 BYTES, since removed),
 * the instruction block plus the full catalog spend 11,747 of it before a single observation, so the
 * scratch block collapses to its placeholder and the model picks the next action having seen none of
 * the page it just fetched. Briefs keep every tool VISIBLE — what a catalog is for — and `tool_help`
 * recovers any entry in full for the cost of one step.
 */
export function buildToolCatalog(scope: AgentToolScope = FULL_TOOL_SCOPE, allBrief = false): string {
  const blocks: string[] = [];
  if (scope.skills.length > 0) {
    blocks.push(specsForAgent(scope)
      .map((spec) => (allBrief || BRIEF_ONLY_SET.has(spec.type)
        ? renderBriefToolLine(spec)
        : renderAgentToolLine(spec)))
      .join('\n'));
  }
  if (scope.builtins) blocks.push(buildBuiltinCatalog(scope.delegate === true));
  if (scope.help) blocks.push(helpToolLine(), optsFooter());
  return blocks.join('\n');
}

export function describeToolSpec(name: string, scope: AgentToolScope = FULL_TOOL_SCOPE): string {
  const wanted = name.trim();
  if (!wanted) return 'ERROR: "tool" is required — name the tool you want the full entry for.';
  if (scope.help && isHelpTool(wanted)) return helpToolLine();
  if (builtinNames(scope).includes(wanted as AgentBuiltinTool)) {
    const line = buildBuiltinCatalog(scope.delegate === true).split('\n').find((entry) => entry.startsWith(`- "${wanted}"`));
    if (line) return line;
  }
  const spec = specsForAgent(scope).find((entry) => entry.type === wanted);
  if (!spec) {
    return `ERROR: "${wanted}" is not one of your tools. Pick one from TOOLS: ${toolNames(scope).join(', ')}.`;
  }
  return renderAgentToolLine(spec);
}

/**
 * Every config key the model may set for this tool — the VISIBLE declared fields, so the
 * catalog and the validator agree on exactly one vocabulary. Hidden fields are hidden because
 * the agent has no business setting them; none of them is required, so nothing
 * `requiredFieldsFor` demands can be filtered away here.
 */
function allowedConfigKeys(type: string): Set<string> {
  if (isHelpTool(type)) return new Set(['tool']);
  if (isBuiltinTool(type)) return new Set(builtinRequiredFields(type));
  const spec = SKILL_SPECS.find((entry) => entry.type === type);
  return new Set(spec ? visibleFieldsOf(spec).map((field) => field.key) : []);
}

function requiredFieldsFor(type: SkillType | AgentBuiltinTool | AgentHelpTool): string[] {
  if (isHelpTool(type)) return ['tool'];
  if (isBuiltinTool(type)) return builtinRequiredFields(type);
  const spec = SKILL_SPECS.find((s) => s.type === type);
  return spec ? spec.fields.filter((f) => f.required).map((f) => f.key) : [];
}

export interface AgentAction {
  thought: string;
  action: 'call_tool' | 'finish' | 'ask_user' | 'deliver';
  tool?: SkillType | AgentBuiltinTool | AgentHelpTool;
  config?: Record<string, string>;
  title?: string;
  content?: string;
  question?: string;
  /** `deliver` only: the 1-based step whose observation IS the answer. */
  from?: number;
  plan?: string[];
  planDone?: number[];
  /** How many steps the model says the GOAL needs. Honored once, on the first action. */
  stepsNeeded?: number;
  intent?: GoalIntent;
  /** `ask_user` only: answers the user can pick instead of typing. */
  choices?: string[];
}

const MAX_CHOICES = 4;
const MAX_CHOICE_CHARS = 120;

/** Malformed choices are dropped, never a reason to reject the question they came with. */
export function readChoices(obj: Record<string, unknown>): { choices?: string[] } {
  if (!Array.isArray(obj.choices)) return {};
  const choices = [...new Set(obj.choices
    .filter((choice): choice is string => typeof choice === 'string')
    .map((choice) => choice.replace(/\s+/g, ' ').trim().slice(0, MAX_CHOICE_CHARS))
    .filter(Boolean))].slice(0, MAX_CHOICES);
  return choices.length > 0 ? { choices } : {};
}

export interface FinalAnswer {
  title: string;
  content: string;
}

export function looksLikeRawData(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}

export function validateFinalAnswer(json: unknown): Validation<FinalAnswer> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, error: 'The response must be a single JSON object {"title": string, "content": string}.' };
  }
  const obj = json as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const content = typeof obj.content === 'string' ? obj.content.trim() : '';
  if (!title) return { ok: false, error: 'The answer needs a non-empty "title" string.' };
  if (!content) return { ok: false, error: 'The answer needs a non-empty "content" string.' };
  if (looksLikeRawData(content)) {
    return {
      ok: false,
      error: '"content" must be a written answer in prose synthesized from the observations — not raw JSON, a data array, or a list of links.',
    };
  }
  return { ok: true, value: { title, content } };
}

const WHOLE_MARKDOWN_LINK = /^\[[^\]]+\]\(([^)]+)\)$/;
const WHOLE_ANGLE_AUTOLINK = /^<(https?:\/\/[^>\s]+)>$/i;
/**
 * Only the OPENING bracket rode into the JSON. ChatGPT's linkifier counts the JSON's own closing
 * `"}}` as part of the URL, so the markdown breaks as `"[https://x/y"}}](https://x/y%22%7D%7D)` —
 * the object still parses, and the tool gets a URL with a bracket glued to the front
 * (measured: ERR_INVALID_URL -300). A real URL never starts with `[`, so this is unambiguous.
 */
const TRUNCATED_LINK_LABEL = /^\[(https?:\/\/[^\]\s]+)\]?$/i;

export function unwrapMarkdownLink(value: string): string {
  const trimmed = value.trim();
  const link = trimmed.match(WHOLE_MARKDOWN_LINK);
  if (link) return link[1].trim();
  const angle = trimmed.match(WHOLE_ANGLE_AUTOLINK);
  if (angle) return angle[1].trim();
  const truncated = trimmed.match(TRUNCATED_LINK_LABEL);
  if (truncated) return truncated[1].trim();
  return value;
}

/**
 * Where a linkified value is a MODEL TYPO worth undoing. Browser-UI models return
 * `[example.com](https://example.com)` where a bare URL was asked for, and unwrapping that saved
 * a repair round-trip — but applying it to every value meant `file_write` with
 * `content: "[Yobi](https://yobi.app)"` wrote a bare URL to disk and told the user it had saved
 * the markdown. A field whose value is prose must be passed through untouched.
 */
const URL_VALUED_KEYS = new Set(['url', 'link']);

function coerceConfigValue(value: unknown, key: string): string {
  if (typeof value === 'string') return URL_VALUED_KEYS.has(key) ? unwrapMarkdownLink(value) : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

const MIN_QUESTION_CHARS = 4;

export function validateAgentAction(
  json: unknown,
  allowAsk = false,
  scope: AgentToolScope = FULL_TOOL_SCOPE,
  deliverable: readonly number[] = [],
  batch = false,
): Validation<AgentAction> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, error: 'The response must be a single JSON object.' };
  }
  const obj = json as Record<string, unknown>;
  const thought = typeof obj.thought === 'string' ? obj.thought : '';
  const action = obj.action;

  if (action === 'ask_user' && !allowAsk) {
    return {
      ok: false,
      error: 'You cannot ask the user anything now — there is no budget left to act on a reply. Output a "finish" action with your best answer from the observations.',
    };
  }

  if (action === 'deliver') {
    // Offered only when a step already holds a finished answer, so a run without one is told to
    // write its own rather than being taught a shape it cannot use.
    if (deliverable.length === 0) {
      return {
        ok: false,
        error: 'There is no step whose observation is a finished answer, so "deliver" is not available. Output a "finish" action and write the answer yourself.',
      };
    }
    const from = typeof obj.from === 'number' ? obj.from : Number.parseInt(String(obj.from ?? ''), 10);
    if (!deliverable.includes(from)) {
      return {
        ok: false,
        error: `"from" must be one of these step numbers: ${deliverable.join(', ')}. Got "${String(obj.from ?? '')}".`,
      };
    }
    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    if (!title) return { ok: false, error: 'A "deliver" action needs a non-empty "title" string.' };
    return { ok: true, value: { thought, action: 'deliver', title, from, ...readPlanFields(obj), ...readStepBudget(obj), ...readIntent(obj) } };
  }

  if (action !== 'call_tool' && action !== 'finish' && action !== 'ask_user') {
    // A connector-scoped run has no call_tool; naming only ask_user and finish would steer the
    // model away from call_mcp, the one shape that can actually do anything for it.
    const canCallTool = scopeHasTools(scope) || scope.help;
    const shapes = [
      ...(canCallTool ? ['"call_tool"'] : ['"call_mcp"']),
      ...(batch ? ['"call_tools"'] : []),
      ...(allowAsk ? ['"ask_user"'] : []),
      ...(deliverable.length > 0 ? ['"deliver"'] : []),
      '"finish"',
    ];
    const listed = shapes.length > 1
      ? `${shapes.slice(0, -1).join(', ')} or ${shapes[shapes.length - 1]}`
      : shapes[0];
    return { ok: false, error: `The "action" field must be exactly ${listed}.` };
  }

  if (action === 'ask_user') {
    const question = typeof obj.question === 'string' ? obj.question.trim() : '';
    if (question.length < MIN_QUESTION_CHARS) {
      return { ok: false, error: 'An "ask_user" action needs a "question" string containing one specific question for the user.' };
    }
    return {
      ok: true,
      value: { thought, action: 'ask_user', question, ...readChoices(obj), ...readPlanFields(obj), ...readStepBudget(obj), ...readIntent(obj) },
    };
  }

  if (action === 'finish') {
    const answer = validateFinalAnswer(obj);
    if (!answer.ok) return answer;
    return {
      ok: true,
      value: {
        thought, action: 'finish', title: answer.value.title, content: answer.value.content,
        ...readPlanFields(obj), ...readStepBudget(obj), ...readIntent(obj),
      },
    };
  }

  const tool = typeof obj.tool === 'string' ? obj.tool : '';
  const names = toolNames(scope);
  if (names.length === 0) {
    return {
      ok: false,
      error: 'There is no "call_tool" action in this run — every tool here is an MCP tool, so use "call_mcp" (or "finish").',
    };
  }
  // The catalog only suggests; a model can still name a tool it remembers from training, so the
  // scope is re-checked here. Both branches answer the same way — knowing which one rejected it
  // would only tell the model that an excluded tool exists.
  const rejectTool: Validation<AgentAction> = {
    ok: false,
    error: `"tool" must be one of: ${names.join(', ')}. Got "${tool}".`,
  };
  if (!isAllowedTool(tool) && !isBuiltinTool(tool) && !isHelpTool(tool)) return rejectTool;
  if (!names.includes(tool)) return rejectTool;

  const rawConfig = obj.config;
  if (rawConfig !== undefined && (typeof rawConfig !== 'object' || rawConfig === null || Array.isArray(rawConfig))) {
    return { ok: false, error: 'The "config" field must be a JSON object of string values.' };
  }
  const allowed = allowedConfigKeys(tool);
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries((rawConfig as Record<string, unknown>) ?? {})) {
    // Silently DROPPED, not rejected: an undeclared key is never something the model needs, and
    // rejecting it would spend a repair round-trip teaching it a key it must not use anyway.
    // This filter is what stops a config field the catalog deliberately hides from being set by
    // hand — `llm`'s `attachments` plus the internal `__attachmentAllowlist` escape hatch were a
    // one-action upload of any local file to a third-party web UI — and it is why `shell`'s
    // `cwd` can be trusted: the engine injects it AFTER this point, so the model cannot pick it.
    if (!allowed.has(key)) continue;
    config[key] = coerceConfigValue(value, key);
  }

  const missing = requiredFieldsFor(tool).filter((key) => !(config[key] ?? '').trim());
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Tool "${tool}" is missing required config field(s): ${missing.join(', ')}.`,
    };
  }

  return { ok: true, value: { thought, action: 'call_tool', tool, config, ...readPlanFields(obj), ...readStepBudget(obj), ...readIntent(obj) } };
}
