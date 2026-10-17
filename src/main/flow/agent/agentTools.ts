import * as os from 'node:os';
import * as path from 'node:path';
import type { SkillType } from '../../../shared/types';
import { SKILL_SPECS, SKILLS_WITHOUT_OUTPUT_KEY } from '../../../shared/flowSkillSchema';
import type { SkillSpec } from '../../../shared/flowSkillSchema';
import { unwrapMarkdownLink } from '../../../shared/markdownLinkUnwrap';
import { AGENT_BUILTIN_TOOLS, buildBuiltinCatalog, builtinConfigKeys, builtinRequiredFields, isBuiltinTool } from './agentBuiltins';
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
  /**
   * With `builtins`, also offer the flow builders (`assess_flow`, `build_flow`, `edit_flow`).
   * Absent means yes; `false` where saving a flow can never be approved.
   */
  flows?: boolean;
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
    delegate: false,
  };
}

export const FULL_TOOL_SCOPE: AgentToolScope = {
  skills: AGENT_ALLOWED_SKILLS,
  builtins: true,
};

/**
 * What a Telegram/LINE message from an account with the agent grant may call. A bot-origin run cannot
 * answer a confirmation dialog, so `shell`, `file_write` and the flow builders are removed here rather
 * than offered and refused; `withShellCapability` re-adds `shell` for a shell grant, confirmed in chat.
 */
export const BOT_TOOL_SCOPE: AgentToolScope = {
  skills: AGENT_ALLOWED_SKILLS.filter((skill) => skill !== 'shell' && skill !== 'file_write'),
  builtins: true,
  flows: false,
};

/**
 * What the composer's "web" checkbox switches off.
 *
 * `browser` belongs here with the two search tools: reading a page IS going online, so leaving it
 * behind would make the toggle cosmetic — the model would simply fetch pages instead of searching.
 */
export const WEB_SKILLS: readonly SkillType[] = ['search', 'research', 'browser'];

const WEB_SKILL_SET = new Set<SkillType>(WEB_SKILLS);

/** A recorded step went online — what tells the composer the run used the web. */
export function isWebTool(tool: string): boolean {
  return WEB_SKILL_SET.has(tool as SkillType);
}

/**
 * Dropping these also shortens the built-in catalog, leaving more of the MCP catalog budget for
 * connectors.
 */
export function withWebCapability(scope: AgentToolScope, enabled: boolean): AgentToolScope {
  if (enabled) return scope;
  return { ...scope, skills: scope.skills.filter((skill) => !WEB_SKILL_SET.has(skill)) };
}

/**
 * What a bot account's "read this computer" grant covers: the tools that read the desktop's files,
 * clipboard and hardware, or pop something up on it. Without the grant they leave the scope.
 */
export const LOCAL_SKILLS: readonly SkillType[] = ['file_read', 'file_list', 'clipboard', 'sysinfo', 'notify'];

const LOCAL_SKILL_SET = new Set<SkillType>(LOCAL_SKILLS);

export function withLocalCapability(scope: AgentToolScope, enabled: boolean): AgentToolScope {
  if (enabled) return scope;
  return { ...scope, skills: scope.skills.filter((skill) => !LOCAL_SKILL_SET.has(skill)) };
}

/**
 * A bot account's shell grant: adds `shell` to a scope that lacks it, or takes it out. Only ever
 * applied to the bot agent kit by a caller that also makes the run ask in the chat
 * (`shellInChat`) — a scope holding `shell` without that would offer a tool every call refuses.
 */
export function withShellCapability(scope: AgentToolScope, enabled: boolean): AgentToolScope {
  const has = scope.skills.includes('shell');
  if (enabled === has) return scope;
  return {
    ...scope,
    skills: enabled ? [...scope.skills, 'shell'] : scope.skills.filter((skill) => skill !== 'shell'),
  };
}

/**
 * A bot message from an account without the agent grant. It gets the web and the harmless
 * read-only lookups, and nothing that touches the machine — files, clipboard, hardware and
 * notifications need the agent grant (and the local grant on top). Widening this by default would
 * turn every paired contact's small talk into something that can read local files.
 */
export const BOT_CHAT_TOOL_SCOPE: AgentToolScope = {
  skills: ['search', 'research', 'browser', 'youtube', 'gmap_reviews', 'weather', 'air_quality', 'stock', 'forex', 'random'],
  builtins: false,
};

/**
 * Thrown when the connectors a run declared cannot be used; the caller turns it into a
 * user-facing message.
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

/**
 * How a run can end with no answer through no fault of a tool: every reply the model gave was
 * rejected, the steps ran out before anything was learned, or a browser provider kept showing its
 * previous answer. Lives beside AgentScopeError for the same reason.
 */
export type AgentRunFailure = 'invalid_output' | 'step_limit' | 'stale_provider';

/**
 * `message` keeps the English detail for the log, the trace and the run file — for
 * `invalid_output` that is the repair text written for the model, which no user should read.
 * The caller words `reason` instead; `provider` names the page for `stale_provider`.
 */
export class AgentRunError extends Error {
  constructor(readonly reason: AgentRunFailure, detail: string, readonly provider = '') {
    super(detail);
    this.name = 'AgentRunError';
  }
}

export const AGENT_HELP_TOOL = 'tool_help';

export type AgentHelpTool = typeof AGENT_HELP_TOOL;

export function isHelpTool(name: string): name is AgentHelpTool {
  return name === AGENT_HELP_TOOL;
}

// `shell` and `file_write` are tier 1 because their full entries can push a tight provider's repair
// prompt past its cap, cutting off the closing fence and the action instruction.
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
  stock: 'Get stock / equity / index quotes, several comma-separated symbols at once. The suffix picks the market: US as-is (AAPL), Taiwan .TW (2330.TW) or .TWO, indices ^ (^TWII).',
  // Optional fields are opt-in by key and unknown keys are dropped, so the brief names them as
  // `fields` spells them.
  sysinfo: "This computer's OS, CPU, memory, GPU, local IP. Only when named in fields: publicIp, disks, displays, printers, bios, macAddress, dns and other hardware/network details.",
  // Overrides the flow brief, which mentions the `{{file}}` flow variable; `sanitizeFieldDesc`
  // cleans field descriptions only.
  file_write: 'Save text to a local file and get back the path. Only the app output folder is allowed; anywhere else is refused, not corrected. Leave "folder" blank to use it.',
  shell: "Run ONE system command; returns its output. The user approves each one; a refusal is final. Never as admin; credential stores and system folders are refused. For what no other tool reads: ports, processes, services.",
};

const AGENT_HIDDEN_FIELDS = new Set<string>([
  'attachments',
  'emitFailFlag', 'includeImage', 'provider', 'saveToHistory', 'useMemory', 'useUserMemory',
  'exportFormat', 'exportTitle', 'exportFileName', 'exportShowProvider', 'exportShowTimestamp', 'palette',
]);

/**
 * A run's own default for a field the flow spec defaults differently. `planCall` fills it in when
 * the model leaves the field blank, and the catalog line states it, so the two cannot disagree.
 */
export const AGENT_FIELD_DEFAULTS: Partial<Record<SkillType, Record<string, string>>> = {
  research: { depth: 'quick' },
};

const AGENT_TOOL_DOCS: Partial<Record<SkillType, { summary: string; output?: string; fields?: Record<string, string> }>> = {
  browser: {
    summary: 'Fetch a human web PAGE and return its visible text (renders JavaScript; for articles / SPA pages). Accepts one URL, a JSON array of URLs, or a comma/newline list. NOT for JSON APIs, and NOT for running a web search — open a search engine with it and you get its chrome, not results; use search or research.',
    output: "the page's visible text (multiple URLs are joined with a '---' separator).",
  },
  search: {
    summary: 'Search the web (DuckDuckGo) and return a ranked list of results — titles, links and snippets only, NO page content. Use this only when you want the raw links yourself (e.g. to pick one specific page for browser). If you want an ANSWER from the web, use research instead.',
    output: "a JSON array of {title, link, snippet} ranked by relevance ('[]' if nothing matched); snippet is the result-page summary and may be empty.",
  },
  research: {
    summary: 'Research a focused QUESTION and return a cited answer in ONE step. Prefer this for evidence. Repeat only for a distinct missing fact; after weak results change keywords or read a specific source with browser/urls, rather than rephrasing the same request.',
    output: "a written answer in prose with [n] citation markers; also provides sources (a JSON array of the {title, link} pages actually read) and count (how many).",
    fields: {
      depth: '"quick" (default: reads 2 pages, fast) or "standard" (several query angles, up to 12 pages, slow) — standard only when the user asks for depth, detail, a comparison or a check, or quick came back thin',
    },
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
    summary: "Collect local system / hardware / network info (OS, CPU, GPU, memory, system language, local IP, uptime, time, app versions). The public (external) IP is collected only when fields lists publicIp — use this, not a web search or a shell command.",
    output: "one string (key:value lines for format='text', or a JSON document for format='json'); each collected field is also provided as an individual sub-field (e.g. locale, cpu, publicIp). cpuCores counts logical processors (threads), not physical cores.",
  },
  weather: {
    summary: 'Get the current weather for a place NAME (Open-Meteo, no API key); returns current conditions plus today\'s high/low and rain chance. Use the place\'s English / Latin-script name (e.g. "Kaohsiung", not "高雄").',
    output: 'a JSON object {location, temp, feelsLike, condition, humidity, windSpeed, unit, isDay, high, low, rainChance}; the same values are also provided as individual fields. rainChance is the DAILY MAX precipitation %, not the chance for a given part of the day; condition is English — translate it.',
  },
  air_quality: {
    summary: 'Get the current air quality (AQI) for a place NAME (Open-Meteo, no API key); a location in Taiwan reads the nearest Ministry of Environment ground station instead when the user has saved a MOENV key. Use the place\'s English / Latin-script name (e.g. "Kaohsiung", not "高雄").',
    output: 'a JSON object {location, station, aqi, level, status, statusLocal, pollutant, pm2_5, pm10, ozone, no2, so2, co, gasUnits, europeanAqi, source, observedAt}; level is 1-6 (1 Good … 6 Hazardous, 0 = no reading) and status is the English band name. Gas units differ by source — read gasUnits before quoting ozone/no2/so2/co. Most values are also provided as individual fields.',
  },
  stock: {
    summary: 'Get a stock / equity quote (Yahoo Finance, no API key). Market is set by the symbol suffix: US tickers as-is (AAPL), Taiwan .TW (2330.TW) or .TWO (OTC), indices with ^ (^TWII).',
    output: 'a JSON quote object; a single symbol also provides fields symbol, name, currency, price, open, high, low, volume, previousClose, change, changePct, marketTime, session. Several comma/newline symbols give a JSON array. marketTime is exchange-local time with its UTC offset; session "open" means price is intraday, NOT a close ("closed", or "" when unknown).',
  },
  forex: {
    summary: 'Get a near-live foreign-exchange rate, and an optional converted amount (Yahoo Finance, falling back to a once-daily rate table; no API key).',
    output: 'a JSON object {base, target, rate, amount, converted, asOf, previousClose, changePct, session}; the values are also provided as individual fields. asOf carries its UTC offset. previousClose and changePct are empty when only the daily fallback source answered.',
  },
  random: {
    summary: 'Generate random WHOLE numbers within an inclusive range (both min and max can occur) — for dice, lottery numbers, picking an index, or jitter.',
    output: 'count 1 (or blank) → a single whole number as a string; count > 1 → a JSON array of whole numbers.',
  },
  notify: {
    summary: 'Show a desktop notification (system toast).',
  },
  shell: {
    summary: "Run ONE system command on the user's computer (Windows \"cmd\" or \"powershell\"; macOS/Linux the login shell) and return its combined output. The user is asked to approve every command before it runs and a refusal is FINAL — never rephrase a refused command and send it again. It runs with your workspace folder as the working directory, so a relative path or a redirect lands there. It never runs as administrator, and a command that names a credential store (.ssh, .aws, .claude, a credentials file, the Credential Manager, a registry hive) or a system directory (Windows, Program Files, System32) is refused before the user is even asked. Use it for this computer's state that no other tool reads (listening ports, running processes, services, installed programs): pick the command yourself, then answer from its output — never hand the user a command to run instead. NOT for fetching web pages (use browser or research), and NOT for reading a file that file_read can read.",
    output: "the command's stdout, trimmed — or its stderr when stdout is empty. A non-zero exit comes back as an ERROR observation carrying the message.",
  },
  file_write: {
    // No `output` clause: file_write is in SKILLS_WITHOUT_OUTPUT_KEY, so `renderAgentToolLine`
    // suppresses the "returns:" tail. The return contract is folded into the summary instead —
    // removing it from that list would change the flow-side `{{file}}` contract.
    summary: 'Write text to a local file and return the full path it wrote. Only the app output folder is allowed — Documents, Downloads and Desktop can be read but not written, and any other destination is refused, not corrected. Leave "folder" blank to write to the app output folder; parent folders are created for you. Use it to save something the user asked to keep — not to stash notes for yourself between steps.',
  },
};

function sanitizeFieldDesc(desc: string): string {
  return desc
    .replace(/;?\s*may embed \{\{variables\}\}/gi, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function visibleFieldsOf(spec: SkillSpec) {
  return spec.fields.filter((f) => !AGENT_HIDDEN_FIELDS.has(f.key));
}

/**
 * Which system the shell tool's commands land on, stated on the shell line so the model picks
 * commands for the right OS. The default shell is the one `execShell` picks when "shell" is blank.
 */
export function describeShellHost(platform: string, release: string, loginShell: string | undefined): string {
  if (platform === 'win32') {
    const [major, , build] = release.split('.').map(Number);
    const name = major === 10 ? (build >= 22_000 ? 'Windows 11' : 'Windows 10') : 'Windows';
    return `Host: ${name}, cmd ("shell": "powershell" for PowerShell).`;
  }
  const shell = path.basename(loginShell || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash'));
  return `Host: ${platform === 'darwin' ? 'macOS' : 'Linux'}, ${shell}.`;
}

function shellHostNote(): string {
  return describeShellHost(process.platform, os.release(), process.env.SHELL);
}

function withHostNote(type: SkillType, text: string): string {
  return type === 'shell' ? `${text} ${shellHostNote()}` : text;
}

function renderAgentToolLine(spec: SkillSpec): string {
  const doc = AGENT_TOOL_DOCS[spec.type];
  const summary = withHostNote(spec.type, doc?.summary ?? spec.summary);
  const visibleFields = visibleFieldsOf(spec);
  const fields = visibleFields.length === 0
    ? 'no config.'
    : `config keys: ${visibleFields
        .map((f) => `"${f.key}" (${sanitizeFieldDesc(doc?.fields?.[f.key] ?? f.desc)}${f.required ? '; REQUIRED' : ''})`)
        .join('; ')}`;
  const hasOutput = !SKILLS_WITHOUT_OUTPUT_KEY.includes(spec.type);
  const returns = hasOutput && doc?.output ? ` → returns: ${doc.output}` : '';
  return `- "${spec.type}": ${summary} ${fields}${returns}`;
}

export const OPTS_MARKER = '[+opts]';

function renderBriefToolLine(spec: SkillSpec): string {
  const brief = withHostNote(spec.type, AGENT_TOOL_BRIEFS[spec.type] ?? spec.brief);
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

export function scopeHasFlowTools(scope: AgentToolScope): boolean {
  return scope.builtins && scope.flows !== false;
}

function builtinNames(scope: AgentToolScope): AgentBuiltinTool[] {
  if (!scope.builtins) return [];
  const flows = scopeHasFlowTools(scope);
  return AGENT_BUILTIN_TOOLS.filter((tool) => (tool === 'delegate' ? scope.delegate === true : flows));
}

function toolNames(scope: AgentToolScope): string[] {
  return [
    ...scope.skills,
    ...builtinNames(scope),
    AGENT_HELP_TOOL,
  ];
}

/**
 * `allBrief` puts every tool on a tier-1 line, not only `AGENT_BRIEF_ONLY_TOOLS`, for a provider whose
 * cap cannot hold the full catalog alongside observations. `tool_help` recovers any full entry.
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
  const builtinCatalog = scope.builtins ? buildBuiltinCatalog(scope.delegate === true, scopeHasFlowTools(scope)) : '';
  if (builtinCatalog) blocks.push(builtinCatalog);
  blocks.push(helpToolLine(), optsFooter());
  return blocks.join('\n');
}

export function describeToolSpec(name: string, scope: AgentToolScope = FULL_TOOL_SCOPE): string {
  const wanted = name.trim();
  if (!wanted) return 'ERROR: "tool" is required — name the tool you want the full entry for.';
  if (isHelpTool(wanted)) return helpToolLine();
  if (builtinNames(scope).includes(wanted as AgentBuiltinTool)) {
    const line = buildBuiltinCatalog(scope.delegate === true, scopeHasFlowTools(scope)).split('\n').find((entry) => entry.startsWith(`- "${wanted}"`));
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
  if (isBuiltinTool(type)) return new Set(builtinConfigKeys(type));
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
  /** `finish` only: the model's own word on whether the GOAL is fully achieved. Absent = not said. */
  done?: boolean;
  /** `finish` only, with `done: false`: what is still left, in the goal's language. */
  missing?: string;
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
  done?: boolean;
  missing?: string;
}

const MAX_MISSING_CHARS = 160;

/**
 * The completion claim that rides on a finished answer. Read leniently and never a reason to
 * reject the answer it came with — the same rule the plan fields follow: a bookkeeping field that
 * could bounce a good answer would cost a repair round trip on exactly the runs that were done.
 * `missing` only means something next to `done: false`, so it is dropped otherwise.
 */
export function readCompletion(obj: Record<string, unknown>): { done?: boolean; missing?: string } {
  const raw = obj.done;
  const done = typeof raw === 'boolean' ? raw
    : typeof raw === 'string' && /^(true|false)$/i.test(raw.trim()) ? raw.trim().toLowerCase() === 'true'
      : undefined;
  if (done === undefined) return {};
  if (done) return { done };
  const missing = typeof obj.missing === 'string'
    ? obj.missing.replace(/\s+/g, ' ').trim().slice(0, MAX_MISSING_CHARS)
    : '';
  return { done, ...(missing ? { missing } : {}) };
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
  return { ok: true, value: { title, content, ...readCompletion(obj) } };
}

export { unwrapMarkdownLink };

/**
 * Keys whose linkified value is a model typo worth undoing (`[example.com](https://example.com)` for a
 * bare URL). Prose fields such as file_write content pass through untouched.
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
    const shapes = [
      '"call_tool"',
      ...(batch ? ['"call_tools"'] : []),
      ...(allowAsk ? ['"ask_user"'] : []),
      ...(deliverable.length > 0 ? ['"deliver"'] : []),
      '"finish"',
    ];
    const listed = `${shapes.slice(0, -1).join(', ')} or ${shapes[shapes.length - 1]}`;
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
        ...readCompletion(obj), ...readPlanFields(obj), ...readStepBudget(obj), ...readIntent(obj),
      },
    };
  }

  const tool = typeof obj.tool === 'string' ? obj.tool : '';
  const names = toolNames(scope);
  // The catalog only suggests; a model can still name a tool it remembers from training, so the
  // scope is re-checked here. Both branches answer the same way — knowing which one rejected it
  // would only tell the model that an excluded tool exists.
  const rejectTool: Validation<AgentAction> = {
    ok: false,
    error: `"tool" must be one of: ${names.join(', ')}. Got "${tool}".`,
  };
  if (!isAllowedTool(tool) && !isBuiltinTool(tool) && !isHelpTool(tool)) return rejectTool;
  // The one exclusion worth naming: the web is off, so tell the model to answer without it rather than
  // only listing the tools it may use.
  if (WEB_SKILL_SET.has(tool as SkillType) && !names.includes(tool)) {
    return {
      ok: false,
      error: `Web search is off in this chat, so "${tool}" cannot run. Answer from what you know in "finish", say it was not checked online, and that turning Web on lets you check it.`,
    };
  }
  if (!names.includes(tool)) return rejectTool;

  const rawConfig = obj.config;
  if (rawConfig !== undefined && (typeof rawConfig !== 'object' || rawConfig === null || Array.isArray(rawConfig))) {
    return { ok: false, error: 'The "config" field must be a JSON object of string values.' };
  }
  const allowed = allowedConfigKeys(tool);
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries((rawConfig as Record<string, unknown>) ?? {})) {
    // Undeclared keys are dropped, not rejected (no repair round-trip). This keeps hidden fields such as
    // `llm` attachments out of reach and lets `shell`'s `cwd`, injected later by the engine, be trusted.
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
