import { PROVIDER_URLS } from '../shared/types';
import type { BotLlmDirectConfig, BotProviderCommand, ByokGroup, ByokProviderType, CaptureFormat, CaptureSettings, LinePairingState, NotifyEventPrefs, PromptPreferences, Provider, TelegramPairingState } from '../shared/types';

export interface Config {
  targetUrl: string;
  hotkey: string;
  debounceMs: number;
  responseTimeout: number;
  locale: string;
  localeSetByUser: boolean;
  theme: string;
  syncSystemLanguageToModel: boolean;
  notifyOnComplete: boolean;
  notifyEvents: NotifyEventPrefs;
  metricsEnabled: boolean;
  promptPreferences: PromptPreferences;
  youtubePrompt: string;
  // Slash commands for the built-in AI providers, shared by every bot platform.
  providerCommands: Record<Provider, BotProviderCommand>;
  telegram: TelegramConfig;
  line: LineConfig;
  smtp: SmtpConfig;
  byokInstances: ByokInstance[];
  byokGroups: ByokGroup[];
  // Model sources hidden from the pickers. Display-only; no execution path reads these.
  hiddenProviders: Provider[];
  hiddenDuckaiModelIds: string[];
  hiddenByokIds: string[];
  hiddenByokGroupIds: string[];
  closeToTray: boolean;
  closeActionDecided: boolean;
  launchAtStartup: boolean;
  layoutMode: 'stacked' | 'side-by-side';
  markdownZoom: number;
  captureSettings: CaptureSettings;
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
  // Reply with the AI answer alone — no header, no saved-file line, no export
  // buttons — the way the LINE bot always answers. Overrides defaultReplyMode.
  compactReply: boolean;
  adminUserIds: number[];
  llmDirect: BotLlmDirectConfig;
  pairing: TelegramPairingState;
}

// LINE bot config. Two secrets: channelAccessToken (calling the Messaging API to
// push) and channelSecret (verifying X-Line-Signature on incoming webhooks). Both
// held in memory as plaintext, persisted encrypted (StoredLineConfig).
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
  hotkey: process.platform === 'darwin' ? 'Command+G' : 'Alt+G',
  debounceMs: 1000,
  responseTimeout: 120_000,
  locale: 'en-US',
  localeSetByUser: false,
  theme: 'auto',
  syncSystemLanguageToModel: true,
  notifyOnComplete: true,
  // Flow success is opt-in by default: cron-triggered flows would otherwise
  // spam a notification on every scheduled run.
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
  captureSettings: {
    palette: 'aurora',
    direction: 'se',
    showPrompt: false,
    showProvider: true,
    showTimestamp: true,
    format: 'png' as CaptureFormat,
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
  telegram: {
    enabled: false,
    botTokenEncrypted: '',
    allowGroupCommands: false,
    defaultReplyMode: 'markdown',
    compactReply: false,
    adminUserIds: [],
    llmDirect: { enabled: false, targetUrl: '' },
    pairing: { pendingCodes: [], pairedUsers: [] },
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
  hiddenProviders: [],
  hiddenDuckaiModelIds: [],
  hiddenByokIds: [],
  hiddenByokGroupIds: [],
};
