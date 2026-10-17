import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getLanguageDir, getUserLanguageDir } from './files';
import { fillTemplate } from '../shared/fillTemplate';
import { formatResetTime, parseClaudeUsageLimit } from './providers/claudeUsageLimit';
import { CLAUDE_BUSY, CLAUDE_LEFT_CONVERSATION } from './providers/claudeReadScript';
import { WORKER_WINDOW_UNAVAILABLE } from './workerWindowError';
import { QUEUE_CANCELLED } from './flow/flowQueue';
import { mtprotoErrorKey } from './telegram/mtproto/errors';
import { TELEGRAM_LARGE_UPLOAD_FAILED, TELEGRAM_LARGE_UPLOAD_NOT_READY } from './telegram/largeUploadError';
import {
  MCP_AUTH_CANCELLED,
  MCP_AUTH_DENIED_PREFIX,
  MCP_AUTH_MISSING_CODE,
  MCP_AUTH_STATE_MISMATCH,
  MCP_AUTH_TIMED_OUT,
  MCP_INVALID_URL_PREFIX,
  MCP_SERVER_NOT_FOUND,
  MCP_UNAVAILABLE,
  MCP_UNKNOWN_BUILTIN,
  MCP_UNKNOWN_SERVER,
  MCP_URL_NEEDS_HTTPS,
} from './mcp/mcpErrors';
import type { PromptPreferences } from '../shared/types';

export function isValidLocaleTag(tag: string): boolean {
  return /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(tag);
}

let langCache: Record<string, string> = {};
let enCache: Record<string, string> = {};

export function getLangCache(): Record<string, string> {
  return langCache;
}

export function setLangCache(data: Record<string, string>): void {
  langCache = data;
}

export function setEnCache(data: Record<string, string>): void {
  enCache = data;
}

interface CachedPack {
  mtimeMs: number;
  data: Record<string, string>;
}

/**
 * Parsed packs keyed by absolute path. The renderer asks for every installed
 * locale on startup and again whenever the language picker opens, and a pack is
 * ~110 KB of JSON — re-reading and re-parsing all of them blocks the main
 * process at exactly the wrong moment. Validated by mtime so dropping a file
 * into the user language folder (or editing one in dev) still takes effect.
 */
const packCache = new Map<string, CachedPack>();

export async function loadLanguageData(lang: string): Promise<Record<string, string> | null> {
  if (!isValidLocaleTag(lang)) return null;
  for (const dir of [getUserLanguageDir(), getLanguageDir()]) {
    const file = path.join(dir, `${lang}.json`);
    try {
      const { mtimeMs } = await fs.stat(file);
      const cached = packCache.get(file);
      if (cached && cached.mtimeMs === mtimeMs) return cached.data;
      const raw = await fs.readFile(file, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const data = parsed as Record<string, string>;
        packCache.set(file, { mtimeMs, data });
        return data;
      }
    } catch {
    }
  }
  return null;
}

export function t(
  strings: Record<string, string>,
  key: string,
  vars?: Record<string, string>,
): string {
  const result = strings[key] ?? enCache[key] ?? key;
  return vars ? fillTemplate(result, vars) : result;
}

const LOGIN_REQUIRED_RE = /\b(GEMINI|CHATGPT|CLAUDE|PERPLEXITY)_LOGIN_REQUIRED\b/;
/** `siteVerification.ts`'s two English diagnostics: `<site> needs a one-time verification…` / `<site> verification was not completed…`. */
const SITE_VERIFICATION_RE = /^(\S+) (needs) a one-time verification in Yobi on this computer|^(\S+) verification was not completed/;
const LOGIN_REQUIRED_PROVIDERS: Record<string, string> = {
  GEMINI: 'Gemini',
  CHATGPT: 'ChatGPT',
  CLAUDE: 'Claude',
  PERPLEXITY: 'Perplexity',
};

/**
 * Provider diagnostics that keep coming back in different words, mapped to what the user can
 * do about them. Group 1 is always the provider's display name. The raw text still goes to the
 * log first; only what the user reads changes, so classifiers that read the raw message
 * (flowErrorReason, metrics) are unaffected.
 */
const PROVIDER_ERROR_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(ChatGPT|Claude|Gemini|Perplexity) automation timed out\b/, 'main.error.answerTimeout'],
  [/^Timeout: (Perplexity) response stopped updating/, 'main.error.answerTimeout'],
  [/^(Gemini) is still generating but produced no visible answer/, 'main.error.answerTimeout'],
  [/^(ChatGPT|Claude|Gemini|Perplexity) (?:composer )?never (?:accepted|registered)\b/, 'main.error.promptNotTaken'],
  [/^(Gemini) send button never became clickable/, 'main.error.promptNotTaken'],
  [/^(Claude) send button is not available/, 'main.error.promptNotTaken'],
  [/^(Gemini) accepted the prompt but never started generating/, 'main.error.answerNotStarted'],
];

const AUTOMATION_FAILED_RE = /^(ChatGPT|Claude|Gemini|Perplexity) automation failed: ([\s\S]*)$/;
const AUTOMATION_FAILED_KEYS: Record<string, string> = {
  ChatGPT: 'main.error.chatgptAutomationFailed',
  Claude: 'main.error.claudeAutomationFailed',
  Gemini: 'main.error.geminiAutomationFailed',
  Perplexity: 'main.error.pplxAutomationFailed',
};

const MCP_EXACT_KEYS: Record<string, string> = {
  [MCP_UNAVAILABLE]: 'main.error.mcpUnavailable',
  [MCP_SERVER_NOT_FOUND]: 'main.error.mcpServerMissing',
  [MCP_UNKNOWN_SERVER]: 'main.error.mcpServerMissing',
  [MCP_UNKNOWN_BUILTIN]: 'main.error.mcpServerMissing',
  [MCP_AUTH_STATE_MISMATCH]: 'main.error.mcpAuthIncomplete',
  [MCP_AUTH_MISSING_CODE]: 'main.error.mcpAuthIncomplete',
  [MCP_AUTH_CANCELLED]: 'main.error.mcpAuthIncomplete',
  [MCP_AUTH_TIMED_OUT]: 'main.error.mcpAuthTimeout',
};

/**
 * The address check's reason stays visible — the host name and the https rule are what the
 * user fixes — only the wording around it is translated.
 */
function localizeMcpError(raw: string, strings: Record<string, string>): string | null {
  const exact = MCP_EXACT_KEYS[raw];
  if (exact) return t(strings, exact);
  if (raw.startsWith(MCP_AUTH_DENIED_PREFIX)) {
    return t(strings, 'main.error.mcpAuthDenied', { error: raw.slice(MCP_AUTH_DENIED_PREFIX.length) });
  }
  if (!raw.startsWith(MCP_INVALID_URL_PREFIX)) return null;
  const detail = raw.slice(MCP_INVALID_URL_PREFIX.length);
  if (detail === MCP_URL_NEEDS_HTTPS) return t(strings, 'main.error.mcpUrlNeedsHttps');
  const blocked = /^(?:host resolves to a )?blocked address: ([^\s→]+)/.exec(detail);
  if (blocked) return t(strings, 'main.error.mcpUrlPrivate', { host: blocked[1] });
  const unresolved = /^could not resolve host: (\S+)/.exec(detail);
  if (unresolved) return t(strings, 'main.error.mcpUrlUnresolved', { host: unresolved[1] });
  return t(strings, 'main.error.mcpInvalidUrl', { error: detail });
}

function localizeKnownError(raw: string, strings: Record<string, string>): string | null {
  const exactMap: Record<string, string> = {
    'ChatGPT returned empty response': t(strings, 'main.error.chatgptEmptyResponse'),
    'ChatGPT input area not found': t(strings, 'main.error.chatgptInputNotFound'),
    'ChatGPT response block not found': t(strings, 'main.error.chatgptResponseBlockNotFound'),
    'ChatGPT response is empty': t(strings, 'main.error.chatgptResponseEmpty'),
    'Claude returned empty response': t(strings, 'main.error.claudeEmptyResponse'),
    'Gemini input area not found — is the page logged in?': t(strings, 'main.error.geminiInputNotFound'),
    'Gemini input area not found after navigation': t(strings, 'main.error.geminiInputNotFound'),
    'Clipboard interceptor returned empty text': t(strings, 'main.error.geminiClipboardEmpty'),
    'Gemini answer element present but its text was empty': t(strings, 'main.error.geminiCopyNoText'),
    'Perplexity returned empty response': t(strings, 'main.error.pplxEmptyResponse'),
    'Perplexity input area not found': t(strings, 'main.error.pplxInputNotFound'),
    'Perplexity response block not found': t(strings, 'main.error.pplxResponseBlockNotFound'),
    'Perplexity response is empty': t(strings, 'main.error.pplxResponseEmpty'),
    'Perplexity asked to sign in': t(strings, 'main.error.pplxSignInWall'),
    'capture renderer not ready': t(strings, 'main.error.captureRendererNotReady'),
    'webp screenshot data is empty': t(strings, 'main.error.webpDataEmpty'),
    'export failed': t(strings, 'main.error.exportFailed'),
    'Image height exceeds limits. Please use PDF format.': t(strings, 'main.error.imageTooTall'),
    'BYOK provider not found — the instance may have been deleted': t(strings, 'main.error.byokInstanceMissing'),
    'BYOK group not found — it may have been deleted': t(strings, 'main.error.byokGroupMissing'),
    'BYOK group has no usable keys — add at least one key to the group': t(strings, 'main.error.byokGroupEmpty'),
    'Telegram bot is not running': t(strings, 'main.error.botNotRunning', { bot: 'Telegram' }),
    'LINE bot is not running': t(strings, 'main.error.botNotRunning', { bot: 'LINE' }),
    [QUEUE_CANCELLED]: t(strings, 'main.error.cancelledInQueue'),
    [TELEGRAM_LARGE_UPLOAD_FAILED]: t(strings, 'main.error.telegramLargeUploadFailed'),
    [TELEGRAM_LARGE_UPLOAD_NOT_READY]: t(strings, 'main.error.telegramLargeUploadNotReady'),
  };
  if (exactMap[raw]) return exactMap[raw];

  const mcp = localizeMcpError(raw, strings);
  if (mcp) return mcp;
  // A big Telegram upload over MTProto (`telegram/mtproto/errors.ts`): only the code is read.
  const upload = mtprotoErrorKey(raw);
  if (upload) return t(strings, upload.key, upload.vars);
  if (raw.startsWith(WORKER_WINDOW_UNAVAILABLE)) return t(strings, 'main.error.workerWindowUnavailable');
  // A link site's click-to-verify check that a bot message or a schedule could not answer
  // (`siteVerification.ts`), and a verification window the person left unfinished.
  const verify = SITE_VERIFICATION_RE.exec(raw);
  if (verify) {
    const key = verify[2] ? 'flow.error.siteVerificationNeeded' : 'flow.error.siteVerificationIncomplete';
    return t(strings, key, { site: verify[1] ?? verify[3] });
  }
  const login = LOGIN_REQUIRED_RE.exec(raw);
  if (login) return t(strings, 'main.error.loginRequired', { provider: LOGIN_REQUIRED_PROVIDERS[login[1]] });
  // Only reaches the user once the bounce retries in gemini.ts have run out.
  if (raw.startsWith('GEMINI_BOUNCED')) return t(strings, 'main.error.answerNotStarted', { provider: 'Gemini' });
  if (raw.startsWith(CLAUDE_BUSY)) return t(strings, 'main.error.claudeBusy');
  if (raw.startsWith(CLAUDE_LEFT_CONVERSATION)) return t(strings, 'main.error.claudeLeftConversation');
  for (const [pattern, key] of PROVIDER_ERROR_PATTERNS) {
    const match = pattern.exec(raw);
    if (match) return t(strings, key, { provider: match[1] });
  }
  return null;
}

export function localizeUserFacingError(raw: string, strings: Record<string, string>): string {
  const usageLimit = parseClaudeUsageLimit(raw);
  if (usageLimit) {
    return usageLimit.resetsAt === null
      ? t(strings, 'main.error.claudeUsageLimitNoTime', { notice: usageLimit.noticeText }).trim()
      : t(strings, 'main.error.claudeUsageLimit', { time: formatResetTime(usageLimit.resetsAt) });
  }

  const known = localizeKnownError(raw, strings);
  if (known) return known;

  // What the page script threw rides inside this wrapper, so it is looked up on its own first;
  // only a message nobody has mapped yet is shown as-is, after the provider's name.
  const wrapped = AUTOMATION_FAILED_RE.exec(raw);
  if (wrapped) {
    const inner = wrapped[2].replace(/^(?:Uncaught )?Error: /, '').trim();
    return localizeKnownError(inner, strings)
      ?? t(strings, AUTOMATION_FAILED_KEYS[wrapped[1]], { error: inner });
  }

  const prefixHandlers: [string, string][] = [
    ['BYOK configuration incomplete: ', 'main.error.byokConfigIncomplete'],
    ['BYOK request failed: ', 'main.error.byokRequestFailed'],
  ];
  for (const [prefix, key] of prefixHandlers) {
    if (raw.startsWith(prefix)) {
      return t(strings, key, { error: raw.slice(prefix.length) });
    }
  }
  return raw;
}

export function buildTaskInstruction(
  customInstruction: string | undefined,
  syncEnabled: boolean,
  locale: string,
  extraRules: string[] = [],
): string {
  const manualInstruction = (customInstruction ?? '').trim();
  const localeInstruction = buildLocaleSystemInstruction(syncEnabled, locale);
  const parts = [manualInstruction, localeInstruction, ...extraRules.map((rule) => rule.trim())].filter(Boolean);
  if (parts.length === 0) return '';
  return `System Instruction: ${parts.join('\n')}`;
}

export function buildCombinedPromptFromPrefs(
  prefs: PromptPreferences,
  strings: Record<string, string>,
): string {
  const parts: string[] = [];
  const nickname = (prefs.nickname ?? '').trim();
  if (nickname) {
    const nicknameTemplate = t(strings, 'settings.prompt.built.nickname');
    parts.push(nicknameTemplate.replace(/\{\{name\}\}/g, () => nickname));
  }
  if (prefs.tone !== 'default') {
    const toneText = t(strings, `settings.prompt.built.tone.${prefs.tone}`);
    if (toneText) parts.push(toneText);
  }
  if (prefs.length !== 'auto') {
    const lengthText = t(strings, `settings.prompt.built.length.${prefs.length}`);
    if (lengthText) parts.push(lengthText);
  }
  if ((prefs.customInstructions ?? '').trim()) {
    const extraLabel = t(strings, 'settings.prompt.built.extra');
    parts.push(`${extraLabel}${prefs.customInstructions.trim()}`);
  }
  return parts.filter(Boolean).join('\n');
}

export function buildLocaleSystemInstruction(syncEnabled: boolean, locale: string): string {
  if (!syncEnabled) return '';
  const localeCode = normalizeLocaleCode(locale);
  if (!localeCode) return '';
  const template = langCache['system.localeInstruction']
    ?? 'Please respond in {{locale}}.';
  return template.replace(/\{\{locale\}\}/g, localeCode);
}

export function stripSystemInstruction(rawPrompt: string): string {
  const normalized = (rawPrompt ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');
  const systemInstructionBlock = /^System Instruction:[^\n]*(?:\n(?!\n)[^\n]*)*(?:\n|$)/gim;
  const stripped = normalized.replace(systemInstructionBlock, '');
  return stripped.replace(/\n{3,}/g, '\n\n').trim();
}

export function normalizeLocaleCode(rawLocale: string): string {
  const trimmed = (rawLocale ?? '').trim().replace('_', '-');
  if (!trimmed) return '';
  const parts = trimmed.split('-').filter(Boolean);
  if (parts.length === 0) return '';
  const [language, ...rest] = parts;
  const normalizedRest = rest.map((part) => {
    if (/^[a-z]{2}$/i.test(part)) return part.toUpperCase();
    if (/^[a-z]{4}$/i.test(part)) return part[0].toUpperCase() + part.slice(1).toLowerCase();
    return part;
  });
  return [language.toLowerCase(), ...normalizedRest].join('-');
}
