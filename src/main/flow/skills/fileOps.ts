import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import * as path from 'node:path';
import * as os from 'node:os';
import { getOutputDir } from '../../files';
import { sendLog } from '../../helpers';
import { ensureHttpScheme } from '../../urlParser';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dateToken(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function timeToken(d: Date): string {
  return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function randToken(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function expandFilenameTokens(name: string): string {
  const d = new Date();
  return name
    .replace(/\{datetime\}/g, `${dateToken(d)}-${timeToken(d)}`)
    .replace(/\{date\}/g, dateToken(d))
    .replace(/\{time\}/g, timeToken(d))
    .replace(/\{rand\}/g, randToken());
}

function autoFileName(): string {
  const d = new Date();
  return `file-${dateToken(d)}-${timeToken(d)}-${randToken()}.txt`;
}

function ensureTxtExt(name: string): string {
  return path.extname(name) ? name : `${name}.txt`;
}

export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export async function resolveUserPath(raw: string): Promise<string> {
  const expanded = expandHome(raw);
  return path.isAbsolute(expanded) ? expanded : path.join(await getOutputDir(), expanded);
}

/**
 * Exported because the agent sandbox has to predict this EXACTLY. Resolving `folder` and
 * `filename` any other way is a bypass: an absolute `filename` makes `folder` irrelevant, and
 * the `..`-segment filter below only ever sees the filename.
 */
export async function resolveWritePath(folderRaw: string, filenameRaw: string): Promise<string> {
  const expanded = filenameRaw ? expandFilenameTokens(filenameRaw) : autoFileName();
  if (path.isAbsolute(expanded)) {
    const base = sanitizeDownloadName(path.basename(expanded)) || autoFileName();
    return path.join(path.dirname(expanded), ensureTxtExt(base));
  }
  const segments = expanded
    .split(/[\\/]+/)
    .filter((s) => s && s !== '.' && s !== '..')
    .map((s) => sanitizeDownloadName(s))
    .filter(Boolean);
  const relative = segments.length > 0 ? ensureTxtExt(segments.join(path.sep)) : autoFileName();
  const dir = folderRaw ? await resolveUserPath(folderRaw) : await getOutputDir();
  return path.join(dir, relative);
}

/**
 * The first free `name-2.txt`, `name-3.txt`… for a `noClobber` write. Bounded, because a caller
 * that has collided a thousand times has a naming problem, not a disk problem.
 */
async function freeSiblingPath(resolved: string): Promise<string> {
  const dir = path.dirname(resolved);
  const ext = path.extname(resolved);
  const stem = path.basename(resolved, ext);
  for (let n = 2; n <= 1_000; n++) {
    const candidate = path.join(dir, `${stem}-${n}${ext}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error(`too many files named like ${path.basename(resolved)}`);
}

export async function execFileWrite(config: Record<string, string>): Promise<string> {
  const content = config.content ?? '';
  try {
    let resolved = await resolveWritePath((config.folder ?? '').trim(), (config.filename ?? '').trim());
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    // `noClobber` is set by `/agent`, never by a flow: a flow author who names a file means that
    // file, but the agent picks names from a model and must not silently truncate one that
    // already exists.
    if (config.noClobber === 'true') {
      try {
        await fs.access(resolved);
        resolved = await freeSiblingPath(resolved);
      } catch {
        // Nothing there — the chosen name is free.
      }
    }
    await fs.writeFile(resolved, content, 'utf-8');
    sendLog(`📝 [Flow] File written: ${resolved}`);
    return resolved;
  } catch (err) {
    throw new Error(`file_write: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function execFileRead(config: Record<string, string>): Promise<string> {
  const filePath = (config.path ?? '').trim();
  if (!filePath) return '';
  try {
    const resolved = await resolveUserPath(filePath);
    const content = await fs.readFile(resolved, 'utf-8');
    sendLog(`📖 [Flow] File read: ${resolved} (${content.length} chars)`);
    return content;
  } catch (err) {
    throw new Error(`file_read: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function execFileList(config: Record<string, string>): Promise<string> {
  const dir = (config.directory ?? '').trim();
  if (!dir) return '[]';
  try {
    const resolved = await resolveUserPath(dir);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const items = entries
      .filter((entry) => entry.isFile())
      .map((entry) => ({ title: entry.name, link: path.join(resolved, entry.name) }));
    sendLog(`📁 [Flow] Listed ${items.length} files in: ${resolved}`);
    return JSON.stringify(items);
  } catch (err) {
    throw new Error(`file_list: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function execFileDelete(config: Record<string, string>): Promise<string> {
  const target = (config.path ?? '').trim();
  if (!target) return '';
  try {
    const resolved = await resolveUserPath(target);
    await fs.rm(resolved, { force: true });
    sendLog(`🗑️ [Flow] File deleted: ${resolved}`);
    return '';
  } catch (err) {
    throw new Error(`file_delete: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const MIME_EXT: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg',
  'application/pdf': '.pdf', 'application/zip': '.zip', 'application/json': '.json', 'application/xml': '.xml',
  'text/plain': '.txt', 'text/csv': '.csv', 'text/html': '.html', 'text/markdown': '.md',
  'video/mp4': '.mp4', 'audio/mpeg': '.mp3',
};

export function deriveDownloadExt(finalUrl: string, contentType: string): string {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (MIME_EXT[mime]) return MIME_EXT[mime];
  try {
    const urlExt = path.extname(new URL(finalUrl).pathname);
    if (urlExt && urlExt.length <= 6) return urlExt;
  } catch {
  }
  return '.bin';
}

export function sanitizeDownloadName(name: string): string {
  return path.basename(name).replace(/[<>:"/\\|?*]/g, '_').replace(/^\.+/, '').trim();
}

function autoDownloadName(ext: string): string {
  const d = new Date();
  return `file-${dateToken(d)}-${timeToken(d)}-${randToken()}${ext}`;
}

export async function execFileDownload(config: Record<string, string>, timeoutMs: number): Promise<string> {
  const url = ensureHttpScheme(config.url ?? '');
  if (!url) return '';
  if (!/^https:\/\//i.test(url)) throw new Error(`file_download: only https:// URLs are allowed (got "${url}")`);

  const parsedMax = Number((config.maxSizeMb ?? '').trim());
  const maxSizeMb = Number.isFinite(parsedMax) && parsedMax >= 0 ? Math.floor(parsedMax) : 100;
  const maxBytes = maxSizeMb > 0 ? maxSizeMb * 1024 * 1024 : 0;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  let partPath = '';
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    if (!res.body) throw new Error('empty response body');
    const contentType = res.headers.get('content-type') ?? '';
    const declaredLen = Number(res.headers.get('content-length') ?? '');
    if (maxBytes > 0 && Number.isFinite(declaredLen) && declaredLen > maxBytes) {
      throw new Error(`file exceeds max size ${maxSizeMb} MB`);
    }
    const finalUrl = res.url || url;

    const requested = (config.filename ?? '').trim();
    let baseName = requested ? sanitizeDownloadName(expandFilenameTokens(requested)) : '';
    if (baseName && !path.extname(baseName)) baseName += deriveDownloadExt(finalUrl, contentType);
    if (!baseName) baseName = autoDownloadName(deriveDownloadExt(finalUrl, contentType));

    const folderRaw = (config.folder ?? '').trim();
    const dir = folderRaw ? await resolveUserPath(folderRaw) : await getOutputDir();
    await fs.mkdir(dir, { recursive: true });
    const resolved = path.join(dir, baseName);
    partPath = `${resolved}.part`;

    const out = createWriteStream(partPath);
    let bytes = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        bytes += chunk.length;
        if (maxBytes > 0 && bytes > maxBytes) throw new Error(`file exceeds max size ${maxSizeMb} MB`);
        if (!out.write(chunk)) await once(out, 'drain');
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    } catch (streamErr) {
      out.destroy();
      throw streamErr;
    }

    await fs.rename(partPath, resolved);
    partPath = '';
    sendLog(`⬇️ [Flow] Downloaded ${(bytes / 1024).toFixed(0)} KB → ${resolved}`);
    return resolved;
  } catch (err) {
    if (partPath) await fs.rm(partPath, { force: true }).catch(() => { });
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`file_download: timed out after ${Math.ceil(timeoutMs / 1_000)}s`);
    }
    throw new Error(`file_download: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}
