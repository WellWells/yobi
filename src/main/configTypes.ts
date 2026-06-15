import { PROVIDER_URLS } from '../shared/types';
import type { CaptureFormat, CaptureSettings, PromptPreferences, Provider, TelegramPairingState, TelegramProviderCommand } from '../shared/types';

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
  promptPreferences: PromptPreferences;
  youtubePrompt: string;
  telegram: TelegramConfig;
  smtp: SmtpConfig;
  closeToTray: boolean;
  closeActionDecided: boolean;
  launchAtStartup: boolean;
  layoutMode: 'stacked' | 'side-by-side';
  markdownZoom: number;
  captureSettings: CaptureSettings;
}

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  allowGroupCommands: boolean;
  defaultReplyMode: 'markdown' | 'png' | 'webp' | 'pdf';
  adminUserIds: number[];
  providerCommands: Record<Provider, TelegramProviderCommand>;
  pairing: TelegramPairingState;
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
export interface StoredSmtpConfig extends Omit<SmtpConfig, 'password'> {
  passwordEncrypted: string;
}
export type StoredConfig = Omit<Config, 'telegram' | 'smtp'> & {
  telegram: StoredTelegramConfig;
  smtp: StoredSmtpConfig;
};

export const defaultStored: StoredConfig = {
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
  telegram: {
    enabled: false,
    botTokenEncrypted: '',
    allowGroupCommands: false,
    defaultReplyMode: 'markdown',
    adminUserIds: [],
    providerCommands: {
      chatgpt: { enabled: true, command: '' },
      gemini: { enabled: true, command: '' },
      perplexity: { enabled: true, command: '' },
      duckai: { enabled: true, command: '', modelId: '' },
    },
    pairing: { pendingCodes: [], pairedUsers: [] },
  },
  smtp: {
    enabled: false,
    host: '',
    port: 587,
    user: '',
    passwordEncrypted: '',
  },
};
