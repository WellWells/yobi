// src/main/flowExecutor.ts — AgentFlow flow execution engine
//
// Executes a FlowDefinition step-by-step, maintaining a context pool
// for variable interpolation between steps.

import { app, clipboard } from 'electron';
import { exec } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { BrowserWindow } from 'electron';
import type {
  CaptureFormat,
  FlowDefinition,
  FlowExecutionLog,
  FlowExecutionResult,
  MarkdownCapturePayload,
  SkillInstance,
  SkillType,
} from '../shared/types';
import { getProviderLabel, preparePromptForProvider, runAutomation } from './providers';
import { fetchAndParse, runParserBlocks, fetchRawText, parseRssFeed } from './urlParser';
import { sendLog } from './helpers';
import { load } from 'cheerio';

const execAsync = promisify(exec);

const DEFAULT_STEP_TIMEOUT_MS = 60_000;
// Browser steps may batch-fetch multiple URLs sequentially (each up to 25s),
// so they get a generous timeout: 10 URLs × 25s = 250s + headroom.
const BROWSER_STEP_TIMEOUT_MS = 300_000;

type LogCallback = (log: FlowExecutionLog) => void;

// ── Variable interpolation ───────────────────────────────────────────────────

function interpolate(template: string, context: Map<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, varName: string) => {
    return context.get(varName.trim()) ?? '';
  });
}

function interpolateConfig(
  config: Record<string, string>,
  context: Map<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    result[key] = interpolate(value, context);
  }
  return result;
}

function isCaptureFormat(value: string | undefined): value is CaptureFormat {
  return value === 'png' || value === 'webp' || value === 'pdf';
}

function inferTelegramSendAs(filePath: string): 'photo' | 'document' {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp' || ext === '.gif') {
    return 'photo';
  }
  return 'document';
}

function isFileOutputStep(type: SkillType, config: Record<string, string>): boolean {
  if (type === 'utility') return (config.action ?? 'delay') === 'export';
  if (type === 'llm') return isCaptureFormat(config.exportFormat);
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractTemplateVariables(template: string): string[] {
  const vars = new Set<string>();
  const matches = template.matchAll(/\{\{([^}]+)\}\}/g);
  for (const match of matches) {
    const varName = match[1]?.trim();
    if (varName) vars.add(varName);
  }
  return [...vars];
}

async function isExistingFilePath(value: string): Promise<boolean> {
  const filePath = value.trim();
  if (!filePath) return false;
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function resolveMagicUploadFile(
  template: string,
  context: Map<string, string>,
): Promise<{ variable: string; filePath: string } | null> {
  const variables = extractTemplateVariables(template);
  for (const variable of variables) {
    const value = context.get(variable)?.trim() ?? '';
    if (!value) continue;
    if (await isExistingFilePath(value)) {
      return { variable, filePath: value };
    }
  }
  return null;
}

// ── Skill handlers ───────────────────────────────────────────────────────────

// Trust boundary: command content is user-defined in the flow editor.
// Context variables interpolated into the command are from prior step outputs.
// No additional escaping is applied — the shell skill is inherently powerful by design.
async function execShell(config: Record<string, string>, timeoutMs: number): Promise<string> {
  const command = config.command ?? '';
  if (!command) return '';
  let shell: string | undefined;
  if (process.platform === 'win32') {
    // Support new unified 'shell' field and legacy 'windowsShell'.
    const selected = (config.shell ?? config.windowsShell ?? 'cmd').toLowerCase();
    shell = selected === 'powershell' ? 'powershell.exe' : 'cmd.exe';
  } else {
    // Support new unified 'shell' field and legacy 'unixShell'.
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

// Fetches the entire page HTML, strips script/style tags, and returns the body's text content (trimmed/collapsed).
async function fetchEntirePageText(url: string): Promise<string> {
  const { cleanedText: html } = await fetchAndParse(url, { rawHtml: true });
  const $ = load(html);
  $('script, style, noscript, iframe').remove();
  const rawText = $('body').text() || $.text() || '';
  return rawText
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── RSS Skill ────────────────────────────────────────────────────────────────

/** RSS checkpoint state persisted per step instance. */
interface RssCheckpoint {
  lastLinks: string[];
  /** ISO 8601 pubDate of the oldest item among lastLinks; used as a dedup anchor. */
  lastPubDate?: string;
  updatedAt: string;
}

/** Resolves the path for RSS checkpoint file inside the shared flow-checkpoints directory. */
function getRssCheckpointPath(stepId: string): string {
  const dir = app.isPackaged ? app.getPath('userData') : path.resolve('.');
  return path.join(dir, 'flow-checkpoints', `rss-${stepId}.json`);
}

async function loadRssCheckpoint(stepId: string): Promise<RssCheckpoint | null> {
  try {
    const raw = await fs.readFile(getRssCheckpointPath(stepId), 'utf-8');
    return JSON.parse(raw) as RssCheckpoint;
  } catch {
    return null;
  }
}

async function saveRssCheckpoint(stepId: string, checkpoint: RssCheckpoint): Promise<void> {
  const filePath = getRssCheckpointPath(stepId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
}

/**
 * Fetches RSS/Atom feed and returns new article links since last checkpoint.
 * - First run: returns latest 5 items, creates checkpoint
 * - Subsequent runs: returns articles newer than checkpoint, updates checkpoint
 * - When fetchContent is enabled, fetches each URL's content and formats as title/link/content
 */
async function execRss(
  config: Record<string, string>,
  stepId: string,
  targetUrl: string,
): Promise<string> {
  const url = config.url ?? '';
  if (!url) return '[]';

  const INITIAL_FETCH_COUNT = 5;

  sendLog(`📡 [AgentFlow] RSS step — fetching feed: ${url}`);

  // Fetch the raw feed XML
  const rawXml = await fetchRawText(url);

  // Parse feed items (link + pubDate) for rich deduplication
  const allItems = parseRssFeed(rawXml);
  const allLinks = allItems.map((item) => item.link);

  if (allLinks.length === 0) {
    sendLog('📡 [AgentFlow] RSS: feed returned 0 items');
    return '[]';
  }

  // Load existing checkpoint
  const checkpoint = await loadRssCheckpoint(stepId);

  let newLinks: string[];

  if (!checkpoint) {
    // First run: take latest N items and create checkpoint
    newLinks = allLinks.slice(0, INITIAL_FETCH_COUNT);
    sendLog(`📡 [AgentFlow] RSS: first run — returning ${newLinks.length} latest items`);
  } else {
    // Subsequent run: filter items not in the known set.
    // Do NOT break early — popularity-sorted feeds (e.g. Mobile01 hot articles)
    // are NOT ordered strictly by time; a known article can appear anywhere in the list.
    const knownSet = new Set(checkpoint.lastLinks);
    const anchorDate = checkpoint.lastPubDate ? new Date(checkpoint.lastPubDate) : null;

    newLinks = allItems
      .filter((item) => {
        if (knownSet.has(item.link)) return false;
        // pubDate anchor: skip articles clearly older than our checkpoint pool
        if (anchorDate && item.pubDate) {
          const itemDate = new Date(item.pubDate);
          if (itemDate < anchorDate) return false;
        }
        return true;
      })
      .map((item) => item.link);

    sendLog(`📡 [AgentFlow] RSS: found ${newLinks.length} new items since checkpoint`);
  }

  // Compute oldest pubDate among the top-100 items for next checkpoint anchor
  const poolItems = allItems.slice(0, 100);
  const poolDates = poolItems
    .map((item) => item.pubDate)
    .filter((d): d is string => !!d)
    .map((d) => new Date(d).getTime());
  const oldestPubDate =
    poolDates.length > 0
      ? new Date(Math.min(...poolDates)).toISOString()
      : undefined;

  // Update checkpoint — store up to 100 links to handle popularity-sorted feeds
  await saveRssCheckpoint(stepId, {
    lastLinks: allLinks.slice(0, 100),
    lastPubDate: oldestPubDate,
    updatedAt: new Date().toISOString(),
  });

  if (newLinks.length === 0) {
    return '[]';
  }

  // If fetchContent is disabled, return link array
  if (config.fetchContent !== 'true') {
    return JSON.stringify(newLinks);
  }

  // Fetch content from each link and format
  sendLog(`📡 [AgentFlow] RSS: fetching content for ${newLinks.length} articles`);
  const parts: string[] = [];
  for (let i = 0; i < newLinks.length; i++) {
    const articleUrl = newLinks[i];
    sendLog(`📡 [${i + 1}/${newLinks.length}] Fetching: ${articleUrl}`);
    try {
      const result = await fetchAndParse(articleUrl, { rawHtml: false });
      const title = result.title || articleUrl;
      parts.push(`title: ${title}\nlink: ${articleUrl}\ncontent: ${result.cleanedText}`);
      sendLog(`✅ [${i + 1}/${newLinks.length}] OK — ${result.cleanedText.length} chars`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      parts.push(`title: (fetch failed)\nlink: ${articleUrl}\ncontent: Error: ${msg}`);
      sendLog(`❌ [${i + 1}/${newLinks.length}] Failed: ${msg}`);
    }
  }

  const rawOutput = parts.join('\n\n---\n\n');
  const prepared = preparePromptForProvider(rawOutput, targetUrl);
  if (prepared.truncated) {
    sendLog(`✂️ [AgentFlow] RSS: output truncated to ${prepared.maxChars} chars (${getProviderLabel(targetUrl)} limit)`);
  }
  return prepared.prompt;
}

// ── Scraper Skill ────────────────────────────────────────────────────────────

interface ScraperCheckpoint {
  lastLinks: string[];
  lastTitles?: string[];
  updatedAt: string;
}

function getScraperCheckpointPath(stepId: string): string {
  const dir = app.isPackaged ? app.getPath('userData') : path.resolve('.');
  return path.join(dir, 'flow-checkpoints', `scraper-${stepId}.json`);
}

async function loadScraperCheckpoint(stepId: string): Promise<ScraperCheckpoint | null> {
  try {
    const raw = await fs.readFile(getScraperCheckpointPath(stepId), 'utf-8');
    return JSON.parse(raw) as ScraperCheckpoint;
  } catch {
    return null;
  }
}

async function saveScraperCheckpoint(stepId: string, checkpoint: ScraperCheckpoint): Promise<void> {
  const filePath = getScraperCheckpointPath(stepId);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
}

async function execScraper(
  config: Record<string, string>,
  stepId: string,
): Promise<string> {
  const url = config.url ?? '';
  if (!url) return '[]';

  sendLog(`🔍 [AgentFlow] Web Scraper step — fetching page: ${url}`);
  const result = await fetchAndParse(url, { rawHtml: true });
  const html = result.cleanedText;

  const $ = load(`<html>${html}</html>`);

  let baseOrigin = '';
  try {
    baseOrigin = new URL(url).origin;
  } catch {
    // ignore
  }

  const items: Array<{ title: string; link: string }> = [];

  const itemSel = (config.itemSelector ?? '').trim();
  const titleSel = (config.titleSelector ?? '').trim();
  const linkSel = (config.linkSelector ?? '').trim();

  if (!titleSel && !linkSel) {
    sendLog(`⚠️ [AgentFlow] Scraper: Both titleSelector and linkSelector are empty!`);
    return '[]';
  }

  if (itemSel) {
    // Nested selector mode
    $(itemSel).each((_, el) => {
      const $el = $(el);
      const title = titleSel ? $el.find(titleSel).first().text().trim() : $el.text().trim();
      let rawLink = '';
      if (linkSel) {
        const linkEl = $el.find(linkSel).first();
        rawLink = linkEl.attr('href') ?? linkEl.text().trim();
      } else {
        rawLink = $el.attr('href') ?? '';
      }
      
      if (rawLink) {
        try {
          const resolved = new URL(rawLink, baseOrigin || url).href;
          if (/^https?:\/\//i.test(resolved)) {
            items.push({ title: title || resolved, link: resolved });
          }
        } catch {
          // ignore
        }
      }
    });
  } else {
    // Global selector mode paired by index
    const titles: string[] = [];
    if (titleSel) {
      $(titleSel).each((_, el) => {
        titles.push($(el).text().trim());
      });
    }

    const rawLinks: string[] = [];
    if (linkSel) {
      $(linkSel).each((_, el) => {
        const $el = $(el);
        const l = $el.attr('href') ?? $el.text().trim();
        rawLinks.push(l);
      });
    }

    const maxLen = Math.max(titles.length, rawLinks.length);
    for (let i = 0; i < maxLen; i++) {
      const title = titles[i] ?? '';
      const rawLink = rawLinks[i] ?? '';
      if (rawLink) {
        try {
          const resolved = new URL(rawLink, baseOrigin || url).href;
          if (/^https?:\/\//i.test(resolved)) {
            items.push({ title: title || resolved, link: resolved });
          }
        } catch {
          // ignore
        }
      }
    }
  }

  sendLog(`🔍 [AgentFlow] Scraper: Found ${items.length} total items on page`);

  if (items.length === 0) {
    return '[]';
  }

  // Load existing checkpoint
  const checkpoint = await loadScraperCheckpoint(stepId);

  // A set of seen titles and links from the checkpoint
  const seenSet = new Set<string>();
  if (checkpoint) {
    if (checkpoint.lastTitles) {
      checkpoint.lastTitles.forEach((t) => { if (t) seenSet.add(t.trim()); });
    }
    if (checkpoint.lastLinks) {
      checkpoint.lastLinks.forEach((l) => { if (l) seenSet.add(l.trim()); });
    }
  }

  const newItems: Array<{ title: string; link: string }> = [];
  for (const item of items) {
    const titleKey = item.title.trim();
    const linkKey = item.link.trim();
    if (!titleKey && !linkKey) continue;

    // Check if seen (by title or by link)
    const isSeen = (titleKey && seenSet.has(titleKey)) || (linkKey && seenSet.has(linkKey));
    if (!isSeen) {
      newItems.push(item);
    }
  }

  const INITIAL_FETCH_COUNT = parseInt(config.maxItems ?? '5', 10);
  
  // Slice to get the items to return in this execution
  const itemsToReturn = newItems.slice(0, INITIAL_FETCH_COUNT);
  
  if (!checkpoint) {
    sendLog(`🔍 [AgentFlow] Scraper: First run — returning ${itemsToReturn.length} latest items`);
  } else {
    sendLog(`🔍 [AgentFlow] Scraper: Found ${itemsToReturn.length} new items out of ${newItems.length} total unseen items`);
  }

  // Update checkpoint — replace entirely with current page content so that
  // items removed from the webpage are also removed from the checkpoint.
  const newCheckpointTitles = items.map((item) => item.title.trim()).filter(Boolean);
  const newCheckpointLinks = items.map((item) => item.link.trim()).filter(Boolean);

  await saveScraperCheckpoint(stepId, {
    lastLinks: newCheckpointLinks,
    lastTitles: newCheckpointTitles,
    updatedAt: new Date().toISOString(),
  });

  return JSON.stringify(itemsToReturn);
}


async function execBrowser(config: Record<string, string>): Promise<string> {
  const url = config.url ?? '';
  if (!url) return '';

  const urlPreview = url.length > 120 ? `${url.slice(0, 120)}…` : url;
  sendLog(`🌐 [AgentFlow] Browser step URL: ${urlPreview}`);

  // Detect JSON array or newline/comma-separated URL list
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

  return await fetchEntirePageText(url);
}

async function execLlm(
  config: Record<string, string>,
  deps: FlowExecutorDeps,
  timeoutMs: number,
): Promise<string> {
  const prompt = config.prompt ?? '';
  if (!prompt) return '';
  const workerWin = deps.getWorkerWin();
  if (!workerWin) throw new Error('Worker window not available');
  const providerUrl = config.provider || deps.getTargetUrl();
  const preparedPrompt = preparePromptForProvider(prompt, providerUrl);
  if (preparedPrompt.removedBlankLines) {
    sendLog(`✂️ [AgentFlow] Removed blank lines for ${getProviderLabel(providerUrl)} input`);
  }
  if (preparedPrompt.truncated) {
    sendLog(`✂️ [AgentFlow] Truncated ${getProviderLabel(providerUrl)} input to ${preparedPrompt.maxChars} chars`);
  }

  const { response } = await runAutomation(workerWin, preparedPrompt.prompt, timeoutMs, providerUrl);
  if (config.saveToHistory === 'true' && deps.onSaveHistory) {
    await deps.onSaveHistory({
      prompt: preparedPrompt.prompt,
      response,
      providerLabel: getProviderLabel(providerUrl),
    });
  }
  const exportFormat = config.exportFormat;
  if (!isCaptureFormat(exportFormat)) {
    return response;
  }
  if (!deps.captureMarkdown) {
    throw new Error('LLM export requires captureMarkdown dependency');
  }
  const title = config.exportTitle || 'AgentFlow LLM Export';
  const background = config.background || 'linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #334155 100%)';
  const exportOptions = {
    fileName: (config.exportFileName ?? '').trim(),
    showProvider: config.exportShowProvider !== 'false',
    showTimestamp: config.exportShowTimestamp !== 'false',
  };
  const payload: MarkdownCapturePayload = {
    title,
    prompt: preparedPrompt.prompt,
    content: response,
    summary: response.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_~\-`\[\]()]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220),
    provider: getProviderLabel(providerUrl),
    timestamp: new Date().toISOString(),
  };
  const filePath = await deps.captureMarkdown(payload, exportFormat, background, exportOptions);
  sendLog(`🖼️ [AgentFlow] LLM export generated: ${filePath}`);
  return filePath;
}

function execClipboard(config: Record<string, string>): string {
  const action = config.action ?? 'read';
  if (action === 'write') {
    clipboard.writeText(config.text ?? '');
    return '';
  }
  return clipboard.readText();
}

function execComment(config: Record<string, string>): string {
  return (config.note ?? '').trim();
}

async function execUtility(config: Record<string, string>, deps: FlowExecutorDeps): Promise<string> {
  const action = config.action ?? 'delay';
  if (action === 'delay') {
    const ms = Math.min(Number(config.delayMs) || 1_000, 60_000);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return `delayed ${ms}ms`;
  }
  if (action === 'notify') {
    const title = config.title ?? 'AgentFlow';
    const body = config.body ?? '';
    sendLog(`📢 [AgentFlow] ${title}: ${body}`);
    return body;
  }
  if (action === 'export') {
    if (!deps.captureMarkdown) throw new Error('Export action requires captureMarkdown dependency');
    const content = config.content ?? '';
    const format = (['png', 'webp', 'pdf'] as const).includes(config.format as CaptureFormat)
      ? (config.format as CaptureFormat)
      : 'png';
    const title = config.title || 'AgentFlow Export';
    const background = config.background || 'linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #334155 100%)';
    const payload: MarkdownCapturePayload = {
      title,
      prompt: '',
      content,
      summary: content.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_~\-`\[\]()]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220),
      provider: 'AgentFlow',
      timestamp: new Date().toISOString(),
    };
    const filePath = await deps.captureMarkdown(payload, format, background);
    sendLog(`🖼️ [AgentFlow] Snapshot exported: ${filePath}`);
    return filePath;
  }
  return '';
}

async function execBot(
  config: Record<string, string>,
  deps: FlowExecutorDeps,
): Promise<string> {
  const message = config.message ?? '';
  const magicFilePath = (config.__magicUploadPath ?? '').trim();
  const magicCaption = (config.__magicUploadCaption ?? '').trim();

  // Resolve target chat IDs — chatIds (new multi-select) takes priority over chatId (legacy).
  // Telegram group chats use negative IDs; accept any non-zero integer.
  const chatIdsRaw = (config.chatIds ?? config.chatId ?? '').trim();
  const explicitIds = chatIdsRaw
    ? chatIdsRaw.split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => Number.isFinite(n) && n !== 0)
    : [];

  // Detect whether chatIds was configured as a template (e.g. {{bot.triggerChatId}}) but
  // resolved to empty because the flow was not triggered via Telegram.
  // In that case, skip sending rather than falling back to all paired users.
  const originalChatIdsTemplate = (config.__originalChatIdsTemplate ?? '').trim();
  const chatIdsWereConfiguredButEmpty = originalChatIdsTemplate !== '' && explicitIds.length === 0;

  if (chatIdsWereConfiguredButEmpty) {
    sendLog('⚠️ [Bot] chatIds resolved to empty (no trigger context) — skipping send');
    return message || magicFilePath;
  }

  // File upload mode (magic variable only)
  if (magicFilePath) {
    if (!deps.sendTelegramFile) throw new Error('sendTelegramFile not configured in FlowExecutorDeps');
    const sendAs = inferTelegramSendAs(magicFilePath);
    const caption = magicCaption || undefined;
    if (explicitIds.length > 0) {
      for (const chatId of explicitIds) {
        await deps.sendTelegramFile(chatId, magicFilePath, sendAs, caption);
        sendLog(`📤 [Bot] Sent ${sendAs} to chat ${chatId}: ${magicFilePath}`);
      }
    } else {
      const pairedUsers = deps.getPairedUsers?.() ?? [];
      if (pairedUsers.length === 0) throw new Error('No paired Telegram users found');
      for (const user of pairedUsers) {
        await deps.sendTelegramFile(user.userId, magicFilePath, sendAs, caption);
        sendLog(`📤 [Bot] Sent ${sendAs} to user ${user.userId}: ${magicFilePath}`);
      }
    }
    return magicFilePath;
  }

  // Text-only mode
  if (!message) return '';
  if (!deps.sendTelegramMessage) throw new Error('Telegram bot is not configured in FlowExecutorDeps');

  if (explicitIds.length > 0) {
    for (const chatId of explicitIds) {
      await deps.sendTelegramMessage(chatId, message);
      sendLog(`📤 [Bot] Sent to chat ${chatId}`);
    }
  } else {
    const pairedUsers = deps.getPairedUsers?.() ?? [];
    if (pairedUsers.length === 0) throw new Error('No paired Telegram users found');
    for (const user of pairedUsers) {
      await deps.sendTelegramMessage(user.userId, message);
      sendLog(`📤 [Bot] Sent to user ${user.userId} (${user.username ?? user.firstName ?? ''})`);
    }
  }
  return message;
}

// ── Executor ─────────────────────────────────────────────────────────────────

export interface SaveHistoryInfo {
  prompt: string;
  response: string;
  providerLabel: string;
}

export interface FlowExecutorDeps {
  getWorkerWin: () => BrowserWindow | null;
  getTargetUrl: () => string;
  getResponseTimeoutMs?: () => number;
  onSaveHistory?: (info: SaveHistoryInfo) => Promise<void>;
  sendTelegramMessage?: (chatId: number, text: string) => Promise<void>;
  getPairedUsers?: () => Array<{ userId: number; username?: string; firstName?: string }>;
  /** Renders markdown content as a snapshot and returns the saved file path. */
  captureMarkdown?: (
    payload: MarkdownCapturePayload,
    format: CaptureFormat,
    background: string,
    options?: {
      fileName?: string;
      showProvider?: boolean;
      showTimestamp?: boolean;
      showPrompt?: boolean;
      showContent?: boolean;
    },
  ) => Promise<string>;
  /** Sends a file to a Telegram chat as photo or document. */
  sendTelegramFile?: (
    chatId: number,
    filePath: string,
    sendAs: 'photo' | 'document',
    caption?: string,
  ) => Promise<void>;
}

function normalizeTimeoutMs(value: number | undefined, fallbackMs: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return fallbackMs;
  return Math.max(1_000, Math.trunc(value));
}

function resolveStepTimeoutMs(type: SkillType, deps: FlowExecutorDeps): number {
  if (type === 'llm') {
    return normalizeTimeoutMs(deps.getResponseTimeoutMs?.(), DEFAULT_STEP_TIMEOUT_MS);
  }
  if (type === 'browser' || type === 'rss' || type === 'scraper') {
    return BROWSER_STEP_TIMEOUT_MS;
  }
  return DEFAULT_STEP_TIMEOUT_MS;
}

function withStepTimeout<T>(work: Promise<T>, timeoutMs: number, stepType: SkillType): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${stepType} step timed out after ${Math.ceil(timeoutMs / 1_000)} seconds`));
    }, timeoutMs);

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function emitLog(
  onLog: LogCallback | undefined,
  flowId: string,
  stepId: string,
  stepIndex: number,
  status: FlowExecutionLog['status'],
  output?: string,
  error?: string,
): void {
  onLog?.({
    flowId,
    stepId,
    stepIndex,
    status,
    output,
    error,
    timestamp: new Date().toISOString(),
  });
}

/** Sentinel thrown by the stop skill to gracefully halt the flow. */
class StopFlowSignal extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'StopFlowSignal';
  }
}

/** Checks the resolved value and throws StopFlowSignal if the stop condition is met. */
function execStop(config: Record<string, string>): string {
  const value = (config.value ?? '').trim();
  if (value === '' || value === '[]') {
    throw new StopFlowSignal(`Stop condition met: value is ${value === '' ? 'empty' : '[]'}`);
  }
  return value;
}

function findLoopEndIndex(steps: SkillInstance[], startIdx: number): number {
  let depth = 1;
  for (let j = startIdx + 1; j < steps.length; j++) {
    if (steps[j].type === 'loop') depth++;
    if (steps[j].type === 'end_loop') {
      depth--;
      if (depth === 0) {
        return j;
      }
    }
  }
  return steps.length;
}

export async function executeFlow(
  flow: FlowDefinition,
  deps: FlowExecutorDeps,
  onLog?: LogCallback,
  initialContext?: Record<string, string>,
): Promise<FlowExecutionResult> {
  const context = new Map<string, string>();

  // Seed built-in variables
  context.set('clipboard', clipboard.readText());
  context.set('timestamp', new Date().toISOString());
  context.set('flow.name', flow.name);

  // Seed caller-provided initial context (e.g. bot trigger input variables)
  if (initialContext) {
    for (const [k, v] of Object.entries(initialContext)) {
      context.set(k, v);
    }
  }

  let completedSteps = 0;

  sendLog(`▶️ [AgentFlow] Executing flow: ${flow.name} (${flow.steps.length} steps)`);

  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    emitLog(onLog, flow.id, step.id, i, 'running');
    sendLog(`⏳ Step ${i + 1}/${flow.steps.length}: [${step.type}] ${step.label}`);

    try {
      const resolvedConfig = interpolateConfig(step.config, context);
      if (step.type === 'bot') {
        const messageTemplate = step.config.message ?? '';
        const magicFile = await resolveMagicUploadFile(messageTemplate, context);
        if (magicFile) {
          const placeholderPattern = new RegExp(`\\{\\{\\s*${escapeRegExp(magicFile.variable)}\\s*\\}\\}`, 'g');
          const captionTemplate = messageTemplate.replace(placeholderPattern, '').trim();
          resolvedConfig.__magicUploadPath = magicFile.filePath;
          resolvedConfig.__magicUploadCaption = interpolate(captionTemplate, context).trim();
        }
        // Preserve the original chatIds template so execBot can detect
        // whether it was configured but resolved to empty (e.g. {{bot.triggerChatId}} with no bot context).
        resolvedConfig.__originalChatIdsTemplate = (step.config.chatIds ?? step.config.chatId ?? '').trim();
      }
      const stepTimeoutMs = resolveStepTimeoutMs(step.type, deps);
      const output = await withStepTimeout(
        executeSkill(step.type, step.id, resolvedConfig, deps, stepTimeoutMs),
        stepTimeoutMs,
        step.type,
      );

      // Store output in context pool
      if (step.outputKey) {
        context.set(step.outputKey, output);
      }
      context.set(`${step.id}.output`, output);
      if (isFileOutputStep(step.type, resolvedConfig) && output) {
        context.set('file', output);
      }

      completedSteps++;
      emitLog(onLog, flow.id, step.id, i, 'completed', output);
      sendLog(`✅ Step ${i + 1} completed (${output.length} chars)`);

      // If step is a 'loop' step, we loop over the subsequent steps!
      if (step.type === 'loop' && i + 1 < flow.steps.length) {
        const loopVar = (step.config.loopVar ?? 'item').trim() || 'item';
        const limitIterations = step.config.limitIterations !== 'false';
        const limit = parseInt(step.config.maxIterations ?? '5', 10) || 5;
        let items: any[] = [];
        try {
          const parsed = JSON.parse(output);
          if (Array.isArray(parsed)) {
            items = parsed;
          }
        } catch {
          // ignore
        }

        if (limitIterations && limit > 0) {
          items = items.slice(0, limit);
        }

        const endIdx = findLoopEndIndex(flow.steps, i);

        if (items.length > 0) {
          sendLog(`🔄 [AgentFlow] Looping subsequent steps for ${items.length} items using variable "${loopVar}"`);
          for (let j = 0; j < items.length; j++) {
            const item = items[j];
            sendLog(`🔄 [AgentFlow] Loop iteration ${j + 1}/${items.length}`);
            const loopContext = new Map(context);
            if (typeof item === 'object' && item !== null) {
              for (const [k, v] of Object.entries(item)) {
                const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
                if (step.outputKey) {
                  loopContext.set(`${step.outputKey}.${k}`, valStr);
                }
                loopContext.set(`${loopVar}.${k}`, valStr);
              }
              const itemStr = JSON.stringify(item);
              if (step.outputKey) {
                loopContext.set(step.outputKey, itemStr);
              }
              loopContext.set(loopVar, itemStr);
            } else {
              const valStr = String(item);
              if (step.outputKey) {
                loopContext.set(step.outputKey, valStr);
              }
              loopContext.set(loopVar, valStr);
            }
            await executeFlowSubrange(flow, i + 1, endIdx, loopContext, deps, onLog);
          }
          // Mark loop body steps as completed in flat progress count
          for (let j = i + 1; j < endIdx; j++) {
            completedSteps++;
          }
          sendLog(`🔄 [AgentFlow] Loop complete`);
          i = endIdx - 1; // skip body in outer execution flow
        } else {
          // Skip loop body
          for (let j = i + 1; j < endIdx; j++) {
            emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
            completedSteps++;
          }
          sendLog(`🔄 [AgentFlow] No items to loop, skipped loop body steps`);
          i = endIdx - 1;
        }
      }

    } catch (err) {
      // StopFlowSignal is a graceful halt — not an error
      if (err instanceof StopFlowSignal) {
        emitLog(onLog, flow.id, step.id, i, 'skipped', undefined, err.message);
        sendLog(`⏹️ Step ${i + 1} stopped flow: ${err.message}`);
        for (let j = i + 1; j < flow.steps.length; j++) {
          emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
        }
        sendLog(`⏹️ [AgentFlow] Flow "${flow.name}" stopped early (${completedSteps}/${flow.steps.length} steps)`);
        return {
          flowId: flow.id,
          success: true,
          outputs: Object.fromEntries(context),
          completedSteps,
          totalSteps: flow.steps.length,
          completedAt: new Date().toISOString(),
        };
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      emitLog(onLog, flow.id, step.id, i, 'error', undefined, errorMsg);
      sendLog(`❌ Step ${i + 1} failed: ${errorMsg}`);

      // Mark remaining steps as skipped
      for (let j = i + 1; j < flow.steps.length; j++) {
        emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
      }

      return {
        flowId: flow.id,
        success: false,
        outputs: Object.fromEntries(context),
        error: `Step "${step.label}" failed: ${errorMsg}`,
        completedSteps,
        totalSteps: flow.steps.length,
        completedAt: new Date().toISOString(),
      };
    }
  }

  sendLog(`✅ [AgentFlow] Flow "${flow.name}" completed (${completedSteps}/${flow.steps.length} steps)`);

  return {
    flowId: flow.id,
    success: true,
    outputs: Object.fromEntries(context),
    completedSteps,
    totalSteps: flow.steps.length,
    completedAt: new Date().toISOString(),
  };
}

function execLoop(config: Record<string, string>): string {
  return config.input ?? '';
}

async function executeSkill(
  type: SkillType,
  stepId: string,
  config: Record<string, string>,
  deps: FlowExecutorDeps,
  timeoutMs: number,
): Promise<string> {
  switch (type) {
    case 'shell':
      return execShell(config, timeoutMs);
    case 'browser':
      return execBrowser(config);
    case 'llm':
      return execLlm(config, deps, timeoutMs);
    case 'clipboard':
      return execClipboard(config);
    case 'utility':
      return execUtility(config, deps);
    case 'bot':
      return execBot(config, deps);
    case 'rss':
      return execRss(config, stepId, deps.getTargetUrl());
    case 'scraper':
      return execScraper(config, stepId);
    case 'stop':
      return execStop(config);
    case 'comment':
      return execComment(config);
    case 'loop':
      return execLoop(config);
    case 'end_loop':
      return '';
    default:
      throw new Error(`Unknown skill type: ${type as string}`);
  }
}

async function executeFlowSubrange(
  flow: FlowDefinition,
  startIndex: number,
  endIndex: number,
  context: Map<string, string>,
  deps: FlowExecutorDeps,
  onLog?: LogCallback,
): Promise<void> {
  for (let i = startIndex; i < endIndex; i++) {
    const step = flow.steps[i];
    emitLog(onLog, flow.id, step.id, i, 'running');
    try {
      const resolvedConfig = interpolateConfig(step.config, context);
      if (step.type === 'bot') {
        const messageTemplate = step.config.message ?? '';
        const magicFile = await resolveMagicUploadFile(messageTemplate, context);
        if (magicFile) {
          const placeholderPattern = new RegExp(`\\{\\{\\s*${escapeRegExp(magicFile.variable)}\\s*\\}\\}`, 'g');
          const captionTemplate = messageTemplate.replace(placeholderPattern, '').trim();
          resolvedConfig.__magicUploadPath = magicFile.filePath;
          resolvedConfig.__magicUploadCaption = interpolate(captionTemplate, context).trim();
        }
        resolvedConfig.__originalChatIdsTemplate = (step.config.chatIds ?? step.config.chatId ?? '').trim();
      }
      const stepTimeoutMs = resolveStepTimeoutMs(step.type, deps);
      const output = await withStepTimeout(
        executeSkill(step.type, step.id, resolvedConfig, deps, stepTimeoutMs),
        stepTimeoutMs,
        step.type,
      );

      // Store output in context pool
      if (step.outputKey) {
        context.set(step.outputKey, output);
      }
      context.set(`${step.id}.output`, output);
      if (isFileOutputStep(step.type, resolvedConfig) && output) {
        context.set('file', output);
      }

      emitLog(onLog, flow.id, step.id, i, 'completed', output);

      // If step is a 'loop' step, handle it recursively!
      if (step.type === 'loop' && i + 1 < endIndex) {
        const loopVar = (step.config.loopVar ?? 'item').trim() || 'item';
        const limitIterations = step.config.limitIterations !== 'false';
        const limit = parseInt(step.config.maxIterations ?? '5', 10) || 5;
        let items: any[] = [];
        try {
          const parsed = JSON.parse(output);
          if (Array.isArray(parsed)) {
            items = parsed;
          }
        } catch {
          // ignore
        }

        if (limitIterations && limit > 0) {
          items = items.slice(0, limit);
        }

        const endIdx = findLoopEndIndex(flow.steps, i);
        const subrangeEndIdx = Math.min(endIdx, endIndex);

        if (items.length > 0) {
          sendLog(`🔄 [AgentFlow] Looping subsequent steps for ${items.length} items (nested) using variable "${loopVar}"`);
          for (let j = 0; j < items.length; j++) {
            const item = items[j];
            sendLog(`🔄 [AgentFlow] Loop iteration ${j + 1}/${items.length} (nested)`);
            const loopContext = new Map(context);
            if (typeof item === 'object' && item !== null) {
              for (const [k, v] of Object.entries(item)) {
                const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
                if (step.outputKey) {
                  loopContext.set(`${step.outputKey}.${k}`, valStr);
                }
                loopContext.set(`${loopVar}.${k}`, valStr);
              }
              const itemStr = JSON.stringify(item);
              if (step.outputKey) {
                loopContext.set(step.outputKey, itemStr);
              }
              loopContext.set(loopVar, itemStr);
            } else {
              const valStr = String(item);
              if (step.outputKey) {
                loopContext.set(step.outputKey, valStr);
              }
              loopContext.set(loopVar, valStr);
            }
            await executeFlowSubrange(flow, i + 1, subrangeEndIdx, loopContext, deps, onLog);
          }
          i = subrangeEndIdx - 1; // skip body in outer execution flow
        } else {
          // Skip loop body
          for (let j = i + 1; j < subrangeEndIdx; j++) {
            emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
          }
          i = subrangeEndIdx - 1;
        }
      }
    } catch (err) {
      if (err instanceof StopFlowSignal) {
        emitLog(onLog, flow.id, step.id, i, 'skipped', undefined, err.message);
        for (let j = i + 1; j < flow.steps.length; j++) {
          emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
        }
        break;
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      emitLog(onLog, flow.id, step.id, i, 'error', undefined, errorMsg);
      for (let j = i + 1; j < flow.steps.length; j++) {
        emitLog(onLog, flow.id, flow.steps[j].id, j, 'skipped');
      }
      throw err;
    }
  }
}

