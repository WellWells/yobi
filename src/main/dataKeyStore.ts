import type Store from 'electron-store';
import { openStoreWithRecovery } from './configStore';
import { getConfigDir } from './configPaths';
import { decryptToken, decryptTokenChecked, encryptSecret } from './configEncryption';
import { clearSecretFailures, recordSecretFailure } from './secretHealth';

export { DATA_KEY_LINE_DB, DATA_KEY_MOENV } from '../shared/types';

interface DataKeyStoreShape {
  keys: Record<string, string>;
}

let store: Store<DataKeyStoreShape> | null = null;

function getStore(): Store<DataKeyStoreShape> {
  if (!store) {
    store = openStoreWithRecovery<DataKeyStoreShape>('data-keys', getConfigDir(), { keys: {} });
  }
  return store;
}

export function getDataKey(name: string): string {
  const encrypted = getStore().store.keys[name];
  if (!encrypted) return '';
  const { value, failed } = decryptTokenChecked(encrypted, `dataKey.${name}`);
  if (failed) recordSecretFailure({ scope: 'dataKey', id: name, field: 'value', label: name });
  else clearSecretFailures('dataKey', name);
  return value;
}

export async function setDataKey(name: string, value: string): Promise<void> {
  const trimmed = value.trim();
  const encrypted = trimmed ? await encryptSecret(trimmed) : '';
  // Read after the await: a write that landed meanwhile keeps its own key.
  const keys = { ...getStore().store.keys };
  if (encrypted) {
    keys[name] = encrypted;
  } else {
    delete keys[name];
  }
  getStore().set('keys', keys);
  clearSecretFailures('dataKey', name);
}

/** What the file holds, for decrypting it ahead of the synchronous reads. */
export function storedDataKeys(): DataKeyStoreShape {
  return getStore().store;
}

/**
 * Drops every stored key. Only a factory reset does this: the keys live in their own file,
 * so emptying the config alone leaves them on disk, tied to nothing and invisible.
 */
export function clearAllDataKeys(): void {
  getStore().set('keys', {});
}

/**
 * Decrypts every stored key at startup purely to file failures. Without it a broken key
 * stays invisible until the flow that needs it runs, which is the worst moment to find out.
 */
export function probeDataKeys(): void {
  for (const name of Object.keys(getStore().store.keys)) getDataKey(name);
}

export async function reEncryptDataKeys(): Promise<void> {
  const current = getStore().store.keys;
  const next: Record<string, string> = {};
  for (const [name, encrypted] of Object.entries(current)) {
    const plaintext = decryptToken(encrypted, `dataKey.${name}`);
    next[name] = plaintext ? await encryptSecret(plaintext, { fresh: true }) : encrypted;
  }
  getStore().set('keys', next);
}
