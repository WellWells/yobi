// JSON recovery ladder for LLM responses. Each fallback only runs when the
// stricter pass failed, so well-formed JSON is never rewritten.

function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Removes commas that directly precede a closing bracket (a common LLM slip)
// without touching string contents.
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

function attemptParse(text: string): unknown | undefined {
  const direct = tryParse(text);
  if (direct !== undefined) return direct;
  return tryParse(stripTrailingCommas(text));
}

// Extracts the string-aware balanced {...} / [...] slice starting at `start`,
// so prose after the JSON (which the last-bracket heuristic would swallow)
// cannot break parsing.
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

// Likely JSON start positions: `{ "` skips prose braces such as {{variable}}
// examples the model may write around the payload.
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

// A response may carry several JSON snippets (e.g. a small illustrative fence
// before the real flow); prefer the one shaped like a flow definition.
function looksLikeFlow(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  const inner = obj.flow && typeof obj.flow === 'object' && !Array.isArray(obj.flow)
    ? (obj.flow as Record<string, unknown>)
    : obj;
  return Array.isArray(inner.steps);
}

type Picker = (parsed: unknown | undefined) => unknown | null;

function makePicker(): { consider: Picker; fallback: () => unknown | null } {
  let fallback: unknown | null = null;
  return {
    consider: (parsed) => {
      if (parsed === undefined || parsed === null) return null;
      if (looksLikeFlow(parsed)) return parsed;
      if (fallback === null) fallback = parsed;
      return null;
    },
    fallback: () => fallback,
  };
}

function extractFromBody(body: string, consider: Picker): unknown | null {
  const direct = consider(attemptParse(body));
  if (direct !== null) return direct;

  for (const start of candidateStarts(body)) {
    const balanced = scanBalanced(body, start);
    if (balanced) {
      const hit = consider(attemptParse(balanced));
      if (hit !== null) return hit;
    }
    const end = body.lastIndexOf(body[start] === '{' ? '}' : ']');
    if (end > start) {
      const hit = consider(attemptParse(body.slice(start, end + 1)));
      if (hit !== null) return hit;
    }
  }
  return null;
}

export function extractJsonFromLlmResponse(text: string): unknown | null {
  if (!text) return null;
  const body = text.trim();
  const picker = makePicker();

  for (const fence of body.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const content = fence[1]?.trim();
    if (!content) continue;
    const hit = extractFromBody(content, picker.consider);
    if (hit !== null) return hit;
  }

  const hit = extractFromBody(body, picker.consider);
  if (hit !== null) return hit;

  // Last resort: a markdown renderer may have curled the quotes.
  if (/[“”]/.test(body)) {
    const curly = extractFromBody(body.replace(/[“”]/g, '"'), picker.consider);
    if (curly !== null) return curly;
  }
  return picker.fallback();
}
