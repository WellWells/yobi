import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { app, clipboard, nativeImage } from 'electron';
import {
  ATTACHMENT_STASH_MAX_BYTES,
  type AttachmentStashRequest,
  type StashedAttachment,
} from '../shared/types';

const STASH_DIR = 'yobi-attachments';
const STASH_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_STEM = 64;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const RESERVED_PUNCTUATION = /[<>:"|?*]/g;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/pdf': '.pdf',
  'application/json': '.json',
};

const EXTENSION_MIMES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
};

export function mimeTypeForName(name: string): string {
  return EXTENSION_MIMES[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

// SECURITY: the result is joined onto the stash directory, so it must stay a leaf name —
// no separators, no traversal, no control characters, no reserved punctuation, never empty.
export function sanitizeStashName(raw: string, mimeType: string): string {
  const leaf = (raw ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = leaf
    .replace(CONTROL_CHARS, '')
    .replace(RESERVED_PUNCTUATION, '-')
    .replace(/^\.+/, '')
    .trim();
  const ext = path.extname(cleaned).toLowerCase() || MIME_EXTENSIONS[mimeType] || '.bin';
  const stem = path.basename(cleaned, path.extname(cleaned)).slice(0, MAX_STEM).trim();
  return `${stem || 'attachment'}${ext}`;
}

export function stashFileName(safeName: string, token: string): string {
  const ext = path.extname(safeName);
  return `${path.basename(safeName, ext)}-${token}${ext}`;
}

function stashRoot(): string {
  return path.join(app.getPath('temp'), STASH_DIR);
}

async function pruneStash(dir: string): Promise<void> {
  const cutoff = Date.now() - STASH_TTL_MS;
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isFile() || stat.mtimeMs >= cutoff) return;
    await fs.rm(full, { force: true }).catch(() => {});
  }));
}

export async function writeStashFile(
  dir: string,
  request: AttachmentStashRequest,
): Promise<StashedAttachment> {
  const bytes = Buffer.from(request.data);
  if (bytes.byteLength === 0) throw new Error('Attachment is empty');
  if (bytes.byteLength > ATTACHMENT_STASH_MAX_BYTES) throw new Error('Attachment is too large');

  const mimeType = request.mimeType || 'application/octet-stream';
  const safeName = sanitizeStashName(request.name, mimeType);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, stashFileName(safeName, randomBytes(6).toString('hex')));
  await fs.writeFile(target, bytes);
  return { path: target, name: path.basename(target), size: bytes.byteLength, mimeType };
}

export async function stashAttachmentBytes(request: AttachmentStashRequest): Promise<StashedAttachment> {
  const dir = stashRoot();
  const written = await writeStashFile(dir, request);
  await pruneStash(dir);
  return written;
}

export async function attachmentFromClipboard(): Promise<StashedAttachment | null> {
  const copied = clipboardFilePath();
  if (copied) {
    const stat = await fs.stat(copied).catch(() => null);
    if (stat?.isFile()) {
      const name = path.basename(copied);
      const mimeType = mimeTypeForName(name);
      return { path: copied, name, size: stat.size, mimeType, preview: thumbnail(copied, mimeType) };
    }
  }

  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  const stashed = await stashAttachmentBytes({
    name: 'pasted-image.png',
    mimeType: 'image/png',
    data: image.toPNG(),
  });
  return { ...stashed, preview: thumbnail(stashed.path, stashed.mimeType) };
}

function thumbnail(filePath: string, mimeType: string): string | undefined {
  if (!mimeType.startsWith('image/')) return undefined;
  try {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return undefined;
    return image.resize({ height: 64, quality: 'good' }).toDataURL();
  } catch {
    return undefined;
  }
}

function clipboardFilePath(): string {
  if (process.platform !== 'win32') return '';
  try {
    const raw = clipboard.readBuffer('FileNameW');
    if (!raw || raw.byteLength === 0) return '';
    return raw.toString('ucs2').replace(/\0.*$/, '').trim();
  } catch {
    return '';
  }
}
