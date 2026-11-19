/**
 * Builds the law index file from the Ministry of Justice's JSON exports, in a worker thread: the
 * two files are 26 MB and 112 MB of JSON and 220k articles, which take ~20 s and ~250 MB of heap
 * to index (measured) — far too long to hold the main process.
 *
 * Schema (version in `meta`): `law` one row per law or order, `art` one row per article with the
 * chapter path it sits under, `fts` an FTS5 trigram index over the article text (`detail=full`:
 * phrase matching and bm25 ranking need it; `column`/`none` saved only 7–27% and lose both).
 */
import { Worker } from 'node:worker_threads';

export const LAW_INDEX_SCHEMA_VERSION = '1';

/** One downloaded export: which file it was and its JSON text as bytes. */
export interface LawExportPart {
  source: 'law' | 'order';
  json: Uint8Array;
}

export interface LawBuildResult {
  laws: number;
  articles: number;
  /** Each export's own UpdateDate, as it wrote it. */
  updates: Record<string, string>;
}

const BUILD_TIMEOUT_MS = 5 * 60_000;

// Plain JavaScript: it runs as the worker's source (eval), where nothing is bundled or imported.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const LEVELS = { '編': 0, '章': 1, '節': 2, '款': 3, '目': 4 };
function headingLevel(text) {
  const m = /^第\\s*[\\d零〇一二三四五六七八九十百千]+\\s*([編章節款目])/.exec(text);
  return m ? LEVELS[m[1]] : 5;
}
try {
  const { out, parts, builtAt, schema } = workerData;
  const db = new DatabaseSync(out);
  db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
  db.exec(\`
    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE law(id INTEGER PRIMARY KEY, pcode TEXT, name TEXT, level TEXT, source TEXT, category TEXT,
      modified TEXT, effective_note TEXT, abolished INTEGER, eng_name TEXT, histories TEXT, foreword TEXT,
      attachments TEXT, articles INTEGER);
    CREATE TABLE art(rowid INTEGER PRIMARY KEY, law INTEGER, seq INTEGER, no TEXT, ord INTEGER, chapter TEXT, body TEXT);
    CREATE INDEX art_law ON art(law, ord);
    CREATE VIRTUAL TABLE fts USING fts5(body, content='art', content_rowid='rowid', tokenize='trigram', detail=full);
  \`);
  const insLaw = db.prepare('INSERT INTO law VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const insArt = db.prepare('INSERT INTO art VALUES (?,?,?,?,?,?,?)');
  const insMeta = db.prepare('INSERT INTO meta VALUES (?,?)');
  const updates = {};
  let lawId = 0;
  let artId = 0;
  db.exec('BEGIN');
  for (const part of parts) {
    const doc = JSON.parse(Buffer.from(part.json).toString('utf8').replace(/^\\uFEFF/, ''));
    updates[part.source] = String(doc.UpdateDate || '');
    for (const law of doc.Laws || []) {
      lawId += 1;
      const pcode = (/pcode=([A-Za-z0-9]+)/.exec(String(law.LawURL || '')) || [])[1] || '';
      let stack = [];
      let seq = 0;
      let count = 0;
      for (const a of law.LawArticles || []) {
        const text = String(a.ArticleContent || '');
        if (a.ArticleType === 'C') {
          const heading = text.trim().replace(/\\s+/g, ' ');
          const level = headingLevel(heading);
          stack = stack.filter((h) => h.level < level).concat([{ level, heading }]);
          continue;
        }
        const m = /(\\d+)(?:\\s*-\\s*(\\d+))?/.exec(String(a.ArticleNo || ''));
        if (!m) continue;
        const main = Number(m[1]);
        const sub = m[2] ? Number(m[2]) : 0;
        artId += 1;
        seq += 1;
        count += 1;
        insArt.run(artId, lawId, seq, sub ? main + '-' + sub : String(main), main * 1000 + sub,
          stack.map((h) => h.heading).join(' > '), text);
      }
      insLaw.run(lawId, pcode, String(law.LawName || ''), String(law.LawLevel || ''), part.source,
        String(law.LawCategory || ''), String(law.LawModifiedDate || ''), String(law.LawEffectiveNote || ''),
        law.LawAbandonNote ? 1 : 0, String(law.EngLawName || ''), String(law.LawHistories || ''),
        String(law.LawForeword || ''), JSON.stringify((law.LawAttachements || []).map((f) => ({ name: f.FileName, url: f.FileURL }))), count);
    }
  }
  db.exec("INSERT INTO fts(fts) VALUES('rebuild')");
  insMeta.run('schema', schema);
  insMeta.run('built_at', String(builtAt));
  for (const [source, value] of Object.entries(updates)) insMeta.run('update_' + source, value);
  db.exec('COMMIT');
  db.close();
  parentPort.postMessage({ ok: true, laws: lawId, articles: artId, updates });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
}
`;

interface WorkerReply {
  ok: boolean;
  laws?: number;
  articles?: number;
  updates?: Record<string, string>;
  error?: string;
}

/** Writes a complete index to `out` (a new file); rejects, leaving whatever it wrote, on failure. */
export async function buildLawIndex(parts: readonly LawExportPart[], out: string, builtAt: number): Promise<LawBuildResult> {
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { out, parts, builtAt, schema: LAW_INDEX_SCHEMA_VERSION },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<LawBuildResult>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('building the law index took too long')), BUILD_TIMEOUT_MS);
      worker.once('message', (reply: WorkerReply) => {
        if (reply?.ok) resolve({ laws: reply.laws ?? 0, articles: reply.articles ?? 0, updates: reply.updates ?? {} });
        else reject(new Error(reply?.error ?? 'building the law index failed'));
      });
      worker.once('error', (err) => reject(err instanceof Error ? err : new Error(String(err))));
      worker.once('exit', (code) => {
        if (code !== 0) reject(new Error(`the law index worker exited (code ${code})`));
      });
    });
  } finally {
    if (timer) clearTimeout(timer);
    void worker.terminate();
  }
}
