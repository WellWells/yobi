/**
 * Session orchestration for LINE access: locate → preflight → extract key → open reader.
 *
 * The wxSQLite3 key is kept between launches in the encrypted data-key store, because
 * scanning it out of LINE's process memory costs ~80s and the flow chat picker is what pays
 * it. It is never logged and never reaches config.json or a backup archive. Loads the native
 * driver, so this stays out of the offline test path (validated by the self-test); the pure
 * tool surface is tested via a fake service that satisfies LineServiceLike.
 */
import { openEncryptedQueryable, preflightDbAccess, probeKey, type EncryptedHandle } from './cipherDb';
import { LineError } from './errors';
import { extractLineKey } from './keyExtractor';
import { forgetStoredLineKey, loadStoredLineKey, rememberLineKey } from './lineKeyStore';
import { inspectStorage, locateLinePaths, type InspectResult, type LocateResult } from './locator';
import { LineReader } from './reader';

export interface LineServiceLike {
  locate(): Promise<LocateResult>;
  inspect(): Promise<InspectResult>;
  getReader(): Promise<LineReader>;
}

export class LineService implements LineServiceLike {
  private cachedKey: string | null = null;
  private handle: EncryptedHandle | null = null;
  private reader: LineReader | null = null;

  async locate(): Promise<LocateResult> {
    return locateLinePaths();
  }

  async inspect(): Promise<InspectResult> {
    const loc = await locateLinePaths();
    if (!loc.dataDir) throw new LineError('DB_NOT_FOUND', 'LINE data directory not found on this machine.');
    return inspectStorage(loc.dataDir);
  }

  async getReader(): Promise<LineReader> {
    if (this.reader) return this.reader;
    const loc = await locateLinePaths();
    if (!loc.keyExtractionSupported) {
      throw new LineError('UNSUPPORTED_PLATFORM', 'Reading LINE messages is only available on Windows.');
    }
    if (!loc.mainEdb) throw new LineError('DB_NOT_FOUND', 'LINE message database (.edb) not found.');
    preflightDbAccess(loc.mainEdb);
    const key = this.cachedKey ?? (await this.resolveKey(loc.mainEdb));
    this.cachedKey = key;
    this.handle = openEncryptedQueryable(loc.mainEdb, key);
    this.reader = new LineReader(this.handle.queryable);
    return this.reader;
  }

  /**
   * Verify, never trust: a stored key is probed before use. LINE rotating its passphrase then
   * self-heals into one extra scan, instead of surfacing at the far end of a flow as "no
   * messages" — the one failure this skill must never produce silently.
   */
  private async resolveKey(dbPath: string): Promise<string> {
    const stored = loadStoredLineKey();
    if (stored && probeKey(dbPath, stored)) return stored;
    if (stored) forgetStoredLineKey();
    const scanned = await extractLineKey(dbPath, probeKey);
    rememberLineKey(scanned);
    return scanned;
  }

  /** Warm the key cache in the background so the first tool call is not blocked ~80s. */
  async warmUp(): Promise<void> {
    await this.getReader();
  }

  reset(): void {
    this.handle?.close();
    this.handle = null;
    this.reader = null;
    this.cachedKey = null;
  }
}
