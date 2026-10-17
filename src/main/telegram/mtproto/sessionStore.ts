import * as fs from 'node:fs/promises';
import { writeFileAtomic } from '../../atomicWrite';
import { decryptTokenChecked, encryptToken } from '../../configEncryption';
import { telegramUploadSessionPath } from './sessionPath';

/**
 * The bot's MTProto session (its auth key) between app starts, so the bot signs in once rather
 * than on every start. The whole file is one safeStorage ciphertext; inside it the session
 * string sits beside a fingerprint of the API id, API hash and bot token it was made with, so a
 * change to any of them throws the session away instead of reusing another bot's key.
 * Callers serialize access (the uploader's queue), as atomic writes to one file require.
 */

export interface StoredUploadSession {
  fingerprint: string;
  session: string;
}

const VERSION = 1;

export interface UploadSessionStore {
  load(): Promise<StoredUploadSession | null>;
  save(value: StoredUploadSession): Promise<void>;
  remove(): Promise<void>;
}

function parse(plaintext: string): StoredUploadSession | null {
  try {
    const raw = JSON.parse(plaintext) as Partial<StoredUploadSession> & { v?: unknown };
    if (raw.v !== VERSION || typeof raw.fingerprint !== 'string' || typeof raw.session !== 'string') return null;
    if (!raw.fingerprint || !raw.session) return null;
    return { fingerprint: raw.fingerprint, session: raw.session };
  } catch {
    return null;
  }
}

export function createUploadSessionStore(filePath: () => string = telegramUploadSessionPath): UploadSessionStore {
  return {
    async load() {
      const stored = await fs.readFile(filePath(), 'utf-8').catch(() => '');
      if (!stored) return null;
      // Unreadable (another OS key, a damaged file) only costs one more sign-in.
      const { value, failed } = decryptTokenChecked(stored.trim(), 'telegram.uploadSession');
      if (failed || !value) return null;
      return parse(value);
    },
    async save(value) {
      const plaintext = JSON.stringify({ v: VERSION, fingerprint: value.fingerprint, session: value.session });
      await writeFileAtomic(filePath(), encryptToken(plaintext));
    },
    async remove() {
      await fs.rm(filePath(), { force: true });
    },
  };
}
