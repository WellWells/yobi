import { clipboard } from 'electron';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { MarkdownCapturePayload } from '../../../shared/types';
import { DEFAULT_CAPTURE_PALETTE, captureBackgroundCss, paletteCardTheme } from '../../../shared/capturePalettes';
import { formatCardTime } from '../../../shared/captureCard';
import { config as appConfig } from '../../config';
import { getProviderLabel, preparePromptForProvider, runAutomation } from '../../providers';
import { runByokCompletion } from '../../providers/byokClient';
import { repairSplitTableRows } from '../../../shared/markdownTableRepair';
import { PROVIDER_ATTACHMENT_POLICIES, isBotPlatform, isByokTargetUrl, providerFromUrl } from '../../../shared/types';
import type { BotPlatform } from '../../../shared/types';
import {
  EMPTY_RECIPIENT_DIRECTORY, botStepTargets, isRecipientId, resolveTargetsForSend, splitTargets,
} from '../../../shared/botRecipients';
import { parseAttachmentList, resolveSafeLocalAttachment } from '../../attachmentGuard';
import { ensureHttpScheme, fetchAndParse } from '../../urlParser';
import { isFetchableWebUrl } from '../../../shared/webUrl';
import { parseWebUrlList } from './urlList';
import { sendLog, sendWebNotification } from '../../helpers';
import { clipboardLane, llmLane, pageFetchLane } from '../lanes';
import { FlowAbortError, resolveDelayMs, withAbort, withStepTimeout } from '../runtime';
import type { FlowExecutorDeps } from '../types';
import { FlowUserError } from '../userError';
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
  if (isByokTargetUrl(providerUrl)) {
    sendLog(`⚠️ [Flow] ${providerLabel} cannot take file attachments — sending the prompt as text only`);
    return [];
  }
  const maxFiles = PROVIDER_ATTACHMENT_POLICIES[providerFromUrl(providerUrl)].maxFiles;
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
  if (!isByokTarget) {
    const preparedPrompt = preparePromptForProvider(effectivePrompt, providerUrl);
    if (preparedPrompt.removedBlankLines) {
      sendLog(`✂️ [Flow] Removed blank lines for ${getProviderLabel(providerUrl)} input`);
    }
    if (preparedPrompt.truncated) {
      sendLog(`✂️ [Flow] Truncated ${getProviderLabel(providerUrl)} input to ${preparedPrompt.capLabel}`);
    }
    promptForModel = preparedPrompt.prompt;
  }

  const attachments = await resolveLlmAttachments(config, providerUrl);

  let response: string;
  if (isByokTarget) {
    const byokAbort = new AbortController();
    const result = await withStepTimeout(
      runByokCompletion(providerUrl, promptForModel, timeoutMs, byokAbort.signal),
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
        const workerWin = deps.ensureWorkerWin ? await deps.ensureWorkerWin() : deps.getWorkerWin();
        if (!workerWin || workerWin.isDestroyed()) throw workerWindowUnavailable();
        return withStepTimeout(
          runAutomation(workerWin, promptForModel, timeoutMs, providerUrl, attachments),
          timeoutMs,
          'llm',
          () => { workerWin.webContents.loadURL('about:blank').catch(() => {}); },
          signal,
        );
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
  const title = config.exportTitle || 'Yobi LLM Export';
  const palette = (config.palette ?? '').trim() || DEFAULT_CAPTURE_PALETTE;
  const background = config.background || captureBackgroundCss(palette);
  const exportOptions = {
    fileName: (config.exportFileName ?? '').trim(),
    showProvider: config.exportShowProvider !== 'false',
    showTimestamp: config.exportShowTimestamp !== 'false',
    showTokens: false,
    cardTheme: paletteCardTheme(palette),
  };
  const payload: MarkdownCapturePayload = {
    title,
    prompt: promptForModel,
    content: finalResponse,
    summary: finalResponse.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_~\-`\[\]()]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220),
    provider: getProviderLabel(providerUrl),
    // Printed on the card as is, so format it as local time like chat exports.
    timestamp: formatCardTime(new Date().toISOString(), appConfig.locale),
  };
  const filePath = await deps.captureMarkdown(payload, exportFormat, background, exportOptions);
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
): 'photo' | 'document' | 'auto' {
  const choice = (attachmentType ?? 'auto').toLowerCase();
  if (choice === 'photo') return 'photo';
  if (choice === 'document') return 'document';
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

function isLineSendableImage(attachment: string): boolean {
  if (!/^https:\/\//i.test(attachment)) return false;
  try {
    return LINE_IMAGE_PATH_RE.test(new URL(attachment).pathname);
  } catch {
    return false;
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
    return execBotLine(deps, {
      message,
      explicitAttachment,
      legacyMagicPath,
      legacyMagicCaption,
      rawTargets,
      originalChatIdsTemplate,
      everyone,
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

  const attachment = explicitAttachment || legacyMagicPath;
  if (attachment) {
    if (!deps.sendTelegramFile) throw new Error('sendTelegramFile not configured in FlowExecutorDeps');
    const sendFile = deps.sendTelegramFile;
    const sendMessageFallback = deps.sendTelegramMessage;
    const sendAs = resolveAttachmentSendAs(config.attachmentType, attachment);
    const text = (explicitAttachment ? message : legacyMagicCaption).trim();
    const caption = text || undefined;
    const isRemote = /^https?:\/\//i.test(attachment);
    let authorizedPaths: string[] = [];
    try {
      const parsed: unknown = JSON.parse(config.__attachmentAllowlist ?? '[]');
      if (Array.isArray(parsed)) authorizedPaths = parsed.filter((v): v is string => typeof v === 'string');
    } catch {}

    const sendToTarget = async (target: number, label: string): Promise<void> => {
      try {
        await sendFile(target, attachment, sendAs, caption, authorizedPaths);
        sendLog(`📤 [Bot] Sent ${sendAs} to ${label}: ${attachment}`);
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        if (isRemote && caption && sendMessageFallback) {
          sendLog(`⚠️ [Bot] ${sendAs} send failed (${reason}); resending as text without the image`);
          await sendMessageFallback(target, caption);
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
    return attachment;
  }

  if (!message) return '';
  if (!deps.sendTelegramMessage) throw new Error('Telegram bot is not configured in FlowExecutorDeps');
  const sendMessage = deps.sendTelegramMessage;
  await broadcast(
    async (chatId) => {
      await sendMessage(chatId, message);
      sendLog(`📤 [Bot] Sent to chat ${chatId}`);
    },
    async (user) => {
      await sendMessage(user.userId, message);
      sendLog(`📤 [Bot] Sent to user ${user.userId} (${user.username ?? user.firstName ?? ''})`);
    },
  );
  return message;
}

interface BotSendParts {
  message: string;
  explicitAttachment: string;
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
    const bot = platform === 'line' ? 'LINE' : 'Telegram';
    const names = named.missing.join(', ');
    if (named.targets.length === 0 && !named.everyone) {
      throw new FlowUserError('flow.error.botRecipientUnknown', { names, bot }, `No paired ${bot} chat matches: ${names}`);
    }
    sendLog(`⚠️ [Bot] No paired ${bot} chat matches ${names} — sending to the others`);
  }
  return { targets: named.targets, everyone: named.everyone };
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

async function execBotLine(
  deps: FlowExecutorDeps,
  parts: BotSendParts,
): Promise<string> {
  const { message, explicitAttachment, legacyMagicPath, legacyMagicCaption, rawTargets } = parts;

  if (parts.originalChatIdsTemplate !== '' && rawTargets.length === 0 && !parts.everyone) {
    sendLog('⚠️ [Bot] LINE recipients resolved to empty (no trigger context) — skipping send');
    return explicitAttachment || message || legacyMagicPath;
  }

  const recipients = rawTargets.length > 0
    ? rawTargets
    : (deps.getLinePairedUsers?.() ?? []).map((user) => user.userId);
  if (recipients.length === 0) {
    throw new FlowUserError('flow.error.noPairedUsers', { bot: 'LINE' }, 'No paired LINE users found');
  }

  const attachment = explicitAttachment || legacyMagicPath;
  const caption = (explicitAttachment ? message : legacyMagicCaption).trim();

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
