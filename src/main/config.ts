import { app, nativeTheme } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import Store from 'electron-store';
import { PROVIDER_URLS, byokIdFromUrl, byokGroupIdFromUrl } from '../shared/types';
import type { HiddenSources, SecretFailure, SecretScope } from '../shared/types';
import { defaultStored } from './configTypes';
import type { Config, LineConfig, StoredByokInstance, StoredConfig, StoredLineConfig, StoredSmtpConfig, StoredTelegramConfig, TelegramConfig } from './configTypes';
import { encryptToken, decryptToken, decryptTokenChecked } from './configEncryption';
import { getConfigDir, getConfigPath } from './configPaths';
import { clearAllSecretFailures, clearSecretFailures, getSecretHealth, recordSecretFailure } from './secretHealth';
import {
  normalizeConfig,
  normalizeCaptureSettings,
  normalizeQuickExport,
  normalizeShareSettings,
  normalizeHiddenSources,
  normalizeNotifyEvents,
  normalizePromptPreferences,
  normalizeByokInstances,
  normalizeLine,
  normalizeSmtp,
  deserializePairingConfig,
} from './configNormalizers';

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

function migrateProviderCommandsIfNeeded(dir: string): void {
  const configPath = path.join(dir, 'config.json');
  if (!existsSync(configPath)) return;
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    if ('providerCommands' in raw) return;
    const telegram = raw.telegram;
    if (!telegram || typeof telegram !== 'object') return;
    const legacy = (telegram as Record<string, unknown>).providerCommands;
    if (!legacy || typeof legacy !== 'object') return;
    delete (telegram as Record<string, unknown>).providerCommands;
    raw.providerCommands = legacy;
    writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown migration error';
    console.warn(`[config] failed to hoist providerCommands: ${message}`);
  }
}

const configDir = getConfigDir();
migrateLegacyWindowsConfigIfNeeded(configDir);
migrateProviderCommandsIfNeeded(configDir);

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
    line: { channelAccessTokenEncrypted: _laEnc, channelSecretEncrypted: _lsEnc, ...lineRest },
    smtp: { passwordEncrypted: _smtpEnc, ...smtpRest },
    byokInstances: storedByok,
    ...rest
  } = stored;
  return normalizeConfig({
    ...rest,
    telegram: { ...telegramRest, botToken: '' },
    line: { ...lineRest, channelAccessToken: '', channelSecret: '' },
    smtp: { ...smtpRest, password: '' },
    byokInstances: (storedByok ?? []).map(({ apiKeyEncrypted: _keyEnc, ...instRest }) => ({ ...instRest, apiKey: '' })),
  });
}

const config: Config = buildConfigFromStore();

let telegramTokenUnavailable = false;

function markTelegramTokenResolved(): void {
  telegramTokenUnavailable = false;
}

/**
 * Decrypts one stored secret and files a failure the UI can show. Before this, a secret that
 * would not decrypt just became an empty string and the bot quietly stopped answering.
 */
function readSecretChecked(stored: string, at: SecretFailure): { value: string; failed: boolean } {
  const suffix = at.label ? ` (${at.label})` : '';
  const result = decryptTokenChecked(stored, `${at.scope}.${at.field}${suffix}`);
  if (result.failed) recordSecretFailure(at);
  else clearSecretFailures(at.scope, at.id, at.field);
  return result;
}

function readSecret(stored: string, at: SecretFailure): string {
  return readSecretChecked(stored, at).value;
}

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
    telegramTokenUnavailable = false;
  } else {
    const telegramToken = readSecretChecked(encrypted, { scope: 'telegram', id: '', field: 'botToken', label: '' });
    config.telegram.botToken = telegramToken.value;
    telegramTokenUnavailable = telegramToken.failed;
  }

  config.smtp.password = readSecret(stored.smtp?.passwordEncrypted ?? '', { scope: 'smtp', id: '', field: 'password', label: '' });

  config.line.channelAccessToken = readSecret(
    stored.line?.channelAccessTokenEncrypted ?? '',
    { scope: 'line', id: '', field: 'channelAccessToken', label: '' },
  );
  config.line.channelSecret = readSecret(
    stored.line?.channelSecretEncrypted ?? '',
    { scope: 'line', id: '', field: 'channelSecret', label: '' },
  );

  const storedByok = stored.byokInstances ?? [];
  for (const instance of config.byokInstances) {
    const storedInstance = storedByok.find((entry) => entry.id === instance.id);
    instance.apiKey = readSecret(
      storedInstance?.apiKeyEncrypted ?? '',
      { scope: 'byok', id: instance.id, field: 'apiKey', label: instance.name },
    );
  }
}

/**
 * Throws away one unreadable ciphertext, leaving the field empty. This is the escape hatch for
 * a user who does not want to re-enter a secret they can no longer use; it writes the store
 * directly because `saveConfig` deliberately preserves ciphertext an empty plaintext would
 * otherwise wipe. Only the caller may decide it is safe — see `clearBrokenSecret` in ipc.
 */
function clearStoredSecret(scope: SecretScope, id: string, field: string): void {
  const current = store.store;

  if (scope === 'telegram') {
    store.store = { ...current, telegram: { ...current.telegram, botTokenEncrypted: '' } } as StoredConfig;
    config.telegram.botToken = '';
    telegramTokenUnavailable = false;
  }

  if (scope === 'line') {
    const emptied = field === 'channelSecret'
      ? { channelSecretEncrypted: '' }
      : { channelAccessTokenEncrypted: '' };
    store.store = { ...current, line: { ...current.line, ...emptied } } as StoredConfig;
    if (field === 'channelSecret') config.line.channelSecret = '';
    else config.line.channelAccessToken = '';
  }

  if (scope === 'smtp') {
    store.store = { ...current, smtp: { ...current.smtp, passwordEncrypted: '' } } as StoredConfig;
    config.smtp.password = '';
  }

  if (scope === 'byok') {
    store.store = {
      ...current,
      byokInstances: (current.byokInstances ?? []).map((entry) => (
        entry.id === id ? { ...entry, apiKeyEncrypted: '' } : entry
      )),
    } as StoredConfig;
    const instance = config.byokInstances.find((entry) => entry.id === id);
    if (instance) instance.apiKey = '';
  }

  clearSecretFailures(scope, id, field);
}

/**
 * Every stored secret is re-encrypted under the current OS key. Triggered by the canary's
 * `shouldReEncrypt`, so it runs only when Electron says the old key provider is on its way
 * out — never on an ordinary boot, which would churn config.json for nothing.
 */
function reEncryptSensitiveConfig(): void {
  const current = store.store;
  store.store = {
    ...current,
    telegram: {
      ...current.telegram,
      botTokenEncrypted: config.telegram.botToken ? encryptToken(config.telegram.botToken) : current.telegram.botTokenEncrypted,
    },
    line: {
      ...current.line,
      channelAccessTokenEncrypted: config.line.channelAccessToken
        ? encryptToken(config.line.channelAccessToken)
        : current.line.channelAccessTokenEncrypted,
      channelSecretEncrypted: config.line.channelSecret
        ? encryptToken(config.line.channelSecret)
        : current.line.channelSecretEncrypted,
    },
    smtp: {
      ...current.smtp,
      passwordEncrypted: config.smtp.password ? encryptToken(config.smtp.password) : current.smtp.passwordEncrypted,
    },
    byokInstances: (current.byokInstances ?? []).map((entry) => {
      const plaintext = config.byokInstances.find((instance) => instance.id === entry.id)?.apiKey ?? '';
      return plaintext ? { ...entry, apiKeyEncrypted: encryptToken(plaintext) } : entry;
    }),
  } as StoredConfig;
}

/**
 * Keeps the previous ciphertext when there is no fresh plaintext — an unreadable secret must
 * survive a save of unrelated settings, or a keychain hiccup would turn into real data loss.
 */
function writeSecret(plaintext: string, previousEncrypted: string, at: SecretFailure): string {
  if (!plaintext) return previousEncrypted;
  clearSecretFailures(at.scope, at.id, at.field);
  return encryptToken(plaintext);
}

function saveConfig(cfg: Partial<Config>): void {
  const { telegram: partialTelegram, line: partialLine, smtp: partialSmtp, byokInstances: partialByok, ...nonSensitivePartial } = cfg;

  const mergedBase = normalizeConfig({
    ...config,
    ...nonSensitivePartial,
    telegram: config.telegram,
    line: config.line,
    smtp: config.smtp,
    byokInstances: config.byokInstances,
  });
  const { telegram: _ignoredTelegram, line: _ignoredLine, smtp: _ignoredSmtp, byokInstances: _ignoredByok, ...storedBase } = mergedBase;

  const mergedTelegram = partialTelegram !== undefined
    ? deserializePairingConfig({ ...config.telegram, ...partialTelegram })
    : config.telegram;
  const { botToken, ...telegramWithoutToken } = mergedTelegram;
  const previousStoredTelegram = store.store.telegram;
  const telegramTokenEncrypted = botToken
    ? encryptToken(botToken)
    : (telegramTokenUnavailable ? (previousStoredTelegram?.botTokenEncrypted ?? '') : '');
  if (botToken) clearSecretFailures('telegram');

  const mergedLine = partialLine !== undefined
    ? normalizeLine({ ...config.line, ...partialLine })
    : config.line;
  const previousStoredLine = store.store.line;
  const { channelAccessToken, channelSecret, ...lineWithoutSecrets } = mergedLine;
  const storedLine: StoredLineConfig = {
    ...lineWithoutSecrets,
    channelAccessTokenEncrypted: writeSecret(
      channelAccessToken,
      previousStoredLine?.channelAccessTokenEncrypted ?? '',
      { scope: 'line', id: '', field: 'channelAccessToken', label: '' },
    ),
    channelSecretEncrypted: writeSecret(
      channelSecret,
      previousStoredLine?.channelSecretEncrypted ?? '',
      { scope: 'line', id: '', field: 'channelSecret', label: '' },
    ),
  };

  const mergedSmtp = partialSmtp !== undefined
    ? normalizeSmtp({ ...config.smtp, ...partialSmtp })
    : config.smtp;
  const { password, ...smtpWithoutPassword } = mergedSmtp;
  const previousStoredSmtp = store.store.smtp;
  const smtpPasswordEncrypted = writeSecret(
    password,
    previousStoredSmtp?.passwordEncrypted ?? '',
    { scope: 'smtp', id: '', field: 'password', label: '' },
  );

  const mergedByok = partialByok !== undefined
    ? normalizeByokInstances(partialByok)
    : config.byokInstances;
  const previousStoredByok = store.store.byokInstances ?? [];
  const storedByok: StoredByokInstance[] = mergedByok.map(({ apiKey, ...instanceRest }) => ({
    ...instanceRest,
    apiKeyEncrypted: writeSecret(
      apiKey,
      previousStoredByok.find((entry) => entry.id === instanceRest.id)?.apiKeyEncrypted ?? '',
      { scope: 'byok', id: instanceRest.id, field: 'apiKey', label: instanceRest.name },
    ),
  }));

  // A deleted BYOK instance must take its alert with it, or the user is left staring at a
  // warning about a key that no longer has a field to be re-entered into.
  for (const failure of getSecretHealth().failures) {
    if (failure.scope !== 'byok') continue;
    if (mergedByok.some((instance) => instance.id === failure.id)) continue;
    clearSecretFailures('byok', failure.id);
  }

  store.store = {
    ...storedBase,
    telegram: {
      ...telegramWithoutToken,
      botTokenEncrypted: telegramTokenEncrypted,
    },
    line: storedLine,
    smtp: {
      ...smtpWithoutPassword,
      passwordEncrypted: smtpPasswordEncrypted,
    },
    byokInstances: storedByok,
  } as StoredConfig;

  Object.assign(config, { ...mergedBase, telegram: mergedTelegram, line: mergedLine, smtp: mergedSmtp, byokInstances: mergedByok });
}

function wipeSensitiveConfig(): void {
  const current = store.store;
  store.store = {
    ...current,
    telegram: { ...current.telegram, botTokenEncrypted: '' },
    line: { ...current.line, channelAccessTokenEncrypted: '', channelSecretEncrypted: '' },
    smtp: { ...current.smtp, passwordEncrypted: '' },
    byokInstances: (current.byokInstances ?? []).map((instance) => ({ ...instance, apiKeyEncrypted: '' })),
  } as StoredConfig;
  telegramTokenUnavailable = false;
  config.telegram.botToken = '';
  config.line.channelAccessToken = '';
  config.line.channelSecret = '';
  config.smtp.password = '';
  for (const instance of config.byokInstances) instance.apiKey = '';
  // The ciphertext is gone, so there is nothing left to fail to decrypt.
  clearAllSecretFailures();
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

  const rawLine = rawConfig.line;
  if (rawLine && typeof rawLine === 'object'
    && ('channelAccessTokenEncrypted' in (rawLine as Record<string, unknown>)
      || 'channelSecretEncrypted' in (rawLine as Record<string, unknown>))) {
    const lineObj = rawLine as Record<string, unknown>;
    const laEnc = lineObj.channelAccessTokenEncrypted;
    const lsEnc = lineObj.channelSecretEncrypted;
    patched.line = {
      ...lineObj,
      channelAccessToken: decryptToken(typeof laEnc === 'string' ? laEnc : ''),
      channelSecret: decryptToken(typeof lsEnc === 'string' ? lsEnc : ''),
    };
  }

  const rawByok = rawConfig.byokInstances;
  if (Array.isArray(rawByok)) {
    patched.byokInstances = rawByok.map((item) => {
      if (!item || typeof item !== 'object' || !('apiKeyEncrypted' in (item as Record<string, unknown>))) return item;
      const entry = item as Record<string, unknown>;
      return {
        ...entry,
        apiKey: decryptToken(typeof entry.apiKeyEncrypted === 'string' ? entry.apiKeyEncrypted : ''),
      };
    });
  }

  const normalized = normalizeConfig(patched);
  if (!normalized.smtp.password) normalized.smtp.password = config.smtp.password;
  if (!normalized.telegram.botToken) normalized.telegram.botToken = config.telegram.botToken;
  if (!normalized.line.channelAccessToken) normalized.line.channelAccessToken = config.line.channelAccessToken;
  if (!normalized.line.channelSecret) normalized.line.channelSecret = config.line.channelSecret;
  if (!Array.isArray(rawByok)) {
    normalized.byokInstances = config.byokInstances;
  }
  for (const instance of normalized.byokInstances) {
    if (!instance.apiKey) {
      instance.apiKey = config.byokInstances.find((existing) => existing.id === instance.id)?.apiKey ?? '';
    }
  }
  if (!Array.isArray(rawConfig.byokGroups)) {
    normalized.byokGroups = config.byokGroups;
  }
  const importedByokId = byokIdFromUrl(normalized.targetUrl);
  const importedGroupId = byokGroupIdFromUrl(normalized.targetUrl);
  if (importedByokId && !normalized.byokInstances.some((instance) => instance.id === importedByokId)) {
    normalized.targetUrl = PROVIDER_URLS.gemini;
  } else if (importedGroupId && !normalized.byokGroups.some((group) => group.id === importedGroupId)) {
    normalized.targetUrl = PROVIDER_URLS.gemini;
  }
  for (const direct of [normalized.telegram.llmDirect, normalized.line.llmDirect]) {
    const directByokId = byokIdFromUrl(direct.targetUrl);
    const directGroupId = byokGroupIdFromUrl(direct.targetUrl);
    if ((directByokId && !normalized.byokInstances.some((instance) => instance.id === directByokId))
      || (directGroupId && !normalized.byokGroups.some((group) => group.id === directGroupId))) {
      direct.targetUrl = '';
    }
  }

  saveConfig(normalized);
  return config;
}

function getHiddenSources(): HiddenSources {
  return {
    providers: config.hiddenProviders,
    duckaiModelIds: config.hiddenDuckaiModelIds,
    byokIds: config.hiddenByokIds,
    byokGroupIds: config.hiddenByokGroupIds,
  };
}

export {
  config,
  saveConfig,
  getHiddenSources,
  wipeSensitiveConfig,
  markTelegramTokenResolved,
  getDefaultConfig,
  getConfigDir,
  getConfigPath,
  importConfigFromJson,
  initSensitiveConfig,
  reEncryptSensitiveConfig,
  clearStoredSecret,
  normalizePromptPreferences,
  normalizeCaptureSettings,
  normalizeQuickExport,
  normalizeShareSettings,
  normalizeHiddenSources,
  normalizeNotifyEvents,
};
export type { Config, TelegramConfig, LineConfig };
