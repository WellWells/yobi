import { ClipboardItem, clipboard } from 'electron';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { randomBytes } from 'node:crypto';
import AdmZip from 'adm-zip';
import { captureRidesAsImage } from '../shared/types';
import { sendLog } from './helpers';

const STAGE_DIR = 'yobi-clipboard';
const STAGE_TTL_MS = 24 * 60 * 60 * 1_000;

export function zipSingleFile(buffer: Buffer, entryName: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(entryName, buffer);
  return zip.toBuffer();
}

export function clipboardStageRoot(): string {
  return path.join(os.tmpdir(), STAGE_DIR);
}

/**
 * A unique directory per copy: the file name must stay exactly what the user typed, and a pasted
 * path must never be rewritten while an app (Yobi's composer included) still points at it.
 */
async function stageForClipboard(bytes: Buffer, fileName: string): Promise<string> {
  const root = clipboardStageRoot();
  const dir = path.join(root, randomBytes(6).toString('hex'));
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, bytes);
  void pruneStage(root);
  return filePath;
}

// Nothing can know when a paste is finally over, so staged copies are kept for a day and
// swept on the next one. Best-effort throughout: a failed sweep must never fail a copy.
async function pruneStage(root: string): Promise<void> {
  const cutoff = Date.now() - STAGE_TTL_MS;
  const entries = await fs.readdir(root).catch(() => [] as string[]);
  await Promise.all(entries.map(async (entry) => {
    const full = path.join(root, entry);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat || stat.mtimeMs >= cutoff) return;
    await fs.rm(full, { recursive: true, force: true }).catch(() => {});
  }));
}

/**
 * RFC 2483: `file://` URIs separated by CRLF. Electron maps this one MIME type onto each
 * OS's own file format — CF_HDROP on Windows, NSFilenamesPboardType on macOS, plain
 * text/uri-list on Linux — so a single write is what makes the capture pasteable in
 * Explorer and in Finder alike. `pathToFileURL` percent-encodes, so spaces and non-ASCII
 * names survive.
 */
function fileUriList(filePath: string): string {
  return `${pathToFileURL(filePath).href}\r\n`;
}

/** Puts files that already exist on the clipboard as files, the way Explorer's Copy does. */
export async function writeFilesToClipboard(filePaths: readonly string[]): Promise<void> {
  if (filePaths.length === 0) return;
  await clipboard.write([new ClipboardItem({ 'text/uri-list': filePaths.map(fileUriList).join('') })]);
}

/**
 * What the clipboard read back after the write. Electron silently drops entries it cannot
 * encode, so the write is read back, but a short read never fails the copy: the file half
 * always encodes, and a platform that keeps one representation still has the other.
 */
export type ClipboardCopyOutcome = 'ok' | 'fileOnly' | 'unverified';

/**
 * Every clipboard type that means the PNG landed. On macOS, once a file shares the entry,
 * Electron drops the `image/png` alias but the native PNG flavour is still there.
 */
export const PNG_LANDED_TYPES = [
  'image/png',
  'electron application/osclipboard;format="Apple PNG pasteboard type"',
] as const;

// The copy-outcome decision, separate from the OS behaviour that feeds it.
export function resolveCopyOutcome(
  landedTypes: readonly string[],
  wantsImage: boolean,
): ClipboardCopyOutcome {
  if (!landedTypes.includes('text/uri-list')) return 'unverified';
  const pictureLanded = PNG_LANDED_TYPES.some((type) => landedTypes.includes(type));
  if (wantsImage && !pictureLanded) return 'fileOnly';
  return 'ok';
}

async function landedTypes(): Promise<string[]> {
  const items = await clipboard.read().catch(() => []);
  return items.flatMap((item) => item.types);
}

export async function writeCaptureToClipboard(
  buffer: Buffer,
  ext: string,
  fileStem: string,
  zip: boolean,
): Promise<ClipboardCopyOutcome> {
  const outExt = zip ? 'zip' : ext;
  const bytes = zip ? zipSingleFile(buffer, `${fileStem}.${ext}`) : buffer;
  const tmpPath = await stageForClipboard(bytes, `${fileStem}.${outExt}`);

  // One entry, both representations: the file for desktops and file managers, the PNG bytes so
  // chats and documents paste the picture inline (Windows ranks image formats ahead of files).
  const asImage = captureRidesAsImage(ext, zip);
  const entry: Record<string, Blob | string> = { 'text/uri-list': fileUriList(tmpPath) };
  if (asImage) entry['image/png'] = new Blob([new Uint8Array(bytes)], { type: 'image/png' });

  await clipboard.write([new ClipboardItem(entry)]);

  const landed = await landedTypes();
  const outcome = resolveCopyOutcome(landed, asImage);
  if (outcome === 'ok') {
    sendLog(
      `📋 ${outExt.toUpperCase()} copied to clipboard${asImage ? ' as an image and' : ' as'} `
      + `a file: ${tmpPath}`,
    );
    return outcome;
  }
  // The types are the diagnosis. Which representations an OS keeps when several are
  // written at once is not knowable from any other machine, so say what came back.
  sendLog(
    `⚠️ ${outExt.toUpperCase()} written to the clipboard, but it read back `
    + `[${landed.join(', ') || 'nothing'}] — the file is at ${tmpPath}`,
  );
  return outcome;
}
