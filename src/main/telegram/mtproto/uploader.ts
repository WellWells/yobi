import { createHash } from 'node:crypto';
import type { LargeUploader, LargeUploadFile } from '../largeUpload';
import { abortReason, untilAborted } from './abort';
import { MtprotoUploadError, isAbortError, toMtprotoError } from './errors';
import type { UploadSessionStore } from './sessionStore';

/**
 * The MTProto side of big Telegram uploads, without the MTProto library itself (that is the
 * injected `openClient`): one bot session at a time, opened on the first upload, one upload at a
 * time, closed after a quiet spell, and its auth key kept across starts.
 */

export interface MtprotoCredentials {
  apiId: number;
  apiHash: string;
  botToken: string;
}

export interface BotIdentity {
  id: number;
  username: string;
}

export interface MtprotoClient {
  /** Signs in as the bot, reusing the session it was opened with while that is still valid. */
  signIn(signal?: AbortSignal): Promise<BotIdentity>;
  /** Uploads without posting anything and returns the Bot API file_id. */
  upload(chatId: number, file: LargeUploadFile, signal?: AbortSignal): Promise<string>;
  exportSession(): Promise<string>;
  close(): Promise<void>;
}

export type OpenMtprotoClient = (credentials: MtprotoCredentials, session: string | null) => Promise<MtprotoClient>;

export interface MtprotoUploaderDeps {
  getCredentials(): MtprotoCredentials;
  openClient: OpenMtprotoClient;
  sessions: UploadSessionStore;
  log(message: string): void;
  /** How long an unused session stays connected. */
  idleMs?: number;
}

export const MTPROTO_IDLE_CLOSE_MS = 10 * 60_000;

interface ActiveSession {
  fingerprint: string;
  client: MtprotoClient;
  identity: BotIdentity;
  /** What is on disk for this fingerprint, so an unchanged session is not rewritten. */
  saved: string | null;
}

export function credentialsReady(credentials: MtprotoCredentials): boolean {
  return credentials.apiId > 0 && credentials.apiHash !== '' && credentials.botToken !== '';
}

export function credentialsFingerprint(credentials: MtprotoCredentials): string {
  return createHash('sha256')
    .update(`${credentials.apiId}\n${credentials.apiHash}\n${credentials.botToken}`)
    .digest('hex');
}

function waitOrAbort(turn: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return turn;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    void turn.then(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
  });
}

export class MtprotoUploader implements LargeUploader {
  private active: ActiveSession | null = null;
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: MtprotoUploaderDeps) {}

  configured(): boolean {
    return credentialsReady(this.deps.getCredentials());
  }

  upload(chatId: string | number, file: LargeUploadFile, signal?: AbortSignal): Promise<string> {
    return this.run(signal, async () => {
      const client = await this.ensureClient(this.readyCredentials(), signal);
      try {
        return await client.upload(Number(chatId), file, signal);
      } catch (err: unknown) {
        const mapped = toMtprotoError(err);
        if (!isAbortError(mapped)) this.deps.log(`[telegram-upload] upload failed: ${mapped.message}`);
        // The token was revoked while connected: this session is dead, the next upload signs in anew.
        if (mapped instanceof MtprotoUploadError && mapped.code === 'BOT_TOKEN_INVALID') {
          await this.closeActive(false);
          await this.deps.sessions.remove().catch(() => undefined);
        }
        throw mapped;
      }
    });
  }

  /**
   * Signs in and says who the bot is: the settings page's Test button. Values typed but not
   * saved yet get a throwaway session; the saved ones use (and keep) the real one.
   */
  async probe(override?: Partial<MtprotoCredentials>, signal?: AbortSignal): Promise<BotIdentity> {
    const saved = this.deps.getCredentials();
    const credentials: MtprotoCredentials = {
      apiId: override?.apiId || saved.apiId,
      apiHash: override?.apiHash || saved.apiHash,
      botToken: saved.botToken,
    };
    if (!credentials.botToken) throw new MtprotoUploadError('NO_BOT_TOKEN', 'no bot token saved');
    if (!credentialsReady(credentials)) throw new MtprotoUploadError('NOT_CONFIGURED', 'API id or hash missing');
    if (credentialsReady(saved) && credentialsFingerprint(credentials) === credentialsFingerprint(saved)) {
      // Already signed in (perhaps mid-upload): that is the answer, without queueing behind it.
      if (this.active?.fingerprint === credentialsFingerprint(saved)) return this.active.identity;
      return this.run(signal, async () => {
        await this.ensureClient(credentials, signal);
        return (this.active as ActiveSession).identity;
      });
    }
    const client = await this.deps.openClient(credentials, null);
    try {
      return await untilAborted(client.signIn(signal), signal);
    } catch (err: unknown) {
      throw toMtprotoError(err);
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  /** Disconnects, keeping the session on disk for the next start. */
  close(): Promise<void> {
    return this.run(undefined, () => this.closeActive(true));
  }

  /**
   * On quit: disconnects at once, without waiting for an upload in flight (the process is going
   * anyway). The session was saved when it signed in, so nothing is lost.
   */
  shutdown(): Promise<void> {
    this.clearIdle();
    const active = this.active;
    this.active = null;
    return active ? active.client.close().catch(() => undefined) : Promise.resolve();
  }

  /** Disconnects and deletes the stored session: the credentials were cleared or replaced. */
  forget(): Promise<void> {
    return this.run(undefined, async () => {
      await this.closeActive(false);
      await this.deps.sessions.remove().catch(() => undefined);
    });
  }

  private readyCredentials(): MtprotoCredentials {
    const credentials = this.deps.getCredentials();
    if (!credentialsReady(credentials)) throw new MtprotoUploadError('NOT_CONFIGURED', 'API id, API hash or bot token missing');
    return credentials;
  }

  private run<T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    const turn = this.tail;
    let finish!: () => void;
    const mine = new Promise<void>((resolve) => { finish = resolve; });
    // The next caller waits for the previous task as well as this one, even when this one is
    // stopped while still waiting: a stopped caller must not let two uploads overlap.
    this.tail = turn.then(() => mine);
    this.pending += 1;
    this.clearIdle();
    return (async () => {
      try {
        await waitOrAbort(turn, signal);
        return await task();
      } finally {
        finish();
        this.pending -= 1;
        void this.tail.then(() => this.armIdle());
      }
    })();
  }

  private clearIdle(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private armIdle(): void {
    if (this.pending > 0 || !this.active || this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.close();
    }, this.deps.idleMs ?? MTPROTO_IDLE_CLOSE_MS);
    this.idleTimer.unref?.();
  }

  private async closeActive(keepSession: boolean): Promise<void> {
    const active = this.active;
    if (!active) return;
    this.active = null;
    if (keepSession) await this.persist(active);
    await active.client.close().catch((err: unknown) => {
      this.deps.log(`[telegram-upload] close failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private async persist(active: ActiveSession): Promise<void> {
    try {
      const session = await active.client.exportSession();
      if (!session || session === active.saved) return;
      await this.deps.sessions.save({ fingerprint: active.fingerprint, session });
      active.saved = session;
    } catch (err: unknown) {
      this.deps.log(`[telegram-upload] could not save the session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async ensureClient(credentials: MtprotoCredentials, signal?: AbortSignal): Promise<MtprotoClient> {
    const fingerprint = credentialsFingerprint(credentials);
    if (this.active && this.active.fingerprint !== fingerprint) {
      this.deps.log('[telegram-upload] credentials changed — dropping the old session');
      await this.closeActive(false);
      await this.deps.sessions.remove().catch(() => undefined);
    }
    if (this.active) return this.active.client;

    const stored = await this.deps.sessions.load().catch(() => null);
    const session = stored?.fingerprint === fingerprint ? stored.session : null;
    if (stored && !session) await this.deps.sessions.remove().catch(() => undefined);
    try {
      return await this.signInWith(credentials, fingerprint, session, signal);
    } catch (err: unknown) {
      const mapped = toMtprotoError(err);
      this.deps.log(`[telegram-upload] sign-in failed: ${mapped.message}`);
      if (!session || isAbortError(mapped) || !(mapped instanceof MtprotoUploadError)) throw mapped;
      if (mapped.code === 'FLOOD_WAIT' || mapped.code === 'NETWORK') throw mapped;
      // The stored session is what failed (or the token behind it is gone): never reuse it.
      await this.deps.sessions.remove().catch(() => undefined);
      if (mapped.code !== 'FAILED') throw mapped;
      try {
        return await this.signInWith(credentials, fingerprint, null, signal);
      } catch (retryErr: unknown) {
        throw toMtprotoError(retryErr);
      }
    }
  }

  private async signInWith(
    credentials: MtprotoCredentials,
    fingerprint: string,
    session: string | null,
    signal?: AbortSignal,
  ): Promise<MtprotoClient> {
    const client = await this.deps.openClient(credentials, session);
    let identity: BotIdentity;
    try {
      identity = await untilAborted(client.signIn(signal), signal);
    } catch (err: unknown) {
      await client.close().catch(() => undefined);
      throw err;
    }
    const active: ActiveSession = { fingerprint, client, identity, saved: session };
    this.active = active;
    this.deps.log(`[telegram-upload] signed in as @${identity.username}${session ? ' (saved session)' : ''}`);
    await this.persist(active);
    return client;
  }
}
