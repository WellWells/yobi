// src/main/config.ts — Centralized configuration via electron-store + safeStorage
//
// On-disk: <userData>/config.json in packaged app, <cwd>/config.json in dev mode.
// Sensitive fields (Telegram botToken) are encrypted with Electron's safeStorage
// before being stored. The rest of the config is kept as plain JSON.
//
// Call initSensitiveConfig() once inside app.whenReady() to decrypt sensitive
// fields — safeStorage APIs require the app to be ready.

import { app, safeStorage, nativeTheme } from 'electron';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import Store from 'electron-store';
import { PROVIDER_URLS } from '../shared/types';
import type { CaptureFormat, CaptureSettings, CustomTemplate, PromptLength, PromptPreferences, PromptTone, TelegramPairedUser, TelegramPairingState, TelegramPendingCode } from '../shared/types';

// ── Versioned encryption format ──────────────────────────────────────────────
// 'enc:v1:<base64>' — encrypted with safeStorage (OS-level key)
// Plain string      — legacy plaintext or safeStorage unavailable
const ENCRYPTED_PREFIX = 'enc:v1:';

function encryptToken(token: string): string {
  if (!token) return '';
  if (safeStorage.isEncryptionAvailable()) {
    return ENCRYPTED_PREFIX + safeStorage.encryptString(token).toString('base64');
  }
  // Fallback: safeStorage unavailable (e.g., libsecret not installed on Linux).
  // Warn the operator so they are aware the token is stored as plaintext.
  console.warn('[config] safeStorage unavailable — botToken stored as plaintext. Install libsecret on Linux to enable OS-level encryption.');
  return token;
}

function decryptToken(stored: string): string {
  if (!stored) return '';
  if (stored.startsWith(ENCRYPTED_PREFIX)) {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[config] safeStorage unavailable — cannot decrypt stored token. Install libsecret on Linux or check OS keychain access.');
      return '';
    }
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64'));
    } catch {
      console.warn('[config] Failed to decrypt token — OS keychain may have changed. Token will be inaccessible until re-entered.');
      return '';
    }
  }
  // Legacy plaintext value — return as-is
  return stored;
}

// ── Interfaces ────────────────────────────────────────────────────────────────

interface Config {
  targetUrl: string;
  hotkey: string;
  debounceMs: number;
  responseTimeout: number;
  locale: string;
  localeSetByUser: boolean;
  theme: string;
  syncSystemLanguageToModel: boolean;
  notifyOnComplete: boolean;
  promptPreferences: PromptPreferences;
  telegram: TelegramConfig;
  closeToTray: boolean;
  autoShowTray: boolean;
  closeActionDecided: boolean;
  launchAtStartup: boolean;
  layoutMode: 'stacked' | 'side-by-side';
  markdownZoom: number;
  captureSettings: CaptureSettings;
}

interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  allowGroupCommands: boolean;
  defaultReplyMode: 'markdown' | 'png' | 'webp' | 'pdf';
  adminUserIds: number[];
  pairing: TelegramPairingState;
}

// On-disk stored shape — botToken replaced with encrypted form
interface StoredTelegramConfig extends Omit<TelegramConfig, 'botToken'> {
  botTokenEncrypted: string;
}
type StoredConfig = Omit<Config, 'telegram'> & { telegram: StoredTelegramConfig };

// ── Config file path ──────────────────────────────────────────────────────────
// Dev       : project root / config.json (app is not packaged, use cwd)
// Packaged  : userData / config.json (stable, survives one-file temp extraction)
function getConfigDir(): string {
  if (app.isPackaged) return app.getPath('userData');
  return path.resolve('.');
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

function getLegacyWindowsConfigPath(): string | null {
  if (!app.isPackaged || process.platform !== 'win32') return null;
  return path.join(path.dirname(app.getPath('exe')), 'config.json');
}

function migrateLegacyWindowsConfigIfNeeded(configDir: string): void {
  const legacyPath = getLegacyWindowsConfigPath();
  if (!legacyPath) return;
  const targetPath = path.join(configDir, 'config.json');
  if (!existsSync(legacyPath) || existsSync(targetPath)) return;
  try {
    mkdirSync(configDir, { recursive: true });
    copyFileSync(legacyPath, targetPath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown migration error';
    console.warn(`[config] failed to migrate legacy config: ${message}`);
  }
}

// ── electron-store instance ───────────────────────────────────────────────────
const defaultStored: StoredConfig = {
  targetUrl: PROVIDER_URLS.gemini,
  hotkey: process.platform === 'darwin' ? 'Command+G' : 'Alt+G',
  debounceMs: 1000,
  responseTimeout: 60_000,
  locale: 'en-US',
  localeSetByUser: false,
  theme: 'auto',
  syncSystemLanguageToModel: true,
  notifyOnComplete: true,
  closeToTray: false,
  autoShowTray: false,
  closeActionDecided: false,
  launchAtStartup: false,
  layoutMode: 'stacked',
  markdownZoom: 100,
  captureSettings: {
    palette: 'aurora',
    direction: 'se',
    showPrompt: false,
    showProvider: true,
    showTimestamp: true,
    format: 'png' as CaptureFormat,
  },
  promptPreferences: {
    tone: 'default',
    length: 'auto',
    customInstructions: '',
    customTemplates: [],
    nickname: '',
  },
  telegram: {
    enabled: false,
    botTokenEncrypted: '',
    allowGroupCommands: false,
    defaultReplyMode: 'markdown',
    adminUserIds: [],
    pairing: { pendingCodes: [], pairedUsers: [] },
  },
};

const configDir = getConfigDir();
migrateLegacyWindowsConfigIfNeeded(configDir);

const store = new Store<StoredConfig>({
  name: 'config',
  cwd: configDir,
  defaults: defaultStored,
});

// ── Build in-memory Config from store (botToken left empty until app.ready) ──
function buildConfigFromStore(): Config {
  const stored = store.store as StoredConfig & { telegram: StoredTelegramConfig & { botToken?: string } };
  const { telegram: { botTokenEncrypted: _enc, ...telegramRest }, ...rest } = stored;
  return normalizeConfig({
    ...rest,
    telegram: { ...telegramRest, botToken: '' },
  });
}

// ── Public mutable config object ──────────────────────────────────────────────
const config: Config = buildConfigFromStore();

// ── initSensitiveConfig — call from index.ts after app.whenReady() ────────────
// Decrypts botToken and migrates legacy plaintext token from old config format.
function initSensitiveConfig(): void {
  const stored = store.store as StoredConfig & { telegram: StoredTelegramConfig & { botToken?: string } };
  const encrypted = stored.telegram?.botTokenEncrypted ?? '';
  const legacyToken = stored.telegram?.botToken ?? '';

  if (!encrypted && legacyToken) {
    // Migrate: encrypt legacy plaintext botToken and remove old field
    const newEncrypted = encryptToken(legacyToken);
    const { botToken: _removed, ...telegramWithout } = stored.telegram as StoredTelegramConfig & { botToken?: string };
    store.set('telegram', { ...telegramWithout, botTokenEncrypted: newEncrypted } as StoredTelegramConfig);
    config.telegram.botToken = legacyToken;
  } else {
    config.telegram.botToken = decryptToken(encrypted);
  }
}

// ── saveConfig ────────────────────────────────────────────────────────────────
function saveConfig(cfg: Partial<Config>): void {
  const { telegram: partialTelegram, ...nonTelegramPartial } = cfg;

  // Merge & normalize non-telegram fields
  const mergedBase = normalizeConfig({
    ...config,
    ...nonTelegramPartial,
    telegram: config.telegram, // preserve telegram in normalizeConfig call
  });
  const { telegram: _ignored, ...storedBase } = mergedBase;

  const mergedTelegram = partialTelegram !== undefined
    ? deserializePairingConfig({ ...config.telegram, ...partialTelegram })
    : config.telegram;

  const { botToken, ...telegramWithoutToken } = mergedTelegram;

  // Single atomic write — assembles the full StoredConfig and writes once to disk,
  // avoiding partial writes and multiple Disk I/O round-trips.
  store.store = {
    ...storedBase,
    telegram: {
      ...telegramWithoutToken,
      botTokenEncrypted: encryptToken(botToken),
    },
  } as StoredConfig;

  // Update in-memory config
  Object.assign(config, { ...mergedBase, telegram: mergedTelegram });
}

// ── loadConfig — returns current in-memory config ─────────────────────────────
function loadConfig(): Config {
  return config;
}

function getDefaultConfig(): Config {
  const { telegram: { botTokenEncrypted: _enc, ...telegramRest }, ...rest } = defaultStored;
  // Detect system dark/light mode for default theme
  const systemTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return normalizeConfig({ ...rest, theme: systemTheme, telegram: { ...telegramRest, botToken: '' } });
}

function importConfigFromJson(raw: unknown): Config | null {
  if (!raw || typeof raw !== 'object') return null;
  const rawConfig = raw as Record<string, unknown>;
  const hasKnownField = [
    'targetUrl',
    'hotkey',
    'locale',
    'theme',
    'telegram',
    'promptPreferences',
    'responseTimeout',
  ].some((key) => key in rawConfig);
  if (!hasKnownField) return null;

  const rawTelegram = rawConfig.telegram;
  const fromStoredShape = rawTelegram && typeof rawTelegram === 'object'
    && 'botTokenEncrypted' in (rawTelegram as Record<string, unknown>);

  const normalized = fromStoredShape
    ? normalizeConfig({
      ...rawConfig,
      telegram: {
        ...(rawTelegram as Record<string, unknown>),
        botToken: decryptToken(
          typeof (rawTelegram as Record<string, unknown>).botTokenEncrypted === 'string'
            ? (rawTelegram as Record<string, unknown>).botTokenEncrypted as string
            : '',
        ),
      },
    })
    : normalizeConfig(rawConfig);

  saveConfig(normalized);
  return config;
}

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizeConfig(raw: unknown): Config {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<Config>) : {};
  const rawZoom = Number(obj.markdownZoom);
  const clampedZoom = Number.isFinite(rawZoom) && rawZoom >= 70 && rawZoom <= 200
    ? Math.round(rawZoom / 10) * 10
    : 100;

  // Migration heuristic for localeSetByUser:
  // Old configs lack this field — infer from the stored locale.
  // A non-default locale value means the user changed it intentionally.
  const inferredLocaleSetByUser = typeof obj.localeSetByUser === 'boolean'
    ? obj.localeSetByUser
    : (typeof obj.locale === 'string' && obj.locale !== 'zh-TW' && obj.locale !== 'en-US');

  return {
    ...defaultStored,
    ...obj,
    localeSetByUser: inferredLocaleSetByUser,
    theme: typeof obj.theme === 'string' && obj.theme ? obj.theme : defaultStored.theme,
    layoutMode: obj.layoutMode === 'side-by-side' ? 'side-by-side' : 'stacked',
    markdownZoom: clampedZoom,
    captureSettings: normalizeCaptureSettings(obj.captureSettings),
    promptPreferences: normalizePromptPreferences(obj.promptPreferences),
    telegram: deserializePairingConfig(obj.telegram),
  };
}

function normalizeCaptureSettings(raw: unknown): CaptureSettings {
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

function deserializePairingConfig(raw: unknown): TelegramConfig {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<TelegramConfig>) : {};
  return {
    enabled: Boolean(obj.enabled),
    botToken: typeof obj.botToken === 'string' ? obj.botToken.trim() : '',
    allowGroupCommands: Boolean(obj.allowGroupCommands),
    defaultReplyMode: obj.defaultReplyMode === 'png' || obj.defaultReplyMode === 'webp' || obj.defaultReplyMode === 'pdf'
      ? obj.defaultReplyMode
      : 'markdown',
    adminUserIds: normalizeAdminUserIds(obj.adminUserIds),
    pairing: deserializePairingState(obj.pairing),
  };
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

function normalizePromptPreferences(raw: unknown): PromptPreferences {
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

export {
  config,
  saveConfig,
  loadConfig,
  getDefaultConfig,
  getConfigPath,
  importConfigFromJson,
  initSensitiveConfig,
  normalizePromptPreferences,
  normalizeCaptureSettings,
  Config,
  TelegramConfig,
};
