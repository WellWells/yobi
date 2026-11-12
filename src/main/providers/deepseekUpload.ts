import type { WebContents } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { sleep } from './common';
import { PROVIDER_ATTACHMENT_POLICIES } from '../../shared/types';
import { attachmentRefusalFor } from '../../shared/attachmentFormats';
import { UploadError, probeDropTarget, withTrustedFileDrop } from './fileDrop';
import { DEEPSEEK_INPUT_SELECTOR } from './deepseekSendScript';

/*
 * chat.deepseek.com, as read from the signed-in page's bundle and model config.
 *
 * The page listens for a file drop anywhere in the window (a full-screen overlay) and reads it
 * with `webkitGetAsEntry()`, so the trusted CDP drop on the composer works as it does elsewhere.
 * Its file tiles carry hashed class names only, and their status text follows the account
 * language, so the wait reads the page's own file API instead: every accepted file is one
 * `POST upload_file` (after the page's proof-of-work), whose JSON names the file id and parse
 * status; the page then polls `fetch_files` until each id leaves PENDING/PARSING. The send
 * control stays disabled until every file is sendable, which the send script already waits for.
 */

const UPLOAD_FILE_PATH = '/api/v0/file/upload_file';
const FETCH_FILES_PATH = '/api/v0/file/fetch_files';
/** A drop the page refuses (type, size, count) never starts a request. */
const UPLOAD_START_TIMEOUT_MS = 10_000;
const POLL_MS = 250;
const IN_PROGRESS = new Set(['PENDING', 'PARSING']);
const PARSED = 'SUCCESS';
const BODY_EXCERPT_CHARS = 120;

interface ServerFile {
  id?: unknown;
  status?: unknown;
  file_name?: unknown;
}

interface ApiEnvelope {
  data?: { biz_code?: unknown; biz_msg?: unknown; biz_data?: unknown };
}

export interface DeepseekUploadState {
  /** Upload requests the page sent: files it accepted at the drop. */
  started: number;
  /** Files whose upload answered with an id. */
  uploaded: number;
  /** Files the server finished reading. */
  parsed: number;
  /** Why a file can no longer be sent, from the server; null while none failed. */
  failure: string | null;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function parseEnvelope(body: string): ApiEnvelope | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as ApiEnvelope : null;
  } catch {
    return null;
  }
}

/** Follows the page's own file traffic; knows nothing about the DOM. */
export class DeepseekUploadTracker {
  private started = 0;
  private failure: string | null = null;
  private readonly statuses = new Map<string, string>();

  noteRequest(url: string, method: string): void {
    if (method.toUpperCase() === 'POST' && pathOf(url) === UPLOAD_FILE_PATH) this.started += 1;
  }

  noteResponse(url: string, httpStatus: number, body: string): void {
    const route = pathOf(url);
    if (route !== UPLOAD_FILE_PATH && route !== FETCH_FILES_PATH) return;
    const envelope = parseEnvelope(body);
    const data = envelope?.data;
    if (route === UPLOAD_FILE_PATH) {
      if (httpStatus >= 400 || !data) {
        // A short excerpt of what came back instead (a gateway page, a challenge) goes to the log,
        // so a refusal that does not reproduce can still be told apart afterwards.
        const excerpt = body.replace(/\s+/g, ' ').trim().slice(0, BODY_EXCERPT_CHARS);
        this.failure ??= `upload_file answered HTTP ${httpStatus}${excerpt ? ` (${excerpt})` : ''}`;
        return;
      }
      if (data.biz_code !== 0) {
        this.failure ??= `upload_file refused (biz_code ${String(data.biz_code)}: ${String(data.biz_msg ?? '')})`;
        return;
      }
      this.record(data.biz_data as ServerFile | undefined, true);
      return;
    }
    if (!data || data.biz_code !== 0) return;
    const files = (data.biz_data as { files?: unknown } | undefined)?.files;
    if (!Array.isArray(files)) return;
    for (const file of files) this.record(file as ServerFile, false);
  }

  private record(file: ServerFile | undefined, fromUpload: boolean): void {
    if (!file || typeof file.id !== 'string' || typeof file.status !== 'string') return;
    // A poll answers for files of other drafts too; only ids this upload produced count.
    if (!fromUpload && !this.statuses.has(file.id)) return;
    this.statuses.set(file.id, file.status);
    if (file.status !== PARSED && !IN_PROGRESS.has(file.status)) {
      this.failure ??= `${typeof file.file_name === 'string' ? file.file_name : file.id} ended ${file.status}`;
    }
  }

  state(): DeepseekUploadState {
    let parsed = 0;
    for (const status of this.statuses.values()) if (status === PARSED) parsed += 1;
    return { started: this.started, uploaded: this.statuses.size, parsed, failure: this.failure };
  }
}

/** Before the page sees anything: the cap, then each file against the page's measured limits. */
async function checkFiles(paths: string[]): Promise<void> {
  const max = PROVIDER_ATTACHMENT_POLICIES.deepseek.maxFiles;
  if (paths.length > max) throw new UploadError('deepseek', 'too-many', `${paths.length} files exceeds cap ${max}`);
  for (const filePath of paths) {
    let size: number;
    try {
      size = (await fs.stat(filePath)).size;
    } catch (err) {
      throw new UploadError('deepseek', 'file-missing', `${path.basename(filePath)}: ${(err as Error).message}`);
    }
    const refusal = attachmentRefusalFor('deepseek', path.basename(filePath), size);
    if (refusal?.kind === 'tooLarge') {
      throw new UploadError('deepseek', 'too-large', `${path.basename(filePath)} is ${size} bytes, over ${refusal.maxBytes}`);
    }
    if (refusal?.kind === 'format') {
      throw new UploadError('deepseek', 'unsupported-type', `.${refusal.extension} is not on DeepSeek's list`);
    }
  }
}

type DebuggerMessage = (event: unknown, method: string, params: Record<string, unknown>) => void;

export async function uploadFilesToDeepseek(
  wc: WebContents,
  paths: string[],
  timeoutMs: number,
): Promise<string[]> {
  const log: string[] = [];
  const t0 = Date.now();
  const add = (m: string): void => { log.push(`+${Date.now() - t0}ms ${m}`); };

  await checkFiles(paths);
  add(`start ${paths.length} file(s)`);

  const probe = await probeDropTarget(wc, [DEEPSEEK_INPUT_SELECTOR]);
  if (!probe.found) throw new UploadError('deepseek', 'composer-missing', `no composer at ${probe.href}`);
  if (!(probe.w > 0 && probe.h > 0)) {
    throw new UploadError('deepseek', 'composer-missing', `degenerate rect ${probe.w}x${probe.h}`);
  }
  add(`composer @ ${Math.round(probe.x)},${Math.round(probe.y)} (${Math.round(probe.w)}x${Math.round(probe.h)})`);

  // Attached here (not by the drop helper) so the network is watched before the drop lands.
  const dbg = wc.debugger;
  let attachedHere = false;
  if (!dbg.isAttached()) {
    try {
      dbg.attach('1.3');
      attachedHere = true;
    } catch (e) {
      throw new UploadError('deepseek', 'debugger-attach-failed', String((e as Error)?.message ?? e));
    }
  }

  const tracker = new DeepseekUploadTracker();
  const responses = new Map<string, { url: string; status: number }>();
  const onMessage: DebuggerMessage = (_event, method, params) => {
    const requestId = String(params.requestId ?? '');
    if (method === 'Network.requestWillBeSent') {
      const request = params.request as { url?: string; method?: string } | undefined;
      tracker.noteRequest(request?.url ?? '', request?.method ?? '');
      return;
    }
    if (method === 'Network.responseReceived') {
      const response = params.response as { url?: string; status?: number; headers?: Record<string, string> } | undefined;
      const url = response?.url ?? '';
      const route = pathOf(url);
      if (route === UPLOAD_FILE_PATH || route === FETCH_FILES_PATH) responses.set(requestId, { url, status: response?.status ?? 0 });
      return;
    }
    if (method === 'Network.loadingFinished' && responses.has(requestId)) {
      const { url, status } = responses.get(requestId)!;
      responses.delete(requestId);
      dbg.sendCommand('Network.getResponseBody', { requestId })
        .then((result: { body?: string }) => tracker.noteResponse(url, status, result?.body ?? ''))
        .catch(() => tracker.noteResponse(url, status, ''));
    }
  };

  dbg.on('message', onMessage);
  try {
    await dbg.sendCommand('Network.enable');
    await withTrustedFileDrop(wc, 'deepseek', probe, paths, async () => {
      add('drop dispatched');
      const deadline = Date.now() + timeoutMs;
      const startBy = Date.now() + UPLOAD_START_TIMEOUT_MS;
      let state = tracker.state();
      while (Date.now() < deadline) {
        state = tracker.state();
        if (state.failure) throw new UploadError('deepseek', 'rejected', state.failure);
        if (state.parsed >= paths.length) {
          add(`all ${paths.length} attachment(s) uploaded and read`);
          return;
        }
        if (state.started < paths.length && Date.now() > startBy) {
          throw new UploadError(
            'deepseek',
            'rejected',
            `only ${state.started}/${paths.length} file(s) accepted at the dropzone`,
          );
        }
        await sleep(POLL_MS);
      }
      throw new UploadError(
        'deepseek',
        'incomplete',
        `${state.uploaded}/${paths.length} uploaded, ${state.parsed} read`,
      );
    });
  } finally {
    dbg.removeListener('message', onMessage);
    if (attachedHere && dbg.isAttached()) {
      try { dbg.detach(); } catch { }
    }
  }
  return log;
}
