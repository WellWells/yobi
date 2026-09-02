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

// Exported for the test suite, which cleans up after the copies it makes.
export function clipboardStageRoot(): string {
  return path.join(os.tmpdir(), STAGE_DIR);
}

/**
 * A whole directory per copy, rather than one file per name.
 *
 * The file name is what the user sees after pasting, so it has to stay exactly what they
 * typed — which means it cannot carry a uniquing token. But the path also has to be
 * immutable: a paste hands the receiving app a REFERENCE, read when that app gets round
 * to it, and Yobi's own composer is one of those apps. Exporting the same document twice
 * would otherwise rewrite bytes an already-attached message is still pointing at, and the
 * thumbnail beside it would go on showing the first version. Uniquing the directory keeps
 * both properties.
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

/**
 * What the clipboard read back after the write.
 *
 * Electron drops an entry it cannot encode without raising anything, so the write is still
 * read back — but that read is no longer allowed to FAIL the copy. Two things changed:
 * the file half is a plain string that always encodes, so an empty read now indicts the
 * READ rather than the write; and on a platform that keeps only one representation, the
 * other one is still there and still does the job the user asked for.
 */
export type ClipboardCopyOutcome = 'ok' | 'fileOnly' | 'unverified';

/**
 * Every spelling that means "the picture landed".
 *
 * Measured on macOS 2026-08-30: Electron only synthesises the `image/png` alias while the
 * image is ALONE on the pasteboard. Declare a file in the same entry and the entry is
 * classified as a file item — the alias vanishes and `clipboard.has('image/png')` goes
 * false — while the PNG itself is still sitting there under its native flavour (read back:
 * 163 bytes, magic 89504e47, decodes 1x1; macOS adds a TIFF rendition beside it that
 * `nativeImage` cannot decode, so it is NOT evidence of anything). Matching on the web MIME
 * type alone therefore reported `fileOnly` on a Mac where BOTH halves had gone through,
 * which is what "the copy button does nothing" turned out to be: a false warning.
 */
export const PNG_LANDED_TYPES = [
  'image/png',
  'electron application/osclipboard;format="Apple PNG pasteboard type"',
] as const;

// Exported for the test suite: this is the whole decision, and it is worth pinning down
// separately from the OS behaviour that feeds it.
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

  // One entry, both representations: the file is what a desktop or a file manager
  // accepts, and for a plain PNG the image bytes ride along so a chat or a document
  // still pastes the picture inline. Measured on Windows: the OS ranks the image
  // formats ahead of the file list, so an app that takes either still takes the image.
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
