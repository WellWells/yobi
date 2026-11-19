/**
 * One knowledge base's index file: which files it read (with the mtime and size that tell a changed
 * file), their chunks as written, and an FTS5 index over the chunks' bigram text.
 *
 * Measured on 4.4M characters / 4,262 chunks (Electron 45, SQLite 3.53): this layout —
 * a contentless bigram FTS table plus the raw chunk table for showing passages — is 13.8 MB and
 * builds in 0.26 s, against 32.2 MB / 1.4 s for a trigram table that still cannot find a
 * two-character word; a ranked query takes 0.2–0.7 ms. So it runs on the main process, like the law
 * index: what takes time is reading the files, and that yields between files.
 *
 * `bm25(fts, 2, 1)`: a hit in the header (file name › headings) counts twice a hit in the body — the
 * weighting the evaluation picked.
 */
import { DatabaseSync } from 'node:sqlite';
import { bigramText, ftsMatch, queryTerms } from '../../shared/kbTokens';
import type { KbChunk } from './kbChunk';
import { KB_IMAGE_EXTENSIONS } from './kbOcr';
import type { KbOcrRead } from './kbOcr';
import { readKnowledgeCut } from '../../shared/knowledgeStatus';
import type { KnowledgeCut } from '../../shared/knowledgeStatus';

export const KB_INDEX_SCHEMA_VERSION = '1';

export interface KbFileRow {
  id: number;
  /** Relative to the knowledge base's folder, `/`-separated. */
  path: string;
  mtime: number;
  size: number;
  chars: number;
  chunks: number;
  /** Why the file has no text (scanned PDF, password, unreadable); empty when it was read. */
  error: string;
  /** How OCR read it: `full` = a scan or a picture, `partial` = a PDF's scanned pages; stored 0/1/2. */
  ocr: KbOcrRead;
  /** Length of the AI-written description; 0 = never analysed. */
  aiChars: number;
  /** The model that wrote it (a target URL). */
  aiModel: string;
  aiAt: number;
  /** The file's mtime when it was analysed: another mtime now = the description may be out of date. */
  aiMtime: number;
  /** Reading stopped short of the whole file (`KnowledgeCut`); absent = read whole. */
  cut?: KnowledgeCut;
  /** The summary was written from part of the file only. */
  aiCut?: KnowledgeCut;
}

/**
 * The AI description's chunks sit after the file's own, from this `ord` on: re-reading the file
 * replaces its own chunks and keeps them, analysing again replaces them and keeps the file's.
 */
export const KB_AI_ORD_BASE = 1_000_000;

/**
 * A file's summary kept across a rebuild of its index (a new schema, another folder): the user paid
 * a model for it, and the folder alone cannot give it back. `sourceMtime` is the file version it
 * describes, so a file changed since is still marked as possibly out of date.
 */
export interface KbCarriedSummary {
  path: string;
  text: string;
  model: string;
  at: number;
  sourceMtime: number;
  /** The summary was written from part of the file only. */
  cut?: KnowledgeCut;
}

export interface KbChunkRow {
  id: number;
  file: number;
  path: string;
  ord: number;
  head: string;
  body: string;
}

export interface KbHit extends KbChunkRow {
  /** Reciprocal-rank-fusion score over the queries; higher is better. */
  score: number;
}

/**
 * A chunk that can answer a question: the file's own text, or its AI description while the file is
 * unchanged since. A description of an older version stays for the page to show (marked "may be out
 * of date") but is never handed to a model as evidence beside the new text ("refund
 * 30 days" from an old summary would sit next to "14 days" from the edited file, unmarked).
 */
const LIVE = `(chunk.ord < ${KB_AI_ORD_BASE} OR file.ai_mtime = file.mtime)`;

/**
 * The files a question is limited to (the user asked about these documents only), as one JSON
 * parameter; `null` = every file. A filter on the query itself, so ranking never reaches a file
 * outside the limit — not a cut of the results afterwards.
 */
function onlySql(param: number): string {
  return `(?${param} IS NULL OR file.path IN (SELECT value FROM json_each(?${param})))`;
}

function onlyParam(only: readonly string[] | undefined): string | null {
  return only ? JSON.stringify(only) : null;
}

/** Hits each query contributes before fusion. */
const PER_QUERY = 60;
/** RRF's constant: rank 1 scores 1/61, rank 60 about half that. */
const RRF_K = 60;

type Row = Record<string, unknown>;

function fileRow(row: Row): KbFileRow {
  return {
    id: Number(row.id),
    path: String(row.path),
    mtime: Number(row.mtime),
    size: Number(row.size),
    chars: Number(row.chars),
    chunks: Number(row.chunks),
    error: String(row.error ?? ''),
    ocr: OCR_READ[Number(row.ocr ?? 0)] ?? 'none',
    aiChars: Number(row.ai_chars ?? 0),
    aiModel: String(row.ai_model ?? ''),
    aiAt: Number(row.ai_at ?? 0),
    aiMtime: Number(row.ai_mtime ?? 0),
    ...cutField('cut', row.cut),
    ...cutField('aiCut', row.ai_cut),
  };
}

/** `file.ocr` as stored: its index is the column's value. */
const OCR_READ: readonly KbOcrRead[] = ['none', 'full', 'partial'];

/** A stored cut (JSON) as a row field; nothing when absent or unreadable. */
function cutField<K extends 'cut' | 'aiCut'>(key: K, raw: unknown): Partial<Record<K, KnowledgeCut>> {
  if (typeof raw !== 'string' || !raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const cut = readKnowledgeCut(parsed);
  return cut ? { [key]: cut } as Partial<Record<K, KnowledgeCut>> : {};
}

function cutText(cut: KnowledgeCut | undefined): string | null {
  return cut ? JSON.stringify(cut) : null;
}

const FILE_COLUMNS = 'id, path, mtime, size, chars, chunks, error, ocr, LENGTH(COALESCE(ai, \'\')) AS ai_chars, ai_model, ai_at, ai_mtime, cut, ai_cut';
/** Columns added after the first index files were written; added to an older file when opened. */
const ADDED_FILE_COLUMNS = [['ocr', 'INTEGER DEFAULT 0'], ['ai', 'TEXT'], ['ai_model', 'TEXT'], ['ai_at', 'INTEGER DEFAULT 0'], ['ai_mtime', 'INTEGER DEFAULT 0'], ['cut', 'TEXT'], ['ai_cut', 'TEXT']] as const;

function chunkRow(row: Row): KbChunkRow {
  return {
    id: Number(row.id),
    file: Number(row.file),
    path: String(row.path),
    ord: Number(row.ord),
    head: String(row.head),
    body: String(row.body),
  };
}

export class KbIndex {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS file(id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, mtime INTEGER, size INTEGER,
        chars INTEGER, chunks INTEGER, error TEXT);
      CREATE TABLE IF NOT EXISTS chunk(id INTEGER PRIMARY KEY, file INTEGER NOT NULL, ord INTEGER NOT NULL, head TEXT, body TEXT);
      CREATE INDEX IF NOT EXISTS chunk_file ON chunk(file, ord);
      CREATE TABLE IF NOT EXISTS carried_ai(path TEXT PRIMARY KEY, ai TEXT NOT NULL, model TEXT, at INTEGER, mtime INTEGER, cut TEXT);
      CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(head, body, content='', contentless_delete=1,
        tokenize='unicode61 remove_diacritics 2', detail=full);
    `);
    const have = new Set((this.db.prepare('PRAGMA table_info(file)').all() as Row[]).map((row) => String(row.name)));
    for (const [name, type] of ADDED_FILE_COLUMNS) {
      if (!have.has(name)) this.db.exec(`ALTER TABLE file ADD COLUMN ${name} ${type}`);
    }
    // An index from before `ocr` was recorded cannot tell which PDFs and pictures OCR read: they are
    // read once more (the next sync sees another mtime) so the page says how each one was read.
    if (!this.db.prepare("SELECT 1 FROM meta WHERE key = 'ocrKnown'").get()) {
      const exts = ['.pdf', ...KB_IMAGE_EXTENSIONS].map((ext) => `lower(path) LIKE '%${ext}'`).join(' OR ');
      this.db.exec(`UPDATE file SET mtime = 0 WHERE ${exts}`);
      this.db.prepare("INSERT OR REPLACE INTO meta VALUES ('ocrKnown', '1')").run();
    }
    // A PDF read before its scanned pages were OCR'd one by one kept those pages empty: the ones read
    // as text are read once more (their summaries stay — a re-read keeps them).
    if (!this.db.prepare("SELECT 1 FROM meta WHERE key = 'ocrPagesKnown'").get()) {
      this.db.exec("UPDATE file SET mtime = 0 WHERE lower(path) LIKE '%.pdf' AND ocr = 0 AND error = ''");
      this.db.prepare("INSERT OR REPLACE INTO meta VALUES ('ocrPagesKnown', '1')").run();
    }
    const schema = this.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as Row | undefined;
    if (!schema) this.db.prepare("INSERT INTO meta VALUES ('schema', ?)").run(KB_INDEX_SCHEMA_VERSION);
  }

  meta(key: string): string {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined;
    return String(row?.value ?? '');
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  close(): void {
    this.db.close();
  }

  files(): KbFileRow[] {
    return (this.db.prepare(`SELECT ${FILE_COLUMNS} FROM file ORDER BY path`).all() as Row[]).map(fileRow);
  }

  /** The file's own chunks (`ai` false) or its AI description's (`ai` true). */
  private dropChunks(fileId: number, part: 'all' | 'own' | 'ai' = 'all'): void {
    const where = part === 'all' ? '' : part === 'own' ? ` AND ord < ${KB_AI_ORD_BASE}` : ` AND ord >= ${KB_AI_ORD_BASE}`;
    const ids = (this.db.prepare(`SELECT id FROM chunk WHERE file = ?${where}`).all(fileId) as Row[]).map((row) => Number(row.id));
    const del = this.db.prepare('DELETE FROM fts WHERE rowid = ?');
    for (const id of ids) del.run(id);
    this.db.prepare(`DELETE FROM chunk WHERE file = ?${where}`).run(fileId);
  }

  private insertChunks(fileId: number, chunks: readonly KbChunk[], ordBase = 0): void {
    const insChunk = this.db.prepare('INSERT INTO chunk(file, ord, head, body) VALUES (?,?,?,?)');
    const insFts = this.db.prepare('INSERT INTO fts(rowid, head, body) VALUES (?,?,?)');
    for (const chunk of chunks) {
      const id = Number(insChunk.run(fileId, ordBase + chunk.ord, chunk.head, chunk.body).lastInsertRowid);
      insFts.run(id, bigramText(chunk.head), bigramText(chunk.body));
    }
  }

  private transaction(work: () => void): void {
    this.db.exec('BEGIN');
    try {
      work();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Writes one file's own chunks over what the index had for it, in one transaction. Its AI
   * description, if any, stays (and still answers searches) until analysed again or cleared.
   */
  putFile(path: string, mtime: number, size: number, chunks: readonly KbChunk[], error = '', ocr: KbOcrRead = 'none', cut?: KnowledgeCut): void {
    this.transaction(() => {
      const existing = this.db.prepare('SELECT id FROM file WHERE path = ?').get(path) as Row | undefined;
      let fileId: number;
      const chars = chunks.reduce((sum, chunk) => sum + chunk.body.length, 0);
      if (existing) {
        fileId = Number(existing.id);
        this.dropChunks(fileId, 'own');
        this.db.prepare('UPDATE file SET mtime = ?, size = ?, chars = ?, chunks = ?, error = ?, ocr = ?, cut = ? WHERE id = ?')
          .run(mtime, size, chars, chunks.length, error, OCR_READ.indexOf(ocr), cutText(cut), fileId);
      } else {
        const result = this.db.prepare('INSERT INTO file(path, mtime, size, chars, chunks, error, ocr, cut) VALUES (?,?,?,?,?,?,?,?)')
          .run(path, mtime, size, chars, chunks.length, error, OCR_READ.indexOf(ocr), cutText(cut));
        fileId = Number(result.lastInsertRowid);
      }
      this.insertChunks(fileId, chunks);
    });
  }

  /**
   * Stores a file's AI description and its chunks (after the file's own); '' clears it. False when
   * the file is not indexed. `sourceMtime` is the version the description was written from — the
   * file's mtime when the analysis read it, not when the answer came back: a file edited while the
   * model was answering keeps a description marked out of date.
   */
  setAi(path: string, text: string, chunks: readonly KbChunk[], model: string, at: number, sourceMtime?: number, cut?: KnowledgeCut): boolean {
    const row = this.fileByPath(path);
    if (!row) return false;
    this.transaction(() => {
      this.dropChunks(row.id, 'ai');
      this.db.prepare('UPDATE file SET ai = ?, ai_model = ?, ai_at = ?, ai_mtime = ?, ai_cut = ? WHERE id = ?')
        .run(text || null, text ? model : null, text ? at : 0, text ? sourceMtime ?? row.mtime : 0, text ? cutText(cut) : null, row.id);
      if (text) this.insertChunks(row.id, chunks, KB_AI_ORD_BASE);
    });
    return true;
  }

  /**
   * Every summary this index holds — on its files, and any still carried from an earlier rebuild —
   * for the index that replaces it (`carrySummaries`).
   */
  summariesToCarry(): KbCarriedSummary[] {
    const rows = this.db.prepare(`SELECT path, ai, ai_model AS model, ai_at AS at, ai_mtime AS mtime, ai_cut AS cut FROM file WHERE ai IS NOT NULL AND ai <> ''
      UNION ALL SELECT path, ai, model, at, mtime, cut FROM carried_ai`).all() as Row[];
    const byPath = new Map<string, KbCarriedSummary>();
    for (const row of rows) {
      const path = String(row.path);
      if (byPath.has(path)) continue;
      byPath.set(path, { path, text: String(row.ai), model: String(row.model ?? ''), at: Number(row.at ?? 0), sourceMtime: Number(row.mtime ?? 0), ...cutField('cut', row.cut) });
    }
    return [...byPath.values()];
  }

  /** Keeps these summaries until their files are read into this index (`takeCarriedSummary`). */
  carrySummaries(list: readonly KbCarriedSummary[]): void {
    if (list.length === 0) return;
    const insert = this.db.prepare('INSERT OR REPLACE INTO carried_ai(path, ai, model, at, mtime, cut) VALUES (?,?,?,?,?,?)');
    this.transaction(() => {
      for (const item of list) insert.run(item.path, item.text, item.model, item.at, item.sourceMtime, cutText(item.cut));
    });
  }

  /** The carried summary of this file, removed from the carry; undefined when there is none. */
  takeCarriedSummary(path: string): KbCarriedSummary | undefined {
    const row = this.db.prepare('SELECT path, ai, model, at, mtime, cut FROM carried_ai WHERE path = ?').get(path) as Row | undefined;
    if (!row) return undefined;
    this.db.prepare('DELETE FROM carried_ai WHERE path = ?').run(path);
    return { path, text: String(row.ai), model: String(row.model ?? ''), at: Number(row.at ?? 0), sourceMtime: Number(row.mtime ?? 0), ...cutField('cut', row.cut) };
  }

  aiText(path: string): string {
    const row = this.db.prepare('SELECT ai FROM file WHERE path = ?').get(path) as Row | undefined;
    return String(row?.ai ?? '');
  }

  /** The file's own text as indexed (its chunks' bodies, in order), up to `max` characters. */
  ownText(path: string, max: number): string {
    const row = this.fileByPath(path);
    if (!row) return '';
    const parts: string[] = [];
    let length = 0;
    for (const chunk of this.fileChunks(row.id, 0, KB_AI_ORD_BASE - 1)) {
      if (length >= max) break;
      parts.push(chunk.body);
      length += chunk.body.length + 2;
    }
    return parts.join('\n\n').slice(0, max);
  }

  removeFile(path: string): void {
    const existing = this.db.prepare('SELECT id FROM file WHERE path = ?').get(path) as Row | undefined;
    if (!existing) return;
    this.transaction(() => {
      this.dropChunks(Number(existing.id));
      this.db.prepare('DELETE FROM file WHERE id = ?').run(Number(existing.id));
    });
  }

  /**
   * The chunks that best answer any of `queries` (the person's words, the model's keywords),
   * fused by reciprocal rank so a chunk several queries find comes first.
   */
  search(queries: readonly string[], limit: number, only?: readonly string[]): KbHit[] {
    const scores = new Map<number, number>();
    const rank = this.db.prepare(`SELECT fts.rowid AS id FROM fts JOIN chunk ON chunk.id = fts.rowid JOIN file ON file.id = chunk.file
      WHERE fts MATCH ?1 AND ${LIVE} AND ${onlySql(2)} ORDER BY bm25(fts, 2.0, 1.0) LIMIT ?3`);
    for (const query of queries) {
      const match = ftsMatch(queryTerms(query));
      if (!match) continue;
      const rows = rank.all(match, onlyParam(only), PER_QUERY) as Row[];
      rows.forEach((row, index) => {
        const id = Number(row.id);
        scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + index + 1));
      });
    }
    const top = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const byId = new Map(this.chunks(top.map(([id]) => id)).map((row) => [row.id, row]));
    return top.flatMap(([id, score]) => {
      const row = byId.get(id);
      return row ? [{ ...row, score }] : [];
    });
  }

  chunks(ids: readonly number[]): KbChunkRow[] {
    if (ids.length === 0) return [];
    const marks = ids.map(() => '?').join(',');
    return (this.db.prepare(`SELECT chunk.*, file.path AS path FROM chunk JOIN file ON file.id = chunk.file WHERE chunk.id IN (${marks})`)
      .all(...ids) as Row[]).map(chunkRow);
  }

  /** A file's chunks from `fromOrd` to `toOrd`, inclusive, in order. */
  fileChunks(fileId: number, fromOrd = 0, toOrd = Number.MAX_SAFE_INTEGER): KbChunkRow[] {
    return (this.db.prepare('SELECT chunk.*, file.path AS path FROM chunk JOIN file ON file.id = chunk.file WHERE chunk.file = ? AND ord BETWEEN ? AND ? ORDER BY ord')
      .all(fileId, fromOrd, toOrd) as Row[]).map(chunkRow);
  }

  /** A file's chunks that can answer a question (`LIVE`), in order. */
  liveChunks(fileId: number): KbChunkRow[] {
    return (this.db.prepare(`SELECT chunk.*, file.path AS path FROM chunk JOIN file ON file.id = chunk.file WHERE chunk.file = ? AND ${LIVE} ORDER BY ord`)
      .all(fileId) as Row[]).map(chunkRow);
  }

  /** What a question could be handed from this index: its live chunks and their characters, headers included. */
  liveSize(only?: readonly string[]): { chunks: number; chars: number } {
    const row = this.db.prepare(`SELECT COUNT(*) AS chunks, COALESCE(SUM(LENGTH(chunk.head) + LENGTH(chunk.body)), 0) AS chars
      FROM chunk JOIN file ON file.id = chunk.file WHERE ${LIVE} AND ${onlySql(1)}`).get(onlyParam(only)) as Row;
    return { chunks: Number(row.chunks), chars: Number(row.chars) };
  }

  fileByPath(path: string): KbFileRow | undefined {
    const row = this.db.prepare(`SELECT ${FILE_COLUMNS} FROM file WHERE path = ?`).get(path) as Row | undefined;
    return row ? fileRow(row) : undefined;
  }

  totals(): { files: number; chunks: number; chars: number } {
    const row = this.db.prepare('SELECT COUNT(*) AS files, COALESCE(SUM(chunks), 0) AS chunks, COALESCE(SUM(chars), 0) AS chars FROM file').get() as Row;
    return { files: Number(row.files), chunks: Number(row.chunks), chars: Number(row.chars) };
  }
}
