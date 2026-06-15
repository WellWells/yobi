import { app, nativeTheme } from 'electron';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import Store from 'electron-store';
import { defaultStored } from './configTypes';
import type { Config, StoredConfig, StoredSmtpConfig, StoredTelegramConfig, TelegramConfig } from './configTypes';
import { encryptToken, decryptToken } from './configEncryption';
import {
  normalizeConfig,
  normalizeCaptureSettings,
  normalizePromptPreferences,
  normalizeSmtp,
  deserializePairingConfig,
} from './configNormalizers';

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

const configDir = getConfigDir();
migrateLegacyWindowsConfigIfNeeded(configDir);

const store = new Store<StoredConfig>({
  name: 'config',
  cwd: configDir,
  defaults: defaultStored,
});

function buildConfigFromStore(): Config {
  const stored = store.store as StoredConfig & {
    telegram: StoredTelegramConfig & { botToken?: string };
    smtp: StoredSmtpConfig & { password?: string };
  };
  const {
    telegram: { botTokenEncrypted: _enc, ...telegramRest },
    smtp: { passwordEncrypted: _smtpEnc, ...smtpRest },
    ...rest
  } = stored;
  return normalizeConfig({
    ...rest,
    telegram: { ...telegramRest, botToken: '' },
    smtp: { ...smtpRest, password: '' },
  });
}

const config: Config = buildConfigFromStore();

function initSensitiveConfig(): void {
  const stored = store.store as StoredConfig & {
    telegram: StoredTelegramConfig & { botToken?: string };
    smtp: StoredSmtpConfig & { password?: string };
  };
  const encrypted = stored.telegram?.botTokenEncrypted ?? '';
  const legacyToken = stored.telegram?.botToken ?? '';

  if (!encrypted && legacyToken) {
    const newEncrypted = encryptToken(legacyToken);
    const { botToken: _removed, ...telegramWithout } = stored.telegram as StoredTelegramConfig & { botToken?: string };
    store.set('telegram', { ...telegramWithout, botTokenEncrypted: newEncrypted } as StoredTelegramConfig);
    config.telegram.botToken = legacyToken;
  } else {
    config.telegram.botToken = decryptToken(encrypted);
  }

  config.smtp.password = decryptToken(stored.smtp?.passwordEncrypted ?? '');
}

function saveConfig(cfg: Partial<Config>): void {
  const { telegram: partialTelegram, smtp: partialSmtp, ...nonSensitivePartial } = cfg;

  const mergedBase = normalizeConfig({
    ...config,
    ...nonSensitivePartial,
    telegram: config.telegram,
    smtp: config.smtp,
  });
  const { telegram: _ignoredTelegram, smtp: _ignoredSmtp, ...storedBase } = mergedBase;

  const mergedTelegram = partialTelegram !== undefined
    ? deserializePairingConfig({ ...config.telegram, ...partialTelegram })
    : config.telegram;
  const { botToken, ...telegramWithoutToken } = mergedTelegram;

  const mergedSmtp = partialSmtp !== undefined
    ? normalizeSmtp({ ...config.smtp, ...partialSmtp })
    : config.smtp;
  const { password, ...smtpWithoutPassword } = mergedSmtp;

  store.store = {
    ...storedBase,
    telegram: {
      ...telegramWithoutToken,
      botTokenEncrypted: encryptToken(botToken),
    },
    smtp: {
      ...smtpWithoutPassword,
      passwordEncrypted: encryptToken(password),
    },
  } as StoredConfig;

  Object.assign(config, { ...mergedBase, telegram: mergedTelegram, smtp: mergedSmtp });
}

function getDefaultConfig(): Config {
  const { telegram: { botTokenEncrypted: _enc, ...telegramRest }, ...rest } = defaultStored;
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

  const patched: Record<string, unknown> = { ...rawConfig };

  const rawTelegram = rawConfig.telegram;
  if (rawTelegram && typeof rawTelegram === 'object' && 'botTokenEncrypted' in (rawTelegram as Record<string, unknown>)) {
    const enc = (rawTelegram as Record<string, unknown>).botTokenEncrypted;
    patched.telegram = {
      ...(rawTelegram as Record<string, unknown>),
      botToken: decryptToken(typeof enc === 'string' ? enc : ''),
    };
  }

  const rawSmtp = rawConfig.smtp;
  if (rawSmtp && typeof rawSmtp === 'object' && 'passwordEncrypted' in (rawSmtp as Record<string, unknown>)) {
    const enc = (rawSmtp as Record<string, unknown>).passwordEncrypted;
    patched.smtp = {
      ...(rawSmtp as Record<string, unknown>),
      password: decryptToken(typeof enc === 'string' ? enc : ''),
    };
  }

  const normalized = normalizeConfig(patched);
  // Keep-if-blank, matching UPDATE_EMAIL_CREDENTIALS: an import must never wipe
  // a stored secret just because the export omitted it or was made elsewhere.
  if (!normalized.smtp.password) normalized.smtp.password = config.smtp.password;
  if (!normalized.telegram.botToken) normalized.telegram.botToken = config.telegram.botToken;

  saveConfig(normalized);
  return config;
}

export {
  config,
  saveConfig,
  getDefaultConfig,
  getConfigPath,
  importConfigFromJson,
  initSensitiveConfig,
  normalizePromptPreferences,
  normalizeCaptureSettings,
};
export type { Config, TelegramConfig };
