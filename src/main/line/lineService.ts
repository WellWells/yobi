/**
 * Session orchestration for LINE access: locate → preflight → extract key → open reader.
 *
 * The key is kept between launches in the encrypted data-key store, because scanning it out of
 * LINE's memory is slow. It is never logged and never reaches config.json or a backup archive.
 * Loads the native driver, so it is imported lazily; the tool surface works against
 * LineServiceLike.
 */
import { join } from 'node:path';
import { openEncryptedQueryable, preflightDbAccess, probeKey, type EncryptedHandle } from './cipherDb';
import { LineError } from './errors';
import { extractLineKey } from './keyExtractor';
import { forgetStoredLineKey, loadStoredLineKey, rememberLineKey } from './lineKeyStore';
import { inspectStorage, locateLinePaths, type InspectResult, type LocateResult } from './locator';
import { LineReader } from './reader';
import { extractAccessTokens } from './tokenExtractor';
import { checkSendInput, sendText, type SendDeps } from './lineSend';
import { prepareFiles } from './lineSendFilePrep';
import { sendFiles, type SendFilesPlan } from './lineSendFiles';
import { checkReplyId } from './lineSendReply';
import type { SendPlan } from './lineSendText';
import { nativeAction, nativeDownloadFile, nativeSend, nativeSendFile, nativeSendKeys, nativeSquareFetch } from './nativeLineCore';
import type { NativeClientEnv } from './nativeContract';
import { reactToMessage, unsendMessage, type ActionPlan, type ReactOptions, type UnsendOptions } from './lineAction';
import { runDownload } from './lineDownload';
import type { DownloadQuery, DownloadResult, PreviewQuery, PreviewResult } from './lineMediaRows';
import { runPreview } from './linePreview';
import { connectSquare, type SquareCaller } from './lineSquareServer';
import { lineRunning } from './lineProcess';
import { buildStatus, statDbFiles, stoppedNote, type LineStatusReport } from './lineStatus';

export interface SendRequest {
  to: string;
  text: string;
  dryRun: boolean;
  allowDuplicate?: boolean;
  /** A stored message id of the same chat to reply to. */
  replyTo?: string;
  /** People to tag in a group: a member id, an exact name, or <word>=<id>. */
  mention?: readonly string[];
  mentionAll?: boolean;
  /** Receives the notes line-cli prints on stderr (`note: …` / `warning: …`). */
  notify?: (note: string) => void;
  /** Where the access-token candidates come from; absent = a fresh scan of LINE's memory. */
  tokens?: () => Promise<string[]>;
}

/** line-cli's send --file: files on this computer, each its own message, after the text when given. */
export interface SendFilesRequest {
  to: string;
  /** Paths of the files to send, in order (at most 50). */
  files: readonly string[];
  /** Sent as a message before the files ('' or absent: none). */
  text?: string;
  /** Send photos and videos as files. */
  asFile?: boolean;
  dryRun: boolean;
  allowDuplicate?: boolean;
  /** A stored message id of the same chat; the first message sent quotes it. */
  replyTo?: string;
  /** The photos among the files go as one album (two or more). */
  album?: boolean;
  notify?: (note: string) => void;
  /** Where the access-token candidates come from; absent = a fresh scan of LINE's memory. */
  tokens?: () => Promise<string[]>;
}

export interface LineServiceLike {
  locate(): Promise<LocateResult>;
  inspect(): Promise<InspectResult>;
  getReader(): Promise<LineReader>;
  send(req: SendRequest): Promise<SendPlan>;
  /** Sends files (absent = this service cannot). */
  sendFiles?(req: SendFilesRequest): Promise<SendFilesPlan>;
  /** Reacts to a stored message (absent = this service cannot). */
  react?(req: ReactOptions): Promise<ActionPlan>;
  /** Takes back the user's own message (absent = this service cannot). */
  unsend?(req: UnsendOptions): Promise<ActionPlan>;
  download(q: DownloadQuery): Promise<DownloadResult[]>;
  preview(q: PreviewQuery): Promise<PreviewResult[]>;
  /** LINE's server for reading open chats and threads (tokens from LINE's memory); absent = never online. */
  connectSquare?(): Promise<SquareCaller>;
  /** Status: a cached key only, never a memory scan or LINE's server. */
  status(): Promise<LineStatusReport>;
  /** "note: LINE is not running; data is as of …" when LINE is known to be stopped, else none (absent = none). */
  stoppedNotes?(): Promise<string[]>;
}

/** How long one LINE-running answer is reused: listing processes costs a PowerShell start. */
const RUNNING_TTL_MS = 10_000;

async function sendStoreDir(): Promise<string> {
  const { app } = await import('electron');
  return join(app.getPath('userData'), 'line');
}

// Downloads/Yobi and its cleanup ledger, the same as every other download (loaded lazily: Electron).
async function downloadsFolder(): Promise<{ dir: string; record: (files: string[]) => Promise<void> }> {
  const { recordDownloads, yobiDownloadsDir } = await import('../downloadsCache');
  return { dir: yobiDownloadsDir(), record: (files) => recordDownloads(files) };
}

export class LineService implements LineServiceLike {
  private cachedKey: string | null = null;
  private handle: EncryptedHandle | null = null;
  private reader: LineReader | null = null;
  private dbPath: string | null = null;
  private dataDir: string | null = null;

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
    const mainEdb = await this.locateDb();
    return this.open(mainEdb, this.cachedKey ?? (await this.resolveKey(mainEdb)));
  }

  async status(): Promise<LineStatusReport> {
    const mainEdb = await this.locateDb();
    const files = statDbFiles(mainEdb);
    const running = await this.running();
    const reader = this.reader ?? this.openCached(mainEdb);
    return buildStatus({ dbPath: mainEdb, files, running, span: reader ? reader.status() : null });
  }

  async stoppedNotes(): Promise<string[]> {
    return stoppedNote(await this.running(), () => (this.dbPath ? statDbFiles(this.dbPath) : null));
  }

  private runningAt = 0;
  private runningValue: boolean | null = null;

  private async running(): Promise<boolean | null> {
    if (Date.now() - this.runningAt < RUNNING_TTL_MS) return this.runningValue;
    this.runningValue = await lineRunning();
    this.runningAt = Date.now();
    return this.runningValue;
  }

  // The main database, checked readable; Windows only (reading needs the key from LINE's memory).
  private async locateDb(): Promise<string> {
    const loc = await locateLinePaths();
    if (!loc.keyExtractionSupported) {
      throw new LineError('UNSUPPORTED_PLATFORM', 'Reading LINE messages is only available on Windows.');
    }
    if (!loc.mainEdb) throw new LineError('DB_NOT_FOUND', 'LINE message database (.edb) not found.');
    preflightDbAccess(loc.mainEdb);
    this.dbPath = loc.mainEdb;
    this.dataDir = loc.dataDir;
    return loc.mainEdb;
  }

  // A reader on the key kept from an earlier run, or null when none decrypts: never scans memory.
  private openCached(mainEdb: string): LineReader | null {
    const stored = loadStoredLineKey();
    if (!stored || !probeKey(mainEdb, stored)) return null;
    return this.open(mainEdb, stored);
  }

  private open(mainEdb: string, key: string): LineReader {
    this.cachedKey = key;
    const handle = openEncryptedQueryable(mainEdb, key);
    this.handle = handle;
    // A broken handle (LINE re-keyed or replaced the DB) is dropped with the key, so the next
    // request re-probes the stored key and rescans only if it no longer decrypts. A reader kept
    // from an earlier handle must not tear down the one that replaced it.
    this.reader = new LineReader(handle.queryable, () => {
      if (this.handle === handle) this.reset();
    });
    return this.reader;
  }

  /**
   * Sends a text message as the user (or, with dryRun, returns the plan without sending). Builds the
   * live dependencies — the access-token scan, the POST, the send-log folder, the client env, and a
   * fresh reader per verify poll (so a newly stored row is visible) — and runs sendText. A bad
   * reply_to or text fails before the LINE database is opened. The send log never
   * records the body; the token is only in the request headers, never logged.
   */
  async send(req: SendRequest): Promise<SendPlan> {
    checkSendInput(req.text, req.replyTo);
    const reader = await this.getReader();
    const { deps, close } = await this.sendDeps(req.tokens);
    try {
      return await sendText(reader, req.to, req.text, {
        dryRun: req.dryRun, allowDuplicate: req.allowDuplicate, replyTo: req.replyTo, mention: req.mention, mentionAll: req.mentionAll, notify: req.notify,
      }, deps);
    } finally {
      close();
    }
  }

  /** Reacts to a stored message, or removes the user's reaction. */
  async react(req: ReactOptions): Promise<ActionPlan> {
    const reader = await this.getReader();
    const { deps, close } = await this.sendDeps();
    try {
      return await reactToMessage(reader, req, { ...deps, nativeAction });
    } finally {
      close();
    }
  }

  /** Takes back one of the user's own messages. */
  async unsend(req: UnsendOptions): Promise<ActionPlan> {
    const reader = await this.getReader();
    const { deps, close } = await this.sendDeps();
    try {
      return await unsendMessage(reader, req, { ...deps, nativeAction });
    } finally {
      close();
    }
  }

  // Where the native core reads LINE's client version and locale.
  private clientEnv(): NativeClientEnv {
    return this.dataDir ? { dataDir: this.dataDir } : {};
  }

  /**
   * Sends files, photos and videos as the user, each its own message, after the text when there is
   * one (line-cli's send --file). A bad reply_to, text or file fails before the LINE database is
   * opened; previews are made with Electron's nativeImage.
   */
  async sendFiles(req: SendFilesRequest): Promise<SendFilesPlan> {
    if (req.text) checkSendInput(req.text, req.replyTo);
    else if (req.replyTo !== undefined) checkReplyId(req.replyTo);
    const { electronImageCodec } = await import('./lineImageCodec');
    const files = await prepareFiles(req.files, req.asFile === true, req.allowDuplicate === true, electronImageCodec, req.notify);
    const reader = await this.getReader();
    const { deps, close } = await this.sendDeps(req.tokens);
    try {
      return await sendFiles(reader, req.to, {
        files, dryRun: req.dryRun, allowDuplicate: req.allowDuplicate, text: req.text, replyTo: req.replyTo, album: req.album, notify: req.notify,
      }, deps);
    } finally {
      close();
    }
  }

  // The live dependencies of a send: the access-token scan, the POST, the send-log folder, the
  // client env, and a fresh reader per verify poll (so a newly stored row is visible), whose
  // handles `close` releases.
  private async sendDeps(tokens?: () => Promise<string[]>): Promise<{ deps: SendDeps; close: () => void }> {
    const dbPath = this.dbPath;
    const key = this.cachedKey;
    if (!dbPath || !key) throw new LineError('DB_UNREADABLE', 'the LINE database is not open');
    const storeDir = await sendStoreDir();
    const verifyHandles: EncryptedHandle[] = [];
    const deps: SendDeps = {
      tokens: tokens ?? (() => extractAccessTokens()),
      nativeKeys: nativeSendKeys,
      nativeDryRun: nativeSend,
      nativeSend,
      nativeSendFile,
      now: () => Date.now(),
      storeDir,
      clientEnv: () => this.clientEnv(),
      verifyReader: () => {
        const handle = openEncryptedQueryable(dbPath, key);
        verifyHandles.push(handle);
        return new LineReader(handle.queryable);
      },
    };
    return { deps, close: () => verifyHandles.forEach((handle) => handle.close()) };
  }

  /**
   * A new read-only handle on the database, for a reader that must see what LINE wrote since the
   * shared handle opened (the same as a send's verify reads). The caller closes it.
   */
  async openFresh(): Promise<{ reader: LineReader; close: () => void }> {
    await this.getReader();
    const dbPath = this.dbPath;
    const key = this.cachedKey;
    if (!dbPath || !key) throw new LineError('DB_UNREADABLE', 'the LINE database is not open');
    const handle = openEncryptedQueryable(dbPath, key);
    return { reader: new LineReader(handle.queryable), close: () => handle.close() };
  }

  /** The database file once located (the files whose write times say LINE stored something). */
  databasePath(): string | null {
    return this.dbPath;
  }

  /** Called on the first read that needs LINE's server, after getReader located the data directory. */
  async connectSquare(): Promise<SquareCaller> {
    return connectSquare({ tokens: () => extractAccessTokens(), clientEnv: this.clientEnv(), fetch: nativeSquareFetch });
  }

  /**
   * line_download: obs fetch + E2EE file decryption into Downloads/Yobi. The token scan runs only
   * when some row is fetched; the token never leaves the request header.
   */
  async download(q: DownloadQuery): Promise<DownloadResult[]> {
    const reader = await this.getReader();
    const folder = await downloadsFolder();
    return runDownload(reader.mediaSource(), q, {
      tokens: () => extractAccessTokens(),
      nativeDownloadFile,
      clientEnv: () => this.clientEnv(),
      now: () => Date.now(),
      pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      dir: folder.dir,
      record: folder.record,
      exePath: process.execPath,
    });
  }

  /** line_preview: cached thumbnails, decrypted into Downloads/Yobi/previews. Offline. */
  async preview(q: PreviewQuery): Promise<PreviewResult[]> {
    const reader = await this.getReader();
    const folder = await downloadsFolder();
    return runPreview(reader.mediaSource(), q, { dir: join(folder.dir, 'previews'), record: folder.record });
  }

  /**
   * A stored key is probed before use, so a rotated LINE passphrase costs one extra scan instead
   * of a flow silently reporting "no messages".
   */
  private async resolveKey(dbPath: string): Promise<string> {
    const stored = loadStoredLineKey();
    if (stored && probeKey(dbPath, stored)) return stored;
    if (stored) forgetStoredLineKey();
    const scanned = await extractLineKey(dbPath, probeKey);
    rememberLineKey(scanned);
    return scanned;
  }

  reset(): void {
    this.handle?.close();
    this.handle = null;
    this.reader = null;
    this.cachedKey = null;
  }
}
