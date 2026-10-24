import { jsonrepair } from 'jsonrepair';

function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function stripTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

const JSON_ESCAPE = /["\\/bfnrt]/;
const UNICODE_ESCAPE = /^u[0-9a-fA-F]{4}/;

/**
 * Doubles every backslash inside a string that cannot start a valid JSON escape. Browser-UI models
 * write Windows paths with single backslashes ("C:\Users\…"); JSON.parse rejects `\U`, and
 * jsonrepair then drops the backslashes, turning the path into "C:Users…".
 */
export function escapeStrayBackslashes(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = text[i + 1] ?? '';
    const valid = next === 'u' ? UNICODE_ESCAPE.test(text.slice(i + 1, i + 6)) : JSON_ESCAPE.test(next);
    if (!valid) {
      out += '\\\\';
      continue;
    }
    // A valid escape: copy it whole so an escaped quote does not end the string.
    out += ch + next;
    i++;
  }
  return out;
}

function repairParse(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return undefined;
  try {
    return tryParse(jsonrepair(trimmed));
  } catch {
    return undefined;
  }
}

/** `repaired` marks a parse that only survived jsonrepair, which rewrites structure. */
interface Parsed {
  value: unknown;
  repaired: boolean;
}

function attemptParse(text: string): Parsed | undefined {
  const direct = tryParse(text);
  if (direct !== undefined) return { value: direct, repaired: false };
  const noTrailing = tryParse(stripTrailingCommas(text));
  if (noTrailing !== undefined) return { value: noTrailing, repaired: false };
  // Literal backslashes restored before anything else touches the text (see escapeStrayBackslashes).
  const escaped = escapeStrayBackslashes(text);
  if (escaped !== text) {
    const literal = tryParse(stripTrailingCommas(escaped));
    if (literal !== undefined) return { value: literal, repaired: false };
  }
  const repaired = repairParse(escaped);
  return repaired === undefined ? undefined : { value: repaired, repaired: true };
}

/**
 * One JSON object or array written by a person (a flow step's arguments): parsed as written, else
 * with the same repairs a model's reply gets (trailing commas, stray backslashes, jsonrepair).
 * `repaired` marks a parse jsonrepair had to rewrite, which can guess (`{"a": }` reads as null).
 */
export function parseJsonLenient(text: string): { value: unknown; repaired: boolean } | undefined {
  const trimmed = text.trim();
  return trimmed ? attemptParse(trimmed) : undefined;
}

function scanBalanced(text: string, start: number): string | null {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function candidateStarts(body: string): number[] {
  const starts: number[] = [];
  const objStart = /\{\s*"/g;
  let match: RegExpExecArray | null;
  while ((match = objStart.exec(body)) !== null && starts.length < 8) starts.push(match.index);
  const firstObj = body.indexOf('{');
  if (firstObj !== -1 && !starts.includes(firstObj)) starts.push(firstObj);
  const firstArr = body.indexOf('[');
  if (firstArr !== -1) starts.push(firstArr);
  return starts;
}

function looksLikeFlow(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  const inner = obj.flow && typeof obj.flow === 'object' && !Array.isArray(obj.flow)
    ? (obj.flow as Record<string, unknown>)
    : obj;
  return Array.isArray(inner.steps);
}

type Picker = (parsed: Parsed | undefined, whole: boolean) => unknown | null;

/**
 * Candidates are ranked by shape, not by the order the recovery ladder reaches them: a repair of
 * the whole body can fold a citation footer (`[1]: https://…`) into a list ahead of the clean
 * object inside it. WHOLE outranks OBJECT so a cleanly parsed `[{…},{…}]` is returned as is; a
 * scalar never gets WHOLE, so a fenced `42` cannot beat a real object later in the reply.
 */
const RANK_FLOW = 4;
const RANK_WHOLE = 3;
const RANK_OBJECT = 2;
const RANK_OTHER = 1;

function isContainer(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

function rankOf(parsed: Parsed, whole: boolean): number {
  if (looksLikeFlow(parsed.value)) return RANK_FLOW;
  if (whole && !parsed.repaired && isContainer(parsed.value)) return RANK_WHOLE;
  if (isContainer(parsed.value) && !Array.isArray(parsed.value)) return RANK_OBJECT;
  return RANK_OTHER;
}

function makePicker(): { consider: Picker; fallback: () => unknown | null } {
  let best: unknown | null = null;
  let bestRank = 0;
  return {
    consider: (parsed, whole) => {
      if (parsed === undefined || parsed.value === null || parsed.value === undefined) return null;
      const rank = rankOf(parsed, whole);
      // Flow-shaped is the one rank that ends the search: nothing can outrank it.
      if (rank === RANK_FLOW) return parsed.value;
      if (rank > bestRank) {
        best = parsed.value;
        bestRank = rank;
      }
      return null;
    },
    fallback: () => best,
  };
}

function sweep(body: string, consider: Picker): unknown | null {
  const direct = consider(attemptParse(body), true);
  if (direct !== null) return direct;

  for (const start of candidateStarts(body)) {
    const balanced = scanBalanced(body, start);
    if (balanced) {
      const hit = consider(attemptParse(balanced), false);
      if (hit !== null) return hit;
    }
    const end = body.lastIndexOf(body[start] === '{' ? '}' : ']');
    if (end > start) {
      const hit = consider(attemptParse(body.slice(start, end + 1)), false);
      if (hit !== null) return hit;
    }
  }
  return null;
}

function candidateBodies(body: string): string[] {
  const bodies: string[] = [];
  for (const fence of body.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const content = fence[1]?.trim();
    if (content) bodies.push(content);
  }
  bodies.push(body);
  if (/[“”]/.test(body)) bodies.push(body.replace(/[“”]/g, '"'));
  return bodies;
}

export function extractJsonFromLlmResponse(text: string): unknown | null {
  if (!text) return null;
  const picker = makePicker();

  for (const body of candidateBodies(text.trim())) {
    const hit = sweep(body, picker.consider);
    if (hit !== null) return hit;
  }
  return picker.fallback();
}
