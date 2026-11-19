/** A knowledge base's index as the settings page shows it (main's `kbStatus`). */
export interface KnowledgeStatus {
  id: string;
  state: 'idle' | 'indexing' | 'error';
  done: number;
  total: number;
  files: number;
  chunks: number;
  chars: number;
  failed: number;
  capped: boolean;
  syncedAt: number;
  error: string;
  folderMissing: boolean;
}

/** What saving a base from the settings page can refuse. */
export type KnowledgeSaveError = 'name' | 'nameTaken' | 'folder' | 'notFound';

export interface KnowledgeSaveRequest {
  /** Absent for a new base. */
  id?: string;
  name: string;
  folder: string;
  aliases: string[];
}

/**
 * Where reading stopped short of the whole file — at a PDF page, or after so many characters.
 * Recorded only when it happened: absent = the whole file was read.
 */
export type KnowledgeCut = { page: number; pages: number } | { chars: number; total: number };

/** Reads a stored cut; anything malformed is "read whole" rather than a wrong claim. */
export function readKnowledgeCut(raw: unknown): KnowledgeCut | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;
  if (whole(value.page) && whole(value.pages) && value.page < value.pages) return { page: value.page, pages: value.pages };
  if (whole(value.chars) && whole(value.total) && value.chars < value.total) return { chars: value.chars, total: value.total };
  return undefined;
}

/**
 * The language-file key and values that say where reading stopped: `summary` for what a summary
 * was written from. One wording for the source guide (renderer) and the answer's sources (main).
 */
export function knowledgeCutLabel(cut: KnowledgeCut, summary = false): { key: string; vars: Record<string, string> } {
  const n = (value: number): string => value.toLocaleString('en-US');
  if ('page' in cut) {
    return { key: summary ? 'kb.cut.summaryPages' : 'kb.cut.pages', vars: { page: String(cut.page), pages: String(cut.pages) } };
  }
  return { key: summary ? 'kb.cut.summaryChars' : 'kb.cut.chars', vars: { chars: n(cut.chars), total: n(cut.total) } };
}

/** How a file's text was read: its own text layer, OCR, a PDF's text with OCR for its scanned pages, none, not yet. */
export type KnowledgeFileRead = 'text' | 'ocr' | 'ocrPartial' | 'none' | 'pending';

/** One file of a base as its page lists it: what is on disk, joined with what the index has. */
export interface KnowledgeFile {
  /** Relative to the base's folder, `/`-separated. */
  path: string;
  size: number;
  mtime: number;
  /** When it appeared in the folder ("date added"): its creation time, else `mtime`. */
  created: number;
  /** `pending`: on disk, not read yet (just added, or the folder is being synced). */
  read: KnowledgeFileRead;
  chars: number;
  error: string;
  /** The AI description, when there is one. `stale`: the file changed after it was written. */
  ai: { chars: number; model: string; at: number; stale: boolean } | null;
}

/**
 * A file's read-only preview on its page (`KB_FILE_PREVIEW`): a picture as a `data:` URL (the page's
 * CSP loads no other local images), a PDF's bytes (drawn page by page in the page), `text` for every
 * other type (the page shows the text the index read), `tooLarge` past the preview's own size cap.
 */
export type KnowledgeFilePreview =
  | { kind: 'image'; dataUrl: string }
  | { kind: 'pdf'; data: Uint8Array }
  | { kind: 'text' }
  | { kind: 'tooLarge' };

export interface KnowledgeFileDetail {
  /** The file's own text as indexed (cut for display). */
  text: string;
  ai: string;
  aiModel: string;
  /** Where reading the file stopped, when it did not read it whole. */
  cut?: KnowledgeCut;
  /** What part of the file the summary was written from, when not the whole of it. */
  aiCut?: KnowledgeCut;
}

/** The base page's content search (`KB_SEARCH`): the documents that match, best first. */
export interface KnowledgeSearchResult {
  /** What the query was cut into (lower-case words and two-character CJK pairs), for highlighting. */
  terms: string[];
  hits: Array<{
    path: string;
    /** Where the best passage sits: heading path and page, without the file name; '' = no heading. */
    location: string;
    snippet: string;
    /** The best passage is the file's summary (content analysis), not its own text. */
    summary: boolean;
    /** Ranked passages of this file among the top ones. */
    matches: number;
  }>;
}

export type KnowledgeAnalysisState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** One file's place in the analysis queue (`KB_ANALYSIS`). `error` is already in the user's language. */
export interface KnowledgeAnalysisEvent {
  kbId: string;
  path: string;
  state: KnowledgeAnalysisState;
  error?: string;
}

export interface KnowledgeImportResult {
  added: number;
  /** Not a document type a base reads (or a folder). */
  skipped: number;
  failed: number;
}
