import type { CaptureFormat, CaptureSettings, CustomTemplate, Provider, PromptLength, PromptPreferences, PromptTone, TelegramPairedUser, TelegramPairingState, TelegramPendingCode, TelegramProviderCommand } from '../shared/types';
import { PROVIDERS } from '../shared/types';
import { defaultStored } from './configTypes';
import type { Config, SmtpConfig, TelegramConfig } from './configTypes';

export function normalizeConfig(raw: unknown): Config {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<Config>) : {};
  const rawZoom = Number(obj.markdownZoom);
  const clampedZoom = Number.isFinite(rawZoom) && rawZoom >= 70 && rawZoom <= 200
    ? Math.round(rawZoom / 10) * 10
    : 100;

  const inferredLocaleSetByUser = typeof obj.localeSetByUser === 'boolean'
    ? obj.localeSetByUser
    : (typeof obj.locale === 'string' && obj.locale !== 'zh-TW' && obj.locale !== 'en-US');

  return {
    ...defaultStored,
    ...obj,
    localeSetByUser: inferredLocaleSetByUser,
    youtubePrompt: typeof obj.youtubePrompt === 'string' ? obj.youtubePrompt : defaultStored.youtubePrompt,
    theme: typeof obj.theme === 'string' && obj.theme ? obj.theme : defaultStored.theme,
    layoutMode: obj.layoutMode === 'side-by-side' ? 'side-by-side' : 'stacked',
    markdownZoom: clampedZoom,
    captureSettings: normalizeCaptureSettings(obj.captureSettings),
    promptPreferences: normalizePromptPreferences(obj.promptPreferences),
    telegram: deserializePairingConfig(obj.telegram),
    smtp: normalizeSmtp(obj.smtp),
  };
}

export function normalizeSmtp(raw: unknown): SmtpConfig {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<SmtpConfig>) : {};
  const port = Number(obj.port);
  return {
    enabled: Boolean(obj.enabled),
    host: typeof obj.host === 'string' ? obj.host.trim() : '',
    port: Number.isFinite(port) && port > 0 && port <= 65_535 ? Math.floor(port) : 587,
    user: typeof obj.user === 'string' ? obj.user.trim() : '',
    password: typeof obj.password === 'string' ? obj.password : '',
  };
}

export function normalizeCaptureSettings(raw: unknown): CaptureSettings {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<CaptureSettings>) : {};
  const validFormats: CaptureFormat[] = ['png', 'webp', 'pdf'];
  return {
    palette: typeof obj.palette === 'string' && obj.palette ? obj.palette : 'aurora',
    direction: typeof obj.direction === 'string' && obj.direction ? obj.direction : 'se',
    showPrompt: obj.showPrompt === true,
    showProvider: obj.showProvider !== false,
    showTimestamp: obj.showTimestamp !== false,
    format: validFormats.includes(obj.format as CaptureFormat) ? (obj.format as CaptureFormat) : 'png',
  };
}

export function deserializePairingConfig(raw: unknown): TelegramConfig {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<TelegramConfig>) : {};
  return {
    enabled: Boolean(obj.enabled),
    botToken: typeof obj.botToken === 'string' ? obj.botToken.trim() : '',
    allowGroupCommands: Boolean(obj.allowGroupCommands),
    defaultReplyMode: obj.defaultReplyMode === 'png' || obj.defaultReplyMode === 'webp' || obj.defaultReplyMode === 'pdf'
      ? obj.defaultReplyMode
      : 'markdown',
    adminUserIds: normalizeAdminUserIds(obj.adminUserIds),
    providerCommands: normalizeProviderCommands(obj.providerCommands),
    pairing: deserializePairingState(obj.pairing),
  };
}

export function normalizeProviderCommands(raw: unknown): Record<Provider, TelegramProviderCommand> {
  const obj = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const result = {} as Record<Provider, TelegramProviderCommand>;
  for (const provider of PROVIDERS) {
    const entry = (obj[provider] && typeof obj[provider] === 'object')
      ? (obj[provider] as Partial<TelegramProviderCommand>)
      : {};
    const command: TelegramProviderCommand = {
      enabled: entry.enabled !== false,
      command: typeof entry.command === 'string' ? entry.command.trim() : '',
    };
    if (provider === 'duckai') {
      command.modelId = typeof entry.modelId === 'string' ? entry.modelId.trim() : '';
    }
    result[provider] = command;
  }
  return result;
}

function normalizeAdminUserIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const value of raw) {
    const userId = Number(value);
    if (!Number.isFinite(userId) || userId <= 0 || seen.has(userId)) continue;
    seen.add(userId);
    ids.push(userId);
  }
  return ids;
}

function deserializePairingState(raw: unknown): TelegramPairingState {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<TelegramPairingState>) : {};
  return {
    pendingCodes: normalizePendingCodes(obj.pendingCodes),
    pairedUsers: normalizePairedUsers(obj.pairedUsers),
  };
}

function normalizePendingCodes(raw: unknown): TelegramPendingCode[] {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  return raw
    .map((item) => {
      const entry = item as Partial<TelegramPendingCode>;
      const code = typeof entry.code === 'string' ? entry.code.trim().toUpperCase() : '';
      const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId.trim() : '';
      const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : '';
      const expiresAt = typeof entry.expiresAt === 'string' ? entry.expiresAt : '';
      const expiresMs = Date.parse(expiresAt);
      if (!code || !sessionId || !createdAt || !expiresAt || Number.isNaN(expiresMs) || expiresMs <= now) {
        return null;
      }
      return { code, sessionId, createdAt, expiresAt };
    })
    .filter((item): item is TelegramPendingCode => Boolean(item));
}

function normalizePairedUsers(raw: unknown): TelegramPairedUser[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const users: TelegramPairedUser[] = [];
  for (const item of raw) {
    const entry = item as Partial<TelegramPairedUser>;
    const userId = Number(entry.userId);
    if (!Number.isFinite(userId) || userId <= 0 || seen.has(userId)) continue;
    seen.add(userId);
    users.push({
      userId,
      username: typeof entry.username === 'string' && entry.username.trim() ? entry.username.trim() : undefined,
      firstName: typeof entry.firstName === 'string' && entry.firstName.trim() ? entry.firstName.trim() : undefined,
      lastName: typeof entry.lastName === 'string' && entry.lastName.trim() ? entry.lastName.trim() : undefined,
      pairedAt: typeof entry.pairedAt === 'string' && entry.pairedAt ? entry.pairedAt : new Date().toISOString(),
    });
  }
  return users;
}

export function normalizePromptPreferences(raw: unknown): PromptPreferences {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<PromptPreferences>) : {};
  const validTones: PromptTone[] = ['default', 'professional', 'casual', 'direct'];
  const validLengths: PromptLength[] = ['auto', 'concise', 'detailed'];
  return {
    tone: validTones.includes(obj.tone as PromptTone) ? (obj.tone as PromptTone) : 'default',
    length: validLengths.includes(obj.length as PromptLength) ? (obj.length as PromptLength) : 'auto',
    customInstructions: typeof obj.customInstructions === 'string' ? obj.customInstructions : '',
    customTemplates: normalizeCustomTemplates(obj.customTemplates),
    nickname: typeof obj.nickname === 'string' ? obj.nickname : '',
  };
}

function normalizeCustomTemplates(raw: unknown): CustomTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const entry = item as Partial<CustomTemplate>;
      const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : '';
      const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : '';
      const prompt = typeof entry.prompt === 'string' ? entry.prompt : '';
      if (!id || !name) return null;
      return { id, name, prompt };
    })
    .filter((item): item is CustomTemplate => Boolean(item));
}
