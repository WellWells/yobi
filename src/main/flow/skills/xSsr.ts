/**
 * Reads the GraphQL results x.com streams into its server-rendered HTML. The embedded literal is
 * decoded, never evaluated: it is remote code.
 */

export interface XGraphqlResult {
  /** The persisted query id. Changes with every X deploy, so nothing may key on it. */
  queryId: string;
  variables: Record<string, unknown>;
  data: unknown;
}

const COMPLETED_MARKER = '{kind:"GraphQLRequestStream.Completed"';

/** Far deeper than any measured payload (~40); only here so a malformed page cannot blow the stack. */
const MAX_DEPTH = 256;

const SIMPLE_ESCAPES: Record<string, string> = {
  n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0',
};

class LiteralReader {
  private i: number;

  constructor(private readonly src: string, start: number) {
    this.i = start;
  }

  get position(): number {
    return this.i;
  }

  value(depth = 0): unknown {
    if (depth > MAX_DEPTH) throw new Error('literal nested too deeply');
    this.skipSpace();
    const { src } = this;
    // `$R[n]=value` registers a value; a bare `$R[n]` references one. References are not resolved
    // and read as undefined.
    if (src.startsWith('$R[', this.i)) {
      const match = /^\$R\[(\d+)\]/.exec(src.slice(this.i, this.i + 24));
      if (!match) throw this.fail('bad $R slot');
      this.i += match[0].length;
      if (src[this.i] === '=') {
        this.i++;
        return this.value(depth + 1);
      }
      return undefined;
    }
    const ch = src[this.i];
    if (ch === '{') return this.object(depth);
    if (ch === '[') return this.array(depth);
    if (ch === '"') return this.string();
    if (src.startsWith('!0', this.i)) { this.i += 2; return true; }
    if (src.startsWith('!1', this.i)) { this.i += 2; return false; }
    if (src.startsWith('true', this.i)) { this.i += 4; return true; }
    if (src.startsWith('false', this.i)) { this.i += 5; return false; }
    if (src.startsWith('null', this.i)) { this.i += 4; return null; }
    if (src.startsWith('void 0', this.i)) { this.i += 6; return undefined; }
    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(this.i, this.i + 40));
    if (num) {
      this.i += num[0].length;
      return Number(num[0]);
    }
    throw this.fail('unsupported syntax');
  }

  private skipSpace(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i])) this.i++;
  }

  private fail(reason: string): Error {
    return new Error(`${reason} at ${this.i}: ${JSON.stringify(this.src.slice(this.i, this.i + 24))}`);
  }

  private string(): string {
    const { src } = this;
    this.i++;
    let out = '';
    while (this.i < src.length && src[this.i] !== '"') {
      if (src[this.i] !== '\\') {
        out += src[this.i++];
        continue;
      }
      const next = src[this.i + 1];
      if (next === 'u' && src[this.i + 2] === '{') {
        const close = src.indexOf('}', this.i);
        out += String.fromCodePoint(parseInt(src.slice(this.i + 3, close), 16));
        this.i = close + 1;
      } else if (next === 'u') {
        out += String.fromCharCode(parseInt(src.slice(this.i + 2, this.i + 6), 16));
        this.i += 6;
      } else if (next === 'x') {
        out += String.fromCharCode(parseInt(src.slice(this.i + 2, this.i + 4), 16));
        this.i += 4;
      } else if (next === '\n') {
        this.i += 2;
      } else {
        out += SIMPLE_ESCAPES[next] ?? next;
        this.i += 2;
      }
    }
    if (src[this.i] !== '"') throw this.fail('unterminated string');
    this.i++;
    return out;
  }

  private key(): string {
    this.skipSpace();
    if (this.src[this.i] === '"') return this.string();
    const match = /^(?:[A-Za-z_$][\w$]*|\d+)/.exec(this.src.slice(this.i, this.i + 256));
    if (!match) throw this.fail('bad key');
    this.i += match[0].length;
    return match[0];
  }

  private object(depth: number): Record<string, unknown> {
    this.i++;
    const out: Record<string, unknown> = {};
    this.skipSpace();
    if (this.src[this.i] === '}') {
      this.i++;
      return out;
    }
    for (;;) {
      const key = this.key();
      this.skipSpace();
      if (this.src[this.i] !== ':') throw this.fail('expected ":"');
      this.i++;
      out[key] = this.value(depth + 1);
      this.skipSpace();
      if (this.src[this.i] === ',') { this.i++; continue; }
      if (this.src[this.i] === '}') { this.i++; return out; }
      throw this.fail('expected "," or "}"');
    }
  }

  private array(depth: number): unknown[] {
    this.i++;
    const out: unknown[] = [];
    for (;;) {
      this.skipSpace();
      if (this.src[this.i] === ']') { this.i++; return out; }
      if (this.src[this.i] === ',') {
        // A hole, as in `[,1]`.
        out.push(undefined);
        this.i++;
        continue;
      }
      out.push(this.value(depth + 1));
      this.skipSpace();
      if (this.src[this.i] === ',') { this.i++; continue; }
      if (this.src[this.i] === ']') { this.i++; return out; }
      throw this.fail('expected "," or "]"');
    }
  }
}

/** Decodes one literal starting at `start`. Throws on anything outside the supported subset. */
export function decodeLiteral(src: string, start: number): { value: unknown; end: number } {
  const reader = new LiteralReader(src, start);
  const value = reader.value();
  return { value, end: reader.position };
}

function splitKey(key: string): { queryId: string; variables: Record<string, unknown> } {
  const brace = key.indexOf('{');
  if (brace < 0) return { queryId: key, variables: {} };
  try {
    const parsed: unknown = JSON.parse(key.slice(brace));
    return {
      queryId: key.slice(0, brace),
      variables: parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {},
    };
  } catch {
    return { queryId: key.slice(0, brace), variables: {} };
  }
}

function variablesOf(url: string): Record<string, unknown> {
  try {
    const raw = new URL(url).searchParams.get('variables');
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** A POST carries `{"variables":{…}}` in its body instead of the URL. */
function postedVariables(postData: string | undefined): Record<string, unknown> {
  if (!postData) return {};
  try {
    const parsed = JSON.parse(postData) as { variables?: unknown } | null;
    const variables = parsed?.variables;
    return variables && typeof variables === 'object' ? variables as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** A GraphQL response the page fetched itself (`/i/api/graphql/<queryId>/<name>`); null for an error body. */
export function readGraphqlResponse(url: string, body: string, postData?: string): XGraphqlResult | null {
  try {
    const parsed = JSON.parse(body) as { data?: unknown } | null;
    if (!parsed || parsed.data === undefined || parsed.data === null) return null;
    const queryId = /\/graphql\/([^/]+)\//.exec(url)?.[1] ?? '';
    return { queryId, variables: { ...variablesOf(url), ...postedVariables(postData) }, data: parsed.data };
  } catch {
    return null;
  }
}

/** Every completed, successful GraphQL result in the page; a chunk that does not decode is skipped. */
export function readSsrGraphql(html: string): XGraphqlResult[] {
  const results: XGraphqlResult[] = [];
  let from = 0;
  for (;;) {
    const at = html.indexOf(COMPLETED_MARKER, from);
    if (at < 0) return results;
    from = at + COMPLETED_MARKER.length;
    let decoded: unknown;
    try {
      decoded = decodeLiteral(html, at).value;
    } catch {
      continue;
    }
    const chunk = decoded as { key?: unknown; result?: { kind?: unknown; value?: { data?: unknown } } };
    if (typeof chunk?.key !== 'string' || chunk.result?.kind !== 'Result.Ok') continue;
    const data = chunk.result.value?.data;
    if (data === undefined) continue;
    results.push({ ...splitKey(chunk.key), data });
  }
}
