/**
 * Encrypted-database driver for LINE PC (better-sqlite3-multiple-ciphers).
 *
 * LINE uses wxSQLite3 with the `aes128cbc` scheme and a hex passphrase (NOT Zetetic
 * SQLCipher). This is the ONLY module that loads the native driver, so it is kept out
 * of the offline test path and validated by the manual self-test against a real DB.
 *
 * All access is strictly read-only. Error text from a wrong key never contains the key
 * (a fixed dummy key is used for the preflight probe).
 */
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3-multiple-ciphers';
import { LineError } from './errors';
import type { Queryable } from './reader';

const CIPHER_SCHEME = 'aes128cbc';

// "encrypted DB, wrong key" — the engine works, the key is just wrong.
const WRONG_KEY_SIGNALS = ['not a database', 'hmac', 'file is encrypted', 'encrypted'];
const LOCK_SIGNALS = ['locked', 'busy'];
const ACCESS_SIGNALS = ['permission', 'access is denied', 'cannot open', 'unable to open'];

function openReadonly(dbPath: string, key: string): Database.Database {
  const db = new Database(dbPath, { readonly: true });
  db.pragma(`cipher='${CIPHER_SCHEME}'`);
  db.pragma(`key='${key}'`);
  return db;
}

/** True if `key` decrypts the DB under the wxSQLite3 aes128cbc scheme. */
export function probeKey(dbPath: string, key: string): boolean {
  try {
    const db = openReadonly(dbPath, key);
    try {
      db.prepare('SELECT count(*) FROM sqlite_master').get();
    } finally {
      db.close();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Confirm the DB is present, readable, and an engine-openable ENCRYPTED database.
 * Returns for the normal case (encrypted, just needs the right key). Throws a typed
 * LineError for genuine environment problems so they are never misreported as
 * "no key worked".
 */
export function preflightDbAccess(dbPath: string): void {
  if (!existsSync(dbPath)) throw new LineError('DB_NOT_FOUND', `LINE database not found: ${dbPath}`);
  try {
    const db = openReadonly(dbPath, '0'.repeat(32)); // deliberately wrong key
    try {
      db.prepare('SELECT count(*) FROM sqlite_master').get();
    } finally {
      db.close();
    }
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).toLowerCase();
    if (WRONG_KEY_SIGNALS.some((s) => msg.includes(s))) return; // healthy encrypted DB
    if (LOCK_SIGNALS.some((s) => msg.includes(s))) throw new LineError('DB_LOCKED', 'The LINE database is locked.');
    if (ACCESS_SIGNALS.some((s) => msg.includes(s))) throw new LineError('DB_ACCESS', 'Cannot open the LINE database (permission/handle).');
    throw new LineError('DB_ACCESS', 'Unexpected error opening the LINE database.');
  }
}

export interface EncryptedHandle {
  queryable: Queryable;
  close(): void;
}

export function openEncryptedQueryable(dbPath: string, key: string): EncryptedHandle {
  const db = openReadonly(dbPath, key);
  const queryable: Queryable = {
    all: (sql, params = []) => db.prepare(sql).all(...(params as [])) as Record<string, unknown>[],
    get: (sql, params = []) => db.prepare(sql).get(...(params as [])) as Record<string, unknown> | undefined,
  };
  return { queryable, close: () => db.close() };
}
