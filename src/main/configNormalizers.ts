import type { BotLlmDirectConfig, BotProviderCommand, ByokGroup, ByokProviderType, CaptureFormat, CaptureSettings, CustomTemplate, HiddenSources, LinePairedUser, LinePairingState, LinePendingCode, NotifyEventPrefs, Provider, PromptLength, PromptPreferences, PromptTone, TelegramPairedUser, TelegramPairingState, TelegramPendingCode } from '../shared/types';
import { BYOK_PROVIDER_TYPES, PROVIDERS } from '../shared/types';
import { isThemePreference } from '../shared/themes';
import { defaultStored } from './configTypes';
import type { ByokInstance, Config, LineConfig, SmtpConfig, TelegramConfig } from './configTypes';

type LegacyTelegramConfig = TelegramConfig & { providerCommands?: unknown };

export function normalizeConfig(raw: unknown): Config {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<Config>) : {};
  const rawZoom = Number(obj.markdownZoom);
  const clampedZoom = Number.isFinite(rawZoom) && rawZoom >= 70 && rawZoom <= 200
    ? Math.round(rawZoom / 10) * 10
    : 100;

  const inferredLocaleSetByUser = typeof obj.localeSetByUser === 'boolean'
    ? obj.localeSetByUser
    : (typeof obj.locale === 'string' && obj.locale !== 'zh-TW' && obj.locale !== 'en-US');

  // The config stores the two lists flat; normalizeHiddenSources speaks the
  // HiddenSources shape the IPC payload uses. Adapt rather than spread — `obj`
  // carries no `providers` key, so a spread would silently wipe the settings.
  const hidden = normalizeHiddenSources({
    providers: obj.hiddenProviders,
    duckaiModelIds: obj.hiddenDuckaiModelIds,
    byokIds: obj.hiddenByokIds,
    byokGroupIds: obj.hiddenByokGroupIds,
  });

  return {
    ...defaultStored,
    ...obj,
    localeSetByUser: inferredLocaleSetByUser,
    metricsEnabled: obj.metricsEnabled !== false,
    notifyEvents: normalizeNotifyEvents(obj.notifyEvents),
    youtubePrompt: typeof obj.youtubePrompt === 'string' ? obj.youtubePrompt : defaultStored.youtubePrompt,
    theme: isThemePreference(obj.theme) ? obj.theme : defaultStored.theme,
    layoutMode: obj.layoutMode === 'side-by-side' ? 'side-by-side' : 'stacked',
    markdownZoom: clampedZoom,
    captureSettings: normalizeCaptureSettings(obj.captureSettings),
    promptPreferences: normalizePromptPreferences(obj.promptPreferences),
    // Provider commands used to live under `telegram` before LINE shared them.
    // Configs written by an older build still carry them there.
    providerCommands: normalizeProviderCommands(
      obj.providerCommands ?? (obj.telegram as LegacyTelegramConfig | undefined)?.providerCommands,
    ),
    telegram: deserializePairingConfig(obj.telegram),
    line: normalizeLine(obj.line),
    smtp: normalizeSmtp(obj.smtp),
    byokInstances: normalizeByokInstances(obj.byokInstances),
    byokGroups: normalizeByokGroups(obj.byokGroups),
    hiddenProviders: hidden.providers,
    hiddenDuckaiModelIds: hidden.duckaiModelIds,
    hiddenByokIds: hidden.byokIds,
    hiddenByokGroupIds: hidden.byokGroupIds,
  };
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const value = item.trim();
    if (value) seen.add(value);
  }
  return [...seen];
}

// Blocklist semantics: an absent key means nothing is hidden, so a config written
// before this feature needs no migration, and duck.ai models added later show up
// by default. Unknown ids survive — the duck.ai list is fetched at runtime, so an
// id we cannot see right now is not necessarily stale.
export function normalizeHiddenSources(raw: unknown): HiddenSources {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<HiddenSources>) : {};
  const known = new Set<string>(PROVIDERS);
  return {
    providers: normalizeStringList(obj.providers).filter((p): p is Provider => known.has(p)),
    duckaiModelIds: normalizeStringList(obj.duckaiModelIds),
    byokIds: normalizeStringList(obj.byokIds),
    byokGroupIds: normalizeStringList(obj.byokGroupIds),
  };
}

export function normalizeByokInstances(raw: unknown): ByokInstance[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const instances: ByokInstance[] = [];
  for (const item of raw) {
    const entry = (item && typeof item === 'object') ? (item as Partial<ByokInstance>) : {};
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    instances.push({
      id,
      name,
      providerType: BYOK_PROVIDER_TYPES.includes(entry.providerType as ByokProviderType)
        ? (entry.providerType as ByokProviderType)
        : 'openai',
      apiKey: typeof entry.apiKey === 'string' ? entry.apiKey.trim() : '',
      baseUrl: typeof entry.baseUrl === 'string' ? entry.baseUrl.trim() : '',
      model: typeof entry.model === 'string' ? entry.model.trim() : '',
    });
  }
  return instances;
}

export function normalizeByokGroups(raw: unknown): ByokGroup[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const groups: ByokGroup[] = [];
  for (const item of raw) {
    const entry = (item && typeof item === 'object') ? (item as Partial<ByokGroup>) : {};
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    // Dangling members (a key deleted while still listed here) are tolerated:
    // kept as-is on disk, skipped at resolution time. Dedup within a group.
    const memberSeen = new Set<string>();
    const memberIds: string[] = [];
    if (Array.isArray(entry.memberIds)) {
      for (const rawMember of entry.memberIds) {
        const memberId = typeof rawMember === 'string' ? rawMember.trim() : '';
        if (!memberId || memberSeen.has(memberId)) continue;
        memberSeen.add(memberId);
        memberIds.push(memberId);
      }
    }
    groups.push({ id, name, memberIds });
  }
  return groups;
}

export function normalizeNotifyEvents(raw: unknown): NotifyEventPrefs {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<NotifyEventPrefs>) : {};
  return {
    chatComplete: obj.chatComplete !== false,
    chatFailure: obj.chatFailure !== false,
    flowSuccess: obj.flowSuccess === true,
    flowFailure: obj.flowFailure !== false,
  };
}

export function normalizeLine(raw: unknown): LineConfig {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<LineConfig> & { allowedUserIds?: unknown }) : {};
  const port = Number(obj.port);
  return {
    enabled: Boolean(obj.enabled),
    channelAccessToken: typeof obj.channelAccessToken === 'string' ? obj.channelAccessToken.trim() : '',
    channelSecret: typeof obj.channelSecret === 'string' ? obj.channelSecret.trim() : '',
    port: Number.isFinite(port) && port > 0 && port <= 65_535 ? Math.floor(port) : 3007,
    llmDirect: normalizeLlmDirect(obj.llmDirect),
    pairing: deserializeLinePairingState(obj.pairing, obj.allowedUserIds),
  };
}

// Shared by the Telegram and LINE configs; pre-feature stored configs have no
// llmDirect key at all and must come back disabled.
export function normalizeLlmDirect(raw: unknown): BotLlmDirectConfig {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<BotLlmDirectConfig>) : {};
  return {
    enabled: Boolean(obj.enabled),
    targetUrl: typeof obj.targetUrl === 'string' ? obj.targetUrl.trim() : '',
  };
}

function deserializeLinePairingState(raw: unknown, legacyAllowedUserIds: unknown): LinePairingState {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<LinePairingState>) : {};
  const pairedUsers = normalizeLinePairedUsers(obj.pairedUsers);
  // Migration: line.allowedUserIds predates pairing. Fold any id that is not
  // already paired into pairedUsers so upgrading never locks the bot's users out.
  const seen = new Set(pairedUsers.map((user) => user.userId));
  for (const userId of normalizeLineUserIds(legacyAllowedUserIds)) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    pairedUsers.push({ userId, pairedAt: new Date().toISOString() });
  }
  return { pendingCodes: normalizeLinePendingCodes(obj.pendingCodes), pairedUsers };
}

function normalizeLinePendingCodes(raw: unknown): LinePendingCode[] {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  return raw
    .map((item) => {
      const entry = item as Partial<LinePendingCode>;
      const code = typeof entry.code === 'string' ? entry.code.trim().toUpperCase() : '';
      const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : '';
      const expiresAt = typeof entry.expiresAt === 'string' ? entry.expiresAt : '';
      const expiresMs = Date.parse(expiresAt);
      if (!code || !createdAt || !expiresAt || Number.isNaN(expiresMs) || expiresMs <= now) return null;
      return { code, createdAt, expiresAt };
    })
    .filter((item): item is LinePendingCode => Boolean(item));
}

function normalizeLinePairedUsers(raw: unknown): LinePairedUser[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const users: LinePairedUser[] = [];
  for (const item of raw) {
    const entry = item as Partial<LinePairedUser>;
    const userId = typeof entry.userId === 'string' ? entry.userId.trim() : '';
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    users.push({
      userId,
      displayName: typeof entry.displayName === 'string' && entry.displayName.trim() ? entry.displayName.trim() : undefined,
      pairedAt: typeof entry.pairedAt === 'string' && entry.pairedAt ? entry.pairedAt : new Date().toISOString(),
    });
  }
  return users;
}

function normalizeLineUserIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of raw) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
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
    compactReply: obj.compactReply === true,
    adminUserIds: normalizeAdminUserIds(obj.adminUserIds),
    llmDirect: normalizeLlmDirect(obj.llmDirect),
    pairing: deserializePairingState(obj.pairing),
  };
}

export function normalizeProviderCommands(raw: unknown): Record<Provider, BotProviderCommand> {
  const obj = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const result = {} as Record<Provider, BotProviderCommand>;
  for (const provider of PROVIDERS) {
    const entry = (obj[provider] && typeof obj[provider] === 'object')
      ? (obj[provider] as Partial<BotProviderCommand>)
      : {};
    const command: BotProviderCommand = {
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
