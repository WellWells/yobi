import { DEFAULT_CAPTURE_WIDTH, DEFAULT_SHARE_INSTANCE, MAX_CAPTURE_WIDTH, MIN_CAPTURE_WIDTH, SHARE_EXPIRE_VALUES, clampCaptureMargin, defaultQuickExportHotkey, normalizeShareExpireList } from '../shared/types';
import type { BotBuiltinCommand, BotBuiltinCommands, BotByokCommands, BotLlmDirectConfig, BotProviderCommand, ByokGroup, ByokProviderType, CaptureFormat, CaptureSettings, QuickExportFormat, QuickExportSettings, HiddenSources, LinePairedUser, LinePairingState, McpServerConfig, NotifyEventPrefs, PendingPairingCode, Provider, PromptLength, PromptPreferences, PromptTone, ShareExpire, ShareExpireCache, ShareSettings, TelegramChannel, TelegramChatKind, TelegramPairedUser, TelegramPairingState } from '../shared/types';
import {
  AGENT_ASK_TTL_MAX_MINUTES,
  AGENT_ASK_TTL_MIN_MINUTES,
  BOT_BUILTIN_COMMAND_KEYS,
  BYOK_PROVIDER_TYPES,
  DEFAULT_AGENT_ASK_TTL_MINUTES,
  PROVIDERS,
  detectByokProviderType,
  canonicalProviderUrl,
  migrateRemovedTargetUrl,
} from '../shared/types';
import { isThemePreference } from '../shared/themes';
import { bySiteFlag } from '../shared/siteConnectors';
import { normalizeReadingFont } from '../shared/readingPrefs';
import { normalizeDownloadsKeep } from '../shared/downloads';
import type { GeminiModelCatalog, GeminiModelChoice, GeminiModelInfo } from '../shared/geminiModels';
import type {
  ClaudeModelCatalog,
  ClaudeModelChoice,
  ClaudeModelInfo,
  ClaudeModelOptions,
  ClaudeOptionInfo,
} from '../shared/claudeModels';
import type { ChatgptModelCatalog, ChatgptModelChoice, ChatgptModelInfo } from '../shared/chatgptModels';
import { slugifyCommandName } from '../shared/mcpCommand';
import {
  CAPTURE_BACKGROUND_STYLES,
  DEFAULT_CAPTURE_BACKGROUND_STYLE,
  DEFAULT_CAPTURE_PALETTE,
  type CaptureBackgroundStyle,
} from '../shared/capturePalettes';
import { defaultStored } from './configTypes';
// The module itself, not the façade: the façade reads config, which imports this file.
import { normalizeBotPermissions } from './botPermissions/normalize';
import { normalizeBlockedUsers, normalizeGroupPermissions } from '../shared/botPermissions';
import { normalizeInstanceUrl } from './share/privatebin';
import { normalizeEditorChoice } from './editorPresets';
import type { ByokInstance, Config, LineConfig, SmtpConfig, TelegramConfig, WindowBounds } from './configTypes';
import { canonicalise, SHORTCUTS } from '../shared/shortcuts';
import type { ShortcutOverride } from '../shared/shortcuts';

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

  const hidden = normalizeHiddenSources({
    providers: obj.hiddenProviders,
    byokIds: obj.hiddenByokIds,
    byokGroupIds: obj.hiddenByokGroupIds,
  });
  const legacyAgentTarget = legacyAgentCommandTarget(obj.builtinCommands);
  // Written by versions that still had Duck.ai; dropped so it does not ride along forever.
  const { hiddenDuckaiModelIds: _legacyDuckaiIds, ...current } = obj as Partial<Config> & { hiddenDuckaiModelIds?: unknown };

  return {
    ...defaultStored,
    ...current,
    targetUrl: normalizeStoredTarget(obj.targetUrl) || defaultStored.targetUrl,
    flowGenerateUrl: normalizeStoredTarget(obj.flowGenerateUrl),
    memoryCurateUrl: normalizeStoredTarget(obj.memoryCurateUrl),
    writingToolsUrl: normalizeStoredTarget(obj.writingToolsUrl),
    externalEditor: normalizeEditorChoice(obj.externalEditor),
    externalEditorCommand: typeof obj.externalEditorCommand === 'string' ? obj.externalEditorCommand.trim() : '',
    localeSetByUser: inferredLocaleSetByUser,
    metricsEnabled: obj.metricsEnabled !== false,
    hotkeyEnabled: obj.hotkeyEnabled !== false,
    lineReaderEnabled: obj.lineReaderEnabled === true,
    thunderbirdEnabled: obj.thunderbirdEnabled === true,
    xConnectorEnabled: obj.xConnectorEnabled === true,
    taiwanRailEnabled: typeof obj.taiwanRailEnabled === 'boolean' ? obj.taiwanRailEnabled : null,
    ...bySiteFlag((row) => obj[row.flag] === true),
    notifyEvents: normalizeNotifyEvents(obj.notifyEvents),
    youtubePrompt: typeof obj.youtubePrompt === 'string' ? obj.youtubePrompt : defaultStored.youtubePrompt,
    theme: isThemePreference(obj.theme) ? obj.theme : defaultStored.theme,
    layoutMode: obj.layoutMode === 'side-by-side' ? 'side-by-side' : 'stacked',
    markdownZoom: clampedZoom,
    readingFont: normalizeReadingFont(obj.readingFont),
    readingFullWidth: obj.readingFullWidth === true,
    captureSettings: normalizeCaptureSettings(obj.captureSettings),
    quickExport: normalizeQuickExport(obj.quickExport),
    shortcuts: normalizeShortcuts(obj.shortcuts),
    share: normalizeShareSettings(obj.share),
    windowBounds: normalizeWindowBounds(obj.windowBounds),
    promptPreferences: normalizePromptPreferences(obj.promptPreferences),
    providerCommands: normalizeProviderCommands(
      obj.providerCommands ?? (obj.telegram as LegacyTelegramConfig | undefined)?.providerCommands,
    ),
    builtinCommands: normalizeBuiltinCommands(obj.builtinCommands),
    botByokCommands: normalizeBotByokCommands(obj.botByokCommands),
    telegram: deserializePairingConfig(obj.telegram, legacyAgentTarget),
    line: normalizeLine(obj.line, legacyAgentTarget),
    smtp: normalizeSmtp(obj.smtp),
    byokInstances: normalizeByokInstances(obj.byokInstances),
    byokGroups: normalizeByokGroups(obj.byokGroups),
    mcpServers: normalizeMcpServers(obj.mcpServers),
    hiddenProviders: hidden.providers,
    hiddenByokIds: hidden.byokIds,
    hiddenByokGroupIds: hidden.byokGroupIds,
    geminiModel: normalizeGeminiModelChoice(obj.geminiModel),
    geminiModelCatalog: normalizeGeminiModelCatalog(obj.geminiModelCatalog),
    claudeModel: normalizeClaudeModelChoice(obj.claudeModel),
    claudeModelCatalog: normalizeClaudeModelCatalog(obj.claudeModelCatalog),
    chatgptModel: normalizeChatgptModelChoice(obj.chatgptModel),
    chatgptModelCatalog: normalizeChatgptModelCatalog(obj.chatgptModelCatalog),
    downloadsKeep: normalizeDownloadsKeep(obj.downloadsKeep),
  };
}

export function normalizeGeminiModelChoice(raw: unknown): GeminiModelChoice {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<GeminiModelChoice>) : {};
  return {
    modelId: typeof obj.modelId === 'string' ? obj.modelId.trim() : '',
    extendedThinking: typeof obj.extendedThinking === 'boolean' ? obj.extendedThinking : null,
  };
}

function cleanText(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

/** A cache, so anything malformed is simply dropped: the next Gemini send reads the page again. */
export function normalizeGeminiModelCatalog(raw: unknown): GeminiModelCatalog | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<GeminiModelCatalog>;
  const seen = new Set<string>();
  const models: GeminiModelInfo[] = [];
  for (const entry of Array.isArray(obj.models) ? obj.models : []) {
    const id = cleanText((entry as Partial<GeminiModelInfo> | null)?.id);
    const label = cleanText((entry as Partial<GeminiModelInfo> | null)?.label);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label, sublabel: cleanText((entry as Partial<GeminiModelInfo>).sublabel) });
  }
  if (models.length === 0) return null;
  const thinkingLabel = cleanText(obj.thinking?.label);
  return {
    models,
    thinking: thinkingLabel ? { label: thinkingLabel, sublabel: cleanText(obj.thinking?.sublabel) } : null,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : '',
  };
}

/** Claude's and ChatGPT's choices share one shape: a model, its effort, and a thinking switch. */
function normalizeEffortModelChoice(raw: unknown): ClaudeModelChoice & ChatgptModelChoice {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<ClaudeModelChoice>) : {};
  return {
    modelId: typeof obj.modelId === 'string' ? obj.modelId.trim() : '',
    effort: typeof obj.effort === 'string' ? obj.effort.trim() : '',
    thinking: typeof obj.thinking === 'boolean' ? obj.thinking : null,
  };
}

export function normalizeClaudeModelChoice(raw: unknown): ClaudeModelChoice {
  return normalizeEffortModelChoice(raw);
}

/** An `{ id, label, sublabel }` row of a provider's picker (Claude's and ChatGPT's share the shape). */
function normalizePickerOption(raw: unknown): ClaudeOptionInfo | null {
  const entry = (raw && typeof raw === 'object') ? (raw as Partial<ClaudeOptionInfo>) : {};
  const id = cleanText(entry.id);
  const label = cleanText(entry.label);
  return id && label ? { id, label, sublabel: cleanText(entry.sublabel) } : null;
}

function normalizeClaudeModelOptions(raw: unknown): ClaudeModelOptions | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<ClaudeModelOptions>;
  const efforts = (Array.isArray(obj.efforts) ? obj.efforts : [])
    .map(normalizePickerOption)
    .filter((effort): effort is ClaudeOptionInfo => effort !== null);
  const thinkingLabel = cleanText(obj.thinking?.label);
  return {
    efforts,
    thinking: thinkingLabel ? { label: thinkingLabel, sublabel: cleanText(obj.thinking?.sublabel) } : null,
  };
}

/** A cache, like Gemini's: anything malformed is dropped and the next Claude send reads the page again. */
export function normalizeClaudeModelCatalog(raw: unknown): ClaudeModelCatalog | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<ClaudeModelCatalog>;
  const seen = new Set<string>();
  const models: ClaudeModelInfo[] = [];
  for (const entry of Array.isArray(obj.models) ? obj.models : []) {
    const option = normalizePickerOption(entry);
    if (!option || seen.has(option.id)) continue;
    seen.add(option.id);
    const model: ClaudeModelInfo = { ...option, options: normalizeClaudeModelOptions((entry as Partial<ClaudeModelInfo>).options) };
    const legacy = (entry as Partial<ClaudeModelInfo>).legacy;
    if (typeof legacy === 'boolean') model.legacy = legacy;
    models.push(model);
  }
  if (models.length === 0) return null;
  return { models, updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : '' };
}

export function normalizeChatgptModelChoice(raw: unknown): ChatgptModelChoice {
  return normalizeEffortModelChoice(raw);
}

/** A cache, like Claude's: anything malformed is dropped and the next ChatGPT send reads the page again. */
export function normalizeChatgptModelCatalog(raw: unknown): ChatgptModelCatalog | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<ChatgptModelCatalog>;
  const seen = new Set<string>();
  const models: ChatgptModelInfo[] = [];
  for (const entry of Array.isArray(obj.models) ? obj.models : []) {
    const option = normalizePickerOption(entry);
    if (!option || seen.has(option.id)) continue;
    seen.add(option.id);
    const rawEfforts = (entry as Partial<ChatgptModelInfo>).efforts;
    const efforts = (Array.isArray(rawEfforts) ? rawEfforts : [])
      .map(normalizePickerOption)
      .filter((effort) => effort !== null);
    models.push({ ...option, efforts });
  }
  const thinkingLabel = cleanText(obj.thinking?.label);
  const thinking = thinkingLabel ? { label: thinkingLabel, sublabel: cleanText(obj.thinking?.sublabel) } : null;
  if (models.length === 0 && !thinking) return null;
  return { models, thinking, updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : '' };
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

export function normalizeHiddenSources(raw: unknown): HiddenSources {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<HiddenSources>) : {};
  const known = new Set<string>(PROVIDERS);
  return {
    providers: normalizeStringList(obj.providers).filter((p): p is Provider => known.has(p)),
    byokIds: normalizeStringList(obj.byokIds),
    byokGroupIds: normalizeStringList(obj.byokGroupIds),
  };
}

function resolveStoredProviderType(rawType: unknown, baseUrl: string): ByokProviderType {
  const known = BYOK_PROVIDER_TYPES.includes(rawType as ByokProviderType)
    ? (rawType as ByokProviderType)
    : null;
  if (!known) return detectByokProviderType(baseUrl);
  if (known === 'openai' && detectByokProviderType(baseUrl) !== 'openai') {
    return detectByokProviderType(baseUrl);
  }
  return known;
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
    const baseUrl = typeof entry.baseUrl === 'string' ? entry.baseUrl.trim() : '';
    instances.push({
      id,
      name,
      providerType: resolveStoredProviderType(entry.providerType, baseUrl),
      apiKey: typeof entry.apiKey === 'string' ? entry.apiKey.trim() : '',
      baseUrl,
      model: typeof entry.model === 'string' ? entry.model.trim() : '',
    });
  }
  return instances;
}

export function normalizeMcpServers(raw: unknown): McpServerConfig[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const servers: McpServerConfig[] = [];
  for (const item of raw) {
    const entry = (item && typeof item === 'object') ? (item as Partial<McpServerConfig>) : {};
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const url = typeof entry.url === 'string' ? entry.url.trim() : '';
    if (!id || !url || seen.has(id) || !/^https:\/\//i.test(url)) continue;
    seen.add(id);
    const headerName = typeof entry.headerName === 'string' && entry.headerName.trim() ? entry.headerName.trim() : undefined;
    // Repaired rather than dropped: a stored command that no longer parses would otherwise take
    // the user's slash command with it, silently, at the next launch.
    const commandName = slugifyCommandName(typeof entry.commandName === 'string' ? entry.commandName : '');
    servers.push({
      id,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : url,
      url,
      enabled: entry.enabled !== false,
      agentEnabled: entry.agentEnabled !== false,
      autoApproveWrites: entry.autoApproveWrites === true,
      createdAt: typeof entry.createdAt === 'string' && entry.createdAt ? entry.createdAt : new Date().toISOString(),
      ...(headerName ? { headerName } : {}),
      ...(commandName ? { commandName } : {}),
    });
  }
  return servers;
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

export function normalizeLine(raw: unknown, legacyAgentTarget = ''): LineConfig {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<LineConfig>) : {};
  const port = Number(obj.port);
  const pairing = deserializeLinePairingState(obj.pairing);
  const { permissions, permissionsVersion } = normalizeBotPermissions({
    platform: 'line',
    raw: obj.permissions,
    rawVersion: obj.permissionsVersion,
    pairedIds: pairing.pairedUsers.map((user) => user.userId),
  });
  return {
    enabled: Boolean(obj.enabled),
    channelAccessToken: typeof obj.channelAccessToken === 'string' ? obj.channelAccessToken.trim() : '',
    channelSecret: typeof obj.channelSecret === 'string' ? obj.channelSecret.trim() : '',
    port: Number.isFinite(port) && port > 0 && port <= 65_535 ? Math.floor(port) : 3007,
    llmDirect: normalizeLlmDirect(obj.llmDirect, legacyAgentTarget),
    pairing,
    permissions,
    permissionsVersion,
    groupPermissions: normalizeGroupPermissions(obj.groupPermissions),
    blockedUsers: normalizeBlockedUsers(obj.blockedUsers),
  };
}

/**
 * The bot's default model. A legacy config with `enabled: false` and no model of its own takes
 * the model of the legacy bot `/agent` command (`legacyAgentTarget`).
 */
export function normalizeLlmDirect(raw: unknown, legacyAgentTarget = ''): BotLlmDirectConfig {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<BotLlmDirectConfig> & { enabled?: unknown }) : {};
  const own = normalizeStoredTarget(obj.targetUrl);
  if (own || obj.enabled !== false) return { targetUrl: own };
  return { targetUrl: normalizeStoredTarget(legacyAgentTarget) };
}

/** The model of the legacy bot `/agent` command, read once to carry it over. */
function legacyAgentCommandTarget(raw: unknown): string {
  const obj = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const agent = (obj.agent && typeof obj.agent === 'object') ? (obj.agent as Partial<BotBuiltinCommand>) : {};
  return typeof agent.targetUrl === 'string' ? agent.targetUrl : '';
}

/** Empty stays empty ("follow the default"); anything else is migrated off removed providers. */
function normalizeStoredTarget(raw: unknown): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed ? migrateRemovedTargetUrl(canonicalProviderUrl(trimmed)) : '';
}

function deserializeLinePairingState(raw: unknown): LinePairingState {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<LinePairingState>) : {};
  return {
    pendingCodes: normalizePendingCodes(obj.pendingCodes),
    pairedUsers: normalizeLinePairedUsers(obj.pairedUsers),
  };
}

/** Telegram and LINE pending codes share one shape; an expired or incomplete code is dropped. */
function normalizePendingCodes(raw: unknown): PendingPairingCode[] {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const entry = item as Partial<PendingPairingCode>;
      const code = typeof entry.code === 'string' ? entry.code.trim().toUpperCase() : '';
      const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : '';
      const expiresAt = typeof entry.expiresAt === 'string' ? entry.expiresAt : '';
      const expiresMs = Date.parse(expiresAt);
      if (!code || !createdAt || !expiresAt || Number.isNaN(expiresMs) || expiresMs <= now) return null;
      return { code, createdAt, expiresAt };
    })
    .filter((item): item is PendingPairingCode => Boolean(item));
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

export function normalizeSmtp(raw: unknown): SmtpConfig {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<SmtpConfig>) : {};
  const port = Number(obj.port);
  return {
    host: typeof obj.host === 'string' ? obj.host.trim() : '',
    port: Number.isFinite(port) && port > 0 && port <= 65_535 ? Math.floor(port) : 587,
    user: typeof obj.user === 'string' ? obj.user.trim() : '',
    password: typeof obj.password === 'string' ? obj.password : '',
  };
}

function clampCaptureWidth(raw: unknown): number {
  const value = Math.round(Number(raw));
  if (!Number.isFinite(value)) return DEFAULT_CAPTURE_WIDTH;
  return Math.max(MIN_CAPTURE_WIDTH, Math.min(MAX_CAPTURE_WIDTH, value));
}

export function normalizeCaptureSettings(raw: unknown): CaptureSettings {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<CaptureSettings>) : {};
  const validFormats: CaptureFormat[] = ['png', 'webp', 'pdf'];
  return {
    palette: typeof obj.palette === 'string' && obj.palette ? obj.palette : DEFAULT_CAPTURE_PALETTE,
    backgroundStyle: CAPTURE_BACKGROUND_STYLES.includes(obj.backgroundStyle as CaptureBackgroundStyle)
      ? (obj.backgroundStyle as CaptureBackgroundStyle)
      : DEFAULT_CAPTURE_BACKGROUND_STYLE,
    direction: typeof obj.direction === 'string' && obj.direction ? obj.direction : 'se',
    showPrompt: obj.showPrompt !== false,
    showProvider: obj.showProvider !== false,
    showTimestamp: obj.showTimestamp !== false,
    showTokens: obj.showTokens !== false,
    format: validFormats.includes(obj.format as CaptureFormat) ? (obj.format as CaptureFormat) : 'png',
    cardLayout: obj.cardLayout === 'bubble' ? 'bubble' : 'document',
    range: obj.range === 'last' ? 'last' : 'all',
    width: clampCaptureWidth(obj.width),
    margin: clampCaptureMargin(obj.margin),
    pixelRatio: obj.pixelRatio === 2 ? 2 : 1,
    zip: obj.zip === true,
  };
}

/**
 * Anything that is not four finite numbers plus a flag is dropped: the value goes straight to
 * `setBounds()`, and a hand-edited or half-written config.json must not be able to put the
 * window somewhere it cannot be reached. Position is still range-checked against the actual
 * displays at restore time (`windowBounds.ts`) — a monitor can disappear between runs.
 */
export function normalizeWindowBounds(raw: unknown): WindowBounds | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<WindowBounds>;
  const nums = [obj.x, obj.y, obj.width, obj.height];
  if (!nums.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  if ((obj.width as number) < 1 || (obj.height as number) < 1) return null;
  return {
    x: Math.round(obj.x as number),
    y: Math.round(obj.y as number),
    width: Math.round(obj.width as number),
    height: Math.round(obj.height as number),
    maximized: obj.maximized === true,
  };
}

export function normalizeShareSettings(raw: unknown): ShareSettings {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<ShareSettings>) : {};
  const rawUrl = typeof obj.instanceUrl === 'string' ? obj.instanceUrl : '';
  return {
    instanceUrl: normalizeInstanceUrl(rawUrl) ?? DEFAULT_SHARE_INSTANCE,
    expire: SHARE_EXPIRE_VALUES.includes(obj.expire as ShareExpire)
      ? (obj.expire as ShareExpire)
      : '1week',
    burnAfterReading: obj.burnAfterReading === true,
    consentedAt: typeof obj.consentedAt === 'string' ? obj.consentedAt.trim() : '',
    instanceExpires: normalizeExpireCache(obj.instanceExpires),
  };
}

function normalizeExpireCache(raw: unknown): ShareExpireCache | null {
  if (!raw || typeof raw !== 'object') return null;
  const cache = raw as Partial<ShareExpireCache>;
  const url = typeof cache.url === 'string' ? normalizeInstanceUrl(cache.url) : null;
  if (!url) return null;
  const values = normalizeShareExpireList(Array.isArray(cache.values) ? cache.values : []);
  return values.length > 0 ? { url, values } : null;
}

export function normalizeShortcuts(raw: unknown): Record<string, ShortcutOverride> {
  if (!raw || typeof raw !== 'object') return {};
  const known = new Set(SHORTCUTS.filter((s) => s.rebindable).map((s) => s.id as string));
  const out: Record<string, ShortcutOverride> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(id)) continue;
    if (!value || typeof value !== 'object') continue;
    const entry = value as { combo?: unknown; off?: unknown };
    const next: ShortcutOverride = {};
    if (typeof entry.combo === 'string') next.combo = canonicalise(entry.combo);
    if (entry.off === true) next.off = true;
    if (next.combo === undefined && !next.off) continue;
    out[id] = next;
  }
  return out;
}

export function normalizeQuickExport(raw: unknown): QuickExportSettings {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<QuickExportSettings>) : null;
  const validFormats: QuickExportFormat[] = ['png', 'webp', 'pdf', 'text'];
  return {
    enabled: obj?.enabled !== false,
    hotkey: typeof obj?.hotkey === 'string'
      ? obj.hotkey.trim()
      : defaultQuickExportHotkey(process.platform === 'darwin'),
    format: validFormats.includes(obj?.format as QuickExportFormat) ? (obj!.format as QuickExportFormat) : 'png',
    zip: obj?.zip === true,
  };
}

export function deserializePairingConfig(raw: unknown, legacyAgentTarget = ''): TelegramConfig {
  const obj = (raw && typeof raw === 'object') ? (raw as Partial<TelegramConfig>) : {};
  const pairing = deserializePairingState(obj.pairing);
  const adminUserIds = normalizeAdminUserIds(obj.adminUserIds);
  const { permissions, permissionsVersion } = normalizeBotPermissions({
    platform: 'telegram',
    raw: obj.permissions,
    rawVersion: obj.permissionsVersion,
    pairedIds: pairing.pairedUsers.map((user) => String(user.userId)),
    legacyAdminIds: adminUserIds.map(String),
  });
  return {
    enabled: Boolean(obj.enabled),
    botToken: typeof obj.botToken === 'string' ? obj.botToken.trim() : '',
    apiId: normalizeTelegramApiId(obj.apiId),
    apiHash: typeof obj.apiHash === 'string' ? obj.apiHash.trim() : '',
    allowGroupCommands: Boolean(obj.allowGroupCommands),
    defaultReplyMode: obj.defaultReplyMode === 'png' || obj.defaultReplyMode === 'webp' || obj.defaultReplyMode === 'pdf'
      ? obj.defaultReplyMode
      : 'markdown',
    compactReply: obj.compactReply === true,
    adminUserIds,
    llmDirect: normalizeLlmDirect(obj.llmDirect, legacyAgentTarget),
    pairing,
    channels: normalizeTelegramChannels(obj.channels),
    permissions,
    permissionsVersion,
    groupPermissions: normalizeGroupPermissions(obj.groupPermissions),
    blockedUsers: normalizeBlockedUsers(obj.blockedUsers),
  };
}

/** my.telegram.org's api_id: a positive integer; anything else is "not set" (0). */
export function normalizeTelegramApiId(raw: unknown): number {
  const value = typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw) : raw;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function normalizeTelegramChannels(raw: unknown): TelegramChannel[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const channels: TelegramChannel[] = [];
  for (const item of raw) {
    const entry = (item && typeof item === 'object') ? (item as Partial<TelegramChannel>) : {};
    const chatId = Number(entry.chatId);
    if (!Number.isFinite(chatId) || chatId === 0 || seen.has(chatId)) continue;
    seen.add(chatId);
    const username = typeof entry.username === 'string' ? entry.username.replace(/^@/, '').trim() : '';
    const chatType = normalizeTelegramChatKind(entry.chatType);
    channels.push({
      chatId,
      title: typeof entry.title === 'string' ? entry.title.trim() : '',
      ...(username ? { username } : {}),
      ...(chatType ? { chatType } : {}),
      canPost: entry.canPost === true,
    });
  }
  return channels;
}

function normalizeTelegramChatKind(raw: unknown): TelegramChatKind | undefined {
  if (raw === 'group' || raw === 'supergroup' || raw === 'channel') return raw;
  return undefined;
}

export function normalizeProviderCommands(raw: unknown): Record<Provider, BotProviderCommand> {
  const obj = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const result = {} as Record<Provider, BotProviderCommand>;
  for (const provider of PROVIDERS) {
    const entry = (obj[provider] && typeof obj[provider] === 'object')
      ? (obj[provider] as Partial<BotProviderCommand>)
      : {};
    result[provider] = {
      enabled: entry.enabled !== false,
      command: typeof entry.command === 'string' ? entry.command.trim() : '',
    };
  }
  return result;
}

export function normalizeBuiltinCommands(raw: unknown): BotBuiltinCommands {
  const obj = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const ttl = Number((obj as Partial<BotBuiltinCommands>).askTtlMinutes);
  const result = {
    askTtlMinutes: Number.isFinite(ttl)
      ? Math.min(AGENT_ASK_TTL_MAX_MINUTES, Math.max(AGENT_ASK_TTL_MIN_MINUTES, Math.round(ttl)))
      : DEFAULT_AGENT_ASK_TTL_MINUTES,
  } as BotBuiltinCommands;
  for (const key of BOT_BUILTIN_COMMAND_KEYS) {
    const entry = (obj[key] && typeof obj[key] === 'object')
      ? (obj[key] as Partial<BotBuiltinCommand>)
      : {};
    result[key] = {
      enabled: entry.enabled !== false,
      command: typeof entry.command === 'string' ? entry.command.trim() : '',
      targetUrl: normalizeStoredTarget(entry.targetUrl),
    };
  }
  return result;
}

export function normalizeBotByokCommands(raw: unknown): BotByokCommands {
  if (!raw || typeof raw !== 'object') return {};
  const result: BotByokCommands = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const trimmed = id.trim();
    if (trimmed && value === false) result[trimmed] = false;
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
    nickname: typeof obj.nickname === 'string' ? obj.nickname : '',
  };
}
