import { clipboard } from 'electron';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { MarkdownCapturePayload } from '../../../shared/types';
import { paletteBackground, paletteCardTheme } from '../../../shared/capturePalettes';
import { getProviderLabel, preparePromptForProvider, runAutomation } from '../../providers';
import { runByokCompletion } from '../../providers/byokClient';
import { isBotPlatform, isByokTargetUrl } from '../../../shared/types';
import type { BotPlatform } from '../../../shared/types';
import { ensureHttpScheme, fetchAndParse } from '../../urlParser';
import { sendLog, sendWebNotification } from '../../helpers';
import { clipboardLane, llmLane, pageFetchLane } from '../lanes';
import { FlowAbortError, resolveDelayMs, withAbort, withStepTimeout } from '../runtime';
import type { FlowExecutorDeps } from '../types';
import { closePage, closeRunPages, openPage, runPageScript } from './browserPages';
import { inferTelegramSendAs, isCaptureFormat } from '../interpolation';
import { appendMemory, buildMemoryAugmentedPrompt, parseAndStripNewMemory, readMemory } from '../flowMemory';

const execAsync = promisify(exec);

export async function execShell(config: Record<string, string>, timeoutMs: number): Promise<string> {
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
  const { stdout, stderr } = await execAsync(command, { timeout: timeoutMs, shell });
  return (stdout || stderr).trim();
}

async function fetchPage(url: string): Promise<{ text: string; image: string }> {
  const { cleanedText, image = '' } = await pageFetchLane.runExclusive(
    () => fetchAndParse(url, { bodyText: true }),
  );
  return { text: cleanedText, image };
}

export async function execBrowser(config: Record<string, string>): Promise<string> {
  const url = config.url ?? '';
  if (!url) return '';

  const includeImage = config.includeImage === 'true';

  const urlPreview = url.length > 120 ? `${url.slice(0, 120)}…` : url;
  sendLog(`🌐 [AgentFlow] Browser step URL: ${urlPreview}`);

  let urlArray: string[] | null = null;
  try {
    const parsed: unknown = JSON.parse(url);
    if (Array.isArray(parsed) && parsed.every((u): u is string => typeof u === 'string')) {
      urlArray = parsed.map((u) => ensureHttpScheme(u)).filter(Boolean);
    }
  } catch {
    const candidates = url.split(/[\n\r,]+/).map((s) => ensureHttpScheme(s)).filter(Boolean);
    if (candidates.length > 1) urlArray = candidates;
  }

  if (urlArray && urlArray.length > 0) {
    if (includeImage) sendLog('🖼️ [AgentFlow] Browser: cover image is single-URL only — skipped for batch input');
    sendLog(`🌐 [AgentFlow] Batch URL input: ${urlArray.length} URLs detected`);
    const parts: string[] = [];
    for (let i = 0; i < urlArray.length; i++) {
      const batchUrl = urlArray[i];
      sendLog(`🌐 [${i + 1}/${urlArray.length}] Fetching: ${batchUrl}`);
      try {
        const { text } = await fetchPage(batchUrl);
        parts.push(text);
        sendLog(`✅ [${i + 1}/${urlArray.length}] OK — ${text.length} chars`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendLog(`❌ [${i + 1}/${urlArray.length}] Failed: ${msg}`);
      }
    }
    if (parts.length === 0) return '';
    sendLog(`🌐 [AgentFlow] Batch complete: ${parts.length}/${urlArray.length} succeeded`);
    return parts.join('\n\n---\n\n');
  }

  const { text, image } = await fetchPage(url);
  sendLog(`✅ [AgentFlow] Browser: ${text.length} chars`);

  if (includeImage) {
    sendLog(`🖼️ [AgentFlow] Browser: cover image ${image ? `→ ${image}` : 'not found'}`);
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
  sendLog(`🌐 [AgentFlow] Opened page ${id} → ${finalUrl}${show ? ' (visible)' : ''}`);
  return JSON.stringify({ id, title, url: finalUrl });
}

export async function execBrowserJs(config: Record<string, string>, timeoutMs: number): Promise<string> {
  const pageId = (config.page ?? '').trim();
  const code = config.code ?? '';
  if (!pageId) throw new Error('browser_js: no page handle (set page to a {{tab}} from browser_open)');
  if (!code.trim()) return '';
  return runPageScript(pageId, code, timeoutMs);
}

export function execBrowserClose(config: Record<string, string>): string {
  const handle = (config.page ?? '').trim();
  const flowId = (config.__flowId ?? '').trim();
  if (handle.toLowerCase() === 'all') {
    closeRunPages(flowId);
    sendLog('🧹 [AgentFlow] Closed all pages opened by this run');
    return '';
  }
  const ok = closePage(handle);
  sendLog(ok ? `🧹 [AgentFlow] Closed page ${handle}` : `⚠️ [AgentFlow] No live page for handle ${handle}`);
  return '';
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
  if (useMemory && flowId) {
    try {
      effectivePrompt = buildMemoryAugmentedPrompt(prompt, await readMemory(flowId));
    } catch (err) {
      sendLog(`⚠️ [AgentFlow] Flow memory read failed, continuing without memory: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // BYOK targets go through verbatim: API calls need none of the input-box
  // shaping (blank-line removal, char truncation) the browser path relies on.
  let promptForModel = effectivePrompt;
  if (!isByokTarget) {
    const preparedPrompt = preparePromptForProvider(effectivePrompt, providerUrl);
    if (preparedPrompt.removedBlankLines) {
      sendLog(`✂️ [AgentFlow] Removed blank lines for ${getProviderLabel(providerUrl)} input`);
    }
    if (preparedPrompt.truncated) {
      sendLog(`✂️ [AgentFlow] Truncated ${getProviderLabel(providerUrl)} input to ${preparedPrompt.maxChars} chars`);
    }
    promptForModel = preparedPrompt.prompt;
  }

  let response: string;
  if (isByokTarget) {
    // Direct HTTP call — no shared worker window, so no llmLane serialization;
    // the abort controller cancels the in-flight fetch on timeout or user abort.
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
    // LLM automation is serialized app-wide by llmLane, so many concurrent flows
    // pile up here. The response-timeout clock must only start once THIS step owns
    // the shared worker window — otherwise time spent queued behind other flows is
    // wrongly counted against the budget and later steps time out before they ever
    // run. withAbort lets a queued step bail promptly on user abort; the in-lane
    // guard stops it from firing stale automation once the lane frees; and the
    // about:blank interrupt only runs while we hold the lane, so it can never nuke
    // another flow's in-progress response. The worker is resolved INSIDE the lane
    // (via ensureWorkerWin, which forces automation mode) so a login/Cloudflare
    // mode switch can't swap the window mid-run and a worker left interactive after
    // a prior login is reclaimed instead of silently degrading this step.
    const result = await withAbort(
      llmLane.runExclusive(async () => {
        if (signal?.aborted) throw new FlowAbortError();
        const workerWin = deps.ensureWorkerWin ? await deps.ensureWorkerWin() : deps.getWorkerWin();
        if (!workerWin || workerWin.isDestroyed()) throw new Error('Worker window not available');
        return withStepTimeout(
          runAutomation(workerWin, promptForModel, timeoutMs, providerUrl),
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

  let finalResponse = response;
  if (useMemory && flowId) {
    const { cleaned, newMemory } = parseAndStripNewMemory(response);
    finalResponse = cleaned;
    if (newMemory) {
      try {
        await appendMemory(flowId, newMemory);
        sendLog(`🧠 [AgentFlow] Flow memory updated (+1 entry)`);
      } catch (err) {
        sendLog(`⚠️ [AgentFlow] Flow memory write failed: ${err instanceof Error ? err.message : String(err)}`);
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
  const title = config.exportTitle || 'AgentFlow LLM Export';
  const background = config.background
    || paletteBackground(config.palette ?? '')
    || 'linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #334155 100%)';
  const exportOptions = {
    fileName: (config.exportFileName ?? '').trim(),
    showProvider: config.exportShowProvider !== 'false',
    showTimestamp: config.exportShowTimestamp !== 'false',
    cardTheme: paletteCardTheme(config.palette ?? ''),
  };
  const payload: MarkdownCapturePayload = {
    title,
    prompt: promptForModel,
    content: finalResponse,
    summary: finalResponse.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_~\-`\[\]()]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220),
    provider: getProviderLabel(providerUrl),
    timestamp: new Date().toISOString(),
  };
  const filePath = await deps.captureMarkdown(payload, exportFormat, background, exportOptions);
  sendLog(`🖼️ [AgentFlow] LLM export generated: ${filePath}`);
  return filePath;
}

export function execClipboard(config: Record<string, string>): Promise<string> {
  return clipboardLane.runExclusive(async () => {
    const action = config.action ?? 'read';
    if (action === 'write') {
      clipboard.writeText(config.text ?? '');
      return '';
    }
    return clipboard.readText();
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
  const title = config.title || 'AgentFlow';
  const body = config.body ?? '';
  sendWebNotification(title, body, 'info');
  sendLog(`📢 [AgentFlow] ${title}: ${body}`);
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

// A step's `platform` is authored in the editor. 'auto' — the default, and what
// every flow written before LINE existed carries — follows whichever platform
// triggered this run, falling back to Telegram for cron/hotkey/manual runs so
// those flows keep behaving exactly as they did.
function resolveBotPlatform(config: Record<string, string>): BotPlatform {
  const choice = (config.platform ?? 'auto').trim().toLowerCase();
  if (isBotPlatform(choice)) return choice;
  const triggered = (config.__triggerPlatform ?? '').trim().toLowerCase();
  return isBotPlatform(triggered) ? triggered : 'telegram';
}

const LINE_IMAGE_PATH_RE = /\.(?:jpe?g|png)$/i;

// LINE fetches the image itself over HTTPS; there is no upload endpoint, and it
// accepts only JPEG/PNG. Everything else has to degrade to text.
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

  const chatIdsRaw = (config.chatIds ?? config.chatId ?? '').trim();
  const rawTargets = chatIdsRaw
    ? chatIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const originalChatIdsTemplate = (config.__originalChatIdsTemplate ?? '').trim();

  if (resolveBotPlatform(config) === 'line') {
    return execBotLine(deps, {
      message,
      explicitAttachment,
      legacyMagicPath,
      legacyMagicCaption,
      rawTargets,
      originalChatIdsTemplate,
    });
  }

  const explicitIds = rawTargets
    .map(Number)
    .filter((n) => Number.isFinite(n) && n !== 0);

  const chatIdsWereConfiguredButEmpty = originalChatIdsTemplate !== '' && explicitIds.length === 0;

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
    if (pairedUsers.length === 0) throw new Error('No paired Telegram users found');
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

    // Telegram downloads remote media on its own servers; some hosts (hotlink
    // protection / WAF) serve an HTML page instead of the image to that fetcher, so
    // sendPhoto/sendDocument by URL fail ("failed to get HTTP URL content" / "wrong
    // type of the web page content"). When that happens, drop the image and deliver
    // the caption as text so the step still succeeds instead of aborting.
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

// LINE recipients are opaque userId strings ('U' + 32 hex), never the numeric
// chat ids Telegram uses, so they are passed through untouched.
async function execBotLine(
  deps: FlowExecutorDeps,
  parts: BotSendParts,
): Promise<string> {
  const { message, explicitAttachment, legacyMagicPath, legacyMagicCaption, rawTargets } = parts;

  if (parts.originalChatIdsTemplate !== '' && rawTargets.length === 0) {
    sendLog('⚠️ [Bot] LINE recipients resolved to empty (no trigger context) — skipping send');
    return explicitAttachment || message || legacyMagicPath;
  }

  const recipients = rawTargets.length > 0
    ? rawTargets
    : (deps.getLinePairedUsers?.() ?? []).map((user) => user.userId);
  if (recipients.length === 0) throw new Error('No paired LINE users found');

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
    sendLog(`⚠️ [Bot] LINE cannot deliver local files or non-image URLs (${attachment}) — sending text only`);
    if (!caption) {
      sendLog('⚠️ [Bot] attachment carried no message text — nothing sent to LINE');
      return attachment;
    }
    await sendLineTextToAll(deps, recipients, caption);
    return attachment;
  }

  if (!message) return '';
  await sendLineTextToAll(deps, recipients, message);
  return message;
}

export function execLoop(config: Record<string, string>): string {
  return config.input ?? '';
}
