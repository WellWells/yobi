/**
 * Persistence for the LINE PC wxSQLite3 passphrase.
 *
 * Deliberately native-free and separate from lineService.ts: turning the connector off has to
 * clear the key, and that path (mcpRegistry) must not drag in the cipher driver.
 *
 * The key lives in the data-key store — safeStorage/DPAPI encrypted, in its own file — rather
 * than in config.json, because the backup archive collects config.json and would carry the
 * passphrase off the machine with it.
 */
import { DATA_KEY_LINE_DB, getDataKey, setDataKey } from '../dataKeyStore';

export function loadStoredLineKey(): string {
  return getDataKey(DATA_KEY_LINE_DB);
}

export function rememberLineKey(key: string): void {
  setDataKey(DATA_KEY_LINE_DB, key);
}

export function forgetStoredLineKey(): void {
  setDataKey(DATA_KEY_LINE_DB, '');
}
