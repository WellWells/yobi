import Store from 'electron-store';
import { getConfigDir } from '../config';
import { decryptToken, encryptToken } from '../configEncryption';
import type { McpAuthRecord } from './mcpTypes';

interface AuthStoreShape {
  records: Record<string, string>;
}

export function serializeAuthRecord(record: McpAuthRecord): string {
  return JSON.stringify(record);
}

export function deserializeAuthRecord(raw: string): McpAuthRecord | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as McpAuthRecord;
  } catch {
    return null;
  }
}

let store: Store<AuthStoreShape> | null = null;

function getStore(): Store<AuthStoreShape> {
  if (!store) {
    store = new Store<AuthStoreShape>({ name: 'mcp-auth', cwd: getConfigDir(), defaults: { records: {} } });
  }
  return store;
}

export function getAuthRecord(serverId: string): McpAuthRecord | null {
  const encrypted = getStore().store.records[serverId];
  if (!encrypted) return null;
  const decrypted = decryptToken(encrypted);
  return decrypted ? deserializeAuthRecord(decrypted) : null;
}

export function setAuthRecord(serverId: string, record: McpAuthRecord): void {
  const records = { ...getStore().store.records, [serverId]: encryptToken(serializeAuthRecord(record)) };
  getStore().set('records', records);
}

export function clearAuthRecord(serverId: string): void {
  const records = { ...getStore().store.records };
  if (!(serverId in records)) return;
  delete records[serverId];
  getStore().set('records', records);
}
