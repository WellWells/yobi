import { safeStorage } from 'electron';

/**
 * Every stored secret is `enc:v1:` + base64 of a safeStorage ciphertext, or the plaintext itself
 * where the OS offers no key. Electron 45 deprecated the synchronous safeStorage calls and 46
 * removes them, so encrypting and decrypting are asynchronous here, while the config and the
 * secret stores are read synchronously all over main. This module keeps what it has decrypted
 * and encrypted: `openSecrets` decrypts ahead of the synchronous reads (each store at boot, a
 * backup's config before it is read), and `encryptSecret` remembers the ciphertext it made,
 * which `sealedToken` hands back to a synchronous writer. The asynchronous calls use the same OS
 * key as the old ones, so ciphertext written by earlier versions opens unchanged.
 */

const ENCRYPTED_PREFIX = 'enc:v1:';
const UNAVAILABLE_ON_WRITE = '[config] safeStorage unavailable — secret stored as plaintext. Install libsecret on Linux to enable OS-level encryption.';

/** null until the OS has been asked. */
let availability: boolean | null = null;
/** Ciphertext → plaintext, for everything opened or encrypted this session. */
const opened = new Map<string, string>();
/** Ciphertext the OS key could not decrypt the last time it was tried. */
const unreadable = new Set<string>();
/** Plaintext → the ciphertext to store for it (the newest one made, else the one it was read from). */
const sealed = new Map<string, string>();
const sealing = new Map<string, Promise<string>>();
const inFlight = new Set<Promise<unknown>>();

export function isEncryptedSecret(stored: unknown): stored is string {
  return typeof stored === 'string' && stored.startsWith(ENCRYPTED_PREFIX);
}

/** Every stored ciphertext anywhere inside a JSON value (a store's contents, a backup's config). */
export function collectEncryptedSecrets(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (isEncryptedSecret(value)) out.add(value);
  else if (Array.isArray(value)) for (const item of value) collectEncryptedSecrets(item, out);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectEncryptedSecrets(item, out);
  return out;
}

/** Asks the OS again: on Linux the keyring can come up after the app does, on macOS access can be granted mid-session. */
export async function refreshSecretCipher(): Promise<boolean> {
  availability = await safeStorage.isAsyncEncryptionAvailable().catch(() => false);
  return availability;
}

/** The last answer `refreshSecretCipher` got; false until it has asked. */
export function secretCipherAvailable(): boolean {
  return availability === true;
}

/** Counts `work` toward `secretWritesSettled` (an encryption and the save that waits on it). */
export function trackSecretWrite<T>(work: Promise<T>): Promise<T> {
  inFlight.add(work);
  const settle = (): void => {
    inFlight.delete(work);
  };
  work.then(settle, settle);
  return work;
}

export function hasPendingSecretWrites(): boolean {
  return inFlight.size > 0;
}

/** Resolves once every encryption started so far, and every write waiting on one, has finished. */
export async function secretWritesSettled(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}

async function osDecrypt(stored: string): Promise<string> {
  return (await safeStorage.decryptStringAsync(Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64'))).result;
}

function warnUnavailable(label: string): void {
  console.warn(`[config] safeStorage unavailable — cannot decrypt ${label}. Install libsecret on Linux or check OS keychain access.`);
}

function warnUnreadable(label: string): void {
  console.warn(`[config] Failed to decrypt ${label} — OS keychain may have changed. It will be inaccessible until re-entered.`);
}

async function decryptOne(stored: string): Promise<void> {
  try {
    const result = await osDecrypt(stored);
    opened.set(stored, result);
    unreadable.delete(stored);
    if (!sealed.has(result)) sealed.set(result, stored);
  } catch {
    unreadable.add(stored);
  }
}

/**
 * Decrypts every ciphertext in `value` not opened yet, so `decryptTokenChecked` can answer for it.
 * One that failed before is tried again. Does nothing to them while the OS has no key to offer.
 */
export async function openSecrets(value: unknown): Promise<void> {
  const pending = [...collectEncryptedSecrets(value)].filter((stored) => !opened.has(stored));
  if (!(await refreshSecretCipher()) || pending.length === 0) return;
  await Promise.all(pending.map(decryptOne));
}

/**
 * The ciphertext to store for `plaintext`; concurrent calls for one value share the work, and a
 * value encrypted before reuses its ciphertext unless `fresh` (a re-encryption sweep) asks for a
 * new one. Without an OS key the plaintext itself is stored, as the synchronous version did.
 */
export function encryptSecret(plaintext: string, options: { fresh?: boolean } = {}): Promise<string> {
  if (!plaintext) return Promise.resolve('');
  if (!options.fresh) {
    const known = sealed.get(plaintext);
    if (known) return Promise.resolve(known);
    const running = sealing.get(plaintext);
    if (running) return running;
  }
  const work = (async (): Promise<string> => {
    if (!(await refreshSecretCipher())) {
      console.warn(UNAVAILABLE_ON_WRITE);
      return plaintext;
    }
    const stored = ENCRYPTED_PREFIX + (await safeStorage.encryptStringAsync(plaintext)).toString('base64');
    sealed.set(plaintext, stored);
    opened.set(stored, plaintext);
    return stored;
  })();
  sealing.set(plaintext, work);
  const settle = (): void => {
    if (sealing.get(plaintext) === work) sealing.delete(plaintext);
  };
  work.then(settle, settle);
  return trackSecretWrite(work);
}

/**
 * For a synchronous writer: the ciphertext `encryptSecret` or `openSecrets` already has for
 * `plaintext`, the plaintext itself when the OS has no key, or null when it has not been
 * encrypted yet (the caller starts `encryptSecret` and writes again once it resolves).
 */
export function sealedToken(plaintext: string): string | null {
  if (!plaintext) return '';
  const known = sealed.get(plaintext);
  if (known) return known;
  if (availability === false) {
    console.warn(UNAVAILABLE_ON_WRITE);
    return plaintext;
  }
  return null;
}

/** Reads a stored secret that `openSecrets` (or an encryption this session) has already handled. */
export function decryptTokenChecked(stored: string, label = 'token'): { value: string; failed: boolean } {
  if (!stored) return { value: '', failed: false };
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return { value: stored, failed: false };
  const value = opened.get(stored);
  if (value !== undefined) return { value, failed: false };
  if (!secretCipherAvailable()) {
    warnUnavailable(label);
  } else if (unreadable.has(stored)) {
    warnUnreadable(label);
  } else {
    console.warn(`[config] ${label} was read before it was decrypted — no openSecrets call covered it.`);
  }
  return { value: '', failed: true };
}

export function decryptToken(stored: string, label = 'token'): string {
  return decryptTokenChecked(stored, label).value;
}

/**
 * Decrypts one stored secret on its own, asking the OS every time, for asynchronous readers that
 * hold just that one (a file read when it is needed). Nothing is kept: no synchronous read follows.
 */
export async function openSecretChecked(stored: string, label = 'token'): Promise<{ value: string; failed: boolean }> {
  if (!stored) return { value: '', failed: false };
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return { value: stored, failed: false };
  if (!(await refreshSecretCipher())) {
    warnUnavailable(label);
    return { value: '', failed: true };
  }
  try {
    return { value: await osDecrypt(stored), failed: false };
  } catch {
    warnUnreadable(label);
    return { value: '', failed: true };
  }
}
