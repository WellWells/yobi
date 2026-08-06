import { PROVIDER_URLS } from '../shared/types';
import { DEFAULT_CAPTURE_WIDTH, defaultMainHotkey, defaultQuickExportHotkey } from '../shared/types';
import { DEFAULT_SHARE_INSTANCE } from '../shared/types';
import { DEFAULT_CAPTURE_BACKGROUND_STYLE, DEFAULT_CAPTURE_PALETTE } from '../shared/capturePalettes';
import { DEFAULT_AGENT_ASK_TTL_MINUTES } from '../shared/types';
import type { BotBuiltinCommands, BotByokCommands, BotLlmDirectConfig, BotProviderCommand, ByokGroup, ByokProviderType, CaptureFormat, CaptureRange, CaptureSettings, CardLayout, QuickExportSettings, LinePairingState, McpServerConfig, NotifyEventPrefs, PromptPreferences, Provider, ShareSettings, TelegramChannel, TelegramPairingState } from '../shared/types';

export interface Config {
  targetUrl: string;
  hotkey: string;
  hotkeyEnabled: boolean;
  debounceMs: number;
  responseTimeout: number;
  byokContextBudgetChars: number;
  locale: string;
  localeSetByUser: boolean;
  theme: string;
  syncSystemLanguageToModel: boolean;
  notifyOnComplete: boolean;
  notifyEvents: NotifyEventPrefs;
  metricsEnabled: boolean;
  promptPreferences: PromptPreferences;
  youtubePrompt: string;
  providerCommands: Record<Provider, BotProviderCommand>;
  builtinCommands: BotBuiltinCommands;
  botByokCommands: BotByokCommands;
  telegram: TelegramConfig;
  line: LineConfig;
  smtp: SmtpConfig;
  byokInstances: ByokInstance[];
  byokGroups: ByokGroup[];
  mcpServers: McpServerConfig[];
  hiddenProviders: Provider[];
  hiddenDuckaiModelIds: string[];
  hiddenByokIds: string[];
  hiddenByokGroupIds: string[];
  closeToTray: boolean;
  closeActionDecided: boolean;
  launchAtStartup: boolean;
  layoutMode: 'stacked' | 'side-by-side';
  markdownZoom: number;
  showTokenUsage: boolean;
  captureSettings: CaptureSettings;
  quickExport: QuickExportSettings;
  share: ShareSettings;
}

export interface ByokInstance {
  id: string;
  name: string;
  providerType: ByokProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  allowGroupCommands: boolean;
  defaultReplyMode: 'markdown' | 'png' | 'webp' | 'pdf';
  compactReply: boolean;
  adminUserIds: number[];
  llmDirect: BotLlmDirectConfig;
  pairing: TelegramPairingState;
  channels: TelegramChannel[];
}

export interface LineConfig {
  enabled: boolean;
  channelAccessToken: string;
  channelSecret: string;
  port: number;
  llmDirect: BotLlmDirectConfig;
  pairing: LinePairingState;
}

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface StoredTelegramConfig extends Omit<TelegramConfig, 'botToken'> {
  botTokenEncrypted: string;
}
export interface StoredLineConfig extends Omit<LineConfig, 'channelAccessToken' | 'channelSecret'> {
  channelAccessTokenEncrypted: string;
  channelSecretEncrypted: string;
}
export interface StoredSmtpConfig extends Omit<SmtpConfig, 'password'> {
  passwordEncrypted: string;
}
export interface StoredByokInstance extends Omit<ByokInstance, 'apiKey'> {
  apiKeyEncrypted: string;
}
export type StoredConfig = Omit<Config, 'telegram' | 'line' | 'smtp' | 'byokInstances'> & {
  telegram: StoredTelegramConfig;
  line: StoredLineConfig;
  smtp: StoredSmtpConfig;
  byokInstances: StoredByokInstance[];
};

export const defaultStored: StoredConfig = {
  targetUrl: PROVIDER_URLS.gemini,
  hotkey: defaultMainHotkey(process.platform === 'darwin'),
  hotkeyEnabled: true,
  debounceMs: 1000,
  responseTimeout: 120_000,
  byokContextBudgetChars: 32_000,
  locale: 'en-US',
  localeSetByUser: false,
  theme: 'auto',
  syncSystemLanguageToModel: true,
  notifyOnComplete: true,
  notifyEvents: {
    chatComplete: true,
    chatFailure: true,
    flowSuccess: false,
    flowFailure: true,
  },
  metricsEnabled: true,
  closeToTray: false,
  closeActionDecided: false,
  launchAtStartup: false,
  layoutMode: 'stacked',
  markdownZoom: 100,
  showTokenUsage: true,
  captureSettings: {
    palette: DEFAULT_CAPTURE_PALETTE,
    backgroundStyle: DEFAULT_CAPTURE_BACKGROUND_STYLE,
    direction: 'se',
    showPrompt: true,
    showProvider: true,
    showTimestamp: true,
    showTokens: true,
    format: 'png' as CaptureFormat,
    cardLayout: 'document' as CardLayout,
    range: 'all' as CaptureRange,
    width: DEFAULT_CAPTURE_WIDTH,
    pixelRatio: 1,
    zip: false,
  },
  share: {
    instanceUrl: DEFAULT_SHARE_INSTANCE,
    expire: '1week',
    burnAfterReading: false,
    consentedAt: '',
  },
  quickExport: {
    enabled: true,
    hotkey: defaultQuickExportHotkey(process.platform === 'darwin'),
    format: 'png' as CaptureFormat,
    zip: false,
  },
  youtubePrompt: '',
  promptPreferences: {
    tone: 'default',
    length: 'auto',
    customInstructions: '',
    customTemplates: [],
    nickname: '',
  },
  providerCommands: {
    chatgpt: { enabled: true, command: '' },
    gemini: { enabled: true, command: '' },
    perplexity: { enabled: true, command: '' },
    duckai: { enabled: true, command: '', modelId: '' },
  },
  builtinCommands: {
    agent: { enabled: true, command: '', targetUrl: '' },
    search: { enabled: true, command: '', targetUrl: '' },
    askTtlMinutes: DEFAULT_AGENT_ASK_TTL_MINUTES,
  },
  botByokCommands: {},
  telegram: {
    enabled: false,
    botTokenEncrypted: '',
    allowGroupCommands: false,
    defaultReplyMode: 'markdown',
    compactReply: false,
    adminUserIds: [],
    llmDirect: { enabled: false, targetUrl: '' },
    pairing: { pendingCodes: [], pairedUsers: [] },
    channels: [],
  },
  line: {
    enabled: false,
    channelAccessTokenEncrypted: '',
    channelSecretEncrypted: '',
    port: 3007,
    llmDirect: { enabled: false, targetUrl: '' },
    pairing: { pendingCodes: [], pairedUsers: [] },
  },
  smtp: {
    enabled: false,
    host: '',
    port: 587,
    user: '',
    passwordEncrypted: '',
  },
  byokInstances: [],
  byokGroups: [],
  mcpServers: [],
  hiddenProviders: [],
  hiddenDuckaiModelIds: [],
  hiddenByokIds: [],
  hiddenByokGroupIds: [],
};
