import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TELEGRAM_MAX_DOWNLOAD_BYTES } from './attachmentPlan';

const FETCH_TIMEOUT_MS = 60_000;
const TEMP_DIR_NAME = 'yobi-telegram-media';
const ORPHAN_MAX_AGE_MS = 6 * 60 * 60 * 1_000;
const TELEGRAM_FILE_ORIGIN = 'https://api.telegram.org';

export function telegramTempDir(): string {
  return path.join(os.tmpdir(), TEMP_DIR_NAME);
}

// SECURITY: the incoming name is attacker-controlled. Always generate the stem and keep
// only a short alphanumeric extension, so traversal and control characters stay impossible.
export function safeLocalFileName(originalName: string | undefined, fallbackExt: string): string {
  const raw = (originalName ?? '').trim().toLowerCase();
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  const candidate = dot > 0 ? base.slice(dot + 1) : '';
  const ext = /^[a-z0-9]{1,12}$/.test(candidate) ? candidate : fallbackExt;
  return `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
}

// SECURITY: filePath is remote input interpolated into a URL — check it, never assume it.
// Reject traversal segments and scheme smuggling, and require the assembled URL to still
// point at the intended host.
export function buildTelegramFileUrl(token: string, filePath: string): string {
  const clean = filePath.trim();
  if (!clean || !/^[A-Za-z0-9_\-./]+$/.test(clean)) {
    throw new Error('Telegram returned an unusable file_path');
  }
  if (clean.startsWith('/') || clean.split('/').includes('..')) {
    throw new Error('Telegram returned an unusable file_path');
  }
  const url = new URL(`${TELEGRAM_FILE_ORIGIN}/file/bot${token}/${clean}`);
  if (url.origin !== TELEGRAM_FILE_ORIGIN) {
    throw new Error('Telegram file URL did not resolve to the API origin');
  }
  return url.toString();
}

async function readCappedBody(res: Response, cap: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const body = res.body;
  if (!body) {
    const whole = Buffer.from(await res.arrayBuffer());
    return whole.byteLength > cap ? null : whole;
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export interface TelegramDownloadRequest {
  token: string;
  filePath: string;
  originalName?: string;
  fallbackExt: string;
}

export async function downloadTelegramFile(request: TelegramDownloadRequest): Promise<string> {
  const url = buildTelegramFileUrl(request.token, request.filePath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'error', signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Telegram file download failed: HTTP ${res.status}`);
    }
    const bytes = await readCappedBody(res, TELEGRAM_MAX_DOWNLOAD_BYTES);
    if (!bytes) throw new Error('Telegram file exceeded the download limit');
    if (bytes.byteLength === 0) throw new Error('Telegram file download was empty');

    const dir = telegramTempDir();
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(dir, safeLocalFileName(request.originalName, request.fallbackExt));
    await fs.writeFile(dest, bytes);
    return dest;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function readTextAttachment(filePath: string): Promise<string | null> {
  const bytes = await fs.readFile(filePath);
  const head = bytes.subarray(0, 8_192);
  if (head.includes(0)) return null;
  return bytes.toString('utf8');
}

export async function deleteTempAttachments(paths: readonly string[]): Promise<void> {
  const dir = telegramTempDir();
  await Promise.all(paths.map(async (target) => {
    const resolved = path.resolve(target);
    if (path.dirname(resolved) !== path.resolve(dir)) return;
    await fs.rm(resolved, { force: true }).catch(() => {});
  }));
}

export async function sweepOrphanTempAttachments(): Promise<number> {
  const dir = telegramTempDir();
  let removed = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const cutoff = Date.now() - ORPHAN_MAX_AGE_MS;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(dir, entry.name);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || stat.mtimeMs > cutoff) continue;
      await fs.rm(full, { force: true }).catch(() => {});
      removed += 1;
    }
  } catch {
  }
  return removed;
}
