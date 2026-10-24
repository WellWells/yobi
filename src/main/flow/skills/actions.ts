import { clipboard } from 'electron';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { CaptureFormat, FlowButton, MarkdownCapturePayload } from '../../../shared/types';
import { cardStyleFromSettings, formatCardTime } from '../../../shared/captureCard';
import { resolveCardTitle } from '../../../shared/markdownTitle';
import { config as appConfig } from '../../config';
import { getProviderLabel, preparePromptForProvider, runAutomation } from '../../providers';
import { byokTargetTakesImages, runByokCompletion } from '../../providers/byokClient';
import { loadByokImages, withByokImages } from '../../providers/byokImages';
import { resendIfGeminiCapFell } from '../../providers/geminiPromptTooLong';
import { isByokImageFile } from '../../../shared/attachmentFormats';
import { repairSplitTableRows } from '../../../shared/markdownTableRepair';
import {
  BOT_PLATFORM_NAMES,
  BYOK_IMAGE_MAX_FILES,
  PROVIDER_ATTACHMENT_POLICIES,
  isBotPlatform,
  isByokTargetUrl,
  isSocketBotPlatform,
  providerFromUrl,
} from '../../../shared/types';
import type { BotPlatform, SocketBotPlatform } from '../../../shared/types';
import {
  EMPTY_RECIPIENT_DIRECTORY, botStepTargets, isRecipientId, resolveTargetsForSend, splitTargets,
} from '../../../shared/botRecipients';
import { parseAttachmentList, resolveSafeLocalAttachment } from '../../attachmentGuard';
import { ensureHttpScheme, fetchAndParse } from '../../urlParser';
import { isFetchableWebUrl } from '../../../shared/webUrl';
import { parseWebUrlList } from './urlList';
import { isHeightLimitError } from './share';
import { sendLog, sendWebNotification } from '../../helpers';
import { clipboardLane, llmLane, pageFetchLane } from '../lanes';
import { FlowAbortError, resolveDelayMs, withAbort, withStepTimeout } from '../runtime';
import type { BotSendExtras, FlowExecutorDeps, TelegramSendAs } from '../types';
import { FlowUserError } from '../userError';
import * as fs from 'node:fs/promises';
import { getLangCache, t } from '../../i18n';
import { formatLimit, formatMegabytes, parseFlowButtons, withButtonImages } from '../../../shared/ytdl';
import { telegramSendLimitBytes } from '../../telegram/largeUpload';
import { LINE_ACTION_TEXT_MAX, LINE_CAROUSEL_MAX, type LineCarouselItem } from '../../line/pickCarousel';
import { lineMenuFits, type LineMenuButton } from '../../line/flowMenu';
import { isBuiltinFlowId } from '../../../shared/builtinFlows';
import { closePage, closeRunPages, openPage, runPageScript } from './browserPages';
import { inferTelegramSendAs, isCaptureFormat } from '../interpolation';
import { appendMemory, buildMemoryAugmentedPrompt, parseAndStripNewMemory, readMemory } from '../flowMemory';
import { renderFlowMemoryBlock } from '../../memory/memoryPrompt';
import { resolveMemory } from '../../memory/memoryContext';
import { workerWindowUnavailable } from '../../workerWindowError';
import { consoleFallbackEncoding, decodeShellOutput } from './shellOutput';

const execAsync = promisify(exec);

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
  if (!command) return '';
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
  const fallback = await consoleFallbackEncoding();
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutMs,
      shell,
      encoding: 'buffer',
      ...(cwd ? { cwd } : {}),
      ...(signal ? { signal } : {}),
    });
    return (decodeShellOutput(stdout, fallback) || decodeShellOutput(stderr, fallback)).trim();
  } catch (err) {
    throw readableShellError(err, command, fallback);
  }
}

/**
 * Node builds the `Command failed` message from stderr decoded as UTF-8; rebuild it from the
 * console-decoded bytes and keep the rest of the error.
 */
function readableShellError(err: unknown, command: string, fallback: string | null): unknown {
  if (!(err instanceof Error)) return err;
  const stderr = (err as { stderr?: unknown }).stderr;
  if (!Buffer.isBuffer(stderr) || !err.message.startsWith('Command failed:')) return err;
  const readable = new Error(`Command failed: ${command}\n${decodeShellOutput(stderr, fallback)}`);
  for (const key of ['code', 'killed', 'signal'] as const) {
    if (key in err) Object.assign(readable, { [key]: (err as unknown as Record<string, unknown>)[key] });
  }
  return readable;
}

async function fetchPage(url: string): Promise<{ text: string; image: string }> {
  const { cleanedText, image = '' } = await pageFetchLane.runExclusive(
    () => fetchAndParse(url, { bodyText: true }),
  );
  return { text: cleanedText, image };
}

const NON_WEB_URL_ERROR = 'browser: only http:// and https:// pages can be fetched.';

export async function execBrowser(config: Record<string, string>): Promise<string> {
  const url = config.url ?? '';
  if (!url) return '';

  const includeImage = config.includeImage === 'true';

  const urlArray = parseWebUrlList(url);

  // A lone URL is logged whole: the log panel shortens it on screen and opens it on click.
  const isLoneUrl = !urlArray && !/\s/.test(url.trim());
  const urlPreview = isLoneUrl || url.length <= 120 ? url : `${url.slice(0, 120)}…`;
  sendLog(`🌐 [Flow] Browser step URL: ${urlPreview}`);

  if (urlArray && urlArray.length > 0) {
    if (includeImage) sendLog('🖼️ [Flow] Browser: cover image is single-URL only — skipped for batch input');
    sendLog(`🌐 [Flow] Batch URL input: ${urlArray.length} URLs detected`);
    const parts: string[] = [];
    let firstError: unknown;
    for (let i = 0; i < urlArray.length; i++) {
      const batchUrl = urlArray[i];
      sendLog(`🌐 [${i + 1}/${urlArray.length}] Fetching: ${batchUrl}`);
      try {
        const { text } = await fetchPage(batchUrl);
        parts.push(text);
        sendLog(`✅ [${i + 1}/${urlArray.length}] OK — ${text.length} chars`);
      } catch (err) {
        firstError ??= err;
        const msg = err instanceof Error ? err.message : String(err);
        sendLog(`❌ [${i + 1}/${urlArray.length}] Failed: ${msg}`);
      }
    }
    // Every page failing must throw: the executor's fail-soft (`.isFailed`, soft-failure count,
    // failure notice) only sees a throw, and '' reads downstream as "nothing new".
    if (parts.length === 0) {
      if (urlArray.length === 1) throw firstError;
      const msg = firstError instanceof Error ? firstError.message : String(firstError);
      throw new Error(`browser: none of the ${urlArray.length} pages could be fetched — ${msg}`);
    }
    sendLog(`🌐 [Flow] Batch complete: ${parts.length}/${urlArray.length} succeeded`);
    return parts.join('\n\n---\n\n');
  }

  if (!isFetchableWebUrl(url)) throw new Error(NON_WEB_URL_ERROR);

  const { text, image } = await fetchPage(url);
  sendLog(`✅ [Flow] Browser: ${text.length} chars`);

  if (includeImage) {
    sendLog(`🖼️ [Flow] Browser: cover image ${image ? `→ ${image}` : 'not found'}`);
    return JSON.stringify({ output: text, image });
  }

  return text;
}

export async function execBrowserOpen(config: Record<string, string>): Promise<string> {
  const url = ensureHttpScheme(config.url ?? '');
  if (!url) throw new Error('browser_open requires a url');
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
      resolved.push(await resolveSafeLocalAttachment(candidate, authorizedPaths));
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

type CaptureMarkdown = NonNullable<FlowExecutorDeps['captureMarkdown']>;
type CaptureMarkdownOptions = NonNullable<Parameters<CaptureMarkdown>[3]>;

/**
 * Renders the llm step's card without losing the already-fetched answer to the image height limit,
 * which the card style's scale and width can push a flow past with no change to the flow: retry at
 * 1x first (same format, same file type for the next step), then as a PDF, which has no height limit.
 */
async function captureCardWithinHeightLimit(
  capture: CaptureMarkdown,
  payload: MarkdownCapturePayload,
  format: CaptureFormat,
  background: string,
  options: CaptureMarkdownOptions,
): Promise<string> {
  try {
    return await capture(payload, format, background, options);
  } catch (err) {
    if (format === 'pdf' || !isHeightLimitError(err)) throw err;
  }
  const pixelRatio = options.pixelRatio ?? 1;
  if (pixelRatio > 1) {
    sendLog(`⚠️ [Flow] LLM export: ${format.toUpperCase()} at ${pixelRatio}x exceeds the image height limit — retrying at 1x`);
    try {
      return await capture(payload, format, background, { ...options, pixelRatio: 1 });
    } catch (err) {
      if (!isHeightLimitError(err)) throw err;
    }
  }
  sendLog(`⚠️ [Flow] LLM export: ${format.toUpperCase()} exceeds the image height limit — re-rendering as PDF`);
  return capture(payload, 'pdf', background, options);
}

export async function execLlm(
  config: Record<string, string>,
  deps: FlowExecutorDeps,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const prompt = config.prompt ?? '';
  if (!prompt) return '';
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

  let response: string;
  if (isByokTarget) {
    const byokAbort = new AbortController();
    const images = attachments.length > 0 ? await loadByokImages(attachments) : undefined;
    const result = await withStepTimeout(
      runByokCompletion(providerUrl, withByokImages(promptForModel, images), timeoutMs, byokAbort.signal),
      timeoutMs,
      'llm',
      () => byokAbort.abort(),
      signal,
    );
    response = result.response;
  } else {
    const result = await withAbort(
      llmLane.runExclusive(async () => {
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
            runAutomation(workerWin, promptForModel, timeoutMs, providerUrl, attachments),
            timeoutMs,
            'llm',
            () => { workerWin.webContents.loadURL('about:blank').catch(() => {}); },
            signal,
          );
        }, (cap) => sendLog(`✂️ [Flow] ${getProviderLabel(providerUrl)} takes only ${cap} characters now — sending the step again`));
      }),
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
  const exportFormat = config.exportFormat;
  if (!isCaptureFormat(exportFormat)) {
    return finalResponse;
  }
  if (!deps.captureMarkdown) {
    throw new Error('LLM export requires captureMarkdown dependency');
  }
  // Blank title = the heading the answer opens with (lifted out of the body), else none.
  const { title, body } = resolveCardTitle(config.exportTitle ?? '', finalResponse);
  // Settings › Card style, the same as a bot export; the step's own Background, when picked,
  // replaces only the palette. `config.background` is deliberately not read: a gradient frozen
  // there would override Solid forever.
  const style = cardStyleFromSettings(appConfig.captureSettings, config.palette ?? '');
  const exportOptions = {
    fileName: (config.exportFileName ?? '').trim(),
    showProvider: config.exportShowProvider !== 'false',
    showTimestamp: config.exportShowTimestamp !== 'false',
    showTokens: false,
    cardTheme: style.cardTheme,
    width: style.width,
    margin: style.margin,
    pixelRatio: style.pixelRatio,
  };
  const provider = getProviderLabel(providerUrl);
  // Printed on the card as is, so it is formatted here in local time, as a chat export reads.
  const timestamp = formatCardTime(new Date().toISOString(), appConfig.locale);
  // The card shows the answer only. The prompt is the flow's own instruction (memory blocks,
  // fenced data) and never goes onto a card, so it is not handed to the capture window at all.
  const payload: MarkdownCapturePayload = {
    title,
    prompt: '',
    content: body,
    summary: '',
    provider,
    timestamp,
    turns: [{ prompt: '', response: body, provider, timestamp }],
  };
  const filePath = await captureCardWithinHeightLimit(deps.captureMarkdown, payload, exportFormat, style.background, exportOptions);
  sendLog(`🖼️ [Flow] LLM export generated: ${filePath}`);
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

export async function execDelay(config: Record<string, string>): Promise<string> {
  const ms = resolveDelayMs(config);
  await new Promise((resolve) => setTimeout(resolve, ms));
  return `delayed ${ms}ms`;
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
  const choice = (config.platform ?? 'auto').trim().toLowerCase();
  if (isBotPlatform(choice)) return choice;
  const triggered = (config.__triggerPlatform ?? '').trim().toLowerCase();
  return isBotPlatform(triggered) ? triggered : 'telegram';
}

const LINE_IMAGE_PATH_RE = /\.(?:jpe?g|png)$/i;
const LINE_VIDEO_PATH_RE = /\.mp4$/i;

function isHttpsPath(attachment: string, pattern: RegExp): boolean {
  if (!/^https:\/\//i.test(attachment)) return false;
  try {
    return pattern.test(new URL(attachment).pathname);
  } catch {
    return false;
  }
}

function isLineSendableImage(attachment: string): boolean {
  return isHttpsPath(attachment, LINE_IMAGE_PATH_RE);
}

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
 * pasted link answered with its video and the link in the caption, user 2026-10-23): sent
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
    return [message.trim(), lines.join('\n')].filter(Boolean).join('\n\n');
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

export async function execBot(
  config: Record<string, string>,
  deps: FlowExecutorDeps,
): Promise<string> {
  const message = config.message ?? '';
  const explicitAttachment = (config.attachment ?? '').trim();
  const legacyMagicPath = (config.__magicUploadPath ?? '').trim();
  const legacyMagicCaption = (config.__magicUploadCaption ?? '').trim();

  const platform = resolveBotPlatform(config);
  const { targets: rawTargets, everyone } = await resolveNamedRecipients(splitTargets(botStepTargets(config)), platform, deps);
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
      message, explicitAttachment, legacyMagicPath, legacyMagicCaption, rawTargets, originalChatIdsTemplate, everyone,
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

  if (!message) return '';
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
 * went nowhere.
 */
async function resolveNamedRecipients(
  tokens: string[],
  platform: BotPlatform,
  deps: FlowExecutorDeps,
): Promise<{ targets: string[]; everyone: boolean }> {
  if (tokens.every((token) => isRecipientId(token, platform))) return { targets: tokens, everyone: false };
  const directory = deps.getBotRecipients
    ? await deps.getBotRecipients().catch(() => EMPTY_RECIPIENT_DIRECTORY)
    : EMPTY_RECIPIENT_DIRECTORY;
  const named = resolveTargetsForSend(tokens, platform, directory);
  if (named.missing.length > 0) {
    const bot = BOT_PLATFORM_NAMES[platform];
    const names = named.missing.join(', ');
    if (named.targets.length === 0 && !named.everyone) {
      throw new FlowUserError('flow.error.botRecipientUnknown', { names, bot }, `No paired ${bot} chat matches: ${names}`);
    }
    sendLog(`⚠️ [Bot] No paired ${bot} chat matches ${names} — sending to the others`);
  }
  return { targets: named.targets, everyone: named.everyone };
}

interface SocketSendParts {
  message: string;
  explicitAttachment: string;
  legacyMagicPath: string;
  legacyMagicCaption: string;
  rawTargets: string[];
  originalChatIdsTemplate: string;
  everyone: boolean;
}

/**
 * Discord and Slack: one message per recipient carrying the text, the run's own files (each
 * through the attachment guard; a link goes in the text, where the chat app previews it) and the
 * step's buttons, each standing for the line it runs — a built-in's link and choice, else the
 * flow's command with the button's input. The asking message is quoted in the chat it came from.
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
  const recipients = rawTargets.length > 0
    ? rawTargets
    : (deps.getSocketBotPairedUsers?.(platform) ?? []).map((user) => user.userId);
  if (recipients.length === 0) {
    throw new FlowUserError('flow.error.noPairedUsers', { bot: name }, `No paired ${name} users found`);
  }

  const caption = attachment ? (explicitAttachment ? message : legacyMagicCaption).trim() : message;
  const allowlist = attachmentAllowlist(config);
  const files: string[] = [];
  const links: string[] = [];
  for (const item of lines(attachment).filter(Boolean)) {
    if (/^https?:\/\//i.test(item)) links.push(item);
    else files.push(await resolveSafeLocalAttachment(item, allowlist));
  }
  const text = [caption.trim(), ...links].filter(Boolean).join('\n');
  const buttons = socketButtons(config);
  if (!text && files.length === 0) return '';

  const askingChat = (config.__triggerChatId ?? '').trim();
  const askingMessage = (config.__triggerMessageId ?? '').trim();
  for (const chatId of recipients) {
    await deps.sendSocketBot(platform, chatId, {
      text,
      ...(files.length > 0 ? { files } : {}),
      ...(buttons.length > 0 ? { buttons } : {}),
      ...(askingMessage && chatId === askingChat ? { replyTo: askingMessage } : {}),
    });
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

  const message = await sendLineCards(deps, recipients, parts) ? parts.message : parts.cardsFallback ?? parts.message;

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

  if (!message) return '';
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
