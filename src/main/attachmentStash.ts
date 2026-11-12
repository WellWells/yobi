import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { app, nativeImage } from 'electron';
import { clipboardBytes, readClipboardItems } from './clipboard';
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

export function stashRoot(): string {
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
  const copied = await clipboardFilePath();
  if (copied) {
    const stat = await fs.stat(copied).catch(() => null);
    if (stat?.isFile()) {
      const name = path.basename(copied);
      const mimeType = mimeTypeForName(name);
      return { path: copied, name, size: stat.size, mimeType, preview: thumbnail(copied, mimeType) };
    }
  }

  const png = await clipboardImagePng();
  if (!png) return null;
  const stashed = await stashAttachmentBytes({
    name: 'pasted-image.png',
    mimeType: 'image/png',
    data: png,
  });
  return { ...stashed, preview: thumbnail(stashed.path, stashed.mimeType) };
}

async function clipboardImagePng(): Promise<Uint8Array<ArrayBuffer> | null> {
  for (const item of await readClipboardItems()) {
    if (!item.types.includes('image/png')) continue;
    const bytes = await clipboardBytes(item, 'image/png');
    if (bytes && bytes.byteLength > 0) return bytes;
  }
  return null;
}

export function thumbnail(filePath: string, mimeType: string): string | undefined {
  if (!mimeType.startsWith('image/')) return undefined;
  try {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return undefined;
    return image.resize({ height: 64, quality: 'good' }).toDataURL();
  } catch {
    return undefined;
  }
}

// macOS carries a copied file as its own pasteboard type, which has no MIME spelling and
// so arrives through the raw-format escape hatch. It holds the same file:// URL.
const FILE_URL_TYPES = [
  'text/uri-list',
  'electron application/osclipboard;format="public.file-url"',
];

/**
 * Every file and folder a file manager copied, in the order it listed them. One copy of several
 * files is a single uri-list on Windows; the macOS fallback type holds one URL per item, so the
 * items are walked and the same path met twice is kept once.
 */
export async function clipboardFilePaths(): Promise<string[]> {
  const paths: string[] = [];
  for (const item of await readClipboardItems()) {
    for (const type of FILE_URL_TYPES) {
      if (!item.types.includes(type)) continue;
      const bytes = await clipboardBytes(item, type);
      if (!bytes) continue;
      const listed = filePathsFromUriList(Buffer.from(bytes).toString('utf-8'));
      if (listed.length === 0) continue;
      for (const entry of listed) if (!paths.includes(entry)) paths.push(entry);
      break;
    }
  }
  return paths;
}

async function clipboardFilePath(): Promise<string> {
  return (await clipboardFilePaths())[0] ?? '';
}

/**
 * The message box's paste-the-path key. A copied file comes back as its path for the box to
 * insert; anything else is pasted here the ordinary way, because the page cannot start a paste
 * itself and nothing on macOS binds that key to one (the Edit menu pastes on Cmd+V and
 * Cmd+Option+Shift+V).
 */
export async function copiedPathsOrPaste(
  sender: Pick<Electron.WebContents, 'isDestroyed' | 'paste'>,
): Promise<string[]> {
  const paths = await clipboardFilePaths();
  if (paths.length === 0 && !sender.isDestroyed()) sender.paste();
  return paths;
}

// A copied file arrives as a percent-encoded file:// URL, which keeps non-ASCII names intact.
// Anything that is not a file:// URL (a link copied from a browser) is ignored.
export function filePathsFromUriList(text: string): string[] {
  const paths: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const uri = line.trim();
    if (!uri || uri.startsWith('#')) continue;
    if (!uri.toLowerCase().startsWith('file:')) continue;
    try {
      paths.push(fileURLToPath(uri));
    } catch {
      continue;
    }
  }
  return paths;
}
