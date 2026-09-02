import Store from 'electron-store';
import { getConfigDir } from './configPaths';
import { decryptToken, decryptTokenChecked, encryptToken } from './configEncryption';
import { clearSecretFailures, recordSecretFailure } from './secretHealth';

export { DATA_KEY_MOENV } from '../shared/types';

interface DataKeyStoreShape {
  keys: Record<string, string>;
}

let store: Store<DataKeyStoreShape> | null = null;

function getStore(): Store<DataKeyStoreShape> {
  if (!store) {
    store = new Store<DataKeyStoreShape>({ name: 'data-keys', cwd: getConfigDir(), defaults: { keys: {} } });
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

export function setDataKey(name: string, value: string): void {
  const trimmed = value.trim();
  const keys = { ...getStore().store.keys };
  if (trimmed) {
    keys[name] = encryptToken(trimmed);
  } else {
    delete keys[name];
  }
  getStore().set('keys', keys);
  clearSecretFailures('dataKey', name);
}

/**
 * Decrypts every stored key at startup purely to file failures. Without it a broken key
 * stays invisible until the flow that needs it runs, which is the worst moment to find out.
 */
export function probeDataKeys(): void {
  for (const name of Object.keys(getStore().store.keys)) getDataKey(name);
}

export function reEncryptDataKeys(): void {
  const current = getStore().store.keys;
  const next: Record<string, string> = {};
  for (const [name, encrypted] of Object.entries(current)) {
    const plaintext = decryptToken(encrypted, `dataKey.${name}`);
    next[name] = plaintext ? encryptToken(plaintext) : encrypted;
  }
  getStore().set('keys', next);
}
