/**
 * The user's personal memory: short sentences about the user that chat, /agent and the user's
 * own bot chats remember across conversations. Shared because the renderer lists the entries and
 * re-renders the per-turn notes from a conversation file.
 */

/**
 * Every entry rides in the prompt of every memory-reading send, and on a capped provider that is
 * room taken from the conversation history. The total is a hard cap: when it is reached a new
 * entry is refused and the user is told, never silently evicting an older one.
 */
export const MEMORY_TOTAL_MAX_CHARS = 2_000;
export const MEMORY_ENTRY_MAX_CHARS = 150;
/** More changes than this in one answer is a model reciting the list, not a user telling it something. */
export const MEMORY_MAX_OPS_PER_TURN = 8;
/** Below this much room a new sentence will almost certainly not fit: the model is told, and Settings says so. */
const MEMORY_FULL_MARGIN_CHARS = 40;

export function memoryNearlyFull(usedChars: number): boolean {
  return MEMORY_TOTAL_MAX_CHARS - usedChars < MEMORY_FULL_MARGIN_CHARS;
}

export type UserMemorySource = 'chat' | 'agent' | 'bot' | 'manual';

export interface UserMemoryEntry {
  /** `m<number>`, never reused: an old thread may still name a deleted id. */
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  source: UserMemorySource;
  /** The user rewrote this entry by hand. */
  edited?: true;
  /** File name of the conversation the entry was learned in. */
  conversation?: string;
}

/** Bot accounts that are the user themself, by platform user id. */
export interface UserMemoryBotSelf {
  telegram: string[];
  line: string[];
}

export interface UserMemorySnapshot {
  enabled: boolean;
  entries: UserMemoryEntry[];
  botSelf: UserMemoryBotSelf;
  usedChars: number;
  maxChars: number;
  entryMaxChars: number;
}

export type MemoryNoteOp = 'add' | 'update' | 'forget' | 'full' | 'review';

/**
 * One change a reply made to the memory, as the program saw it land. `full` is an addition that
 * was refused because the memory is at its cap. `review` changed nothing: the user asked for the
 * whole memory to be tidied, which only ever happens after they confirm each change.
 */
export interface MemoryNote {
  op: MemoryNoteOp;
  id?: string;
  /** The entry's text after the change; for `forget`, the text that was removed; for `review`, what to tidy (may be empty). */
  text: string;
  /** For `update`, the text it replaced — what "undo" puts back. */
  prev?: string;
}

/** One wording per change for both the chat's note line and a bot message's closing line. */
export const MEMORY_NOTE_KEYS: Record<MemoryNoteOp, string> = {
  add: 'memory.note.added',
  update: 'memory.note.updated',
  forget: 'memory.note.forgot',
  full: 'memory.note.full',
  review: 'memory.note.review',
};

export type MemoryEditFailure = 'empty' | 'tooLong' | 'full' | 'duplicate' | 'notFound';

export type MemoryEditResult =
  | { ok: true; snapshot: UserMemorySnapshot }
  | { ok: false; reason: MemoryEditFailure; snapshot: UserMemorySnapshot };

const LINE_SEPARATOR = 0x2028;
const PARAGRAPH_SEPARATOR = 0x2029;

/** C0 controls, DEL and the two Unicode line breaks a JSON string can carry but a single line cannot. */
function isControlChar(code: number): boolean {
  return code < 0x20 || code === 0x7f || code === LINE_SEPARATOR || code === PARAGRAPH_SEPARATOR;
}

const WRAPPING_QUOTES = /^["'“”「『]+|["'“”」』]+$/g;

/**
 * One line, no control characters, and nothing that could close the HTML comment a turn's notes
 * are stored in.
 */
export function cleanMemoryText(raw: string): string {
  return Array.from(raw ?? '', (char) => (isControlChar(char.codePointAt(0) ?? 0) ? ' ' : char))
    .join('')
    .replace(/-->/g, '->')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(WRAPPING_QUOTES, '')
    .trim();
}

/** Two entries that differ only in case, spacing or a closing full stop are the same memory. */
export function memoryDedupeKey(text: string): string {
  return cleanMemoryText(text).toLowerCase().replace(/\s+/g, '').replace(/[.。!！]+$/u, '');
}

export function memoryUsedChars(entries: readonly UserMemoryEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.text.length, 0);
}

export function memoryIdNumber(id: string): number {
  const match = /^m(\d+)$/i.exec(id.trim());
  return match ? Number(match[1]) : Number.NaN;
}

/** Whether "undo" on this note would still do what it says, against the memory as it is now. */
export function canUndoMemoryNote(note: MemoryNote, entries: readonly UserMemoryEntry[]): boolean {
  if (!note.id) return false;
  const current = entries.find((entry) => entry.id === note.id);
  if (note.op === 'add') return current?.text === note.text;
  if (note.op === 'update') return current?.text === note.text && typeof note.prev === 'string' && note.prev !== '';
  if (note.op === 'forget') return !current;
  return false;
}

const NOTE_OPS: readonly MemoryNoteOp[] = ['add', 'update', 'forget', 'full', 'review'];

/** Turn meta is read back from a file the user can edit, so every field is checked. */
export function normalizeMemoryNotes(raw: unknown): MemoryNote[] {
  if (!Array.isArray(raw)) return [];
  const notes: MemoryNote[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    const op = candidate.op as MemoryNoteOp;
    const text = typeof candidate.text === 'string' ? cleanMemoryText(candidate.text) : '';
    if (!NOTE_OPS.includes(op) || (!text && op !== 'review')) continue;
    const id = typeof candidate.id === 'string' && Number.isFinite(memoryIdNumber(candidate.id)) ? candidate.id : undefined;
    const prev = typeof candidate.prev === 'string' ? cleanMemoryText(candidate.prev) : '';
    notes.push({ op, text, ...(id ? { id } : {}), ...(prev ? { prev } : {}) });
  }
  return notes;
}
