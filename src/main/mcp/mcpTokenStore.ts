import type Store from 'electron-store';
import { openStoreWithRecovery } from '../configStore';
import { getConfigDir } from '../configPaths';
import { decryptToken, decryptTokenChecked, encryptSecret, trackSecretWrite } from '../configEncryption';
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
    store = openStoreWithRecovery<AuthStoreShape>('mcp-auth', getConfigDir(), { records: {} });
  }
  return store;
}

/**
 * Records saved but still being encrypted. Reads return them at once, so the read-merge-write
 * callers (`{ ...getAuthRecord(id), tokens }`) never merge into the record before last.
 */
const unsaved = new Map<string, McpAuthRecord>();

export function getAuthRecord(serverId: string): McpAuthRecord | null {
  const pending = unsaved.get(serverId);
  if (pending) return pending;
  const encrypted = getStore().store.records[serverId];
  if (!encrypted) return null;
  const { value, failed } = decryptTokenChecked(encrypted, `mcp.authRecord (${serverId})`);
  if (failed) recordSecretFailure({ scope: 'mcp', id: serverId, field: 'authRecord', label: '' });
  else clearSecretFailures('mcp', serverId);
  return value ? deserializeAuthRecord(value) : null;
}

async function writeAuthRecord(serverId: string, record: McpAuthRecord): Promise<void> {
  try {
    const encrypted = await encryptSecret(serializeAuthRecord(record));
    // A later save or a clear for this server owns the entry now.
    if (unsaved.get(serverId) !== record) return;
    getStore().set('records', { ...getStore().store.records, [serverId]: encrypted });
  } finally {
    if (unsaved.get(serverId) === record) unsaved.delete(serverId);
  }
}

export function setAuthRecord(serverId: string, record: McpAuthRecord): Promise<void> {
  unsaved.set(serverId, record);
  clearSecretFailures('mcp', serverId);
  return trackSecretWrite(writeAuthRecord(serverId, record));
}

export function clearAuthRecord(serverId: string): void {
  unsaved.delete(serverId);
  clearSecretFailures('mcp', serverId);
  const records = { ...getStore().store.records };
  if (!(serverId in records)) return;
  delete records[serverId];
  getStore().set('records', records);
}

/**
 * Drops every stored authorization. Only a factory reset does this: the records live in their
 * own file, so clearing `config.mcpServers` leaves the OAuth tokens behind, orphaned by an id
 * nothing references — and re-adding a server under that id would silently reuse them.
 */
export function clearAllAuthRecords(): void {
  unsaved.clear();
  for (const serverId of Object.keys(getStore().store.records)) {
    clearSecretFailures('mcp', serverId);
  }
  getStore().set('records', {});
}

/**
 * Decrypts every stored record at startup purely to file failures. Without it a dead OAuth
 * token only surfaces mid-run, as a connection error that reads like the server's fault.
 */
export function probeAuthRecords(): void {
  for (const serverId of Object.keys(getStore().store.records)) getAuthRecord(serverId);
}

/** What the file holds, for decrypting it ahead of the synchronous reads. */
export function storedAuthRecords(): AuthStoreShape {
  return getStore().store;
}

export async function reEncryptAuthRecords(): Promise<void> {
  const current = getStore().store.records;
  const next: Record<string, string> = {};
  for (const [serverId, encrypted] of Object.entries(current)) {
    const plaintext = decryptToken(encrypted, `mcp.authRecord (${serverId})`);
    next[serverId] = plaintext ? await encryptSecret(plaintext, { fresh: true }) : encrypted;
  }
  // Read after the awaits: a record saved or cleared meanwhile keeps what was done to it, so only
  // the ones still holding the value read above take the re-encrypted copy.
  const latest = { ...getStore().store.records };
  for (const [serverId, encrypted] of Object.entries(next)) {
    if (latest[serverId] === current[serverId]) latest[serverId] = encrypted;
  }
  getStore().set('records', latest);
}
