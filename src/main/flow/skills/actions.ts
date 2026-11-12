import { clipboard } from 'electron';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CaptureFormat, FlowButton } from '../../../shared/types';
import { parseLlmExportFormats } from '../../../shared/fileOutputStep';
import { getProviderLabel, preparePromptForProvider, runAutomation } from '../../providers';
import { byokTargetTakesImages, runByokCompletion } from '../../providers/byokClient';
import { loadByokImages, withByokImages } from '../../providers/byokImages';
import { resendIfGeminiCapFell } from '../../providers/geminiPromptTooLong';
import { attachmentRefusalFor, isByokImageFile, megabytesLabel } from '../../../shared/attachmentFormats';
import { repairSplitTableRows } from '../../../shared/markdownTableRepair';
import {
  BOT_PLATFORM_NAMES,
  BYOK_IMAGE_MAX_FILES,
  PROVIDER_ATTACHMENT_POLICIES,
  parseBotPlatform,
  isByokTargetUrl,
  isSocketBotPlatform,
  providerFromUrl,
} from '../../../shared/types';
import type { BotPlatform, SocketBotPlatform } from '../../../shared/types';
import {
  EMPTY_RECIPIENT_DIRECTORY, LINE_SELF_MAX_RECIPIENTS, botStepTargets, isRecipientId, pairedEntries, resolveTargetsForSend, splitTargets,
} from '../../../shared/botRecipients';
import type { RecipientDirectory } from '../../../shared/botRecipients';
import { parseAttachmentList, resolveSafeLocalAttachment } from '../../attachmentGuard';
import { ensureHttpScheme, fetchAndParse } from '../../urlParser';
import { isFetchableWebUrl } from '../../../shared/webUrl';
import { parseWebUrlList } from './urlList';
import { exportLlmAnswer } from './llmExport';
import { sendLog, sendWebNotification } from '../../helpers';
import { clipboardLane, llmLane, pageFetchLane } from '../lanes';
import { yieldRunSlot } from '../flowQueue';
import { FlowAbortError, llmIdleTimeoutMs, resolveDelayMs, withAbort, withStepTimeout } from '../runtime';
import type { BotSendExtras, FlowExecutorDeps, TelegramSendAs } from '../types';
import { FlowUserError } from '../userError';
import * as fs from 'node:fs/promises';
import { getLangCache, t } from '../../i18n';
import { formatLimit, formatMegabytes, parseFlowButtons, withButtonImages } from '../../../shared/ytdl';
import { telegramSendLimitBytes } from '../../telegram/largeUpload';
import { LINE_ACTION_TEXT_MAX, LINE_CAROUSEL_MAX, type LineCarouselItem } from '../../line/pickCarousel';
import { isHttpsPath, isLineSendableImage, lineMenuFits, type LineMenuButton } from '../../line/flowMenu';
import { lineTextAbove } from '../../line/format';
import { isBuiltinFlowId } from '../../../shared/builtinFlows';
import { closePage, closeRunPages, openPage, runPageScript } from './browserPages';
import { inferTelegramSendAs } from '../interpolation';
import { appendMemory, buildMemoryAugmentedPrompt, parseAndStripNewMemory, readMemory } from '../flowMemory';
import { renderFlowMemoryBlock } from '../../memory/memoryPrompt';
import { resolveMemory } from '../../memory/memoryContext';
import { workerWindowUnavailable } from '../../workerWindowError';
import { consoleFallbackEncoding, decodeShellOutput } from './shellOutput';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * `cwd` is honored but deliberately not a declared spec field: `/agent` sets it after validation
 * (which drops undeclared keys), so the model cannot pick its own working directory. A blank cwd
 * keeps the process cwd.
 *
 * `signal` aborts the direct child only. A command that detaches (`start /b`, `Start-Process`,
 * `schtasks`) outlives both this and the timeout — do not present either as containment.
 */
export async function execShell(
  config: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const command = config.command ?? '';
  if (!command.trim()) {
    throw new FlowUserError('flow.error.requiredShellCommand', {}, 'The shell step has no command to run');
  }
  let shell: string | undefined;
  if (process.platform === 'win32') {
    const selected = (config.shell ?? config.windowsShell ?? 'cmd').toLowerCase();
    shell = selected === 'powershell' ? 'powershell.exe' : 'cmd.exe';
  } else {
    const selected = config.shell ?? config.unixShell;
    if (selected && selected !== 'auto') {
      shell = selected;
    } else {
      shell = process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
    }
  }
  const cwd = (config.cwd ?? '').trim();
  // Set by `/agent` after validation, like `cwd`: an installed skill's folder for its scripts.
  const skillDir = (config.skillDir ?? '').trim();
  const fallback = await consoleFallbackEncoding();
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutMs,
      shell,
      encoding: 'buffer',
      ...(cwd ? { cwd } : {}),
      ...(skillDir ? { env: { ...process.env, SKILL_DIR: skillDir } } : {}),
      ...(signal ? { signal } : {}),
    });
    return (decodeShellOutput(stdout, fallback) || decodeShellOutput(stderr, fallback)).trim();
  } catch (err) {
    throw readableShellError(err, command, fallback, timeoutMs);
  }
}

/** The most of a failed command's error output the step's failure shows; the log keeps it all. */
const SHELL_ERROR_DETAIL_MAX = 1_000;

/**
 * Node builds the `Command failed` message from stderr decoded as UTF-8; rebuild it from the
 * console-decoded bytes and keep the rest of the error. The English message (the log, `/agent`'s
 * observation, `flowErrorReason`) stays `Command failed: <command>\n<stderr>`; the person reading
 * the card gets the exit code and the error output in their language, or the step timeout's own
 * sentence when the command was stopped at the time limit.
 */
function readableShellError(err: unknown, command: string, fallback: string | null, timeoutMs: number): unknown {
  if (!(err instanceof Error)) return err;
  const stderr = (err as { stderr?: unknown }).stderr;
  if (!Buffer.isBuffer(stderr) || !err.message.startsWith('Command failed:')) return err;
  const errorOutput = decodeShellOutput(stderr, fallback);
  const english = `Command failed: ${command}\n${errorOutput}`;
  const fields = err as unknown as Record<string, unknown>;
  const detail = errorOutput.trim();
  const code = String(fields.code ?? '?');
  const shown = detail.length > SHELL_ERROR_DETAIL_MAX ? `${detail.slice(0, SHELL_ERROR_DETAIL_MAX)}…` : detail;
  let readable: FlowUserError;
  if (fields.killed === true) {
    readable = new FlowUserError('flow.error.stepTimeout', { seconds: String(Math.ceil(timeoutMs / 1_000)) }, english);
  } else if (detail) {
    readable = new FlowUserError('flow.error.shellFailed', { code, detail: shown }, english);
  } else {
    readable = new FlowUserError('flow.error.shellFailedQuiet', { code }, english);
  }
  for (const key of ['code', 'killed', 'signal'] as const) {
    if (key in err) Object.assign(readable, { [key]: fields[key] });
  }
  return readable;
}

export interface TrustedCallsOptions {
  /** The command as the model wrote it: a failure names it, as a shell's failure does. */
  command: string;
  cwd: string;
  skillDir?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * A trusted command (`/agent`'s shellTrust): each `&&` part started as its own program with its
 * parsed words, never through a shell, stopping at the first that fails — what `a && b` does.
 * The timeout covers all the parts together, as it covers the one shell otherwise.
 */
export async function execTrustedCalls(
  calls: readonly { file: string; args: readonly string[] }[],
  options: TrustedCallsOptions,
): Promise<string> {
  const fallback = await consoleFallbackEncoding();
  const deadline = Date.now() + options.timeoutMs;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  try {
    for (const call of calls) {
      const result = await execFileAsync(call.file, [...call.args], {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        timeout: Math.max(1_000, deadline - Date.now()),
        encoding: 'buffer',
        windowsHide: true,
        ...(options.skillDir ? { env: { ...process.env, SKILL_DIR: options.skillDir } } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      stdout.push(result.stdout);
      stderr.push(result.stderr);
    }
  } catch (err) {
    throw readableShellError(err, options.command, fallback, options.timeoutMs);
  }
  return (decodeShellOutput(Buffer.concat(stdout), fallback) || decodeShellOutput(Buffer.concat(stderr), fallback)).trim();
}

async function fetchPage(url: string): Promise<{ text: string; image: string }> {
  const { cleanedText, image = '' } = await pageFetchLane.runExclusive(
    () => fetchAndParse(url, { bodyText: true }),
  );
  return { text: cleanedText, image };
}

/** A row that is not a web address: the user can fix it, so it is said in their language. */
function nonWebUrlError(url: string): FlowUserError {
  return new FlowUserError('flow.error.httpUrlOnly', { url }, 'browser: only http:// and https:// pages can be fetched.');
}

export async function execBrowser(
  config: Record<string, string>,
  onOutput?: FlowExecutorDeps['onStepOutput'],
): Promise<string> {
  const url = config.url ?? '';
  const requireAll = config.requireAll === 'true';
  // Only the editor's own rows keep their positions; a list from a variable or a model is filtered.
  const urlArray = parseWebUrlList(url, config.__urlRows === 'true');
  if (requireAll && (!url.trim() || urlArray?.length === 0)) {
    throw new FlowUserError('flow.error.browserNoUrls', {}, 'browser: at least one page URL is required');
  }
  if (!url) {
    onOutput?.({ page1: '' });
    return '';
  }

  const includeImage = config.includeImage === 'true';

  const pageFields: Record<string, string> = Object.fromEntries(
    Array.from({ length: urlArray?.length || 1 }, (_, index) => [`page${index + 1}`, '']),
  );
  onOutput?.(pageFields);

  // A lone URL is logged whole: the log panel shortens it on screen and opens it on click.
  const isLoneUrl = !urlArray && !/\s/.test(url.trim());
  const urlPreview = isLoneUrl || url.length <= 120 ? url : `${url.slice(0, 120)}…`;
  sendLog(`🌐 [Flow] Browser step URL: ${urlPreview}`);

  if (urlArray && urlArray.length > 0) {
    if (includeImage) sendLog('🖼️ [Flow] Browser: cover image is single-URL only — skipped for batch input');
    sendLog(`🌐 [Flow] Batch URL input: ${urlArray.length} URLs detected`);
    const parts: string[] = [];
    let firstError: unknown;
    let blankRow: FlowUserError | undefined;
    for (let i = 0; i < urlArray.length; i++) {
      const batchUrl = urlArray[i];
      sendLog(`🌐 [${i + 1}/${urlArray.length}] Fetching: ${batchUrl}`);
      try {
        if (!batchUrl.trim()) {
          // A row whose variable came out empty: said as such, not as a page that failed to load.
          const blank = new FlowUserError('flow.error.browserBlankUrl', { number: String(i + 1) }, `browser: URL ${i + 1} is empty`);
          blankRow ??= blank;
          throw blank;
        }
        if (!isFetchableWebUrl(batchUrl)) throw nonWebUrlError(batchUrl);
        const { text } = await fetchPage(batchUrl);
        if (requireAll && !text.trim()) throw new Error('The page returned no readable text');
        parts.push(text);
        pageFields[`page${i + 1}`] = text;
        sendLog(`✅ [${i + 1}/${urlArray.length}] OK — ${text.length} chars`);
      } catch (err) {
        firstError ??= err;
        const msg = err instanceof Error ? err.message : String(err);
        sendLog(`❌ [${i + 1}/${urlArray.length}] Failed: ${msg}`);
      }
    }
    if (requireAll && parts.length !== urlArray.length) {
      if (blankRow) throw blankRow;
      const failed = String(urlArray.length - parts.length);
      const total = String(urlArray.length);
      const reason = firstError instanceof Error ? firstError.message : String(firstError);
      throw new FlowUserError('flow.error.browserIncomplete', { failed, total }, `browser: ${failed} of ${total} required pages could not be read — ${reason}`);
    }
    // Every page failing must throw: the executor's fail-soft (`.isFailed`, soft-failure count,
    // failure notice) only sees a throw, and '' reads downstream as "nothing new".
    if (parts.length === 0) {
      if (urlArray.length === 1) throw firstError;
      const msg = firstError instanceof Error ? firstError.message : String(firstError);
      throw new Error(`browser: none of the ${urlArray.length} pages could be fetched — ${msg}`);
    }
    sendLog(`🌐 [Flow] Batch complete: ${parts.length}/${urlArray.length} succeeded`);
    onOutput?.(pageFields);
    return parts.join('\n\n---\n\n');
  }

  if (!isFetchableWebUrl(url)) throw nonWebUrlError(url);

  const { text, image } = await fetchPage(url);
  if (requireAll && !text.trim()) {
    throw new FlowUserError('flow.error.browserIncomplete', { failed: '1', total: '1' }, 'browser: the required page returned no readable text');
  }
  sendLog(`✅ [Flow] Browser: ${text.length} chars`);
  onOutput?.({ page1: text });

  if (includeImage) {
    sendLog(`🖼️ [Flow] Browser: cover image ${image ? `→ ${image}` : 'not found'}`);
    return JSON.stringify({ output: text, image });
  }

  return text;
}

export async function execBrowserOpen(config: Record<string, string>): Promise<string> {
  const url = ensureHttpScheme(config.url ?? '');
  if (!url) throw new FlowUserError('flow.error.browserOpenNoUrl', {}, 'browser_open requires a url');
  const flowId = (config.__flowId ?? '').trim();
  const show = config.show === 'true';
  const { id, title, url: finalUrl } = await openPage(url, { show, flowId });
  sendLog(`🌐 [Flow] Opened page ${id} → ${finalUrl}${show ? ' (visible)' : ''}`);
  return JSON.stringify({ id, title, url: finalUrl });
}

export async function execBrowserJs(config: Record<string, string>, timeoutMs: number): Promise<string> {
  const pageId = (config.page ?? '').trim();
  const code = config.code ?? '';
  if (!pageId) {
    throw new FlowUserError(
      'flow.error.noPage',
      {},
      'browser_js: no page handle (set page to a {{tab}} from browser_open)',
    );
  }
  if (!code.trim()) return '';
  return runPageScript(pageId, code, timeoutMs);
}

export function execBrowserClose(config: Record<string, string>): string {
  const handle = (config.page ?? '').trim();
  const flowId = (config.__flowId ?? '').trim();
  if (handle.toLowerCase() === 'all') {
    closeRunPages(flowId);
    sendLog('🧹 [Flow] Closed all pages opened by this run');
    return '';
  }
  const ok = closePage(handle);
  sendLog(ok ? `🧹 [Flow] Closed page ${handle}` : `⚠️ [Flow] No live page for handle ${handle}`);
  return '';
}

/** Why the web page would refuse this file (its measured size and format limits), as an English log clause. */
async function pageRefusalOf(providerUrl: string, filePath: string): Promise<string | null> {
  const { size } = await fs.stat(filePath);
  const refusal = attachmentRefusalFor(providerFromUrl(providerUrl), filePath, size);
  if (!refusal) return null;
  return refusal.kind === 'tooLarge'
    ? `takes files up to ${megabytesLabel(refusal.maxBytes)} MB`
    : `does not accept .${refusal.extension} files`;
}

async function resolveLlmAttachments(
  config: Record<string, string>,
  providerUrl: string,
): Promise<string[]> {
  const raw = (config.attachments ?? '').trim();
  if (!raw) return [];

  const providerLabel = getProviderLabel(providerUrl);
  const byok = isByokTargetUrl(providerUrl);
  if (byok && !byokTargetTakesImages(providerUrl)) {
    sendLog(`⚠️ [Flow] ${providerLabel} cannot take file attachments — sending the prompt as text only`);
    return [];
  }
  const maxFiles = byok ? BYOK_IMAGE_MAX_FILES : PROVIDER_ATTACHMENT_POLICIES[providerFromUrl(providerUrl)].maxFiles;
  if (maxFiles <= 0) {
    sendLog(`⚠️ [Flow] ${providerLabel} cannot take file attachments — sending the prompt as text only`);
    return [];
  }

  let authorizedPaths: string[] = [];
  try {
    const parsed: unknown = JSON.parse(config.__attachmentAllowlist ?? '[]');
    if (Array.isArray(parsed)) authorizedPaths = parsed.filter((v): v is string => typeof v === 'string');
  } catch {}

  const candidates = parseAttachmentList(raw);
  const resolved: string[] = [];
  for (const candidate of candidates) {
    if (byok && !isByokImageFile(undefined, candidate)) {
      sendLog(`⚠️ [Flow] Attachment skipped (${candidate}): ${providerLabel} takes only PNG, JPEG or WebP images`);
      continue;
    }
    try {
      const safePath = await resolveSafeLocalAttachment(candidate, authorizedPaths);
      const refusal = byok ? null : await pageRefusalOf(providerUrl, safePath);
      if (refusal) {
        sendLog(`⚠️ [Flow] Attachment skipped (${candidate}): ${providerLabel} ${refusal}`);
        continue;
      }
      resolved.push(safePath);
    } catch (err) {
      sendLog(`⚠️ [Flow] Attachment skipped (${candidate}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (resolved.length > maxFiles) {
    sendLog(`⚠️ [Flow] ${providerLabel} accepts at most ${maxFiles} file(s) — dropping ${resolved.length - maxFiles}`);
    return resolved.slice(0, maxFiles);
  }
  return resolved;
}

/**
 * `timeoutMs` bounds the whole step (a caller's run budget may shorten it); the provider stops on
 * its own after the response timeout passes with no new word, as it does in chat.
 */
export async function execLlm(
  config: Record<string, string>,
  deps: FlowExecutorDeps,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const prompt = config.prompt ?? '';
  const files: Record<CaptureFormat, string> = { png: '', webp: '', pdf: '' };
  deps.onStepOutput?.({ text: '', file: '', ...files });
  // After interpolation: a prompt made only of variables that are empty this run is nothing to send.
  if (!prompt.trim()) {
    throw new FlowUserError('flow.error.requiredLlmPrompt', {}, 'The AI step prompt is empty, so nothing was sent');
  }
  const idleMs = Math.min(llmIdleTimeoutMs(deps), timeoutMs);
  const providerUrl = config.provider || deps.getTargetUrl();
  const isByokTarget = isByokTargetUrl(providerUrl);

  const useMemory = config.useMemory === 'true';
  const flowId = (config.__flowId ?? '').trim();
  let effectivePrompt = prompt;
  if (config.useUserMemory === 'true') {
    // Ahead of the prompt (flow memory, when on, follows it). Read-only: nothing a flow's model says is remembered.
    const { entries } = await resolveMemory({ surface: 'flow', flowOptIn: true });
    const block = renderFlowMemoryBlock(entries);
    if (block) effectivePrompt = `${block}\n\n${effectivePrompt}`;
  }
  if (useMemory && flowId) {
    try {
      effectivePrompt = buildMemoryAugmentedPrompt(
        effectivePrompt,
        await readMemory(flowId),
        isByokTarget ? undefined : (p) => !preparePromptForProvider(p, providerUrl).truncated,
      );
    } catch (err) {
      sendLog(`⚠️ [Flow] Flow memory read failed, continuing without memory: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let promptForModel = effectivePrompt;

  const attachments = await resolveLlmAttachments(config, providerUrl);

  // The wait for the model and the request lend the run's queue slot (`yieldRunSlot`); the step
  // timeout stays inside, so taking the slot back afterwards never times out an answered step.
  let response: string;
  if (isByokTarget) {
    const byokAbort = new AbortController();
    const images = attachments.length > 0 ? await loadByokImages(attachments) : undefined;
    const result = await withAbort(yieldRunSlot(() => withStepTimeout(
      runByokCompletion(providerUrl, withByokImages(promptForModel, images), idleMs, byokAbort.signal),
      timeoutMs,
      'llm',
      () => byokAbort.abort(),
      signal,
    )), signal);
    response = result.response;
  } else {
    const result = await withAbort(
      yieldRunSlot(() => llmLane.runExclusive(async () => {
        if (signal?.aborted) throw new FlowAbortError();
        // Prepared once the lane is ours, and again when the Gemini page refused it unsent because
        // its cap fell on the way: the step is then cut to the cap that holds, as it would have been
        // had that cap been known up front.
        return resendIfGeminiCapFell(async () => {
          const preparedPrompt = preparePromptForProvider(effectivePrompt, providerUrl);
          if (preparedPrompt.removedBlankLines) {
            sendLog(`✂️ [Flow] Removed blank lines for ${getProviderLabel(providerUrl)} input`);
          }
          if (preparedPrompt.truncated) {
            sendLog(`✂️ [Flow] Truncated ${getProviderLabel(providerUrl)} input to ${preparedPrompt.capLabel}`);
          }
          promptForModel = preparedPrompt.prompt;
          const workerWin = deps.ensureWorkerWin ? await deps.ensureWorkerWin() : deps.getWorkerWin();
          if (!workerWin || workerWin.isDestroyed()) throw workerWindowUnavailable();
          return withStepTimeout(
            runAutomation(workerWin, promptForModel, idleMs, providerUrl, attachments),
            timeoutMs,
            'llm',
            () => { workerWin.webContents.loadURL('about:blank').catch(() => {}); },
            signal,
          );
        }, (cap) => sendLog(`✂️ [Flow] ${getProviderLabel(providerUrl)} takes only ${cap} characters now — sending the step again`));
      })),
      signal,
    );
    response = result.response;
  }

  // A wrapped table row has to be rejoined here rather than at each sink: this answer goes on
  // to a file, an email body, a bot message and the next step's input, and only one of those
  // ends up in a document the renderer would have repaired on the way out.
  response = repairSplitTableRows(response);

  let finalResponse = response;
  if (useMemory && flowId) {
    const { cleaned, newMemory } = parseAndStripNewMemory(response);
    finalResponse = cleaned;
    if (newMemory) {
      try {
        await appendMemory(flowId, newMemory);
        sendLog(`🧠 [Flow] Flow memory updated (+1 entry)`);
      } catch (err) {
        sendLog(`⚠️ [Flow] Flow memory write failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (config.saveToHistory === 'true' && deps.onSaveHistory) {
    await deps.onSaveHistory({
      prompt: promptForModel,
      response: finalResponse,
      providerLabel: getProviderLabel(providerUrl),
    });
  }
  const exportFormats = parseLlmExportFormats(config.exportFormat);
  if (exportFormats.length === 0) {
    deps.onStepOutput?.({ text: finalResponse, file: '', ...files });
    return finalResponse;
  }
  const filePath = await exportLlmAnswer(config, deps, finalResponse, providerUrl, exportFormats, files, signal);
  if (signal?.aborted) throw new FlowAbortError();
  deps.onStepOutput?.({ text: finalResponse, file: filePath, ...files });
  return filePath;
}

export function execClipboard(config: Record<string, string>): Promise<string> {
  return clipboardLane.runExclusive(async () => {
    const action = config.action ?? 'read';
    if (action === 'write') {
      await clipboard.writeText(config.text ?? '');
      return '';
    }
    return await clipboard.readText();
  });
}

export function execComment(config: Record<string, string>): string {
  return (config.note ?? '').trim();
}

/** No output: the run panel showed the English `delayed 1000ms` under the step; the card says how long. */
export async function execDelay(config: Record<string, string>): Promise<string> {
  const ms = resolveDelayMs(config);
  await new Promise((resolve) => setTimeout(resolve, ms));
  return '';
}

export function execNotify(config: Record<string, string>): string {
  const title = config.title || 'Yobi';
  const body = config.body ?? '';
  sendWebNotification(title, body, 'info');
  sendLog(`📢 [Flow] ${title}: ${body}`);
  return body;
}

export async function execCapture(config: Record<string, string>, deps: FlowExecutorDeps): Promise<string> {
  if (!deps.captureScreen) throw new Error('Screen capture requires captureScreen dependency');
  const format = config.format === 'jpg' ? 'jpg' : 'png';
  const outputDir = (config.output ?? '').trim();
  return deps.captureScreen(format, outputDir || undefined);
}

function resolveAttachmentSendAs(
  attachmentType: string | undefined,
  attachment: string,
): TelegramSendAs {
  const choice = (attachmentType ?? 'auto').toLowerCase();
  if (choice === 'photo') return 'photo';
  if (choice === 'document') return 'document';
  if (choice === 'video') return 'video';
  if (choice === 'audio') return 'audio';
  if (/^https?:\/\//i.test(attachment)) return 'auto';
  return inferTelegramSendAs(attachment);
}

function resolveBotPlatform(config: Record<string, string>): BotPlatform {
  return parseBotPlatform(config.platform) ?? parseBotPlatform(config.__triggerPlatform) ?? 'telegram';
}

const LINE_VIDEO_PATH_RE = /\.mp4$/i;

/** LINE plays an https mp4 it fetches itself, but only with an https jpeg/png to show first. */
function isLineSendableVideo(attachment: string, preview: string): boolean {
  return isHttpsPath(attachment, LINE_VIDEO_PATH_RE) && isLineSendableImage(preview);
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim());
}

/**
 * The step's buttons, ready for the Telegram sender. Buttons run the flow's own bot command again,
 * so a flow without one (a schedule) gets none.
 */
function stepButtons(config: Record<string, string>): BotSendExtras | undefined {
  const items = parseFlowButtons(config.buttons ?? '');
  if (items.length === 0) return undefined;
  const flowId = (config.__flowId ?? '').trim();
  if (!flowId || !(config.__botCommand ?? '').trim()) {
    sendLog('⚠️ [Bot] Buttons skipped — they rerun the flow\'s bot command, and this flow has none');
    return undefined;
  }
  const userId = Number(config.__triggerUserId);
  return { buttons: { flowId, items, ...(Number.isSafeInteger(userId) && userId !== 0 ? { userId } : {}) } };
}

/**
 * The Telegram message that started this run, when `chatId` is the chat it was sent in: what a
 * send there quotes. Any other recipient (a channel, everyone paired) gets the message unquoted.
 */
function triggerMessageIn(config: Record<string, string>, chatId: number): number | undefined {
  const messageId = Number(config.__triggerMessageId);
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return undefined;
  return (config.__triggerChatId ?? '').trim() === String(chatId) ? messageId : undefined;
}

/** The step's extras for one recipient: its buttons, and the quote when it is the asking chat. */
function extrasFor(config: Record<string, string>, extras: BotSendExtras | undefined, chatId: number): BotSendExtras | undefined {
  const replyTo = replacesTrigger(config) ? undefined : triggerMessageIn(config, chatId);
  return replyTo ? { ...extras, replyTo } : extras;
}

/**
 * The step takes the place of the Telegram message that started the run (`replaceTrigger`; a
 * pasted link answered with its video and the link in the caption): sent
 * unquoted, and once it is out in that chat the message is deleted. Only a message that said
 * nothing but the input (`TRIGGER_IS_INPUT_VARIABLE`): a link among someone's words stays where
 * it is, quoted as usual.
 */
function replacesTrigger(config: Record<string, string>): boolean {
  const value = (config.replaceTrigger ?? '').trim().toLowerCase();
  return (value === 'true' || value === '1') && config.__triggerIsInput === '1';
}

/**
 * Deletes the message that started the run once the step reached its chat. Telegram lets a bot
 * delete another's message only in a private chat or as a group admin with that right: a refusal
 * leaves it there and is only logged.
 */
async function deleteReplacedTrigger(config: Record<string, string>, deps: FlowExecutorDeps, sentTo: readonly number[]): Promise<void> {
  if (!replacesTrigger(config) || !deps.deleteTelegramMessage) return;
  const chatId = Number(config.__triggerChatId);
  const messageId = sentTo.includes(chatId) ? triggerMessageIn(config, chatId) : undefined;
  if (messageId === undefined) return;
  const deleted = await deps.deleteTelegramMessage(chatId, messageId).catch(() => false);
  sendLog(deleted
    ? `🧹 [Bot] Deleted message ${messageId} in chat ${chatId}: the answer took its place`
    : `⚠️ [Bot] Could not delete message ${messageId} in chat ${chatId} (no right to here, or too old) — left as it is`);
}

interface LineChoices {
  /** Choices with a picture LINE can show (a person's stories): cards to tap. */
  cards: LineCarouselItem[];
  /** The message with a line for every other choice. */
  message: string;
  /** The message with a line for every choice: what goes out if the cards cannot. */
  fallback: string;
  /** The choices that are not cards, as the buttons of a menu card (`sendLineMenu`). */
  menu: LineMenuButton[];
}

/**
 * LINE has no inline buttons: each choice becomes the line that does the same — the command, or
 * for a built-in (which runs on a pasted link, not a command) the link and the choice alone. A
 * choice with a picture (`buttonImages`) is a card instead, which sends that line when tapped; a
 * picture step's other choices can be a menu card's buttons, which stand for their lines.
 */
function lineChoices(message: string, config: Record<string, string>): LineChoices {
  const items = withButtonImages(parseFlowButtons(config.buttons ?? ''), config.buttonImages);
  const command = (config.__botCommand ?? '').trim();
  if (items.length === 0 || !command) return { cards: [], message, fallback: message, menu: [] };
  const builtin = isBuiltinFlowId((config.__flowId ?? '').trim());
  const lineOf = (b: FlowButton): string => (builtin ? b.input : `/${command} ${b.input}`);
  const carded = items
    .filter((b) => b.image && isLineSendableImage(b.image) && lineOf(b).length <= LINE_ACTION_TEXT_MAX)
    .slice(0, LINE_CAROUSEL_MAX);
  const withHints = (choices: readonly FlowButton[]): string => {
    if (choices.length === 0) return message;
    const lines = choices.map((b) => t(getLangCache(), 'flow.bot.buttonHint', { label: b.label, command: lineOf(b) }));
    return lineTextAbove(message, lines.join('\n'));
  };
  const rest = items.filter((b) => !carded.includes(b));
  return {
    cards: carded.map((b) => ({ label: b.label, image: b.image ?? '', text: lineOf(b) })),
    message: withHints(rest),
    fallback: withHints(items),
    menu: rest.map((b) => ({ label: b.label, line: lineOf(b), ...(b.rowStart ? { rowStart: true } : {}) })),
  };
}

/**
 * A file over what the bot can send right now (`telegramSendLimitBytes`: the Bot API's 50 MB, or
 * Telegram's 2000 MiB once large uploads are set up) would come back as an English 413 or never
 * go up at all; say it first. Only for files this run produced: any other path is the attachment
 * guard's to judge, and its size is nobody's business before that.
 */
async function requireTelegramSize(attachment: string, producedFiles: readonly string[]): Promise<void> {
  if (!producedFiles.includes(attachment)) return;
  let size: number;
  try {
    size = (await fs.stat(attachment)).size;
  } catch {
    return;
  }
  const limit = telegramSendLimitBytes();
  if (size <= limit) return;
  throw new FlowUserError(
    'flow.error.botFileTooLarge',
    { size: formatMegabytes(size), limit: formatLimit(limit) },
    `The file is ${formatMegabytes(size)}; this Telegram bot can send up to ${formatLimit(limit)}`,
  );
}

/** The files this run produced, the only local paths a bot step may send. */
function attachmentAllowlist(config: Record<string, string>): string[] {
  try {
    const parsed: unknown = JSON.parse(config.__attachmentAllowlist ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Neither a message nor anything attached reached the send: the step delivered nothing. */
function nothingToSend(): FlowUserError {
  return new FlowUserError('flow.error.requiredBotMessage', {}, 'The bot step has no message and no attachment, so nothing was sent');
}

export async function execBot(
  config: Record<string, string>,
  deps: FlowExecutorDeps,
): Promise<string> {
  const message = config.message ?? '';
  const explicitAttachment = (config.attachment ?? '').trim();
  const legacyMagicPath = (config.__magicUploadPath ?? '').trim();
  const legacyMagicCaption = (config.__magicUploadCaption ?? '').trim();

  const platform = resolveBotPlatform(config);
  const tokens = splitTargets(botStepTargets(config));
  const written = platform === 'lineSelf' ? writtenInStep(config) : undefined;
  const { targets: rawTargets, everyone, picked } = await resolveNamedRecipients(tokens, platform, deps, written);
  const originalChatIdsTemplate = (config.__originalChatIdsTemplate ?? '').trim();

  if (platform === 'line') {
    const choices = lineChoices(message, config);
    return execBotLine(deps, {
      message: choices.message,
      cards: choices.cards,
      cardsFallback: choices.fallback,
      cardsAltText: message,
      menu: choices.menu,
      menuText: message,
      attachmentType: (config.attachmentType ?? '').trim(),
      explicitAttachment,
      preview: config.preview ?? '',
      legacyMagicPath,
      legacyMagicCaption,
      rawTargets,
      originalChatIdsTemplate,
      everyone,
    });
  }

  if (isSocketBotPlatform(platform)) {
    return execBotSocket(platform, config, deps, {
      message, explicitAttachment, legacyMagicPath, legacyMagicCaption, rawTargets, originalChatIdsTemplate, everyone, picked,
    });
  }

  const explicitIds = rawTargets
    .map(Number)
    .filter((n) => Number.isFinite(n) && n !== 0);

  const invalidTargets = rawTargets.filter((value) => {
    const numeric = Number(value);
    return !Number.isFinite(numeric) || numeric === 0;
  });
  if (invalidTargets.length > 0) {
    sendLog(`⚠️ [Bot] Ignoring non-numeric Telegram recipient(s): ${invalidTargets.join(', ')} — pick the target from the recipient picker`);
  }

  const chatIdsWereConfiguredButEmpty = originalChatIdsTemplate !== '' && explicitIds.length === 0 && !everyone;

  if (chatIdsWereConfiguredButEmpty) {
    sendLog('⚠️ [Bot] chatIds resolved to empty (no trigger context) — skipping send');
    return explicitAttachment || message || legacyMagicPath;
  }

  async function broadcast(
    onChat: (chatId: number) => Promise<void>,
    onUser: (user: { userId: number; username?: string; firstName?: string }) => Promise<void>,
  ): Promise<void> {
    if (explicitIds.length > 0) {
      for (const chatId of explicitIds) await onChat(chatId);
      return;
    }
    const pairedUsers = deps.getPairedUsers?.() ?? [];
    if (pairedUsers.length === 0) {
      throw new FlowUserError('flow.error.noPairedUsers', { bot: 'Telegram' }, 'No paired Telegram users found');
    }
    for (const user of pairedUsers) await onUser(user);
  }

  const extras = stepButtons(config);
  const attachment = explicitAttachment || legacyMagicPath;
  // One file per line (a post's photos and videos, its MP3s): all of them, as one album.
  const album = attachment.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (album.length > 1) {
    if (!deps.sendTelegramAlbum) throw new Error('sendTelegramAlbum not configured in FlowExecutorDeps');
    const sendAlbum = deps.sendTelegramAlbum;
    const authorizedPaths = attachmentAllowlist(config);
    for (const file of album) await requireTelegramSize(file, authorizedPaths);
    const caption = (explicitAttachment ? message : legacyMagicCaption).trim() || undefined;
    // A Telegram album cannot carry buttons: they follow it in a short message of their own, which
    // names a lone button ("analyze" under a forwarded post) and only points at several.
    const sendButtons = extras ? deps.sendTelegramMessage : undefined;
    const items = extras?.buttons?.items ?? [];
    const buttonsLine = items.length === 1
      ? t(getLangCache(), 'flow.bot.albumButton', { label: items[0].label })
      : t(getLangCache(), 'flow.bot.albumButtons');
    // The album quotes the asking message; the buttons line under it does not quote it again.
    const albumTo = (target: number): Promise<void> => {
      const replyTo = triggerMessageIn(config, target);
      return replyTo ? sendAlbum(target, album, caption, authorizedPaths, replyTo) : sendAlbum(target, album, caption, authorizedPaths);
    };
    await broadcast(
      async (chatId) => {
        await albumTo(chatId);
        if (sendButtons) await sendButtons(chatId, buttonsLine, extras);
      },
      async (user) => {
        await albumTo(user.userId);
        if (sendButtons) await sendButtons(user.userId, buttonsLine, extras);
      },
    );
    sendLog(`📤 [Bot] Sent an album of ${album.length} files${sendButtons ? ', its buttons after it' : ''}`);
    return attachment;
  }
  if (attachment) {
    if (!deps.sendTelegramFile) throw new Error('sendTelegramFile not configured in FlowExecutorDeps');
    const sendFile = deps.sendTelegramFile;
    const sendMessageFallback = deps.sendTelegramMessage;
    const sendAs = resolveAttachmentSendAs(config.attachmentType, attachment);
    const text = (explicitAttachment ? message : legacyMagicCaption).trim();
    const caption = text || undefined;
    const isRemote = /^https?:\/\//i.test(attachment);
    const authorizedPaths = attachmentAllowlist(config);
    await requireTelegramSize(attachment, authorizedPaths);

    const sendToTarget = async (target: number, label: string): Promise<void> => {
      const targetExtras = extrasFor(config, extras, target);
      try {
        await sendFile(target, attachment, sendAs, caption, authorizedPaths, targetExtras);
        sendLog(`📤 [Bot] Sent ${sendAs} to ${label}: ${attachment}`);
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        if (isRemote && caption && sendMessageFallback) {
          sendLog(`⚠️ [Bot] ${sendAs} send failed (${reason}); resending as text without the image`);
          await sendMessageFallback(target, caption, targetExtras);
          sendLog(`📤 [Bot] Sent text (no image) to ${label}`);
          return;
        }
        throw err;
      }
    };

    await broadcast(
      (chatId) => sendToTarget(chatId, `chat ${chatId}`),
      (user) => sendToTarget(user.userId, `user ${user.userId}`),
    );
    await deleteReplacedTrigger(config, deps, explicitIds);
    return attachment;
  }

  if (!message.trim()) throw nothingToSend();
  if (!deps.sendTelegramMessage) throw new Error('Telegram bot is not configured in FlowExecutorDeps');
  const sendMessage = deps.sendTelegramMessage;
  await broadcast(
    async (chatId) => {
      await sendMessage(chatId, message, extrasFor(config, extras, chatId));
      sendLog(`📤 [Bot] Sent to chat ${chatId}`);
    },
    async (user) => {
      await sendMessage(user.userId, message, extrasFor(config, extras, user.userId));
      sendLog(`📤 [Bot] Sent to user ${user.userId} (${user.username ?? user.firstName ?? ''})`);
    },
  );
  await deleteReplacedTrigger(config, deps, explicitIds);
  return message;
}

interface BotSendParts {
  message: string;
  /** LINE: choices sent first as cards to tap; `message` then names only the others. */
  cards?: LineCarouselItem[];
  /** LINE: the message naming every choice, for when the cards cannot be sent. */
  cardsFallback?: string;
  /** LINE: the step's message alone, which stands for the cards in a notification. */
  cardsAltText?: string;
  /** LINE: the choices that are not cards, for a picture step's menu card. */
  menu?: LineMenuButton[];
  /** LINE: the step's message without the choices' lines: the menu card's text. */
  menuText?: string;
  /** The step's `attachmentType`: a menu card only for a `photo`. */
  attachmentType?: string;
  explicitAttachment: string;
  /** One preview image per attachment line, for LINE videos. */
  preview: string;
  legacyMagicPath: string;
  legacyMagicCaption: string;
  rawTargets: string[];
  originalChatIdsTemplate: string;
  /** The step said "all": every paired user, even though the field was not blank. */
  everyone: boolean;
}

/**
 * Names in the recipient field ("me", "Alice", a channel title) looked up among the paired
 * chats. One that matches nothing — or several — is never guessed at: if nothing else is left to
 * send to, the step fails and says which name, rather than reporting success for a message that
 * went nowhere. A token `written` says the step did not choose itself is looked up among the paired
 * chats only, never LINE PC's own groups and friends; `picked` is what the step's own tokens became.
 */
async function resolveNamedRecipients(
  tokens: string[],
  platform: BotPlatform,
  deps: FlowExecutorDeps,
  written: (token: string) => boolean = () => true,
): Promise<{ targets: string[]; everyone: boolean; picked: ReadonlySet<string> }> {
  const own = tokens.filter(written);
  const filled = tokens.filter((token) => !written(token));
  if (tokens.every((token) => isRecipientId(token, platform))) return { targets: tokens, everyone: false, picked: new Set(own) };
  const directory = await recipientDirectory(deps);
  const mine = resolveTargetsForSend(own, platform, directory);
  const theirs = resolveTargetsForSend(filled, platform, { ...directory, entries: pairedEntries(directory) });
  const everyone = mine.everyone || theirs.everyone;
  const targets = everyone ? [] : [...new Set([...mine.targets, ...theirs.targets])];
  const missing = [...mine.missing, ...theirs.missing];
  if (missing.length > 0) {
    const bot = BOT_PLATFORM_NAMES[platform];
    const names = missing.join(', ');
    if (targets.length === 0 && !everyone) {
      throw new FlowUserError('flow.error.botRecipientUnknown', { names, bot }, `No paired ${bot} chat matches: ${names}`);
    }
    sendLog(`⚠️ [Bot] No paired ${bot} chat matches ${names} — sending to the others`);
  }
  return { targets, everyone, picked: new Set(mine.targets) };
}

async function recipientDirectory(deps: FlowExecutorDeps): Promise<RecipientDirectory> {
  return deps.getBotRecipients ? deps.getBotRecipients().catch(() => EMPTY_RECIPIENT_DIRECTORY) : EMPTY_RECIPIENT_DIRECTORY;
}

/**
 * LINE PC: whether a recipient token is the step's own choice — written in the saved step, or the
 * chat the run was asked from (`{{bot.triggerChatId}}`) — rather than text a variable filled in (a
 * bot command's input, a step's output that may come from a web page). Every LINE PC message goes
 * from the owner's own account, so only the step's own choices may be any group or friend LINE PC
 * has; whoever or whatever fills a variable reaches only the chats it reached before.
 */
export function writtenInStep(config: Record<string, string>): (token: string) => boolean {
  const template = config.__originalChatIdsTemplate;
  if (template === undefined) return () => true;
  const written = new Set(splitTargets(template).filter((token) => !token.includes('{{')));
  const asking = (config.__triggerChatId ?? '').trim();
  return (token) => written.has(token) || (asking !== '' && token === asking);
}

const UNNAMED_LINE_SELF_ERRORS: Readonly<Record<string, string>> = {
  'flow.error.lineSelfKeyMissing': 'flow.error.lineSelfKeyMissingUnnamed',
  'flow.error.lineSelfSealingOff': 'flow.error.lineSelfSealingOffUnnamed',
} as const;

/**
 * A LINE PC refusal names the chat — one of the owner's own groups or friends. A run someone else
 * started gets its failure back in their chat, so there it only says one of the step's chats
 * refused; at the desktop, on a schedule, or asked from an account marked as the user's, the name stays.
 */
async function unnamedForOthers(err: unknown, config: Record<string, string>, deps: FlowExecutorDeps): Promise<unknown> {
  if (!(err instanceof FlowUserError)) return err;
  const unnamed = UNNAMED_LINE_SELF_ERRORS[err.key];
  const asker = (config.__triggerUserId ?? '').trim();
  if (!unnamed || !asker) return err;
  const platform = parseBotPlatform(config.__triggerPlatform);
  const directory = await recipientDirectory(deps);
  if (directory.entries.some((entry) => entry.self && entry.platform === platform && entry.id === asker)) return err;
  return new FlowUserError(unnamed, {}, err.message);
}

interface SocketSendParts {
  message: string;
  explicitAttachment: string;
  legacyMagicPath: string;
  legacyMagicCaption: string;
  rawTargets: string[];
  originalChatIdsTemplate: string;
  everyone: boolean;
  /** The recipients the step chose itself (`writtenInStep`): on LINE PC, any group or friend it has. */
  picked: ReadonlySet<string>;
}

/**
 * Discord, Slack and LINE PC: one message per recipient carrying the text, the run's own files
 * (each through the attachment guard; a link goes in the text, where the chat app previews it —
 * a photo step's links go as `pictures`, which each platform shows its own way) and the step's
 * buttons, each standing for the line it runs — a built-in's link and choice, else the flow's
 * command with the button's input. The asking message is quoted in the chat it came from.
 */
async function execBotSocket(
  platform: SocketBotPlatform,
  config: Record<string, string>,
  deps: FlowExecutorDeps,
  parts: SocketSendParts,
): Promise<string> {
  const name = BOT_PLATFORM_NAMES[platform];
  const { message, explicitAttachment, legacyMagicPath, legacyMagicCaption, rawTargets } = parts;
  const attachment = explicitAttachment || legacyMagicPath;
  if (parts.originalChatIdsTemplate !== '' && rawTargets.length === 0 && !parts.everyone) {
    sendLog(`⚠️ [Bot] ${name} recipients resolved to empty (no trigger context) — skipping send`);
    return attachment || message;
  }
  if (!deps.sendSocketBot) throw new Error(`${name} bot is not configured in FlowExecutorDeps`);
  // Once each: a name and its id in one field are one chat.
  const recipients = [...new Set(rawTargets.length > 0
    ? rawTargets
    : (deps.getSocketBotPairedUsers?.(platform) ?? []).map((user) => user.userId))];
  if (recipients.length === 0) {
    throw new FlowUserError('flow.error.noPairedUsers', { bot: name }, `No paired ${name} users found`);
  }
  // Every LINE PC message goes from the user's own account: refused before any goes, not cut short.
  if (platform === 'lineSelf' && recipients.length > LINE_SELF_MAX_RECIPIENTS) {
    const vars = { count: String(recipients.length), max: String(LINE_SELF_MAX_RECIPIENTS) };
    throw new FlowUserError('flow.error.lineSelfTooManyRecipients', vars, `This LINE PC step names ${vars.count} chats; one step may send to at most ${vars.max}, so nothing was sent`);
  }

  const caption = attachment ? (explicitAttachment ? message : legacyMagicCaption).trim() : message;
  const allowlist = attachmentAllowlist(config);
  const photo = (config.attachmentType ?? '').trim() === 'photo';
  const files: string[] = [];
  const links: string[] = [];
  const pictures: string[] = [];
  for (const item of lines(attachment).filter(Boolean)) {
    if (/^https?:\/\//i.test(item)) (photo ? pictures : links).push(item);
    else files.push(await resolveSafeLocalAttachment(item, allowlist));
  }
  const text = [caption.trim(), ...links].filter(Boolean).join('\n');
  const buttons = socketButtons(config);
  if (!text && files.length === 0 && pictures.length === 0) throw nothingToSend();

  const askingChat = (config.__triggerChatId ?? '').trim();
  const askingMessage = (config.__triggerMessageId ?? '').trim();
  for (const chatId of recipients) {
    try {
      await deps.sendSocketBot(platform, chatId, {
        text,
        ...(files.length > 0 ? { files } : {}),
        ...(pictures.length > 0 ? { pictures } : {}),
        ...(buttons.length > 0 ? { buttons } : {}),
        ...(askingMessage && chatId === askingChat ? { replyTo: askingMessage } : {}),
        ...(platform === 'lineSelf' && parts.picked.has(chatId) ? { picked: true as const } : {}),
      });
    } catch (err: unknown) {
      throw platform === 'lineSelf' ? await unnamedForOthers(err, config, deps) : err;
    }
    sendLog(`📤 [Bot] Sent to ${name} chat ${chatId}${files.length > 0 ? ` with ${files.length} file(s)` : ''}`);
  }
  return attachment || message;
}

/** The step's buttons as the lines they run; none without the flow's bot command (a schedule has nothing to rerun). */
function socketButtons(config: Record<string, string>): Array<{ label: string; line: string; rowStart?: boolean }> {
  const items = parseFlowButtons(config.buttons ?? '');
  const command = (config.__botCommand ?? '').trim();
  if (items.length === 0 || !command) return [];
  const builtin = isBuiltinFlowId((config.__flowId ?? '').trim());
  return items.map((b) => ({ label: b.label, line: builtin ? b.input : `/${command} ${b.input}`, ...(b.rowStart ? { rowStart: true } : {}) }));
}

async function sendLineTextToAll(
  deps: FlowExecutorDeps,
  recipients: string[],
  text: string,
): Promise<void> {
  if (!deps.sendLineMessage) throw new Error('LINE bot is not configured in FlowExecutorDeps');
  const send = deps.sendLineMessage;
  for (const userId of recipients) {
    await send(userId, text);
    sendLog(`📤 [Bot] Sent to LINE user ${userId}`);
  }
}

/**
 * Several attachments, or a video: each image and each video with its preview goes as itself,
 * then the message. Links LINE cannot show go along under the message; a local file cannot reach
 * LINE at all, and if nothing else did either the step fails rather than report success.
 */
async function sendLineMediaList(
  deps: FlowExecutorDeps,
  recipients: string[],
  items: string[],
  previews: string[],
  caption: string,
): Promise<string> {
  const links: string[] = [];
  let sent = 0;
  for (const [index, item] of items.entries()) {
    const preview = previews[index] ?? '';
    if (isLineSendableImage(item)) {
      if (!deps.sendLineImage) throw new Error('sendLineImage not configured in FlowExecutorDeps');
      for (const userId of recipients) await deps.sendLineImage(userId, item);
      sent++;
    } else if (isLineSendableVideo(item, preview)) {
      if (!deps.sendLineVideo) throw new Error('sendLineVideo not configured in FlowExecutorDeps');
      for (const userId of recipients) await deps.sendLineVideo(userId, item, preview);
      sent++;
    } else if (/^https?:\/\//i.test(item)) {
      links.push(item);
    } else {
      sendLog(`⚠️ [Bot] LINE cannot deliver the local file ${item} — skipped`);
    }
  }
  if (sent > 0) sendLog(`📤 [Bot] Sent ${sent} image(s)/video(s) to ${recipients.length} LINE user(s)`);
  const text = [caption, ...links].filter(Boolean).join('\n');
  if (text) await sendLineTextToAll(deps, recipients, text);
  if (sent === 0 && !text) {
    throw new FlowUserError(
      'flow.error.lineAttachmentUndeliverable',
      { file: items[0].split(/[\\/]/).pop() || items[0] },
      `LINE cannot send the local file ${items[0]} and the step has no message, so nothing was sent`,
    );
  }
  return items.join('\n');
}

/**
 * The step's choices as cards, before its text: true when they went out. Cards LINE refuses (a
 * picture it will not take) leave every choice to the text's lines.
 */
async function sendLineCards(deps: FlowExecutorDeps, recipients: readonly string[], parts: BotSendParts): Promise<boolean> {
  const cards = parts.cards ?? [];
  if (cards.length === 0 || !deps.sendLineCarousel) return false;
  // What a notification or the chat list shows for the cards: the step's own text, not its choices.
  const altText = (parts.cardsAltText ?? '').split('\n').map((line) => line.trim()).filter(Boolean).join(' ');
  try {
    for (const userId of recipients) await deps.sendLineCarousel(userId, cards, altText);
    sendLog(`📤 [Bot] Sent ${cards.length} choices as cards to ${recipients.length} LINE user(s)`);
    return true;
  } catch (err: unknown) {
    sendLog(`⚠️ [Bot] LINE cards not sent (${err instanceof Error ? err.message : String(err)}) — every choice goes in the text`);
    return false;
  }
}

/**
 * A picture step with choices (a video's menu: the cover, the title and sizes) as one card with a
 * button per choice, each standing for its line (`line/flowMenu.ts`): true when it went out. A
 * picture LINE cannot show leaves the card without it; text too long for a card, a line too long
 * for a button, or a card LINE refuses leaves the step to the picture and the lines.
 */
async function sendLineMenu(deps: FlowExecutorDeps, recipients: readonly string[], parts: BotSendParts): Promise<boolean> {
  const buttons = parts.menu ?? [];
  const text = (parts.menuText ?? '').trim();
  const image = parts.explicitAttachment;
  if (!deps.sendLineMenu || parts.attachmentType !== 'photo' || (parts.cards?.length ?? 0) > 0) return false;
  if (image.includes('\n') || !lineMenuFits(text, buttons)) return false;
  const altText = text.split('\n').map((line) => line.trim()).filter(Boolean).join(' ');
  const menu = { ...(isLineSendableImage(image) ? { image } : {}), text, buttons, altText };
  try {
    for (const userId of recipients) await deps.sendLineMenu(userId, menu);
    sendLog(`📤 [Bot] Sent ${buttons.length} choices as a menu card to ${recipients.length} LINE user(s)`);
    return true;
  } catch (err: unknown) {
    sendLog(`⚠️ [Bot] LINE menu card not sent (${err instanceof Error ? err.message : String(err)}) — the choices go in the text`);
    return false;
  }
}

async function execBotLine(
  deps: FlowExecutorDeps,
  parts: BotSendParts,
): Promise<string> {
  const { explicitAttachment, legacyMagicPath, legacyMagicCaption, rawTargets } = parts;

  if (parts.originalChatIdsTemplate !== '' && rawTargets.length === 0 && !parts.everyone) {
    sendLog('⚠️ [Bot] LINE recipients resolved to empty (no trigger context) — skipping send');
    return explicitAttachment || parts.message || legacyMagicPath;
  }

  const recipients = rawTargets.length > 0
    ? rawTargets
    : (deps.getLinePairedUsers?.() ?? []).map((user) => user.userId);
  if (recipients.length === 0) {
    throw new FlowUserError('flow.error.noPairedUsers', { bot: 'LINE' }, 'No paired LINE users found');
  }

  if (await sendLineMenu(deps, recipients, parts)) return explicitAttachment || (parts.menuText ?? '');

  const cardsSent = await sendLineCards(deps, recipients, parts);
  const message = cardsSent ? parts.message : parts.cardsFallback ?? parts.message;

  const attachment = explicitAttachment || legacyMagicPath;
  const caption = (explicitAttachment ? message : legacyMagicCaption).trim();
  const items = lines(attachment).filter(Boolean);
  const previews = lines(parts.preview);

  if (items.length > 1 || (items.length === 1 && isLineSendableVideo(items[0], previews[0] ?? ''))) {
    return sendLineMediaList(deps, recipients, items, previews, caption);
  }

  if (attachment && isLineSendableImage(attachment)) {
    if (!deps.sendLineImage) throw new Error('sendLineImage not configured in FlowExecutorDeps');
    const sendImage = deps.sendLineImage;
    for (const userId of recipients) {
      await sendImage(userId, attachment);
      sendLog(`📤 [Bot] Sent image to LINE user ${userId}: ${attachment}`);
    }
    if (caption) await sendLineTextToAll(deps, recipients, caption);
    return attachment;
  }

  if (attachment) {
    // With no message, a link LINE cannot show as an image goes out as its text so the step still
    // delivers something. With a message, only the message is sent (as Telegram's fallback does):
    // the attachment is usually a cover image ({{browser_1.image}}), and a raw image URL under the
    // summary is noise.
    if (/^https?:\/\//i.test(attachment) && !caption) {
      sendLog(`⚠️ [Bot] LINE can only push https .jpg/.png as images (${attachment}) — sending the link as text`);
      await sendLineTextToAll(deps, recipients, attachment);
      return attachment;
    }
    // A local file cannot reach LINE at all; with no message either, the step delivered nothing
    // and must not report success.
    if (!caption) {
      throw new FlowUserError(
        'flow.error.lineAttachmentUndeliverable',
        { file: attachment.split(/[\\/]/).pop() || attachment },
        `LINE cannot send the local file ${attachment} and the step has no message, so nothing was sent`,
      );
    }
    sendLog(`⚠️ [Bot] LINE cannot deliver local files or non-image URLs (${attachment}) — sending the message only`);
    await sendLineTextToAll(deps, recipients, caption);
    return attachment;
  }

  if (!message.trim()) {
    if (cardsSent) return '';
    throw nothingToSend();
  }
  await sendLineTextToAll(deps, recipients, message);
  return message;
}

export function execLoop(config: Record<string, string>): string {
  const input = config.input ?? '';
  // Legacy flows may hold `{{}}` (interpolation leaves it as is); fail instead of looping zero times.
  if (input.trim() === '{{}}') {
    throw new FlowUserError('flow.error.loopInputEmptyRef', {}, 'Loop input is an empty reference {{}} — choose the list to loop over');
  }
  return input;
}
