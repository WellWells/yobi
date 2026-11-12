/**
 * Text-search SQL and folding.
 *
 * The visible-text projection matches what LINE shows for a message (text, call text, file name,
 * link preview, post title/desc, contact-card name, bot ALT_TEXT, location address, a renamed
 * chat's new name) — never hidden metadata. A custom match function folds full-width and mixed
 * case before comparing, which SQLite's ASCII-only LIKE cannot do for CJK; several space-separated
 * terms must all appear (AND) and a quoted phrase must appear verbatim.
 *
 * Every column a LINE version might lack is referenced through `col()`, so an older schema (or a
 * minimal test fixture) degrades to NULL instead of failing the whole query with "no such column".
 */
import { isGoSpace } from './lineGoText';
import { goTrimSpace } from './lineMessageParts';
import { CONTENT_TYPE_FILTERS, contentTypeCode } from './schema';

/**
 * The `--type` values search lists: the content type names plus
 * event and unsent, sorted, then url and notice (`type_N` is accepted too).
 */
export const SEARCH_TYPE_NAMES: readonly string[] = [...[...CONTENT_TYPE_FILTERS, 'event', 'unsent'].sort(), 'url', 'notice'];

export type HasColumn = (column: string) => boolean;

/** A column reference that becomes NULL when the column is absent from this database. */
function col(name: string, has: HasColumn): string {
  return has(name) ? name : 'NULL';
}

// _attribute and _type are coalesced to 0: a NULL (a partial row, an older schema) means a normal
// message, not an unsent one or an event.
/** `_attribute=1` guards unsent rows; '0' (never) when the column is absent. */
export function unsentSql(has: HasColumn): string {
  return has('_attribute') ? 'coalesce(_attribute,0)=1' : '0';
}

/** A system row: a _type 3 event, or a code-18 chat notice. */
export function eventSql(has: HasColumn): string {
  return `(${has('_type') ? 'coalesce(_type,0)=3' : '0'} OR _contentType=18)`;
}

/** The `_attribute<>1` guard (not unsent), NULL-safe; '1' (always) when the column is absent. */
function notUnsentSql(has: HasColumn): string {
  return has('_attribute') ? 'coalesce(_attribute,0)<>1' : '1';
}

/** Neither an event nor an unsent message — the rows a plain search should count. */
export function plainKindSql(has: HasColumn): string {
  return `NOT (${eventSql(has)} OR ${unsentSql(has)})`;
}

function jsonText(colExpr: string, key: string): string {
  return `CASE WHEN json_valid(${colExpr}) THEN nullif(json_extract(${colExpr},'$.${key}'),'') END`;
}

function metaText(has: HasColumn, ...keys: string[]): string {
  const c = col('_contentMetadata', has);
  return keys.map((k) => jsonText(c, k)).join(',');
}

// renamedSql is the new chat name a renamed event shows as content: the second LOC_ARGS field
// (fields separated by char 30 / U+001E) of a C_PN notice, or the param of an _eventInfo type 18.
function renamedSql(has: HasColumn): string {
  const meta = col('_contentMetadata', has);
  const ev = col('_eventInfo', has);
  return `CASE
 WHEN _contentType=18 THEN CASE WHEN json_valid(${meta}) AND json_extract(${meta},'$.LOC_KEY')='C_PN' THEN
  (SELECT CASE WHEN instr(a,char(30))>0 THEN substr(a,1,instr(a,char(30))-1) ELSE a END
   FROM (SELECT substr(v,instr(v,char(30))+1) AS a FROM (SELECT json_extract(${meta},'$.LOC_ARGS') AS v) WHERE instr(v,char(30))>0)) END
 WHEN json_valid(${ev}) AND CAST(json_extract(${ev},'$.type') AS INTEGER)=18 AND json_type(${ev},'$.param')='text' THEN json_extract(${ev},'$.param')
END`;
}

/** The text a search matches for a row, mirroring what read shows as content. */
export function visibleSql(has: HasColumn): string {
  const text = col('_text', has);
  const urlPreview = col('_urlPreview', has);
  const contentInfo = col('_contentInfo', has);
  const location = col('_location', has);
  return `CASE
 WHEN ${unsentSql(has)} THEN ''
 WHEN ${eventSql(has)} THEN coalesce(${renamedSql(has)},'')
 WHEN _contentType=0 THEN coalesce(${text},'') || CASE WHEN json_valid(${urlPreview}) THEN coalesce((SELECT group_concat(coalesce(json_extract(value,'$.title'),'') || char(10) || coalesce(json_extract(value,'$.desc'),''), char(10)) FROM json_each(${urlPreview},'$.urlPreview')),'') ELSE '' END
 WHEN _contentType IN (1,2,3,7) THEN ''
 WHEN _contentType=14 THEN coalesce(${jsonText(contentInfo, 'fileName')},${metaText(has, 'FILE_NAME', 'fileName')},'') || char(10) || coalesce(${text},'')
 WHEN _contentType=13 THEN coalesce(${metaText(has, 'displayName')},${text},'')
 WHEN _contentType=16 THEN coalesce(${metaText(has, 'officialName', 'albumName', 'serviceName', 'title')},'') || char(10) || coalesce(${metaText(has, 'text', 'desc')},'')
 WHEN _contentType IN (17,22) THEN coalesce(${metaText(has, 'ALT_TEXT')},${text},'')
 WHEN _contentType=15 THEN coalesce(${text},'') || char(10) || coalesce(${jsonText(location, 'address')},'') || char(10) || coalesce(${jsonText(location, 'title')},'')
 ELSE coalesce(${text},'')
END`;
}

/** Text messages with a URL or a link preview that has a title or description. */
export function urlSql(has: HasColumn): string {
  const text = col('_text', has);
  const urlPreview = col('_urlPreview', has);
  return `_contentType=0 AND ${plainKindSql(has)} AND (${text} LIKE '%http://%' OR ${text} LIKE '%https://%' OR (json_valid(${urlPreview}) AND EXISTS (SELECT 1 FROM json_each(${urlPreview},'$.urlPreview') WHERE json_extract(value,'$.title')<>'' OR json_extract(value,'$.desc')<>'')))`;
}

export interface TypeClause {
  clause: string;
  params: unknown[];
}

/**
 * Turns a `--type` value into a WHERE clause. `link`, the older name of `post` (content type 16),
 * still selects posts; `url` selects text messages with a link; `notice`/`type_18` the chat
 * notices; `event`/`unsent` the system rows; `type_N` a raw code. Returns null for an invalid name.
 */
export function typeFilter(name: string, has: HasColumn): TypeClause | null {
  switch (name) {
    case 'unsent':
      return { clause: unsentSql(has), params: [] };
    case 'event':
      return { clause: `${eventSql(has)} AND ${notUnsentSql(has)}`, params: [] };
    case 'notice':
    case 'type_18':
      return { clause: `_contentType=18 AND ${notUnsentSql(has)}`, params: [] };
    case 'url':
      return { clause: urlSql(has), params: [] };
  }
  const lookup = name === 'link' ? 'post' : name;
  let code = contentTypeCode(lookup);
  if (code === undefined) {
    const m = /^type_(\d+)$/.exec(name);
    if (!m) return null;
    code = Number(m[1]);
  }
  return { clause: `_contentType=? AND ${plainKindSql(has)}`, params: [code] };
}

// foldChar maps full-width ASCII (U+FF01-U+FF5E) and the ideographic space to half-width, then
// lowercases, so a mixed-case or full-width query matches the way LINE displays the text. Go's
// unicode.ToLower makes the dotted capital I a plain i (JS adds a combining dot).
function foldChar(cp: number): string {
  let c = cp;
  if (c >= 0xff01 && c <= 0xff5e) c -= 0xfee0;
  else if (c === 0x3000) c = 0x20;
  else if (c === 0x130) c = 0x69;
  return String.fromCodePoint(c).toLowerCase();
}

export function foldString(s: string): string {
  let out = '';
  for (const ch of s) out += foldChar(ch.codePointAt(0) ?? 0);
  return out;
}

/**
 * Splits a query into folded terms: whitespace separates words, double quotes (straight or curly)
 * keep a phrase together. An empty query yields no terms.
 */
export function searchTerms(query: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  const flush = (): void => {
    const s = goTrimSpace(cur);
    if (s) out.push(s);
    cur = '';
  };
  for (const ch of foldString(query)) {
    if (ch === '"' || ch === '“' || ch === '”') {
      flush();
      quoted = !quoted;
    } else if (!quoted && isGoSpace(ch)) {
      flush();
    } else {
      cur += ch;
    }
  }
  flush();
  return out;
}

export const MATCH_FN = 'yobi_line_match';

/**
 * Registers `yobi_line_match(text, terms)`: 1 when the folded text contains every
 * `\x1f`-separated (already folded) term. Terms are joined once by the caller.
 */
export function registerLineMatch(register: (name: string, fn: (...args: unknown[]) => unknown) => void): void {
  register(MATCH_FN, (text: unknown, terms: unknown) => {
    const folded = foldString(text == null ? '' : String(text));
    for (const t of String(terms).split('\x1f')) {
      if (t && !folded.includes(t)) return 0;
    }
    return 1;
  });
}
