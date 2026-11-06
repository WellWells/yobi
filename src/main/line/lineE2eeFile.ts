/**
 * Opening LINE's E2EE media and files: what the preview and the tests read back.
 *
 * Layout: ciphertext ‖ HMAC-SHA256(32). Keys come from HKDF-SHA256(keyMaterial, info="FileEncryption")
 * → encKey(32) ‖ macKey(32) ‖ nonce(12); the cipher is AES-256-CTR with the 12-byte nonce left-aligned
 * in a 16-byte counter block starting at 0. The keyMaterial travels inside the sealed message, so
 * LINE's server only ever holds ciphertext.
 *
 * A video is MACed in chunks so LINE's players can check it while streaming: the ciphertext is cut
 * into 128 KiB chunks and the MAC is HMAC-SHA256(macKey, SHA-256(chunk 1)‖SHA-256(chunk 2)‖…).
 * Decryption accepts either.
 */
import { createDecipheriv, createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

const INFO = Buffer.from('FileEncryption');

/** The chunk size of a video's MAC (LINE's apps: 131072). */
export const FILE_MAC_CHUNK = 128 << 10;
/** The HMAC-SHA256 tag at the end of every blob. */
export const FILE_MAC_LEN = 32;

interface FileKeys {
  encKey: Buffer;
  macKey: Buffer;
  iv: Buffer;
}

function deriveKeys(km: Buffer): FileKeys {
  const d = Buffer.from(hkdfSync('sha256', km, Buffer.alloc(0), INFO, 76));
  const iv = Buffer.alloc(16);
  d.subarray(64, 76).copy(iv); // 12-byte nonce, left-aligned; low 4 bytes are the CTR counter from 0
  return { encKey: d.subarray(0, 32), macKey: d.subarray(32, 64), iv };
}

/** SHA-256 of each 128 KiB chunk of `b`, concatenated: what a video's MAC covers. */
export function chunkHashes(b: Buffer): Buffer {
  const out: Buffer[] = [];
  for (let at = 0; at < b.length; at += FILE_MAC_CHUNK) {
    out.push(createHash('sha256').update(b.subarray(at, at + FILE_MAC_CHUNK)).digest());
  }
  return Buffer.concat(out);
}

function tagMatches(macKey: Buffer, covered: Buffer, tag: Buffer): boolean {
  const mac = createHmac('sha256', macKey).update(covered).digest();
  return mac.length === tag.length && timingSafeEqual(mac, tag);
}

/**
 * Decrypts `blob` (ciphertext‖mac) with the message's base64 keyMaterial. The MAC covers the
 * ciphertext or, for a video as LINE's apps send it, its chunk hashes; neither = a MAC mismatch.
 */
export function decryptE2EEFile(keyMaterialB64: string, blob: Buffer): Buffer {
  // Too short to hold the tag reads as a MAC mismatch, in line-cli's words (a decrypt_failed note).
  if (blob.length < FILE_MAC_LEN) throw new Error('e2ee file: MAC mismatch');
  const { encKey, macKey, iv } = deriveKeys(Buffer.from(keyMaterialB64, 'base64'));
  const body = blob.subarray(0, blob.length - FILE_MAC_LEN);
  const tag = blob.subarray(blob.length - FILE_MAC_LEN);
  if (!tagMatches(macKey, body, tag) && !tagMatches(macKey, chunkHashes(body), tag)) throw new Error('e2ee file: MAC mismatch');
  const decipher = createDecipheriv('aes-256-ctr', encKey, iv);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

