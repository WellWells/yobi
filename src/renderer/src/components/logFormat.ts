export type LogLevel = 'error' | 'warning' | 'info';

export type LogTone = 'error' | 'warning' | 'success' | 'active' | 'plain';

export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warning', 'info'];

const TONE_LEVEL: Record<LogTone, LogLevel> = {
  error: 'error',
  warning: 'warning',
  success: 'info',
  active: 'info',
  plain: 'info',
};

const TONE_MARKERS: [LogTone, string[]][] = [
  ['error', ['❌', '🛑']],
  ['warning', ['⚠️', '🔒', '👻', '🚫']],
  ['success', ['✅', '💾', '📋', '🎉', '🚀']],
  ['active', ['⏳', '📤', '🔥', '⌨️', '▶️', '🔄', '🤖', '🧵', '💬', '↪️', '⏹️', '📡', '🔐', '🧹', '✂️', '🔍']],
  ['plain', ['ℹ️', '🧪', '📥']],
];

export function classifyTone(msg: string): LogTone {
  for (const [tone, markers] of TONE_MARKERS) {
    if (markers.some((marker) => msg.includes(marker))) return tone;
  }
  if (/\berrors?\b|\bfailed\b|\bfailure\b|\bexception\b/i.test(msg)) return 'error';
  if (/\bwarn(ing)?\b/i.test(msg)) return 'warning';
  return 'plain';
}

export function classifyLog(msg: string): LogLevel {
  return TONE_LEVEL[classifyTone(msg)];
}

export function isAllLevels(levels: readonly LogLevel[]): boolean {
  return LOG_LEVELS.every((level) => levels.includes(level));
}

export const LOG_STAMP_PATTERN = /^\[(\d{2}:\d{2}:\d{2})\] (.*)$/s;

export interface SplitLogLine {
  time: string;
  message: string;
}

export function splitLogLine(log: string): SplitLogLine {
  const match = LOG_STAMP_PATTERN.exec(log);
  return match ? { time: match[1], message: match[2] } : { time: '', message: log };
}

const LEADING_GLYPH = /^((?![\x00-\x7F])[^\p{L}\p{N}\s\[]{1,6})\s*/u;
const LEADING_SCOPE = /^\[([^\]]{1,64})\]\s*/;
const RUN_START = /^(▶️|🚀)/u;

export interface ParsedLogLine {
  time: string;
  glyph: string;
  scope: string;
  depth: number;
  text: string;
  level: LogLevel;
  tone: LogTone;
  startsRun: boolean;
}

export function parseLogLine(log: string): ParsedLogLine {
  const { time, message } = splitLogLine(log);
  let rest = message;
  let glyph = '';

  const takeGlyph = (): void => {
    if (glyph) return;
    const match = LEADING_GLYPH.exec(rest);
    if (!match) return;
    glyph = match[1];
    rest = rest.slice(match[0].length);
  };

  takeGlyph();
  const scopeMatch = LEADING_SCOPE.exec(rest);
  const scope = scopeMatch ? scopeMatch[1].trim() : '';
  if (scopeMatch) rest = rest.slice(scopeMatch[0].length);
  takeGlyph();

  const tone = classifyTone(message);
  return {
    time,
    glyph,
    scope,
    depth: scope.split('▸').length - 1,
    text: rest,
    level: TONE_LEVEL[tone],
    tone,
    startsRun: RUN_START.test(message),
  };
}

export function scopeRoot(scope: string): string {
  return scope.split('▸')[0].trim();
}

const URL_PATTERN = /https?:\/\/\S+/g;
const URL_TRAILING = /["'>)\]},.;:]+$/;
const URL_WIDTH_BUDGET = 64;
const URL_TAIL_WIDTH = 18;

function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x1100) return 1;
  const wide = code <= 0x115f
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1f9ff);
  return wide ? 2 : 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width;
}

function decodeUrl(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

export function shortenUrl(url: string): string {
  const decoded = decodeUrl(url);
  if (displayWidth(decoded) <= URL_WIDTH_BUDGET) return decoded;

  const chars = [...decoded];
  const tail: string[] = [];
  let tailWidth = 0;
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const width = charWidth(chars[i]);
    if (tailWidth + width > URL_TAIL_WIDTH) break;
    tail.unshift(chars[i]);
    tailWidth += width;
  }

  const headBudget = URL_WIDTH_BUDGET - tailWidth - 1;
  const head: string[] = [];
  let headWidth = 0;
  for (const char of chars) {
    const width = charWidth(char);
    if (headWidth + width > headBudget) break;
    head.push(char);
    headWidth += width;
  }

  return `${head.join('')}…${tail.join('')}`;
}

export function shortenUrls(text: string): string {
  return text.replace(URL_PATTERN, (match) => {
    const trailing = URL_TRAILING.exec(match)?.[0] ?? '';
    const url = trailing ? match.slice(0, -trailing.length) : match;
    return `${shortenUrl(url)}${trailing}`;
  });
}

export interface LogFilter {
  query: string;
  levels: readonly LogLevel[];
  scope: string;
}

export function filterLogs(logs: string[], filter: LogFilter): string[] {
  const needle = filter.query.trim().toLowerCase();
  const allLevels = isAllLevels(filter.levels);
  if (!needle && allLevels && !filter.scope) return logs;
  return logs.filter((log) => {
    if (needle && !log.toLowerCase().includes(needle)) return false;
    if (allLevels && !filter.scope) return true;
    const parsed = parseLogLine(log);
    if (!allLevels && !filter.levels.includes(parsed.level)) return false;
    return !filter.scope || scopeRoot(parsed.scope) === filter.scope;
  });
}

export function toggleLevel(levels: readonly LogLevel[], level: LogLevel): LogLevel[] {
  const next = levels.includes(level)
    ? levels.filter((l) => l !== level)
    : LOG_LEVELS.filter((l) => l === level || levels.includes(l));
  return next.length === 0 ? [...LOG_LEVELS] : next;
}

export function isolateLevel(levels: readonly LogLevel[], level: LogLevel): LogLevel[] {
  const alreadyAlone = levels.length === 1 && levels[0] === level;
  return alreadyAlone ? [...LOG_LEVELS] : [level];
}

export function toggleScope(current: string, scope: string): string {
  return current === scope ? '' : scope;
}
