import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { isInsideDir } from './paths';

/** Checks and unpacking for downloaded tools; nothing here touches the network. */

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/** `SHA2-256SUMS` lines are `<hex>  <file name>`; a `*` before the name marks binary mode. */
export function parseSums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+)\s*$/i.exec(line.trim());
    if (match) sums.set(match[2], match[1].toLowerCase());
  }
  return sums;
}

/**
 * Throws unless `signature` is a valid detached signature over `sums` by `armoredKey`. openpgp is
 * loaded here, on first use, so it stays off the app's startup path.
 */
export async function verifySumsSignature(sums: Buffer, signature: Buffer, armoredKey: string): Promise<void> {
  const { createMessage, readKey, readSignature, verify } = await import('openpgp');
  const key = await readKey({ armoredKey });
  const sig = await readSignature({ binarySignature: new Uint8Array(signature) });
  const message = await createMessage({ binary: new Uint8Array(sums) });
  const result = await verify({ message, signature: sig, verificationKeys: key, expectSigned: true });
  // expectSigned already throws on a bad signature; the explicit check keeps that true if it ever changes.
  if (!result.signatures.length) throw new Error('SHA2-256SUMS carries no signature');
  await result.signatures[0].verified;
}

const S_IFMT = 0o170_000;
const S_IFLNK = 0o120_000;

/**
 * Unpacks a zip into `target`, keeping each entry's permission bits (the macOS and Linux builds
 * need their executable bits). Every entry is checked first: an absolute name, a `..` segment, a
 * path that resolves outside `target`, or a symlink rejects the whole archive before anything is
 * written.
 */
export function extractZipSafely(zipPath: string, target: string): void {
  const zip = new AdmZip(zipPath);
  const root = path.resolve(target);
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (!name || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..')) {
      throw new Error(`zip entry "${entry.entryName}" points outside the target folder`);
    }
    if (!isInsideDir(root, path.resolve(root, name))) {
      throw new Error(`zip entry "${entry.entryName}" points outside the target folder`);
    }
    if (((entry.header.attr >>> 16) & S_IFMT) === S_IFLNK) {
      throw new Error(`zip entry "${entry.entryName}" is a symbolic link`);
    }
  }
  zip.extractAllTo(root, true, true);
}

export async function gunzipFile(source: string, dest: string): Promise<void> {
  await pipeline(createReadStream(source), createGunzip(), createWriteStream(dest));
}
