import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import { guardedFetch } from '../net/ssrfGuard';
import { safeResolveWithin } from '../backup/fsUtils';
import { isSkippedName } from './skillFiles';

/** A whole repository archive (anthropics/skills is 4.3 MB); far above any skill, far below a disk problem. */
export const SKILL_DOWNLOAD_MAX_BYTES = 100 * 1_048_576;
/** Unpacked, for the same archive: a zip bomb stops here, before anything is written. */
export const SKILL_UNPACK_MAX_BYTES = 300 * 1_048_576;
export const SKILL_ARCHIVE_MAX_ENTRIES = 20_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export class SkillArchiveError extends Error {
  constructor(readonly reason: 'download' | 'tooLarge' | 'badArchive' | 'notFound', message: string) {
    super(message);
    this.name = 'SkillArchiveError';
  }
}

export interface GithubSkillUrl {
  owner: string;
  repo: string;
  /**
   * The words after `tree/` or `blob/`: a ref and then a path, with no telling where one ends —
   * a branch may hold slashes. Empty for the repository root (its default branch).
   */
  rest: string[];
  /** `blob/` names a file, so the skill is the folder it sits in. */
  file: boolean;
}

/** github.com URLs a skill is shared as: the repository, a folder (`tree/`) or its SKILL.md (`blob/`). */
export function parseGithubSkillUrl(raw: string): GithubSkillUrl | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const isRaw = /^raw\.githubusercontent\.com$/i.test(url.hostname);
  if (!isRaw && !/^(www\.)?github\.com$/i.test(url.hostname)) return null;
  let parts: string[];
  try {
    parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  if (parts.length < 2 || parts.some((part) => part === '..' || part === '.')) return null;
  // raw.githubusercontent.com/<owner>/<repo>/<ref…>/<path>/SKILL.md: a file, like blob/.
  if (isRaw) {
    const [owner, repo, ...rest] = parts;
    return rest.length >= 2 ? { owner, repo, rest, file: true } : null;
  }
  const [owner, rawRepo, kind, ...rest] = parts;
  const repo = rawRepo.replace(/\.git$/i, '');
  if (parts.length === 2) return { owner, repo, rest: [], file: false };
  if ((kind !== 'tree' && kind !== 'blob') || rest.length === 0) return null;
  return { owner, repo, rest, file: kind === 'blob' };
}

/** Each way the words could split into a ref and a path, the shortest ref first (most branches have no slash). */
export function githubRefCandidates(rest: readonly string[], file: boolean): { ref: string; dir: string }[] {
  if (rest.length === 0) return [{ ref: 'HEAD', dir: '' }];
  const out: { ref: string; dir: string }[] = [];
  for (let cut = 1; cut <= Math.min(3, rest.length); cut += 1) {
    const pathParts = rest.slice(cut);
    // A blob names a file: the skill is its folder.
    const dirParts = file ? pathParts.slice(0, -1) : pathParts;
    if (file && pathParts.length === 0) continue;
    out.push({ ref: rest.slice(0, cut).join('/'), dir: dirParts.join('/') });
  }
  return out;
}

export function githubArchiveUrl(owner: string, repo: string, ref: string): string {
  return `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/${ref.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Downloads to a file, counting bytes as they arrive: a missing or false Content-Length cannot
 * get past `SKILL_DOWNLOAD_MAX_BYTES`. Every hop is checked for a public address (`guardedFetch`).
 * Resolves false on 404, so a caller trying ref splits can move on to the next.
 */
export async function downloadSkillArchive(url: string, dest: string, fetchImpl: typeof guardedFetch = guardedFetch): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetchImpl(url, { signal: controller.signal, headers: { 'User-Agent': 'Yobi' } });
    } catch (err) {
      throw new SkillArchiveError('download', err instanceof Error ? err.message : String(err));
    }
    if (res.status === 404) return false;
    if (!res.ok || !res.body) throw new SkillArchiveError('download', `HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > SKILL_DOWNLOAD_MAX_BYTES) throw new SkillArchiveError('tooLarge', `${declared} bytes`);
    const chunks: Buffer[] = [];
    let received = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > SKILL_DOWNLOAD_MAX_BYTES) {
        controller.abort();
        throw new SkillArchiveError('tooLarge', `over ${SKILL_DOWNLOAD_MAX_BYTES} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, Buffer.concat(chunks));
    return true;
  } catch (err) {
    if (err instanceof SkillArchiveError) throw err;
    throw new SkillArchiveError('download', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

/** Unix mode bits a zip made on macOS or Linux keeps in the entry's external attributes. */
function isLinkEntry(entry: AdmZip.IZipEntry): boolean {
  return ((entry.attr >>> 16) & 0o170000) === 0o120000;
}

/**
 * Unpacks a zip into `destDir`. `stripTop` drops the one folder a GitHub archive wraps everything
 * in (`skills-HEAD/`); `within` keeps only entries under that path (after stripping). Links, `..`
 * paths and the names a skill never carries are skipped; the sizes are checked before writing.
 */
export async function extractSkillArchive(
  zipFile: string,
  destDir: string,
  options: { stripTop?: boolean; within?: string } = {},
): Promise<void> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipFile);
  } catch (err) {
    throw new SkillArchiveError('badArchive', err instanceof Error ? err.message : String(err));
  }
  const entries = zip.getEntries();
  if (entries.length > SKILL_ARCHIVE_MAX_ENTRIES) throw new SkillArchiveError('tooLarge', `${entries.length} entries`);
  const within = (options.within ?? '').replace(/^\/+|\/+$/g, '');
  const wanted: { entry: AdmZip.IZipEntry; rel: string }[] = [];
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory || isLinkEntry(entry)) continue;
    let rel = entry.entryName.replace(/\\/g, '/');
    if (options.stripTop) rel = rel.split('/').slice(1).join('/');
    if (within) {
      if (!rel.toLowerCase().startsWith(`${within.toLowerCase()}/`)) continue;
      rel = rel.slice(within.length + 1);
    }
    if (!rel || rel.split('/').some((part) => isSkippedName(part))) continue;
    total += entry.header.size;
    if (total > SKILL_UNPACK_MAX_BYTES) throw new SkillArchiveError('tooLarge', 'unpacked size');
    wanted.push({ entry, rel });
  }
  if (wanted.length === 0) throw new SkillArchiveError('notFound', within || 'empty archive');
  await fs.mkdir(destDir, { recursive: true });
  for (const { entry, rel } of wanted) {
    const dest = safeResolveWithin(destDir, rel);
    if (!dest || dest === path.resolve(destDir)) continue;
    let data: Buffer;
    try {
      data = entry.getData();
    } catch (err) {
      throw new SkillArchiveError('badArchive', err instanceof Error ? err.message : String(err));
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data);
  }
}
