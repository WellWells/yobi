/**
 * The pictures and files a LINE PC request is about (`mediaRows.ts`), made ready for its agent run
 * the way Telegram makes them ready (`botChat/attachmentPlan.ts`): every one planned for the run's
 * model before anything is fetched or a token is touched — over 20 MB, programs, videos and voice
 * messages refused for Telegram's reasons; BYOK takes pictures only; a model that takes no uploads
 * hands them to Gemini — then fetched one by one into the bots' scratch folder under a safe name
 * (a copy the user saved on this computer instead of LINE's server when there is one), a text file
 * read and deleted. The scratch copies go once the run is over (`dispose`).
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { t } from '../i18n';
import {
  BOT_MEDIA_MAX_BYTES,
  providerAttachmentCapacity,
  resolveAttachmentPlan,
  uploadTargetFor,
  type AttachmentCandidate,
  type AttachmentPlan,
  type AttachmentRejectReason,
} from '../botChat/attachmentPlan';
import { botMediaTempDir, deleteTempAttachments, readTextAttachment, safeLocalFileName } from '../botChat/mediaTemp';
import type { BotAgentMedia } from '../botChat/types';
import type { MessageDownloadRequest } from '../line/lineMessageDownload';
import type { DownloadResult } from '../line/lineMediaRows';
import { UPLOAD_CAPABLE_PROVIDER_LABELS } from '../../shared/types';
import type { AgentReplyContext } from '../../shared/types';
import type { LineSelfMediaRef, LineSelfMediaRow } from './mediaRows';

/** What the run is told of a text file, at most (the quoted-message section keeps no more). */
const INLINE_TEXT_MAX = 4_096;

const REJECT_KEYS: Readonly<Record<AttachmentRejectReason, string>> = {
  'too-large': 'bot.lineSelf.media.tooLarge',
  'audio-unsupported': 'bot.lineSelf.media.audio',
  'format-unsupported': 'bot.lineSelf.media.format',
  'provider-cannot-upload': 'bot.lineSelf.media.providerCannotUpload',
  // Nothing is inlined against a budget here; a text file too long is read in part.
  'context-full': 'bot.lineSelf.media.tooLarge',
};

export interface LineSelfMediaDeps {
  /** One message's file from LINE's server; absent = only copies saved on this computer can be read. */
  download?: (req: MessageDownloadRequest) => Promise<DownloadResult>;
  /** The access-token candidates the bot's sends already use (no memory scan per picture). */
  tokens: () => Promise<string[]>;
  /** The stand-in model for media the run's own cannot take ('' = none). */
  fallbackUrl: string;
  strings: Record<string, string>;
  onLog: (message: string) => void;
  /** The scratch folder; absent = the bots' own. */
  dir?: string;
}

export interface LineSelfMediaTarget {
  /** The chat the request came from: the only one a message is fetched from. */
  chatId: string;
  /** Who asked. */
  userId: string;
  /** The run's model. */
  targetUrl: string;
}

/** The plan's view of a row: what the chat says it is. A video is refused outright (a row has no extension to tell). */
function candidateOf(row: LineSelfMediaRow): AttachmentCandidate {
  const size = typeof row.sizeBytes === 'number' ? { sizeBytes: row.sizeBytes } : {};
  if (row.kind === 'image') return { kind: 'photo', mimeType: 'image/jpeg', ...size };
  if (row.kind === 'audio') return { kind: 'audio', ...size };
  return { kind: 'document', ...(row.fileName ? { fileName: row.fileName } : {}), ...size };
}

function planOf(row: LineSelfMediaRow, targetUrl: string): AttachmentPlan {
  if (row.kind === 'video') return { route: 'reject', reason: 'format-unsupported' };
  return resolveAttachmentPlan(candidateOf(row), targetUrl);
}

/** The scratch copy's name: generated, with the sender's extension only when it is a picture or document type. */
function scratchName(row: LineSelfMediaRow, route: 'upload' | 'inline'): string {
  if (route === 'inline') return safeLocalFileName(undefined, 'txt');
  return safeLocalFileName(row.fileName, row.kind === 'image' ? 'jpg' : 'bin');
}

async function fetchRow(row: LineSelfMediaRow, route: 'upload' | 'inline', target: LineSelfMediaTarget, deps: LineSelfMediaDeps, dir: string): Promise<string> {
  const name = scratchName(row, route);
  if (row.localPath) {
    // The plan saw the size LINE recorded; the file on disk may have changed since.
    const { size } = await stat(row.localPath);
    if (size > BOT_MEDIA_MAX_BYTES) throw new Error(`the saved copy is ${size} bytes, over the cap`);
    await mkdir(dir, { recursive: true });
    const copy = join(dir, name);
    await copyFile(row.localPath, copy);
    return copy;
  }
  if (!deps.download) throw new Error('LINE PC cannot fetch files from LINE here');
  const result = await deps.download({ chatId: target.chatId, id: row.id, dir, fileName: name, maxBytes: BOT_MEDIA_MAX_BYTES, tokens: deps.tokens });
  if (result.status !== 'downloaded' || !result.saved_as) throw new Error(`${result.status}${result.note ? `: ${result.note}` : ''}`);
  return result.saved_as;
}

/** The message the request is about as the run is shown it: its sender, its words or the text file read, no "not shown" media. */
function replyFor(ref: LineSelfMediaRef, userId: string, text: string): AgentReplyContext | undefined {
  if (!ref.quoted && !text) return undefined;
  return {
    from: ref.senderName,
    text: text || ref.text,
    // Someone else's photo or file is their words in the run: what a group may have (`othersText.ts`).
    ...(ref.senderId === userId ? { asker: true as const } : {}),
  };
}

function refused(text: string, targetUrl: string): BotAgentMedia {
  return { refusal: text, attachments: [], targetUrl, dispose: async () => {} };
}

/** What a request that is about its media hears when that media could not even be prepared. */
export function lineSelfMediaUnavailable(targetUrl: string, strings: Record<string, string>): BotAgentMedia {
  return refused(t(strings, 'bot.lineSelf.media.downloadFailed'), targetUrl);
}

/**
 * The request's media ready for its run, or a refusal in the user's words when none of it can be
 * handed to the model. Never throws: a failure to fetch counts that one as not read.
 */
export async function prepareLineSelfMedia(ref: LineSelfMediaRef, target: LineSelfMediaTarget, deps: LineSelfMediaDeps): Promise<BotAgentMedia> {
  const dir = deps.dir ?? botMediaTempDir();
  const fetched: string[] = [];
  const dispose = (): Promise<void> => deleteTempAttachments(fetched, dir);
  const planTarget = uploadTargetFor(ref.rows.filter((row) => row.kind !== 'video').map(candidateOf), target.targetUrl, deps.fallbackUrl);
  const viaFallback = planTarget !== target.targetUrl;
  if (viaFallback) deps.onLog('[lineSelf] the bot model takes no uploads — this media goes to the fallback model');
  const capacity = providerAttachmentCapacity(planTarget);
  const attachments: string[] = [];
  const rejections: AttachmentRejectReason[] = [];
  let failures = 0;
  let inlineText = '';

  for (const row of ref.rows) {
    const plan = planOf(row, planTarget);
    if (plan.route === 'reject') {
      rejections.push(plan.reason);
      continue;
    }
    // Fewer slots than an album has photos (a BYOK key): the rest are skipped.
    if ((plan.route === 'upload' && attachments.length >= capacity) || (plan.route === 'inline' && inlineText)) {
      failures += 1;
      continue;
    }
    let file: string;
    try {
      file = await fetchRow(row, plan.route, target, deps, dir);
      fetched.push(file);
    } catch (err: unknown) {
      deps.onLog(`[lineSelf] could not fetch message ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      failures += 1;
      continue;
    }
    if (plan.route === 'upload') {
      attachments.push(file);
      continue;
    }
    const text = await readTextAttachment(file).catch(() => null);
    await deleteTempAttachments([file], dir);
    if (text === null) rejections.push('format-unsupported');
    else inlineText = text.slice(0, INLINE_TEXT_MAX);
  }

  if (attachments.length === 0 && !inlineText) {
    await dispose();
    const key = rejections.length > 0 ? REJECT_KEYS[rejections[0]] : 'bot.lineSelf.media.downloadFailed';
    return refused(t(deps.strings, key, { providers: UPLOAD_CAPABLE_PROVIDER_LABELS }), target.targetUrl);
  }
  const skipped = rejections.length + failures;
  if (skipped > 0) deps.onLog(`[lineSelf] ${skipped} of ${ref.rows.length} picture(s) or file(s) not handed to the model`);
  const replyTo = replyFor(ref, target.userId, inlineText);
  return {
    attachments,
    targetUrl: planTarget,
    ...(replyTo ? { replyTo } : {}),
    ...(viaFallback ? { failureText: t(deps.strings, 'bot.lineSelf.media.fallbackFailed') } : {}),
    dispose,
  };
}

/** The words of a bare "Yobi" sent with a picture or a file: what the user would have asked. */
export function defaultMediaPrompt(ref: LineSelfMediaRef, strings: Record<string, string>): string {
  const pictures = ref.rows.every((row) => row.kind === 'image');
  return t(strings, pictures ? 'bot.lineSelf.media.defaultPrompt.image' : 'bot.lineSelf.media.defaultPrompt.document');
}
