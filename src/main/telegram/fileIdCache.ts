import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { app } from 'electron';
import { writeFileAtomic } from '../atomicWrite';
import { Mutex } from '../flow/lanes';

/*
 * The Bot API's file_id of every local file the bot sent, so sending the same bytes again — the
 * same link pasted again, the same video to another chat — goes by that id instead of uploading
 * the file anew (core.telegram.org/bots/api#sending-files: "no limits for files sent this way").
 *
 * The key is what Telegram's rules make it: the bot (a file_id is "unique for each individual bot
 * and can't be transferred from one bot to another"), the kind it was sent as ("it is not possible
 * to change the file type when resending by file_id") and the bytes themselves (SHA-256 and size,
 * so a file replaced at the same path is a new file, and the same bytes at another path are not).
 * An id Telegram refuses is forgotten and the file uploaded once more (`sendWithSavedFileId`).
 * Only ids, kinds, hashes and sizes are kept: no paths, names or chats.
 */

export type TelegramFileKind = 'video' | 'audio' | 'photo' | 'document';

/** What a send is keyed by. */
export interface UploadIdentity {
  /** The bot's own id: the number before the token's colon. */
  bot: string;
  kind: TelegramFileKind;
  /** SHA-256 of the bytes that go up (a WebP photo's JPEG, else the file). */
  hash: string;
  size: number;
}

interface Entry extends UploadIdentity {
  fileId: string;
  usedAt: number;
}

/** The ids kept; the least recently used goes first. */
export const MAX_FILE_IDS = 500;

let enabled = !process.env.VITEST;
let pathOverride: string | null = null;
let loaded: Map<string, Entry> | null = null;
const lock = new Mutex();

/** `<userData>/telegram-file-ids.json`. */
export function telegramFileIdsPath(): string {
  return pathOverride ?? path.join(app.getPath('userData'), 'telegram-file-ids.json');
}

/**
 * Off while Vitest runs, so one test's sends never answer another's; a test that is about the
 * cache turns it on with a file of its own. Changing either forgets what was loaded.
 */
export function setTelegramFileIdCache(options: { enabled: boolean; file?: string | null }): void {
  enabled = options.enabled;
  if (options.file !== undefined) pathOverride = options.file;
  loaded = null;
  hashes.clear();
}

function keyOf(id: UploadIdentity): string {
  return [id.bot, id.kind, id.hash, id.size].join('|');
}

function isEntry(value: unknown): value is Entry {
  const e = value as Partial<Entry> | null;
  return typeof e?.bot === 'string' && typeof e.kind === 'string' && typeof e.hash === 'string'
    && typeof e.size === 'number' && typeof e.fileId === 'string' && e.fileId !== '' && typeof e.usedAt === 'number';
}

async function entries(): Promise<Map<string, Entry>> {
  if (loaded) return loaded;
  let list: Entry[] = [];
  try {
    const parsed = JSON.parse(await fs.readFile(telegramFileIdsPath(), 'utf8')) as { files?: unknown };
    list = Array.isArray(parsed?.files) ? parsed.files.filter(isEntry) : [];
  } catch {
    // Missing or unreadable: nothing kept yet, and the next send writes it anew.
  }
  list.sort((a, b) => a.usedAt - b.usedAt);
  loaded = new Map(list.map((e) => [keyOf(e), e]));
  return loaded;
}

async function save(map: Map<string, Entry>): Promise<void> {
  while (map.size > MAX_FILE_IDS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  const file = telegramFileIdsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, JSON.stringify({ files: [...map.values()] }));
}

/** The bot's id, the part of its token before the colon: never the token itself. */
export function botIdOf(token: string | undefined): string {
  const id = (token ?? '').split(':')[0] ?? '';
  return /^\d+$/.test(id) ? id : '';
}

/** A file's SHA-256 by its path, size and time, so a file sent again is not read twice. */
const hashes = new Map<string, string>();
const MAX_HASHES = 200;

async function hashFile(file: string): Promise<{ hash: string; size: number }> {
  const stat = await fs.stat(file);
  const memo = `${path.resolve(file)}|${stat.size}|${stat.mtimeMs}`;
  const known = hashes.get(memo);
  if (known) return { hash: known, size: stat.size };
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk as Buffer);
  const hash = digest.digest('hex');
  hashes.set(memo, hash);
  if (hashes.size > MAX_HASHES) {
    const oldest = hashes.keys().next().value;
    if (oldest !== undefined) hashes.delete(oldest);
  }
  return { hash, size: stat.size };
}

/**
 * What a send of `file` as `kind` by `bot` is keyed by: the bytes that go up (`upload`, a WebP
 * photo's JPEG) or the file's. Null while the cache is off, for a bot without an id, or a file
 * that cannot be read — that send just uploads.
 */
export async function uploadIdentity(bot: string, kind: TelegramFileKind, file: string, upload?: Buffer): Promise<UploadIdentity | null> {
  if (!enabled || !bot) return null;
  try {
    if (upload) return { bot, kind, hash: createHash('sha256').update(upload).digest('hex'), size: upload.length };
    return { bot, kind, ...(await hashFile(file)) };
  } catch {
    return null;
  }
}

/** The file_id this bot got for these bytes sent as this kind, or null. */
export async function savedFileId(id: UploadIdentity): Promise<string | null> {
  if (!enabled) return null;
  return lock.runExclusive(async () => (await entries()).get(keyOf(id))?.fileId ?? null);
}

/** Notes the id Telegram gave (or used again): it becomes the most recently used. */
export async function rememberFileId(id: UploadIdentity, fileId: string, now = Date.now()): Promise<void> {
  if (!enabled || !fileId) return;
  await lock.runExclusive(async () => {
    const map = await entries();
    const key = keyOf(id);
    map.delete(key);
    map.set(key, { bot: id.bot, kind: id.kind, hash: id.hash, size: id.size, fileId, usedAt: now });
    await save(map);
  });
}

/** Drops an id Telegram refused. */
export async function forgetFileId(id: UploadIdentity): Promise<void> {
  if (!enabled) return;
  await lock.runExclusive(async () => {
    const map = await entries();
    if (map.delete(keyOf(id))) await save(map);
  });
}

/**
 * Telegram refused a send by file_id as a bad request (400): a bad, expired or other-kind id says
 * so in words that vary ("wrong file identifier", "MEDIA_EMPTY", "wrong type…"), so any 400 is
 * taken as the id's — at worst the upload that follows fails the same way. 403, 429 and network
 * errors are not the id's and are thrown as they are.
 */
export function isFileIdRefused(err: unknown): boolean {
  const e = err as { error_code?: unknown } | null;
  return e?.error_code === 400 || /\b400\b.*Bad Request|Bad Request.*\b400\b/i.test(String(err));
}

export interface SavedIdSend<M> {
  identity: UploadIdentity | null;
  /** The send by a saved id. */
  byId(fileId: string): Promise<M>;
  /** The send that uploads the file. */
  upload(): Promise<M>;
  /** The id of what came back, only when it came back as the kind it was sent as. */
  idOf(message: M): string | undefined;
  onLog(message: string): void;
  /** For the log: which file. */
  label: string;
}

/**
 * Sends by the saved file_id when there is one; an id Telegram refuses (`isFileIdRefused`) is
 * forgotten and the file uploaded instead. Whatever was uploaded is noted for next time.
 */
export async function sendWithSavedFileId<M>(send: SavedIdSend<M>): Promise<M> {
  const { identity } = send;
  const saved = identity ? await savedFileId(identity).catch(() => null) : null;
  if (identity && saved) {
    try {
      const message = await send.byId(saved);
      send.onLog(`♻️ [telegram] Sent ${send.label} by its saved file_id — no upload`);
      await rememberFileId(identity, saved).catch(() => {});
      return message;
    } catch (err) {
      if (!isFileIdRefused(err)) throw err;
      await forgetFileId(identity).catch(() => {});
      send.onLog(`[telegram] The saved file_id of ${send.label} was refused (${String(err)}); uploading it again`);
    }
  }
  const message = await send.upload();
  const fileId = send.idOf(message);
  if (identity && fileId) await rememberFileId(identity, fileId).catch(() => {});
  return message;
}
