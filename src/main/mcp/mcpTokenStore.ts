import Store from 'electron-store';
import { getConfigDir } from '../configPaths';
import { decryptToken, decryptTokenChecked, encryptToken } from '../configEncryption';
import { clearSecretFailures, recordSecretFailure } from '../secretHealth';
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
  const { value, failed } = decryptTokenChecked(encrypted, `mcp.authRecord (${serverId})`);
  if (failed) recordSecretFailure({ scope: 'mcp', id: serverId, field: 'authRecord', label: '' });
  else clearSecretFailures('mcp', serverId);
  return value ? deserializeAuthRecord(value) : null;
}

export function setAuthRecord(serverId: string, record: McpAuthRecord): void {
  const records = { ...getStore().store.records, [serverId]: encryptToken(serializeAuthRecord(record)) };
  getStore().set('records', records);
  clearSecretFailures('mcp', serverId);
}

export function clearAuthRecord(serverId: string): void {
  clearSecretFailures('mcp', serverId);
  const records = { ...getStore().store.records };
  if (!(serverId in records)) return;
  delete records[serverId];
  getStore().set('records', records);
}

/**
 * Decrypts every stored record at startup purely to file failures. Without it a dead OAuth
 * token only surfaces mid-run, as a connection error that reads like the server's fault.
 */
export function probeAuthRecords(): void {
  for (const serverId of Object.keys(getStore().store.records)) getAuthRecord(serverId);
}

export function reEncryptAuthRecords(): void {
  const current = getStore().store.records;
  const next: Record<string, string> = {};
  for (const [serverId, encrypted] of Object.entries(current)) {
    const plaintext = decryptToken(encrypted, `mcp.authRecord (${serverId})`);
    next[serverId] = plaintext ? encryptToken(plaintext) : encrypted;
  }
  getStore().set('records', next);
}
