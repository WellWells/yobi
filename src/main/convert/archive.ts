/**
 * Several files in one .zip and text as a QR code, for `export_file`. Both are made in memory and
 * kept by the caller like any answer file.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import AdmZip from 'adm-zip';

/** Past this the archive is not one a chat sends (Telegram's Bot API takes 50 MB). */
export const ZIP_MAX_BYTES = 200 * 1024 * 1024;
export const ZIP_MAX_FILES = 100;

/** A name per file inside the archive: the file's own, "a (2).jpg" for the second "a.jpg". */
export function zipEntryNames(files: readonly string[]): string[] {
  const used = new Set<string>();
  return files.map((file) => {
    const { name, ext } = path.parse(file);
    let candidate = `${name}${ext}`;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** The .zip bytes of `files`, each at the archive's top level. Throws a message for the model past the limits. */
export async function zipFiles(files: readonly string[]): Promise<Buffer> {
  if (files.length > ZIP_MAX_FILES) throw new Error(`A zip holds ${ZIP_MAX_FILES} files at most.`);
  let total = 0;
  const zip = new AdmZip();
  const names = zipEntryNames(files);
  for (const [i, file] of files.entries()) {
    const data = await fs.readFile(file);
    total += data.length;
    if (total > ZIP_MAX_BYTES) throw new Error(`The files are larger than ${ZIP_MAX_BYTES / 1024 / 1024} MB together.`);
    zip.addFile(names[i], data);
  }
  return zip.toBufferPromise();
}

/** About what a phone camera still reads at 512 px; longer text makes a denser code. */
export const QR_MAX_CHARS = 1_000;

/** `text` as a QR code PNG. Throws a message for the model when it is empty or too long. */
export async function qrPng(text: string): Promise<Buffer> {
  const value = text.trim();
  if (!value) throw new Error('Write the text or link the QR code should hold in "content".');
  if (Array.from(value).length > QR_MAX_CHARS) throw new Error(`A QR code holds ${QR_MAX_CHARS} characters at most here; shorten "content" (a link is best).`);
  // Loaded on first use: it is not needed on any start-up path.
  const QRCode = await import('qrcode');
  return QRCode.toBuffer(value, { type: 'png', errorCorrectionLevel: 'M', margin: 4, width: 512 });
}
