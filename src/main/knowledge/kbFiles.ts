/**
 * A knowledge base's files as its page manages them: the list (what is on disk, joined with what the
 * index read), adding files (copied into the folder — the originals stay where they were — under a
 * free name; the folder watcher then reads them, by OCR where needed), and removing files (to the
 * Recycle Bin, so a wrong click can be undone in the file manager). Every file is named by the base's
 * id and a path relative to its folder, and only used when it resolves inside that folder — also
 * through links (`resolveKbFile`).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { KnowledgeBase } from '../../shared/knowledgeBase';
import type { KnowledgeFile, KnowledgeFilePreview, KnowledgeImportResult } from '../../shared/knowledgeStatus';
import { isKbFile, KB_MAX_FILE_BYTES } from './kbExtract';
import type { KbFileRow } from './kbIndex';
import type { KbFolderFile } from './kbSync';

/** The file `rel` names inside the base's folder, when it is a document there (real path included). */
export function resolveKbFile(kb: KnowledgeBase, rel: unknown): string | null {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
  const root = path.resolve(kb.folder);
  const file = path.resolve(root, ...rel.split('/'));
  if (!file.startsWith(root + path.sep) || !isKbFile(file)) return null;
  try {
    // The real path too: a link inside the folder must not lead out of it.
    const real = fs.realpathSync(file);
    const realRoot = fs.realpathSync(root);
    return real.startsWith(realRoot + path.sep) && fs.statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

/** A picture or PDF past these is not previewed (the page offers to open it instead). */
export const KB_PREVIEW_IMAGE_MAX = 20 * 1024 * 1024;
export const KB_PREVIEW_PDF_MAX = 60 * 1024 * 1024;

const PREVIEW_IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp',
};

/**
 * One file's preview, read only from a path `resolveKbFile` accepted (inside the base's folder,
 * real path included). Other types are previewed as the text the index read.
 */
export async function readKbPreview(file: string): Promise<KnowledgeFilePreview> {
  const ext = path.extname(file).toLowerCase();
  const image = PREVIEW_IMAGE_TYPES[ext];
  if (!image && ext !== '.pdf') return { kind: 'text' };
  const { size } = await fs.promises.stat(file);
  if (size > (image ? KB_PREVIEW_IMAGE_MAX : KB_PREVIEW_PDF_MAX)) return { kind: 'tooLarge' };
  const bytes = await fs.promises.readFile(file);
  return image
    ? { kind: 'image', dataUrl: `data:${image};base64,${bytes.toString('base64')}` }
    : { kind: 'pdf', data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
}

/** Disk and index joined: a file on disk the index has not read yet is `pending`. */
export function joinKbFiles(onDisk: readonly KbFolderFile[], indexed: readonly KbFileRow[]): KnowledgeFile[] {
  const rows = new Map(indexed.map((row) => [row.path, row]));
  return onDisk.map((file): KnowledgeFile => {
    const row = rows.get(file.rel);
    const current = row && row.mtime === file.mtime && row.size === file.size;
    let read: KnowledgeFile['read'] = 'pending';
    if (row && current) read = row.error ? 'none' : row.ocr === 'full' ? 'ocr' : row.ocr === 'partial' ? 'ocrPartial' : 'text';
    return {
      path: file.rel,
      size: file.size,
      mtime: file.mtime,
      created: file.created ?? file.mtime,
      read,
      chars: row?.chars ?? 0,
      error: current ? row.error : '',
      ai: row && row.aiChars > 0
        ? { chars: row.aiChars, model: row.aiModel, at: row.aiAt, stale: row.aiMtime !== file.mtime }
        : null,
    };
  });
}

/** `name.pdf`, else `name (2).pdf`, `name (3).pdf`… — the first one not in `folder`. */
export function freeName(folder: string, name: string, exists: (file: string) => boolean = fs.existsSync): string {
  if (!exists(path.join(folder, name))) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!exists(path.join(folder, candidate))) return candidate;
  }
}

/**
 * Copies the files into the base's folder (its top level), each under a free name. Folders and
 * files a base does not read are skipped; a file already inside the folder is not copied again.
 */
export async function importIntoKb(kb: KnowledgeBase, sources: readonly unknown[]): Promise<KnowledgeImportResult> {
  const result: KnowledgeImportResult = { added: 0, skipped: 0, failed: 0 };
  const root = path.resolve(kb.folder);
  for (const source of sources) {
    if (typeof source !== 'string' || !path.isAbsolute(source)) {
      result.skipped += 1;
      continue;
    }
    try {
      const stat = await fs.promises.stat(source);
      // Past the size a base reads: copying it would only add a file nothing can search.
      const tooLarge = stat.size > KB_MAX_FILE_BYTES;
      if (!stat.isFile() || !isKbFile(source) || tooLarge || path.resolve(source).startsWith(root + path.sep)) {
        result.skipped += 1;
        continue;
      }
      const target = path.join(root, freeName(root, path.basename(source)));
      await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      result.added += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

/** Moves the files to the Recycle Bin; returns how many went. Paths outside the folder are ignored. */
export async function deleteKbFiles(kb: KnowledgeBase, rels: readonly unknown[], trash: (file: string) => Promise<void>): Promise<number> {
  let removed = 0;
  for (const rel of rels) {
    const file = resolveKbFile(kb, rel);
    if (!file) continue;
    try {
      await trash(file);
      removed += 1;
    } catch {
      // Held open by another program: it stays, and stays listed.
    }
  }
  return removed;
}
