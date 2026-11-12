/**
 * Sending as the user for the LINE PC bot: one message at a time with a gap between them, the
 * access token kept between sends (finding it means reading LINE's memory, seconds each time), and
 * the server ids of what was sent, so the bot never takes its own answer for a request.
 */
import { basename } from 'node:path';
import { Mutex } from '../flow/lanes';
import { LineError } from '../line/errors';
import type { SendFilesRequest, SendRequest } from '../line/lineService';
import type { SendFilesPlan } from '../line/lineSendFiles';
import type { SendPlan } from '../line/lineSendText';

/** Between two sends: a burst of answers reads as a person typing, not a script. */
export const LINE_SELF_SEND_GAP_MS = 1_000;
const SENT_IDS_KEPT = 500;
/** What LINE sends as a photo (one too large still goes, as a file, in its place); a WebP is made a JPEG first. */
const PHOTO_PATH = /\.(?:jpe?g|png)$/i;

export interface LineSelfSenderDeps {
  send: (req: SendRequest) => Promise<SendPlan>;
  sendFiles: (req: SendFilesRequest) => Promise<SendFilesPlan>;
  /** A fresh read of LINE's memory for access-token candidates. */
  scanTokens: () => Promise<string[]>;
  /**
   * A file as LINE sends it as a photo: a WebP made a JPEG (LINE takes only JPEG and PNG as photos),
   * any other file itself. Without it a WebP goes as a file.
   */
  photoFile?: (path: string) => Promise<string>;
  onLog: (message: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  gapMs?: number;
}

export interface LineSelfQuote {
  /** A message of that chat to quote (LINE's Reply); left out when LINE will not take it. */
  replyTo?: string;
}

export interface LineSelfFileOptions extends LineSelfQuote {
  /** Photos and videos as files. */
  asFile?: boolean;
}

export interface LineSelfSender {
  /** Sends one text to a chat; resolves with LINE's id for it ('' when LINE did not say). */
  send: (chatId: string, text: string, quote?: LineSelfQuote) => Promise<string>;
  /**
   * Sends files on this computer to a chat as LINE shows them (unless `asFile`): two or more photos
   * (a WebP made a JPEG) as one album where the first one is, every other file its own message; a
   * file LINE will not take is logged and left out. The quote goes on the first send unless that is
   * the album. Resolves with how many went.
   */
  sendFiles: (chatId: string, paths: readonly string[], options?: LineSelfFileOptions) => Promise<number>;
  /** Whether this message id is one the bot sent. */
  sentByBot: (messageId: string) => boolean;
  /** The access-token candidates the sends use, read once and kept (a download of a request's photo uses them too). */
  tokens: () => Promise<string[]>;
  /** Forgets the kept token (the bot stopped, or LINE was signed out). */
  reset: () => void;
}

/** A send that certainly did not reach LINE, so trying once more with a new token is safe. */
function notDelivered(err: unknown): boolean {
  return err instanceof LineError && notDeliveredCode(err.code);
}

function notDeliveredCode(code: string): code is 'SEND_FAILED' | 'TOKEN_NOT_FOUND' {
  return code === 'SEND_FAILED' || code === 'TOKEN_NOT_FOUND';
}

/** Refused before anything was sent: the quote, a file, or the text LINE will not take. */
function refusedBeforeSending(err: unknown): boolean {
  return err instanceof LineError && err.code === 'INVALID_ARGUMENT';
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The sends of a list of files: the photos together where the first one is, every other file alone. */
export function fileSends(paths: readonly string[], asFile: boolean): string[][] {
  const photos = asFile ? [] : paths.filter((path) => PHOTO_PATH.test(path));
  if (photos.length < 2) return paths.map((path) => [path]);
  const sends: string[][] = [];
  let placed = false;
  for (const path of paths) {
    if (!PHOTO_PATH.test(path)) sends.push([path]);
    else if (!placed) {
      sends.push(photos);
      placed = true;
    }
  }
  return sends;
}

export function createLineSelfSender(deps: LineSelfSenderDeps): LineSelfSender {
  const lock = new Mutex();
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const gap = deps.gapMs ?? LINE_SELF_SEND_GAP_MS;
  const sent = new Set<string>();
  let tokens: string[] | null = null;
  let lastAt = 0;

  const remember = (id: string | undefined): void => {
    if (!id) return;
    sent.add(id);
    if (sent.size > SENT_IDS_KEPT) sent.delete(sent.values().next().value as string);
  };

  const keptTokens = async (): Promise<string[]> => {
    tokens ??= await deps.scanTokens();
    return tokens;
  };

  // One send after the gap. A kept token LINE no longer takes: scan once more and try again —
  // never after SEND_UNCERTAIN, which may have been delivered.
  const paced = async <T>(run: () => Promise<T>): Promise<T> => {
    const wait = lastAt + gap - now();
    if (wait > 0) await sleep(wait);
    const usedKeptToken = tokens !== null;
    try {
      try {
        return await run();
      } catch (err: unknown) {
        if (!usedKeptToken || !notDelivered(err)) throw err;
        deps.onLog('[lineSelf] the kept LINE token was refused — reading a new one');
        tokens = null;
        return await run();
      }
    } finally {
      lastAt = now();
    }
  };

  // A send quoting a message LINE will not take (unsent since, or not in this chat) is refused
  // before anything goes: it goes once more without the quote. Any other failure is the send's own.
  const quoting = async <T>(replyTo: string | undefined, run: (replyTo?: string) => Promise<T>): Promise<T> => {
    if (!replyTo) return paced(() => run());
    try {
      return await paced(() => run(replyTo));
    } catch (err: unknown) {
      if (!refusedBeforeSending(err)) throw err;
      deps.onLog(`[lineSelf] LINE refused the send quoting message ${replyTo} (${errorText(err)}) — trying once without the quote`);
      return paced(() => run());
    }
  };

  // Every send is the bot's own decision: a repeated line ("Working on it…") or picture is not a
  // mistake to stop, so the ten-minute duplicate guard of `line_send` does not apply.
  const sendText = (chatId: string, text: string, replyTo?: string): Promise<SendPlan> =>
    deps.send({ to: chatId, text, dryRun: false, allowDuplicate: true, tokens: keptTokens, ...(replyTo ? { replyTo } : {}) });

  const postFiles = (chatId: string, files: readonly string[], extra: Pick<SendFilesRequest, 'asFile' | 'replyTo' | 'album'>): Promise<SendFilesPlan> =>
    deps.sendFiles({ to: chatId, files, dryRun: false, allowDuplicate: true, tokens: keptTokens, ...extra });

  // One file per send: alone, a file LINE refuses (a type it does not allow, too large) fails by
  // itself instead of stopping the ones after it.
  const sendOne = async (chatId: string, path: string, asFile: boolean, replyTo?: string): Promise<number> => {
    try {
      const plan = await quoting(replyTo, (quote) => postFiles(chatId, [path], { ...(asFile ? { asFile } : {}), ...(quote ? { replyTo: quote } : {}) }));
      for (const file of plan.files) remember(file.server_message_id);
      return plan.sent_count > 0 ? 1 : 0;
    } catch (err: unknown) {
      deps.onLog(`[lineSelf] could not send ${basename(path)} to ${chatId}: ${errorText(err)}`);
      return 0;
    }
  };

  const sendEach = async (chatId: string, paths: readonly string[]): Promise<number> => {
    let delivered = 0;
    for (const path of paths) delivered += await sendOne(chatId, path, false);
    return delivered;
  };

  // The photos as one album, in one send. Nothing went because of the token: a throw, so `paced`
  // reads a new one. A photo LINE will not take (refused before anything went) must not cost the
  // others: each goes alone. Once the album started, only the photos never tried go alone — one
  // that failed may have reached LINE.
  const sendAlbum = async (chatId: string, paths: readonly string[]): Promise<number> => {
    let plan: SendFilesPlan;
    try {
      plan = await paced(async () => {
        const result = await postFiles(chatId, paths, { album: true });
        if (result.sent_count === 0 && result.error && notDeliveredCode(result.error)) throw new LineError(result.error, result.message ?? result.error);
        return result;
      });
    } catch (err: unknown) {
      deps.onLog(`[lineSelf] could not send ${paths.length} photos to ${chatId} as an album: ${errorText(err)}`);
      return refusedBeforeSending(err) ? sendEach(chatId, paths) : 0;
    }
    for (const file of plan.files) remember(file.server_message_id);
    if (plan.error) deps.onLog(`[lineSelf] the album to ${chatId} stopped: ${plan.message ?? plan.error}`);
    const left = plan.files.filter((file) => file.status === 'not_sent').map((file) => file.path);
    return plan.sent_count + (await sendEach(chatId, left));
  };

  // Before any goes, so a WebP joins the album as its JPEG. One at a time: each is a decode by the
  // platform. One that fails goes as it is.
  const asPhotos = async (paths: readonly string[]): Promise<readonly string[]> => {
    const photoFile = deps.photoFile;
    if (!photoFile) return paths;
    const files: string[] = [];
    for (const path of paths) files.push(await photoFile(path).catch(() => path));
    return files;
  };

  return {
    send: (chatId, text, quote = {}) => lock.runExclusive(async () => {
      const plan = await quoting(quote.replyTo, (replyTo) => sendText(chatId, text, replyTo));
      remember(plan.server_message_id);
      return plan.server_message_id ?? '';
    }),
    sendFiles: (chatId, paths, options = {}) => lock.runExclusive(async () => {
      const asFile = options.asFile === true;
      const sendable = asFile ? paths : await asPhotos(paths);
      let delivered = 0;
      for (const [i, files] of fileSends(sendable, asFile).entries()) {
        delivered += files.length > 1
          ? await sendAlbum(chatId, files)
          : await sendOne(chatId, files[0], asFile, i === 0 ? options.replyTo : undefined);
      }
      return delivered;
    }),
    sentByBot: (messageId) => sent.has(messageId),
    tokens: keptTokens,
    reset: () => {
      tokens = null;
    },
  };
}
