import { clipboard } from 'electron';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { load } from 'cheerio';
import type { MarkdownCapturePayload } from '../../../shared/types';
import { paletteBackground, paletteCardTheme } from '../../../shared/capturePalettes';
import { getProviderLabel, preparePromptForProvider, runAutomation } from '../../providers';
import { extractCoverImage, fetchAndParse } from '../../urlParser';
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

function htmlToText(html: string): string {
  const $ = load(html);
  $('script, style, noscript, iframe').remove();
  const rawText = $('body').text() || $.text() || '';
  return rawText
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchEntirePageText(url: string): Promise<string> {
  const { cleanedText: html } = await pageFetchLane.runExclusive(() => fetchAndParse(url, { rawHtml: true }));
  return htmlToText(html);
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
      urlArray = parsed.filter((u) => /^https?:\/\//i.test(u.trim()));
    }
  } catch {
    const candidates = url.split(/[\n\r,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
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
        const text = await fetchEntirePageText(batchUrl);
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

  if (includeImage) {
    const { cleanedText: html } = await pageFetchLane.runExclusive(() => fetchAndParse(url, { rawHtml: true }));
    const image = extractCoverImage(html, url);
    sendLog(`🖼️ [AgentFlow] Browser: cover image ${image ? `→ ${image}` : 'not found'}`);
    return JSON.stringify({ output: htmlToText(html), image });
  }

  return await fetchEntirePageText(url);
}

export async function execBrowserOpen(config: Record<string, string>): Promise<string> {
  const url = (config.url ?? '').trim();
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
  const workerWin = deps.getWorkerWin();
  if (!workerWin) throw new Error('Worker window not available');
  const providerUrl = config.provider || deps.getTargetUrl();

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

  const preparedPrompt = preparePromptForProvider(effectivePrompt, providerUrl);
  if (preparedPrompt.removedBlankLines) {
    sendLog(`✂️ [AgentFlow] Removed blank lines for ${getProviderLabel(providerUrl)} input`);
  }
  if (preparedPrompt.truncated) {
    sendLog(`✂️ [AgentFlow] Truncated ${getProviderLabel(providerUrl)} input to ${preparedPrompt.maxChars} chars`);
  }

  // LLM automation is serialized app-wide by llmLane, so many concurrent flows
  // pile up here. The response-timeout clock must only start once THIS step owns
  // the shared worker window — otherwise time spent queued behind other flows is
  // wrongly counted against the budget and later steps time out before they ever
  // run. withAbort lets a queued step bail promptly on user abort; the in-lane
  // guard stops it from firing stale automation once the lane frees; and the
  // about:blank interrupt only runs while we hold the lane, so it can never nuke
  // another flow's in-progress response.
  const { response } = await withAbort(
    llmLane.runExclusive(() => {
      if (signal?.aborted) throw new FlowAbortError();
      return withStepTimeout(
        runAutomation(workerWin, preparedPrompt.prompt, timeoutMs, providerUrl),
        timeoutMs,
        'llm',
        () => { workerWin.webContents.loadURL('about:blank').catch(() => {}); },
        signal,
      );
    }),
    signal,
  );

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
      prompt: preparedPrompt.prompt,
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
    prompt: preparedPrompt.prompt,
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

export async function execBot(
  config: Record<string, string>,
  deps: FlowExecutorDeps,
): Promise<string> {
  const message = config.message ?? '';
  const explicitAttachment = (config.attachment ?? '').trim();
  const legacyMagicPath = (config.__magicUploadPath ?? '').trim();
  const legacyMagicCaption = (config.__magicUploadCaption ?? '').trim();

  const chatIdsRaw = (config.chatIds ?? config.chatId ?? '').trim();
  const explicitIds = chatIdsRaw
    ? chatIdsRaw.split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => Number.isFinite(n) && n !== 0)
    : [];

  const originalChatIdsTemplate = (config.__originalChatIdsTemplate ?? '').trim();
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

export function execLoop(config: Record<string, string>): string {
  return config.input ?? '';
}
