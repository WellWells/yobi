import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { openStoreWithRecovery } from './configStore';
import { repairStoredShape } from './configShapeRepair';
import { PROVIDER_URLS, SOCKET_BOT_PLATFORMS, SOCKET_BOT_SECRET_FIELDS, byokIdFromUrl, byokGroupIdFromUrl, isSocketBotPlatform } from '../shared/types';
import type { HiddenSources, SecretFailure, SecretScope, SocketBotPlatform } from '../shared/types';
import { defaultStored } from './configTypes';
import type {
  Config, LineConfig, StoredByokInstance, StoredConfig, StoredLineConfig, StoredMailAccount, StoredTelegramConfig, TelegramConfig,
} from './configTypes';
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
  normalizeGeminiModelChoice,
  normalizeClaudeModelChoice,
  normalizeChatgptModelChoice,
  normalizeByokInstances,
  normalizeLine,
  normalizeDiscord,
  normalizeSlack,
  normalizeMailAccounts,
  migrateLegacyMailAccount,
  sameMailSignIn,
  LEGACY_MAIL_ACCOUNT_ID,
  deserializePairingConfig,
} from './configNormalizers';
import { carryCurrentGrantsIntoLegacyBackup, telegramAdminMirror } from './botPermissions/normalize';

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
migrateProviderCommandsIfNeeded(configDir);

// electron-store writes its defaults into config.json as it opens it, which would hide that a
// config from before the region hotkey lacks the field; normalizeConfig fills it in instead,
// after checking the combo against the user's other hotkeys.
const { regionHotkey: _regionDefault, ...storeDefaults } = defaultStored;
const store = openStoreWithRecovery<StoredConfig>('config', configDir, storeDefaults as StoredConfig);

function repairStoredShapeIfNeeded(): void {
  const result = repairStoredShape(store.store as Record<string, unknown>, defaultStored);
  if (!result) return;
  store.store = result.repaired;
  console.warn(`[config] repaired malformed field(s) in config.json: ${result.fields.join(', ')}`);
}

repairStoredShapeIfNeeded();

function migrateLegacyMailAccountIfNeeded(): void {
  const migrated = migrateLegacyMailAccount(store.store as StoredConfig);
  if (migrated) store.store = migrated;
}

migrateLegacyMailAccountIfNeeded();

function buildConfigFromStore(): Config {
  const stored = store.store as StoredConfig & {
    telegram: StoredTelegramConfig & { botToken?: string };
  };
  const {
    telegram: { botTokenEncrypted: _enc, apiHashEncrypted: _hashEnc, ...telegramRest },
    line: { channelAccessTokenEncrypted: _laEnc, channelSecretEncrypted: _lsEnc, ...lineRest },
    byokInstances: storedByok,
    mailAccounts: storedMail,
    ...rest
  } = stored;
  return normalizeConfig({
    ...rest,
    telegram: { ...telegramRest, botToken: '', apiHash: '' },
    line: { ...lineRest, channelAccessToken: '', channelSecret: '' },
    byokInstances: (storedByok ?? []).map(({ apiKeyEncrypted: _keyEnc, ...instRest }) => ({ ...instRest, apiKey: '' })),
    mailAccounts: (storedMail ?? []).map(({ passwordEncrypted: _pwEnc, ...accountRest }) => ({ ...accountRest, password: '' })),
  });
}

// Read before anything saves: whether config.json lacked the region hotkey when the app started.
let regionHotkeyFilled = typeof (store.store as Partial<StoredConfig>).regionHotkey !== 'string';

const config: Config = buildConfigFromStore();

/**
 * Whether the region hotkey is a default filled in for a config from before it (config.json at
 * launch, or a restored backup) that has not yet been checked against the user's flows.
 */
function regionHotkeyFilledIn(): boolean {
  return regionHotkeyFilled;
}

/** The checked region hotkey is saved, so the check is made once. */
function settleRegionHotkey(regionHotkey: string): void {
  regionHotkeyFilled = false;
  saveConfig({ regionHotkey });
}

let telegramTokenUnavailable = false;
let telegramApiHashUnavailable = false;

function markTelegramTokenResolved(): void {
  telegramTokenUnavailable = false;
}

/** The API hash's twin of `markTelegramTokenResolved`: the user typed a new one or cleared it. */
function markTelegramApiHashResolved(): void {
  telegramApiHashUnavailable = false;
}

/** Decrypts one stored secret and files a failure the UI can show instead of silently returning ''. */
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

/*
 * Socket platforms (Discord, Slack) keep each secret field `x` (`SOCKET_BOT_SECRET_FIELDS`) as
 * `xEncrypted` in the store, so reading, saving, re-encrypting, wiping and restoring them is one
 * loop over the platforms and their fields rather than a branch per platform.
 */
type SecretRecord = Record<string, string>;

function socketSecrets(platform: SocketBotPlatform): readonly string[] {
  return SOCKET_BOT_SECRET_FIELDS[platform];
}

function storedSocketSection(stored: StoredConfig | undefined, platform: SocketBotPlatform): SecretRecord {
  return ((stored?.[platform] ?? {}) as unknown) as SecretRecord;
}

function liveSocketSection(target: Config, platform: SocketBotPlatform): SecretRecord {
  return (target[platform] as unknown) as SecretRecord;
}

function initSocketSecrets(stored: StoredConfig): void {
  for (const platform of SOCKET_BOT_PLATFORMS) {
    const section = storedSocketSection(stored, platform);
    for (const field of socketSecrets(platform)) {
      liveSocketSection(config, platform)[field] = readSecret(section[`${field}Encrypted`] ?? '', { scope: platform, id: '', field, label: '' });
    }
  }
}

/** One platform's section as stored: its secrets encrypted (or kept, see `writeSecret`), the rest as is. */
function storedSocketConfig<P extends SocketBotPlatform>(platform: P, merged: Config[P], previous: StoredConfig | undefined): StoredConfig[P] {
  const plain = { ...(merged as unknown as Record<string, unknown>) };
  const before = storedSocketSection(previous, platform);
  for (const field of socketSecrets(platform)) {
    const plaintext = typeof plain[field] === 'string' ? plain[field] as string : '';
    delete plain[field];
    plain[`${field}Encrypted`] = writeSecret(plaintext, before[`${field}Encrypted`] ?? '', { scope: platform, id: '', field, label: '' });
  }
  return plain as unknown as StoredConfig[P];
}

function initSensitiveConfig(): void {
  const stored = store.store as StoredConfig;
  initSocketSecrets(stored);
  const telegramToken = readSecretChecked(
    stored.telegram?.botTokenEncrypted ?? '',
    { scope: 'telegram', id: '', field: 'botToken', label: '' },
  );
  config.telegram.botToken = telegramToken.value;
  telegramTokenUnavailable = telegramToken.failed;

  const apiHash = readSecretChecked(
    stored.telegram?.apiHashEncrypted ?? '',
    { scope: 'telegram', id: '', field: 'apiHash', label: '' },
  );
  config.telegram.apiHash = apiHash.value;
  telegramApiHashUnavailable = apiHash.failed;

  const storedMail = stored.mailAccounts ?? [];
  for (const account of config.mailAccounts) {
    account.password = readSecret(
      storedMail.find((entry) => entry.id === account.id)?.passwordEncrypted ?? '',
      { scope: 'smtp', id: account.id, field: 'password', label: account.address },
    );
  }

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

  if (scope === 'telegram' && field === 'apiHash') {
    store.store = { ...current, telegram: { ...current.telegram, apiHashEncrypted: '' } } as StoredConfig;
    config.telegram.apiHash = '';
    telegramApiHashUnavailable = false;
  } else if (scope === 'telegram') {
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

  if (isSocketBotPlatform(scope) && socketSecrets(scope).includes(field)) {
    store.store = { ...current, [scope]: { ...storedSocketSection(current, scope), [`${field}Encrypted`]: '' } } as StoredConfig;
    liveSocketSection(config, scope)[field] = '';
  }

  if (scope === 'smtp') {
    store.store = {
      ...current,
      mailAccounts: (current.mailAccounts ?? []).map((entry) => (entry.id === id ? { ...entry, passwordEncrypted: '' } : entry)),
    } as StoredConfig;
    const account = config.mailAccounts.find((entry) => entry.id === id);
    if (account) account.password = '';
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
      apiHashEncrypted: config.telegram.apiHash ? encryptToken(config.telegram.apiHash) : current.telegram.apiHashEncrypted,
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
    mailAccounts: (current.mailAccounts ?? []).map((entry) => {
      const plaintext = config.mailAccounts.find((account) => account.id === entry.id)?.password ?? '';
      return plaintext ? { ...entry, passwordEncrypted: encryptToken(plaintext) } : entry;
    }),
    byokInstances: (current.byokInstances ?? []).map((entry) => {
      const plaintext = config.byokInstances.find((instance) => instance.id === entry.id)?.apiKey ?? '';
      return plaintext ? { ...entry, apiKeyEncrypted: encryptToken(plaintext) } : entry;
    }),
    ...Object.fromEntries(SOCKET_BOT_PLATFORMS.map((platform) => {
      const section = { ...storedSocketSection(current, platform) };
      for (const field of socketSecrets(platform)) {
        const plaintext = liveSocketSection(config, platform)[field];
        if (plaintext) section[`${field}Encrypted`] = encryptToken(plaintext);
      }
      return [platform, section];
    })),
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
  const {
    telegram: partialTelegram, line: partialLine, discord: partialDiscord, slack: partialSlack,
    byokInstances: partialByok, mailAccounts: partialMail, ...nonSensitivePartial
  } = cfg;

  const mergedMail = partialMail !== undefined ? normalizeMailAccounts(partialMail) : config.mailAccounts;
  const mergedBase = normalizeConfig({
    ...config,
    ...nonSensitivePartial,
    telegram: config.telegram,
    line: config.line,
    discord: config.discord,
    slack: config.slack,
    byokInstances: config.byokInstances,
    // The default id is checked against the accounts being saved, not the ones being replaced.
    mailAccounts: mergedMail,
  });
  const {
    telegram: _ignoredTelegram, line: _ignoredLine, discord: _ignoredDiscord, slack: _ignoredSlack,
    byokInstances: _ignoredByok, mailAccounts: _ignoredMail, ...storedBase
  } = mergedBase;

  const mergedDiscord = partialDiscord !== undefined ? normalizeDiscord({ ...config.discord, ...partialDiscord }) : config.discord;
  const mergedSlack = partialSlack !== undefined ? normalizeSlack({ ...config.slack, ...partialSlack }) : config.slack;

  const mergedTelegram = partialTelegram !== undefined
    ? deserializePairingConfig({ ...config.telegram, ...partialTelegram })
    : config.telegram;
  const { botToken, apiHash, ...telegramWithoutToken } = mergedTelegram;
  const previousStoredTelegram = store.store.telegram;
  const telegramTokenEncrypted = botToken
    ? encryptToken(botToken)
    : (telegramTokenUnavailable ? (previousStoredTelegram?.botTokenEncrypted ?? '') : '');
  if (botToken) clearSecretFailures('telegram', '', 'botToken');
  const telegramApiHashEncrypted = apiHash
    ? encryptToken(apiHash)
    : (telegramApiHashUnavailable ? (previousStoredTelegram?.apiHashEncrypted ?? '') : '');
  if (apiHash) clearSecretFailures('telegram', '', 'apiHash');

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

  // A blank password keeps the account's saved one, but only while it is still the same sign-in;
  // a removed account takes its ciphertext with it.
  const previousStoredMail = store.store.mailAccounts ?? [];
  const storedMail: StoredMailAccount[] = mergedMail.map(({ password, ...accountRest }) => ({
    ...accountRest,
    passwordEncrypted: writeSecret(
      password,
      previousStoredMail.find((entry) => entry.id === accountRest.id && sameMailSignIn(entry, accountRest))?.passwordEncrypted ?? '',
      { scope: 'smtp', id: accountRest.id, field: 'password', label: accountRest.address },
    ),
  }));

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
    if (failure.scope === 'byok' && !mergedByok.some((instance) => instance.id === failure.id)) clearSecretFailures('byok', failure.id);
    if (failure.scope === 'smtp' && !mergedMail.some((account) => account.id === failure.id)) clearSecretFailures('smtp', failure.id);
  }

  store.store = {
    ...storedBase,
    telegram: {
      ...telegramWithoutToken,
      botTokenEncrypted: telegramTokenEncrypted,
      apiHashEncrypted: telegramApiHashEncrypted,
    },
    line: storedLine,
    discord: storedSocketConfig('discord', mergedDiscord, store.store),
    slack: storedSocketConfig('slack', mergedSlack, store.store),
    byokInstances: storedByok,
    mailAccounts: storedMail,
  } as StoredConfig;

  Object.assign(config, {
    ...mergedBase,
    telegram: mergedTelegram,
    line: mergedLine,
    discord: mergedDiscord,
    slack: mergedSlack,
    byokInstances: mergedByok,
    mailAccounts: mergedMail,
  });
}

function wipeSensitiveConfig(): void {
  const current = store.store;
  store.store = {
    ...current,
    telegram: { ...current.telegram, botTokenEncrypted: '', apiHashEncrypted: '' },
    line: { ...current.line, channelAccessTokenEncrypted: '', channelSecretEncrypted: '' },
    mailAccounts: (current.mailAccounts ?? []).map((account) => ({ ...account, passwordEncrypted: '' })),
    byokInstances: (current.byokInstances ?? []).map((instance) => ({ ...instance, apiKeyEncrypted: '' })),
    ...Object.fromEntries(SOCKET_BOT_PLATFORMS.map((platform) => [platform, {
      ...storedSocketSection(current, platform),
      ...Object.fromEntries(socketSecrets(platform).map((field) => [`${field}Encrypted`, ''])),
    }])),
  } as StoredConfig;
  for (const platform of SOCKET_BOT_PLATFORMS) {
    for (const field of socketSecrets(platform)) liveSocketSection(config, platform)[field] = '';
  }
  telegramTokenUnavailable = false;
  telegramApiHashUnavailable = false;
  config.telegram.botToken = '';
  config.telegram.apiHash = '';
  config.line.channelAccessToken = '';
  config.line.channelSecret = '';
  for (const account of config.mailAccounts) account.password = '';
  for (const instance of config.byokInstances) instance.apiKey = '';
  // The ciphertext is gone, so there is nothing left to fail to decrypt.
  clearAllSecretFailures();
}

// `theme` stays at the shipped 'auto' so a factory reset keeps following the system theme.
function getDefaultConfig(): Config {
  const { telegram: { botTokenEncrypted: _enc, apiHashEncrypted: _hashEnc, ...telegramRest }, ...rest } = defaultStored;
  return normalizeConfig({ ...rest, telegram: { ...telegramRest, botToken: '', apiHash: '' } });
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
  if (rawTelegram && typeof rawTelegram === 'object') {
    const telegramObj = rawTelegram as Record<string, unknown>;
    const enc = telegramObj.botTokenEncrypted;
    const hashEnc = telegramObj.apiHashEncrypted;
    patched.telegram = {
      ...telegramObj,
      ...('botTokenEncrypted' in telegramObj ? { botToken: decryptToken(typeof enc === 'string' ? enc : '') } : {}),
      ...('apiHashEncrypted' in telegramObj ? { apiHash: decryptToken(typeof hashEnc === 'string' ? hashEnc : '') } : {}),
    };
  }

  const rawMail = rawConfig.mailAccounts;
  const rawSmtp = rawConfig.smtp && typeof rawConfig.smtp === 'object' ? rawConfig.smtp as Record<string, unknown> : null;
  const legacyAddress = typeof rawSmtp?.user === 'string' ? rawSmtp.user.trim() : '';
  const backupHasMail = Array.isArray(rawMail) || Boolean(legacyAddress);
  if (Array.isArray(rawMail)) {
    patched.mailAccounts = rawMail.map((item) => {
      if (!item || typeof item !== 'object' || !('passwordEncrypted' in (item as Record<string, unknown>))) return item;
      const entry = item as Record<string, unknown>;
      return { ...entry, password: decryptToken(typeof entry.passwordEncrypted === 'string' ? entry.passwordEncrypted : '') };
    });
  } else if (rawSmtp && legacyAddress) {
    // A backup from before multiple mailboxes: its one account becomes the default, as on upgrade.
    patched.mailAccounts = [{
      id: LEGACY_MAIL_ACCOUNT_ID,
      address: legacyAddress,
      smtp: { host: rawSmtp.host, port: rawSmtp.port },
      imap: rawConfig.imap,
      password: decryptToken(typeof rawSmtp.passwordEncrypted === 'string' ? rawSmtp.passwordEncrypted : ''),
    }];
    patched.mailDefaultId = LEGACY_MAIL_ACCOUNT_ID;
  }
  delete patched.smtp;
  delete patched.imap;

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

  for (const platform of SOCKET_BOT_PLATFORMS) {
    const section = rawConfig[platform];
    if (!section || typeof section !== 'object') continue;
    const obj = section as Record<string, unknown>;
    const decrypted = Object.fromEntries(socketSecrets(platform)
      .filter((field) => `${field}Encrypted` in obj)
      .map((field) => {
        const enc = obj[`${field}Encrypted`];
        return [field, decryptToken(typeof enc === 'string' ? enc : '')];
      }));
    patched[platform] = { ...obj, ...decrypted };
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

  // An old backup must not re-run an upgrade migration: the grants in force now are kept (from
  // before the downloader grant, only that one), pruned to the restored pairing (the same rule as
  // mcpServers below).
  const telegramGrants = carryCurrentGrantsIntoLegacyBackup(patched.telegram, config.telegram.permissions);
  const lineGrants = carryCurrentGrantsIntoLegacyBackup(patched.line, config.line.permissions);
  patched.telegram = telegramGrants.value;
  patched.line = lineGrants.value;
  for (const platform of SOCKET_BOT_PLATFORMS) {
    if (platform in patched) patched[platform] = carryCurrentGrantsIntoLegacyBackup(patched[platform], config[platform].permissions).value;
  }

  const normalized = normalizeConfig(patched);
  if (telegramGrants.carried) {
    normalized.telegram.adminUserIds = telegramAdminMirror(
      normalized.telegram.permissions,
      normalized.telegram.pairing.pairedUsers.map((user) => user.userId),
    );
  }
  // No mail in the backup means it predates the feature, not "delete every mailbox". A password the
  // backup cannot give back (another machine's key) keeps the current one only for the same sign-in
  // (address and servers): two installs both call their upgraded account `main`.
  if (!backupHasMail) {
    normalized.mailAccounts = config.mailAccounts;
    normalized.mailDefaultId = config.mailDefaultId;
  }
  for (const account of normalized.mailAccounts) {
    if (account.password) continue;
    account.password = config.mailAccounts.find((existing) => sameMailSignIn(existing, account))?.password ?? '';
  }
  if (!normalized.telegram.botToken) normalized.telegram.botToken = config.telegram.botToken;
  // The API id and hash are one pair: a hash the backup cannot give back (another machine's key,
  // or a backup from before big uploads) keeps the current pair rather than mixing the two.
  if (!normalized.telegram.apiHash) {
    normalized.telegram.apiHash = config.telegram.apiHash;
    normalized.telegram.apiId = config.telegram.apiId;
  } else if (!normalized.telegram.apiId) {
    normalized.telegram.apiId = config.telegram.apiId;
  }
  if (!normalized.line.channelAccessToken) normalized.line.channelAccessToken = config.line.channelAccessToken;
  if (!normalized.line.channelSecret) normalized.line.channelSecret = config.line.channelSecret;
  // A platform the backup predates keeps everything it has now; one it holds keeps only the
  // secrets the backup cannot give back (another machine's key).
  for (const platform of SOCKET_BOT_PLATFORMS) {
    if (!(platform in rawConfig)) {
      Object.assign(normalized, { [platform]: config[platform] });
      continue;
    }
    for (const field of socketSecrets(platform)) {
      const restored = liveSocketSection(normalized, platform);
      if (!restored[field]) restored[field] = liveSocketSection(config, platform)[field] ?? '';
    }
  }
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
  // Absent means the backup predates the feature, not "delete what is connected". An empty
  // ARRAY is still honoured, so a backup can deliberately clear the list.
  if (!Array.isArray(rawConfig.mcpServers)) {
    normalized.mcpServers = config.mcpServers;
  }
  // Same for how long Downloads/Yobi keeps files: the default would let the next sweep delete
  // downloads the person chose to keep.
  if (!('downloadsKeep' in rawConfig)) {
    normalized.downloadsKeep = config.downloadsKeep;
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
  regionHotkeyFilled = typeof rawConfig.regionHotkey !== 'string';
  return config;
}

function getHiddenSources(): HiddenSources {
  return {
    providers: config.hiddenProviders,
    byokIds: config.hiddenByokIds,
    byokGroupIds: config.hiddenByokGroupIds,
  };
}

export {
  config,
  saveConfig,
  regionHotkeyFilledIn,
  settleRegionHotkey,
  getHiddenSources,
  wipeSensitiveConfig,
  markTelegramTokenResolved,
  markTelegramApiHashResolved,
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
  normalizeGeminiModelChoice,
  normalizeClaudeModelChoice,
  normalizeChatgptModelChoice,
};
export type { Config, TelegramConfig, LineConfig };
