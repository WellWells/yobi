/**
 * Keeps the law index on disk and open: downloads the Ministry of Justice's two exports (laws
 * ~6 MB, orders ~25 MB zipped, no key), builds the index in a worker into a hidden temporary file
 * beside the real one and renames it over, and rebuilds a week later in the background while the
 * old index keeps answering. Concurrent callers share one build. Dependencies are parameters, so
 * the tests run it offline.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import AdmZip from 'adm-zip';
import { buildLawIndex, type LawBuildResult, type LawExportPart } from './lawIndexBuild';
import { LawIndex } from './lawIndex';

/** The Ministry of Justice's open data exports (全國法規資料庫 API, JSON). */
export const LAW_EXPORTS = [
  { source: 'law', url: 'https://law.moj.gov.tw/api/Ch/Law/JSON' },
  { source: 'order', url: 'https://law.moj.gov.tw/api/Ch/Order/JSON' },
] as const;

export { LAW_DIR_NAME } from './lawPaths';
const INDEX_FILE = 'laws.db';
const TEMP_PREFIX = '.laws-';
const TEMP_SUFFIX = '.tmp';

/** The exports are refreshed weekly at most; a week-old index is rebuilt in the background. */
export const LAW_REFRESH_MS = 7 * 24 * 3_600_000;
/** After a failed rebuild, the next try waits this long (a broken site is not hit on every call). */
export const LAW_RETRY_MS = 3_600_000;
const DOWNLOAD_TIMEOUT_MS = 3 * 60_000;
/** Both zips are well under this; anything bigger is not the export. */
const DOWNLOAD_MAX_BYTES = 200 * 1024 * 1024;

export type LawFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface LawStoreDeps {
  dir: string;
  fetchFn?: LawFetch;
  now?: () => number;
  log?: (line: string) => void;
  build?: (parts: readonly LawExportPart[], out: string, builtAt: number) => Promise<LawBuildResult>;
}

export interface LawStoreStatus {
  state: 'empty' | 'building' | 'ready' | 'failed';
  builtAt?: number;
  updates?: Record<string, string>;
  error?: string;
}

async function download(fetchFn: LawFetch, url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > DOWNLOAD_MAX_BYTES) throw new Error(`${url} sent ${body.length} bytes, more than an export can be`);
    return body;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error(`downloading ${url} timed out`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** The JSON file inside an export zip, inflated off the main thread. */
function unzipJson(zipBytes: Buffer, url: string): Promise<Buffer> {
  const zip = new AdmZip(zipBytes);
  const entry = zip.getEntries().find((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.json'));
  if (!entry) return Promise.reject(new Error(`no JSON file in the export from ${url}`));
  return new Promise((resolve, reject) => {
    entry.getDataAsync((data, err) => (err ? reject(new Error(`unzipping ${url}: ${err}`)) : resolve(data)));
  });
}

export class LawStore {
  private readonly dir: string;
  private readonly fetchFn: LawFetch;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly build: NonNullable<LawStoreDeps['build']>;
  private index: LawIndex | null = null;
  private building: Promise<LawIndex> | null = null;
  private lastFailure: { at: number; error: string } | null = null;

  constructor(deps: LawStoreDeps) {
    this.dir = deps.dir;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => {});
    this.build = deps.build ?? buildLawIndex;
  }

  get file(): string {
    return path.join(this.dir, INDEX_FILE);
  }

  status(): LawStoreStatus {
    if (this.index) return { state: this.building ? 'building' : 'ready', builtAt: this.index.meta.builtAt, updates: this.index.meta.updates };
    if (this.building) return { state: 'building' };
    if (this.lastFailure) return { state: 'failed', error: this.lastFailure.error };
    return { state: 'empty' };
  }

  /**
   * The open index. The first call opens the file, or downloads and builds it (tens of seconds);
   * a week-old index answers at once and is rebuilt in the background.
   */
  async ready(): Promise<LawIndex> {
    if (!this.index) this.index = this.openExisting();
    if (this.index) {
      this.refreshIfStale();
      return this.index;
    }
    return this.rebuild();
  }

  /** Starts preparing the index without waiting (the connector being switched on). */
  prepare(): void {
    this.ready().catch(() => {});
  }

  close(): void {
    this.index?.close();
    this.index = null;
  }

  private openExisting(): LawIndex | null {
    if (!fs.existsSync(this.file)) return null;
    try {
      return new LawIndex(this.file);
    } catch (err) {
      this.log(`[tw-law] index unreadable, rebuilding: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private refreshIfStale(): void {
    if (!this.index || this.building) return;
    const now = this.now();
    if (now - this.index.meta.builtAt < LAW_REFRESH_MS) return;
    if (this.lastFailure && now - this.lastFailure.at < LAW_RETRY_MS) return;
    this.rebuild().catch(() => {});
  }

  private rebuild(): Promise<LawIndex> {
    if (this.building) return this.building;
    if (!this.index && this.lastFailure && this.now() - this.lastFailure.at < LAW_RETRY_MS) {
      return Promise.reject(new Error(this.lastFailure.error));
    }
    this.building = this.runBuild()
      .then((index) => {
        this.lastFailure = null;
        return index;
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : String(err);
        this.lastFailure = { at: this.now(), error };
        this.log(`[tw-law] building the index failed: ${error}`);
        throw err;
      })
      .finally(() => {
        this.building = null;
      });
    return this.building;
  }

  private async runBuild(): Promise<LawIndex> {
    fs.mkdirSync(this.dir, { recursive: true });
    this.removeLeftoverTemps();
    const started = this.now();
    this.log('[tw-law] downloading the law exports');
    const parts: LawExportPart[] = [];
    for (const { source, url } of LAW_EXPORTS) {
      const zipBytes = await download(this.fetchFn, url);
      parts.push({ source, json: await unzipJson(zipBytes, url) });
    }
    const temp = path.join(this.dir, `${TEMP_PREFIX}${randomBytes(6).toString('hex')}${TEMP_SUFFIX}`);
    try {
      const result = await this.build(parts, temp, this.now());
      // Windows cannot rename over a file that is still open: close the old index first. Queries
      // are synchronous, so none is between statements here.
      this.close();
      fs.renameSync(temp, this.file);
      const index = new LawIndex(this.file);
      this.index = index;
      this.log(`[tw-law] index ready: ${result.laws} laws, ${result.articles} articles in ${Math.round((this.now() - started) / 1_000)} s`);
      return index;
    } catch (err) {
      fs.rmSync(temp, { force: true });
      // A failed rename left no index open; the old file, if any, is still whole.
      if (!this.index) this.index = this.openExisting();
      throw err;
    }
  }

  private removeLeftoverTemps(): void {
    for (const name of fs.readdirSync(this.dir)) {
      if (name.startsWith(TEMP_PREFIX) && name.endsWith(TEMP_SUFFIX)) fs.rmSync(path.join(this.dir, name), { force: true });
    }
  }
}
