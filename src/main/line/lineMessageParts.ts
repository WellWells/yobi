/**
 * The parts of a LINE message row that live in JSON columns (`_contentMetadata`, `_contentInfo`,
 * `_eventInfo`, `_reactionStatus`, `_reactions`, `_location`, `_urlPreview`), decoded the way
 * line-cli's Go code decodes them, so a column Go rejects is
 * rejected here too and both tools print the same JSON:
 * - `encoding/json` matches object keys exactly, else case-insensitively;
 * - a value of the wrong type fails a strict decode (mentions, reactions, location, link
 *   previews: the whole column is dropped) but only skips that field in `_eventInfo`, whose error
 *   line-cli ignores;
 * - numbers are integers parsed like `strconv.ParseInt` (no spaces, hex, exponents or fractions
 *   in strings; JSON numbers truncate).
 *
 * The output types are defined here and re-exported by schema.ts.
 */

/** A member an event or mention refers to; `name` is omitted when unknown. */
export interface Person {
  id: string;
  name?: string;
}

export interface Reactions {
  total: number;
  by_type: Record<string, number>;
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
  address?: string;
  title?: string;
}

export interface Call {
  kind: string;
  result?: string;
  duration_sec?: number;
}

export interface LinkPreview {
  url?: string;
  title?: string;
  description?: string;
}

export interface Album {
  id: string;
  index?: number;
  total?: number;
}

type JsonObject = Record<string, unknown>;

/** Thrown inside a strict decode when a field has the wrong type (Go's UnmarshalTypeError). */
class TypeMismatch extends Error {}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** A struct field as Go's decoder finds it: the exact key, else the first case-insensitive one. */
export function goField(obj: JsonObject, name: string): unknown {
  if (Object.hasOwn(obj, name)) return obj[name];
  const lower = name.toLowerCase();
  const key = Object.keys(obj).find((k) => k.toLowerCase() === lower);
  return key === undefined ? undefined : obj[key];
}

const INTEGER_STRING = /^[+-]?\d+$/;

/** A JSON number (truncated) or an integer string; null otherwise. */
export function anyInt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === 'string' && INTEGER_STRING.test(value)) return Number(value);
  return null;
}

/** `_contentMetadata` / `_contentInfo` as an object; anything but a JSON object is empty. */
export function parseMeta(raw: string | null | undefined): JsonObject {
  if (!raw) return {};
  const parsed = parseJson(raw);
  return isObject(parsed) ? parsed : {};
}

/** The first non-empty string among the keys (exact keys, like a Go map lookup); '' when none. */
export function metaString(meta: JsonObject, ...keys: string[]): string {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

/**
 * The first key holding a JSON number (truncated) or an integer string; a key with another type,
 * an empty or non-integer string is skipped. LINE stores most as strings.
 */
export function metaNumber(meta: JsonObject, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && INTEGER_STRING.test(value)) return Number(value);
  }
  return null;
}

export function metaBool(meta: JsonObject, key: string): boolean {
  const value = meta[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
}

export function msToSec(ms: number): number {
  return ms / 1000;
}

/** A LINE mid: 33 bytes, any type character, then 32 lowercase hex digits. */
export function isMid(value: string): boolean {
  return value.length === 33 && value.charCodeAt(0) < 0x80 && /^[0-9a-f]{32}$/.test(value.slice(1));
}

// ── _eventInfo (lenient: line-cli ignores its decode error, so a bad field is only skipped) ──

export interface EventInfo {
  type?: unknown;
  midList: string[];
  names: Record<string, string>;
  param?: unknown;
  fromName: string;
}

export function parseEventInfo(raw: string | null | undefined): EventInfo {
  const ev: EventInfo = { midList: [], names: {}, fromName: '' };
  if (!raw) return ev;
  const parsed = parseJson(raw);
  if (!isObject(parsed)) return ev;
  ev.type = goField(parsed, 'type');
  ev.param = goField(parsed, 'param');
  const mids = goField(parsed, 'midList');
  if (Array.isArray(mids)) ev.midList = mids.map((id) => (typeof id === 'string' ? id : ''));
  const names = goField(parsed, 'displayNameMap');
  if (isObject(names)) {
    for (const [id, name] of Object.entries(names)) {
      if (typeof name === 'string') ev.names[id] = name;
    }
  }
  const fromName = goField(parsed, 'fromName');
  if (typeof fromName === 'string') ev.fromName = fromName;
  return ev;
}

/**
 * The sender name LINE stored with a row: `_contentInfo.fromName`, or an event's `fromName` /
 * displayNameMap entry; '' when there is none. Used when no name table knows the sender.
 */
export function storedName(from: string, ci: JsonObject, ev: EventInfo): string {
  return metaString(ci, 'fromName') || ev.fromName || ev.names[from] || '';
}

// Open-chat member events by _eventInfo.type: 14 still joined, 13 left, 15 admin removed the
// listed member, 18 carries the new chat name, 20 unsent.
export const EVENT_TYPES: Readonly<Record<number, string>> = { 13: 'left', 14: 'joined', 15: 'kicked', 18: 'renamed', 20: 'unsent' };

// Chat notices (_contentType 18) by LOC_KEY. LOC_ARGS holds the actor, then \x1f-separated target
// mids (the new name for C_PN), separated by \x1e. The keys and their meanings are LINE's own (the
// LOC_KEY enum in LINE's Chrome extension); A_ keys are for chats created with several people at
// once. Other keys, such as C_MA, are given raw.
export const NOTICE_KEYS: Readonly<Record<string, string>> = {
  C_MJ: 'joined', C_ML: 'left', C_MI: 'invited', C_GI: 'invited', C_MR: 'removed', C_PN: 'renamed',
  A_MJ: 'joined', A_ML: 'left', A_MC: 'invited', A_MI: 'invited', A_MR: 'removed',
  C_IC: 'invite_canceled', A_IC: 'invite_canceled', C_OL: 'invite_failed',
  C_PI: 'photo_changed', C_SN: 'join_by_link_on', C_SP: 'join_by_link_off', C_BG: 'became_group',
  BB: 'album_renamed', BD: 'album_deleted', BO: 'album_photo_deleted',
};

// ── strict decoders (a wrong type anywhere drops the whole column, as Go's Unmarshal error does) ──

function strictString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new TypeMismatch();
  return value;
}

/** A Go int64 field: a JSON integer or null (0); a fraction, string or other type fails. */
function strictInt(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new TypeMismatch();
  return value;
}

function strictFloat(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number') throw new TypeMismatch();
  return value;
}

/** A Go slice of structs: null = empty; each element an object, or null (the zero struct). */
function strictObjects(value: unknown): JsonObject[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeMismatch();
  return value.map((item) => {
    if (item === null) return {};
    if (!isObject(item)) throw new TypeMismatch();
    return item;
  });
}

/** A Go struct field: null = the zero struct; anything but an object fails. */
function strictObject(value: unknown): JsonObject {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new TypeMismatch();
  return value;
}

function strictDecode<T>(raw: string, decode: (top: JsonObject) => T): T | null {
  const parsed = parseJson(raw);
  if (parsed === null) return decode({});
  if (!isObject(parsed)) return null;
  try {
    return decode(parsed);
  } catch (err) {
    if (err instanceof TypeMismatch) return null;
    throw err;
  }
}

interface Mentionee {
  s: unknown;
  e: unknown;
  a: unknown;
  m: string;
}

function decodeMentionees(top: JsonObject): Mentionee[] {
  return strictObjects(goField(top, 'MENTIONEES')).map((e) => ({
    s: goField(e, 'S'), e: goField(e, 'E'), a: goField(e, 'A'), m: strictString(goField(e, 'M')),
  }));
}

function mentioneesOf(meta: JsonObject): Mentionee[] | null {
  const raw = meta.MENTION;
  if (typeof raw === 'string') return strictDecode(raw, decodeMentionees);
  if (isObject(raw)) return strictDecode(JSON.stringify(raw), decodeMentionees);
  return null;
}

/** The span a mentionee's S..E names in `text`, when it lies inside it. */
function mentionSpan(e: Mentionee, text: string): { start: number; end: number } | null {
  const start = anyInt(e.s);
  const end = anyInt(e.e);
  return start !== null && end !== null && start >= 0 && start < end && end <= text.length ? { start, end } : null;
}

/**
 * Reads MENTION.MENTIONEES. S and E are UTF-16 offsets into the text (JS string indices are
 * already UTF-16 code units); that span names a mentioned mid when no name table knows it.
 * A=1 marks @All.
 */
export function parseMentions(meta: JsonObject, text: string, name: (mid: string) => string): [Person[], boolean] {
  const mentionees = mentioneesOf(meta);
  if (!mentionees) return [[], false];
  const out: Person[] = [];
  const seen = new Set<string>();
  let all = false;
  for (const e of mentionees) {
    if (anyInt(e.a) === 1) {
      all = true;
      continue;
    }
    if (!e.m || seen.has(e.m)) continue;
    seen.add(e.m);
    let personName = name(e.m);
    if (!personName) {
      const span = mentionSpan(e, text);
      if (span) personName = goTrimSpace(text.slice(span.start, span.end).replace(/^@/, ''));
    }
    out.push(personName ? { id: e.m, name: personName } : { id: e.m });
  }
  return [out, all];
}

/** One person a message @-mentions, and where the "@name" sits in its text when LINE says so. */
export interface MentionSpan {
  id: string;
  at?: { start: number; end: number };
}

/** Everyone a message @-mentions by name, in order (@All names nobody); [] when none or unreadable. */
export function mentionSpans(meta: JsonObject, text: string): MentionSpan[] {
  const out: MentionSpan[] = [];
  for (const e of mentioneesOf(meta) ?? []) {
    if (anyInt(e.a) === 1 || !e.m) continue;
    const at = mentionSpan(e, text);
    out.push(at ? { id: e.m, at } : { id: e.m });
  }
  return out;
}

// Go's unicode.IsSpace set: JS `\s` without U+FEFF, plus U+0085.
const GO_SPACE = '\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';
const GO_TRIM = new RegExp(`^[${GO_SPACE}]+|[${GO_SPACE}]+$`, 'g');

/** Go's strings.TrimSpace. */
export function goTrimSpace(value: string): string {
  return value.replace(GO_TRIM, '');
}

// Predefined reaction codes: 2 nice, 3 love, 4 fun, 5 amazing, 6 sad, 7 omg.
export const REACTION_NAMES: Readonly<Record<number, string>> = { 2: 'nice', 3: 'love', 4: 'fun', 5: 'amazing', 6: 'sad', 7: 'omg' };

function reactionName(code: number): string {
  return REACTION_NAMES[code] ?? `type_${code}`;
}

interface ReactionStatus {
  totalCount: number;
  countByType: [string, number][];
  list: { type: number; predefined: number; cancel: unknown }[];
}

function decodeStatus(top: JsonObject): ReactionStatus {
  const counts = strictObject(goField(top, 'countByType'));
  return {
    totalCount: strictInt(goField(top, 'totalCount')),
    countByType: Object.entries(counts).map(([k, n]) => [k, strictInt(n)]),
    list: strictObjects(goField(top, 'reactionList')).map((e) => ({
      type: strictInt(goField(e, 'type')),
      predefined: strictInt(goField(e, 'PredefinedType')),
      cancel: goField(e, 'cancel'),
    })),
  };
}

interface LegacyReaction {
  predefined: number | null;
  paid: boolean;
}

function decodeLegacy(top: JsonObject): LegacyReaction[] {
  return Object.values(top).map((entry) => {
    const rt = strictObject(goField(strictObject(entry), 'reactionType'));
    const predefined = goField(rt, 'predefinedReactionType');
    if (predefined !== undefined && predefined !== null && (typeof predefined !== 'number' || !Number.isInteger(predefined))) {
      throw new TypeMismatch();
    }
    // A json.RawMessage keeps any present value, `null` included.
    return { predefined: typeof predefined === 'number' ? predefined : null, paid: goField(rt, 'paidReactionType') !== undefined };
  });
}

/**
 * Counts reactions. Open chats keep totals in `_reactionStatus.countByType`; other chats list each
 * reaction in `_reactionStatus.reactionList` (type 1 predefined, 2 paid) or in `_reactions`.
 * by_type keys come out sorted, as Go encodes a map.
 */
export function parseReactions(status: string, legacy: string): Reactions | undefined {
  const by: Record<string, number> = {};
  let total = 0;
  const add = (key: string, n: number): void => {
    if (n > 0) {
      by[key] = (by[key] ?? 0) + n;
      total += n;
    }
  };
  const rs = status ? strictDecode(status, decodeStatus) : null;
  if (rs) {
    for (const [k, n] of rs.countByType) {
      if (INTEGER_STRING.test(k)) add(reactionName(Number(k)), n);
    }
    if (total === 0) {
      for (const e of rs.list) {
        if (e.cancel === true) continue;
        const cancel = anyInt(e.cancel);
        if (cancel !== null && cancel !== 0) continue;
        if (e.type === 1) add(reactionName(e.predefined), 1);
        else if (e.type === 2) add('paid', 1);
        else add(`kind_${e.type}`, 1);
      }
    }
    if (rs.totalCount > total && total > 0) total = rs.totalCount;
  }
  if (total === 0 && legacy) {
    for (const e of strictDecode(legacy, decodeLegacy) ?? []) {
      if (e.predefined !== null) add(reactionName(e.predefined), 1);
      else if (e.paid) add('paid', 1);
    }
  }
  if (total === 0) return undefined;
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(by).sort()) sorted[key] = by[key];
  return { total, by_type: sorted };
}

// Call kinds from ct6 metadata TYPE. A group call (G) always has RESULT INFO, so its GC_EVT_TYPE
// S/E becomes started/ended.
const CALL_KINDS: Readonly<Record<string, string>> = { A: 'audio', V: 'video', G: 'group' };

export function parseCall(meta: JsonObject): Call | undefined {
  const type = metaString(meta, 'TYPE');
  if (!type) return undefined;
  const call: Call = { kind: CALL_KINDS[type] ?? type.toLowerCase() };
  const result = metaString(meta, 'RESULT').toLowerCase();
  if (result) call.result = result;
  if (type === 'G') {
    const evt = metaString(meta, 'GC_EVT_TYPE');
    if (evt === 'S') call.result = 'started';
    else if (evt === 'E') call.result = 'ended';
  }
  const dur = metaNumber(meta, 'DURATION');
  if (dur !== null && dur > 0) call.duration_sec = msToSec(dur);
  return call;
}

export function parseLocation(raw: string | null | undefined): GeoLocation | undefined {
  if (!raw) return undefined;
  const loc = strictDecode(raw, (top) => ({
    latitude: strictFloat(goField(top, 'latitude')),
    longitude: strictFloat(goField(top, 'longitude')),
    address: strictString(goField(top, 'address')),
    title: strictString(goField(top, 'title')),
  }));
  if (!loc || loc.latitude === null || loc.longitude === null) return undefined;
  const out: GeoLocation = { latitude: loc.latitude, longitude: loc.longitude };
  if (loc.address) out.address = loc.address;
  if (loc.title) out.title = loc.title;
  return out;
}

/** The `_urlPreview` entries that have a title or description. */
export function linkPreviews(raw: string | null | undefined): LinkPreview[] {
  if (!raw) return [];
  const list = strictDecode(raw, (top) => strictObjects(goField(top, 'urlPreview')).map((p) => ({
    url: strictString(goField(p, 'url')),
    title: strictString(goField(p, 'title')),
    desc: strictString(goField(p, 'desc')),
  })));
  const out: LinkPreview[] = [];
  for (const p of list ?? []) {
    if (!p.title && !p.desc) continue;
    const preview: LinkPreview = {};
    if (p.url) preview.url = p.url;
    if (p.title) preview.title = p.title;
    if (p.desc) preview.description = p.desc;
    out.push(preview);
  }
  return out;
}
