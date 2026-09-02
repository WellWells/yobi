import { safeStorage } from 'electron';
import Store from 'electron-store';
import { getConfigDir } from './configPaths';
import { encryptToken } from './configEncryption';
import type { SecretFailure, SecretHealth, SecretKeyState, SecretScope } from '../shared/types';

/**
 * Known plaintext encrypted with the same OS key as every real secret. Decrypting it
 * separates "this one blob is broken" from "the OS key changed and nothing will ever
 * decrypt again" — only the second warrants telling the user everything is gone.
 */
const CANARY_PLAINTEXT = 'yobi-secret-canary-v1';
const ENCRYPTED_PREFIX = 'enc:v1:';

interface HealthStoreShape {
  canary: string;
}

let store: Store<HealthStoreShape> | null = null;

function getStore(): Store<HealthStoreShape> {
  if (!store) {
    store = new Store<HealthStoreShape>({ name: 'secret-health', cwd: getConfigDir(), defaults: { canary: '' } });
  }
  return store;
}

const failures = new Map<string, SecretFailure>();
let keyState: SecretKeyState = 'unknown';
let listener: ((health: SecretHealth) => void) | null = null;

function failureKey(scope: SecretScope, id: string, field: string): string {
  return `${scope} ${id} ${field}`;
}

export function setSecretHealthListener(fn: (health: SecretHealth) => void): void {
  listener = fn;
}

/**
 * Read live rather than cached: on Linux the keyring can come up after the app does, and on
 * macOS access can be granted mid-session. A stale `false` here would keep offering the
 * wrong story long after the keychain came back.
 */
export function isSecretEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function getSecretHealth(): SecretHealth {
  return {
    keyState,
    encryptionAvailable: isSecretEncryptionAvailable(),
    failures: [...failures.values()],
  };
}

function publish(): void {
  listener?.(getSecretHealth());
}

export function recordSecretFailure(failure: SecretFailure): void {
  const key = failureKey(failure.scope, failure.id, failure.field);
  const previous = failures.get(key);
  if (previous && previous.label === failure.label) return;
  failures.set(key, failure);
  publish();
}

function writeCanary(): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  getStore().set('canary', encryptToken(CANARY_PLAINTEXT));
}

function adoptCurrentKeyIfClean(): void {
  // Once the user has re-entered everything, adopt the current key so the alarm stops
  // for good instead of resurfacing on the next boot.
  if (failures.size > 0 || keyState !== 'rotated') return;
  writeCanary();
  keyState = 'intact';
}

/** Called when a secret is written again — omitting `id`/`field` widens it to the whole scope. */
export function clearSecretFailures(scope: SecretScope, id?: string, field?: string): void {
  let changed = false;
  for (const [key, failure] of failures) {
    if (failure.scope !== scope) continue;
    if (id !== undefined && failure.id !== id) continue;
    if (field !== undefined && failure.field !== field) continue;
    failures.delete(key);
    changed = true;
  }
  if (!changed) return;
  adoptCurrentKeyIfClean();
  publish();
}

export function clearAllSecretFailures(): void {
  if (failures.size === 0) return;
  failures.clear();
  adoptCurrentKeyIfClean();
  publish();
}

/**
 * Reads the canary through the async API so `shouldReEncrypt` comes with it — that flag is
 * Electron's only signal that the OS moved us to a stronger key provider and every stored
 * blob should be rewritten before the old provider goes away.
 */
export async function checkSecretKey(): Promise<{ state: SecretKeyState; shouldReEncrypt: boolean }> {
  if (!safeStorage.isEncryptionAvailable()) {
    keyState = 'unknown';
    publish();
    return { state: 'unknown', shouldReEncrypt: false };
  }

  const stored = getStore().get('canary');
  if (!stored?.startsWith(ENCRYPTED_PREFIX)) {
    writeCanary();
    keyState = 'unknown';
    publish();
    return { state: 'unknown', shouldReEncrypt: false };
  }

  const payload = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64');
  try {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(payload);
    keyState = result === CANARY_PLAINTEXT ? 'intact' : 'rotated';
    publish();
    return { state: keyState, shouldReEncrypt: keyState === 'intact' && shouldReEncrypt };
  } catch {
    keyState = 'rotated';
    publish();
    return { state: 'rotated', shouldReEncrypt: false };
  }
}

/** Re-stamps the canary after a re-encryption sweep so the next boot reads the new key. */
export function refreshCanary(): void {
  writeCanary();
}
