import type { SkillType } from '../../../shared/types';
import { SKILL_SPECS, SKILLS_WITHOUT_OUTPUT_KEY } from '../../../shared/flowSkillSchema';
import type { SkillSpec } from '../../../shared/flowSkillSchema';
import { AGENT_BUILTIN_TOOLS, buildBuiltinCatalog, builtinRequiredFields, isBuiltinTool } from './agentBuiltins';
import type { AgentBuiltinTool } from './agentBuiltins';
import { readPlanFields } from './agentPrompts';
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

export const AGENT_HELP_TOOL = 'tool_help';

export type AgentHelpTool = typeof AGENT_HELP_TOOL;

export function isHelpTool(name: string): name is AgentHelpTool {
  return name === AGENT_HELP_TOOL;
}

export const AGENT_BRIEF_ONLY_TOOLS: readonly SkillType[] = [
  'sysinfo', 'air_quality', 'gmap_reviews', 'forex', 'random', 'stock', 'weather',
  'file_read', 'file_list', 'clipboard', 'notify',
];

const BRIEF_ONLY_SET = new Set<SkillType>(AGENT_BRIEF_ONLY_TOOLS);

// SECURITY: the workspace/sandbox wording must survive into these tier-1 briefs. A model
// that guesses a path has to be refused rather than corrected, and only the brief tells it so.
const AGENT_TOOL_BRIEFS: Partial<Record<SkillType, string>> = {
  file_read: 'Read a local text file. Only your workspace is allowed (app output folder, Documents, Downloads, Desktop); a guessed path is refused, so call file_list first.',
  file_list: 'List the files in a local folder (non-recursive). Only your workspace is allowed (app output folder, Documents, Downloads, Desktop). Use it to learn a file name before reading it.',
  stock: 'Get a stock / equity / index quote. The suffix picks the market: US as-is (AAPL), Taiwan .TW (2330.TW) or .TWO, indices with ^ (^TWII).',
};

const AGENT_HIDDEN_FIELDS = new Set<string>([
  'attachments',
  'emitFailFlag', 'includeImage', 'provider', 'saveToHistory', 'useMemory',
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
    summary: 'Research a QUESTION on the web and return a written, cited answer: it plans several query angles, reads the most relevant pages and synthesizes them — all in ONE step. Prefer this over search+browser for anything that needs evidence, because it costs one step instead of one per page. Call it repeatedly with DIFFERENT sub-questions to cover a topic from several angles.',
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

function specsForAgent(): SkillSpec[] {
  return SKILL_SPECS.filter((spec) => ALLOWED_SET.has(spec.type));
}

export function buildToolCatalog(): string {
  const skills = specsForAgent()
    .map((spec) => (BRIEF_ONLY_SET.has(spec.type) ? renderBriefToolLine(spec) : renderAgentToolLine(spec)))
    .join('\n');
  return [skills, buildBuiltinCatalog(), helpToolLine(), optsFooter()].join('\n');
}

export function describeToolSpec(name: string): string {
  const wanted = name.trim();
  if (!wanted) return 'ERROR: "tool" is required — name the tool you want the full entry for.';
  if (isHelpTool(wanted)) return helpToolLine();
  if (isBuiltinTool(wanted)) {
    const line = buildBuiltinCatalog().split('\n').find((entry) => entry.startsWith(`- "${wanted}"`));
    if (line) return line;
  }
  const spec = specsForAgent().find((entry) => entry.type === wanted);
  if (!spec) {
    return `ERROR: "${wanted}" is not one of your tools. Pick one from TOOLS: ${[...AGENT_ALLOWED_SKILLS, ...AGENT_BUILTIN_TOOLS].join(', ')}.`;
  }
  return renderAgentToolLine(spec);
}

function requiredFieldsFor(type: SkillType | AgentBuiltinTool | AgentHelpTool): string[] {
  if (isHelpTool(type)) return ['tool'];
  if (isBuiltinTool(type)) return builtinRequiredFields(type);
  const spec = SKILL_SPECS.find((s) => s.type === type);
  return spec ? spec.fields.filter((f) => f.required).map((f) => f.key) : [];
}

export interface AgentAction {
  thought: string;
  action: 'call_tool' | 'finish' | 'ask_user';
  tool?: SkillType | AgentBuiltinTool | AgentHelpTool;
  config?: Record<string, string>;
  title?: string;
  content?: string;
  question?: string;
  plan?: string[];
  planDone?: number[];
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

export function unwrapMarkdownLink(value: string): string {
  const trimmed = value.trim();
  const link = trimmed.match(WHOLE_MARKDOWN_LINK);
  if (link) return link[1].trim();
  const angle = trimmed.match(WHOLE_ANGLE_AUTOLINK);
  if (angle) return angle[1].trim();
  return value;
}

function coerceConfigValue(value: unknown): string {
  if (typeof value === 'string') return unwrapMarkdownLink(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

const MIN_QUESTION_CHARS = 4;

export function validateAgentAction(json: unknown, allowAsk = false): Validation<AgentAction> {
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

  if (action !== 'call_tool' && action !== 'finish' && action !== 'ask_user') {
    return {
      ok: false,
      error: allowAsk
        ? 'The "action" field must be exactly "call_tool", "ask_user" or "finish".'
        : 'The "action" field must be exactly "call_tool" or "finish".',
    };
  }

  if (action === 'ask_user') {
    const question = typeof obj.question === 'string' ? obj.question.trim() : '';
    if (question.length < MIN_QUESTION_CHARS) {
      return { ok: false, error: 'An "ask_user" action needs a "question" string containing one specific question for the user.' };
    }
    return { ok: true, value: { thought, action: 'ask_user', question, ...readPlanFields(obj) } };
  }

  if (action === 'finish') {
    const answer = validateFinalAnswer(obj);
    if (!answer.ok) return answer;
    return {
      ok: true,
      value: {
        thought, action: 'finish', title: answer.value.title, content: answer.value.content,
        ...readPlanFields(obj),
      },
    };
  }

  const tool = typeof obj.tool === 'string' ? obj.tool : '';
  if (!isAllowedTool(tool) && !isBuiltinTool(tool) && !isHelpTool(tool)) {
    return {
      ok: false,
      error: `"tool" must be one of: ${[...AGENT_ALLOWED_SKILLS, ...AGENT_BUILTIN_TOOLS, AGENT_HELP_TOOL].join(', ')}. Got "${tool}".`,
    };
  }

  const rawConfig = obj.config;
  if (rawConfig !== undefined && (typeof rawConfig !== 'object' || rawConfig === null || Array.isArray(rawConfig))) {
    return { ok: false, error: 'The "config" field must be a JSON object of string values.' };
  }
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries((rawConfig as Record<string, unknown>) ?? {})) {
    config[key] = coerceConfigValue(value);
  }

  const missing = requiredFieldsFor(tool).filter((key) => !(config[key] ?? '').trim());
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Tool "${tool}" is missing required config field(s): ${missing.join(', ')}.`,
    };
  }

  return { ok: true, value: { thought, action: 'call_tool', tool, config, ...readPlanFields(obj) } };
}
