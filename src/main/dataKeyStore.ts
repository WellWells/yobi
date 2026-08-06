import Store from 'electron-store';
import { getConfigDir } from './config';
import { decryptToken, encryptToken } from './configEncryption';

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
  return encrypted ? decryptToken(encrypted) : '';
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
}
