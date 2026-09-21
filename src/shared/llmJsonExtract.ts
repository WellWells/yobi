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
  const repaired = repairParse(text);
  return repaired === undefined ? undefined : { value: repaired, repaired: true };
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
 * Candidates are ranked by SHAPE, not by the order the recovery ladder happened to reach them.
 * Arrival order was the old rule and it misread the ladder in both directions: a jsonrepair of
 * the whole body that swallowed a markdown citation footer (`[1]: https://…`, which a provider
 * running its own web search appends under every answer) into a top-level list arrived before the
 * clean object sitting inside it, and a clean parse of an inner `[…]` fragment arrived before the
 * repair that rescued the object around it. Both shipped the wrong value to callers that all want
 * one object.
 *
 * WHOLE outranks OBJECT because a candidate body that parsed cleanly end to end needs no salvage
 * at all — without it, `[{…},{…}]` would be mined for the first element instead of returned. It
 * is withheld from a scalar, which no caller can use: a fenced `42` must not beat a real object
 * found further down the reply.
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
