/**
 * Read side of the law index (see lawIndexBuild.ts for the schema): finds laws by name, reads
 * articles, outlines a law's chapters, searches article text, lists recent amendments. Opened
 * read-only; every query is a few milliseconds, except a search with only one- or two-letter
 * words, which the trigram index cannot serve and scans (~0.2 s over everything).
 */
import { DatabaseSync } from 'node:sqlite';
import { LAW_INDEX_SCHEMA_VERSION } from './lawIndexBuild';
import { articleOrder, rankLawNames, type ArticleSpecItem, type LawNameEntry } from './lawText';

export interface LawRow extends LawNameEntry {
  pcode: string;
  source: 'law' | 'order';
  category: string;
  /** YYYYMMDD of the last amendment. */
  modified: string;
  articles: number;
}

export interface LawDetail extends LawRow {
  effectiveNote: string;
  engName: string;
  histories: string;
  foreword: string;
  attachments: { name: string; url: string }[];
}

export interface ArticleRow {
  law: number;
  no: string;
  chapter: string;
  body: string;
}

export interface SearchOptions {
  terms: readonly string[];
  lawIds?: readonly number[];
  includeOrders: boolean;
  includeAbolished: boolean;
  limit: number;
}

export interface IndexMeta {
  schema: string;
  builtAt: number;
  updates: Record<string, string>;
}

/** The trigram tokenizer matches words of three letters or more; shorter ones are scanned. */
const TRIGRAM_MIN = 3;

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function ftsPhrase(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

type Row = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

export class LawIndex {
  private readonly db: DatabaseSync;
  private readonly laws: LawRow[];
  private readonly byId = new Map<number, LawRow>();
  readonly meta: IndexMeta;

  constructor(file: string) {
    this.db = new DatabaseSync(file, { readOnly: true });
    try {
      const metaRows = this.db.prepare('SELECT key, value FROM meta').all() as Row[];
      const meta = new Map(metaRows.map((row) => [str(row.key), str(row.value)]));
      const updates: Record<string, string> = {};
      for (const [key, value] of meta) if (key.startsWith('update_')) updates[key.slice('update_'.length)] = value;
      this.meta = { schema: meta.get('schema') ?? '', builtAt: Number(meta.get('built_at') ?? 0), updates };
      if (this.meta.schema !== LAW_INDEX_SCHEMA_VERSION) throw new Error(`law index schema ${this.meta.schema || 'missing'}`);
      const rows = this.db.prepare('SELECT id, pcode, name, level, source, category, modified, abolished, articles FROM law').all() as Row[];
      this.laws = rows.map((row) => ({
        id: Number(row.id),
        pcode: str(row.pcode),
        name: str(row.name),
        level: str(row.level),
        source: str(row.source) === 'order' ? 'order' : 'law',
        category: str(row.category),
        modified: str(row.modified),
        abolished: Number(row.abolished) === 1,
        articles: Number(row.articles),
      }));
      for (const law of this.laws) this.byId.set(law.id, law);
    } catch (err) {
      this.db.close();
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }

  get lawCount(): number {
    return this.laws.length;
  }

  findLaws(query: string, limit: number): LawRow[] {
    return rankLawNames(query, this.laws, limit);
  }

  law(id: number): LawRow | undefined {
    return this.byId.get(id);
  }

  detail(id: number): LawDetail | undefined {
    const law = this.byId.get(id);
    if (!law) return undefined;
    const row = this.db.prepare('SELECT effective_note, eng_name, histories, foreword, attachments FROM law WHERE id = ?').get(id) as Row | undefined;
    let attachments: { name: string; url: string }[] = [];
    try {
      const parsed: unknown = JSON.parse(str(row?.attachments) || '[]');
      if (Array.isArray(parsed)) attachments = parsed.map((item: Row) => ({ name: str(item?.name), url: str(item?.url) }));
    } catch {
      attachments = [];
    }
    return {
      ...law,
      effectiveNote: str(row?.effective_note),
      engName: str(row?.eng_name),
      histories: str(row?.histories),
      foreword: str(row?.foreword),
      attachments,
    };
  }

  /** The articles in the given numbers and ranges, in the law's order. */
  articles(lawId: number, items: readonly ArticleSpecItem[], limit: number): ArticleRow[] {
    const stmt = this.db.prepare('SELECT no, chapter, body FROM art WHERE law = ? AND ord BETWEEN ? AND ? ORDER BY ord LIMIT ?');
    const seen = new Set<string>();
    const out: ArticleRow[] = [];
    for (const item of items) {
      const rows = stmt.all(lawId, articleOrder(item.from), articleOrder(item.to), limit) as Row[];
      for (const row of rows) {
        const no = str(row.no);
        if (seen.has(no) || out.length >= limit) continue;
        seen.add(no);
        out.push({ law: lawId, no, chapter: str(row.chapter), body: str(row.body) });
      }
    }
    return out;
  }

  /** Every article's number and chapter, in order: the law's outline. */
  articleList(lawId: number): { no: string; chapter: string }[] {
    const rows = this.db.prepare('SELECT no, chapter FROM art WHERE law = ? ORDER BY seq').all(lawId) as Row[];
    return rows.map((row) => ({ no: str(row.no), chapter: str(row.chapter) }));
  }

  /**
   * Articles whose text holds every term. Terms of three letters or more go through the index and
   * rank by bm25; shorter ones filter by scanning. With only short terms, laws come before orders.
   */
  search(options: SearchOptions): ArticleRow[] {
    const long = options.terms.filter((term) => Array.from(term).length >= TRIGRAM_MIN);
    const short = options.terms.filter((term) => Array.from(term).length < TRIGRAM_MIN);
    const where: string[] = [];
    const params: (string | number)[] = [];
    for (const term of short) {
      where.push("art.body LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(term)}%`);
    }
    if (!options.includeOrders) where.push("law.source = 'law'");
    if (!options.includeAbolished) where.push('law.abolished = 0');
    if (options.lawIds && options.lawIds.length > 0) {
      where.push(`art.law IN (${options.lawIds.map(() => '?').join(',')})`);
      params.push(...options.lawIds);
    }
    const filters = where.length > 0 ? ` AND ${where.join(' AND ')}` : '';
    let sql: string;
    let args: (string | number)[];
    if (long.length > 0) {
      sql = `SELECT art.law, art.no, art.chapter, art.body FROM fts JOIN art ON art.rowid = fts.rowid JOIN law ON law.id = art.law
        WHERE fts MATCH ?${filters} ORDER BY bm25(fts) LIMIT ?`;
      args = [long.map(ftsPhrase).join(' AND '), ...params, options.limit];
    } else {
      sql = `SELECT art.law, art.no, art.chapter, art.body FROM art JOIN law ON law.id = art.law
        WHERE 1 = 1${filters} ORDER BY law.source = 'order', law.id, art.seq LIMIT ?`;
      args = [...params, options.limit];
    }
    const rows = this.db.prepare(sql).all(...args) as Row[];
    return rows.map((row) => ({ law: Number(row.law), no: str(row.no), chapter: str(row.chapter), body: str(row.body) }));
  }

  /** Laws amended on or after a YYYYMMDD date, newest first. */
  recent(sinceYmd: string, includeOrders: boolean, limit: number): LawRow[] {
    return this.laws
      .filter((law) => law.modified >= sinceYmd && (includeOrders || law.source === 'law'))
      .sort((a, b) => b.modified.localeCompare(a.modified) || a.name.localeCompare(b.name))
      .slice(0, limit);
  }
}
