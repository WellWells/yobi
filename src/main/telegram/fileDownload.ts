import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BOT_MEDIA_MAX_BYTES } from '../botChat/attachmentPlan';
import { botMediaTempDir, safeLocalFileName } from '../botChat/mediaTemp';

export {
  botMediaTempDir as telegramTempDir,
  deleteTempAttachments,
  readTextAttachment,
  safeLocalFileName,
  sweepOrphanTempAttachments,
} from '../botChat/mediaTemp';

const FETCH_TIMEOUT_MS = 60_000;
const TELEGRAM_FILE_ORIGIN = 'https://api.telegram.org';

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
    const bytes = await readCappedBody(res, BOT_MEDIA_MAX_BYTES);
    if (!bytes) throw new Error('Telegram file exceeded the download limit');
    if (bytes.byteLength === 0) throw new Error('Telegram file download was empty');

    const dir = botMediaTempDir();
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(dir, safeLocalFileName(request.originalName, request.fallbackExt));
    await fs.writeFile(dest, bytes);
    return dest;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
