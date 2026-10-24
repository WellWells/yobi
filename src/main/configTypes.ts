import { PROVIDER_URLS } from '../shared/types';
import { DEFAULT_CAPTURE_MARGIN, DEFAULT_CAPTURE_WIDTH, defaultMainHotkey, defaultQuickExportHotkey, defaultRegionHotkey } from '../shared/types';
import { DEFAULT_SHARE_INSTANCE } from '../shared/types';
import { DEFAULT_CAPTURE_BACKGROUND_STYLE, DEFAULT_CAPTURE_PALETTE } from '../shared/capturePalettes';
import { DEFAULT_AGENT_ASK_TTL_MINUTES } from '../shared/types';
import { bySiteFlag } from '../shared/siteConnectors';
import type { SiteConnectorFlag } from '../shared/siteConnectors';
import type { ShortcutOverride } from '../shared/shortcuts';
import type { MailAuthKind } from '../shared/microsoftMail';
import { EMPTY_GEMINI_CHOICE } from '../shared/geminiModels';
import type { GeminiModelCatalog, GeminiModelChoice } from '../shared/geminiModels';
import { EMPTY_CLAUDE_CHOICE } from '../shared/claudeModels';
import type { ClaudeModelCatalog, ClaudeModelChoice } from '../shared/claudeModels';
import { EMPTY_CHATGPT_CHOICE } from '../shared/chatgptModels';
import type { ChatgptModelCatalog, ChatgptModelChoice } from '../shared/chatgptModels';
import { BOT_PERMISSIONS_VERSION } from '../shared/botPermissions';
import type { BotGrant, BotGroupGrant } from '../shared/botPermissions';
import type { ReadingFont } from '../shared/readingPrefs';
import type { SidebarViewPrefs } from '../shared/sidebarView';
import { DEFAULT_DOWNLOADS_KEEP } from '../shared/downloads';
import type { DownloadsKeep } from '../shared/downloads';
import type { LinkRecognitionPrefs } from '../shared/linkRecognition';
import type { BotBuiltinCommands, BotByokCommands, BotLlmDirectConfig, BotProviderCommand, ByokGroup, ByokProviderType, CaptureFormat, CaptureRange, CaptureSettings, CardLayout, QuickExportSettings, LinePairingState, McpServerConfig, NotifyEventPrefs, PromptPreferences, Provider, ShareSettings, TelegramChannel, TelegramPairingState } from '../shared/types';

/**
 * The main window's last geometry. `x`/`y`/`width`/`height` are the *restored* rect even when
 * the window was maximized (Electron's `getNormalBounds()`), so un-maximizing after a restart
 * lands back where the user left it rather than at the default size.
 */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** Opt-ins of the sign-in site connectors, one per row of `shared/siteConnectors.ts` (`instagramConnectorEnabled`, …). */
type SiteConnectorFlags = Record<SiteConnectorFlag, boolean>;

export interface Config extends SiteConnectorFlags {
  targetUrl: string;
  /**
   * Which model the Flow Builder's "create with AI" uses. Deliberately NOT `targetUrl`: the chat
   * model is chosen for conversation, while this one only ever has to return a large JSON object,
   * and the provider that is best at one is often not the other. Empty means "whatever
   * `pickProvider` falls back to", which is how every existing install reads.
   */
  flowGenerateUrl: string;
  /** Which model tidies the personal memory. Empty follows the chat model. */
  memoryCurateUrl: string;
  /** Which model the writing tools (rewrite a selection) last used. Empty follows the chat model. */
  writingToolsUrl: string;
  /** Which editor the composer's Ctrl+G opens; see `ExternalEditorChoice`. */
  externalEditor: string;
  /** The command line for `externalEditor: 'custom'`. */
  externalEditorCommand: string;
  /** Empty = the ask hotkey is off. Older configs said so with `hotkeyEnabled: false`, migrated on load. */
  hotkey: string;
  /** Box a screen region and ask about it. Empty = off, like the other two OS hotkeys. */
  regionHotkey: string;
  shortcuts: Record<string, ShortcutOverride>;
  responseTimeout: number;
  byokContextBudgetChars: number;
  locale: string;
  localeSetByUser: boolean;
  theme: string;
  syncSystemLanguageToModel: boolean;
  notifyOnComplete: boolean;
  notifyEvents: NotifyEventPrefs;
  metricsEnabled: boolean;
  /** One-shot sends (flow steps, translations, searches) use the provider's temporary chat. */
  oneShotTemporaryChat: boolean;
  /** A chat or hotkey send the chosen web AI cannot take goes to the next signed-in one. */
  providerFallback: boolean;
  promptPreferences: PromptPreferences;
  youtubePrompt: string;
  providerCommands: Record<Provider, BotProviderCommand>;
  builtinCommands: BotBuiltinCommands;
  botByokCommands: BotByokCommands;
  telegram: TelegramConfig;
  line: LineConfig;
  discord: DiscordConfig;
  slack: SlackConfig;
  /**
   * The user's mailboxes, used by the Mail connector, the read-new-mail step and the email step.
   * Each signs in to SMTP and IMAP with its address and its own (app) password.
   */
  mailAccounts: MailAccountConfig[];
  /** The account new mail goes out from when nothing says otherwise; '' = the first one. */
  mailDefaultId: string;
  byokInstances: ByokInstance[];
  byokGroups: ByokGroup[];
  mcpServers: McpServerConfig[];
  /** Opt-in: let `/agent`, bots and flow connector steps use the mail account (the Mail connector). */
  mailEnabled: boolean;
  /** Opt-in: host the built-in LINE PC reader as an in-process MCP connector. */
  lineReaderEnabled: boolean;
  /** Opt-in: relay the Thunderbird MCP add-on through an in-process MCP connector. */
  thunderbirdEnabled: boolean;
  /** Opt-in: let `/agent` search and read X through an in-process MCP connector. */
  xConnectorEnabled: boolean;
  /**
   * The Taiwan rail connector. null = not decided yet: the first launch decides from the system
   * language (on for Taiwan Chinese) and stores it; after that only the user changes it.
   */
  taiwanRailEnabled: boolean | null;
  /** The PTT connector; null = not decided yet, decided once like `taiwanRailEnabled`. */
  pttConnectorEnabled: boolean | null;
  /**
   * The "Recognize links" switches the user turned. A group not in here follows the region's
   * default every time it is read (`resolveLinkRecognition`), so a language change moves it.
   */
  linkRecognition: LinkRecognitionPrefs;
  hiddenProviders: Provider[];
  hiddenByokIds: string[];
  hiddenByokGroupIds: string[];
  /** Yobi's one Gemini setting; the page is switched to match it before every send. */
  geminiModel: GeminiModelChoice;
  /** Gemini's model picker as it was last read — the cache the model menu draws from. */
  geminiModelCatalog: GeminiModelCatalog | null;
  /** Yobi's one Claude setting (model, effort, thinking); the page is matched to it before every send. */
  claudeModel: ClaudeModelChoice;
  /** The models this Claude account can select, as last read from its picker. */
  claudeModelCatalog: ClaudeModelCatalog | null;
  /** Yobi's one ChatGPT setting (model, effort, thinking); the page is matched to it before every send. */
  chatgptModel: ChatgptModelChoice;
  /** The models, effort steps or thinking toggle this ChatGPT account offers, as last read. */
  chatgptModelCatalog: ChatgptModelCatalog | null;
  closeToTray: boolean;
  closeActionDecided: boolean;
  launchAtStartup: boolean;
  layoutMode: 'stacked' | 'side-by-side';
  markdownZoom: number;
  /** The reading column's typeface; the UI keeps its own font. */
  readingFont: ReadingFont;
  /** No maximum width on the reading column. */
  readingFullWidth: boolean;
  /** How the conversation list is sorted and whether it is grouped by date. */
  sidebarView: SidebarViewPrefs;
  showTokenUsage: boolean;
  /** Where the main window was last left. `null` until the first run has produced one. */
  windowBounds: WindowBounds | null;
  captureSettings: CaptureSettings;
  quickExport: QuickExportSettings;
  share: ShareSettings;
  /** How long Downloads/Yobi keeps what Yobi saved there; the sweep reads it every time. */
  downloadsKeep: DownloadsKeep;
}

export interface ByokInstance {
  id: string;
  name: string;
  providerType: ByokProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * What every bot platform keeps about who may use it and how it answers, under the same names, so
 * permission code reads `config[platform]` instead of choosing between platforms by hand.
 */
export interface BotAccessConfig {
  enabled: boolean;
  llmDirect: BotLlmDirectConfig;
  pairing: { pairedUsers: Array<{ userId: string | number }> };
  /** Per-account grants, keyed by the stringified user id. No entry means no grants. */
  permissions: Record<string, BotGrant[]>;
  /** Missing on configs written before per-account grants; set once the migration has run. */
  permissionsVersion?: number;
  /** Copied into an account's grants when it pairs with a code; never shell or admin. */
  defaultGrants: BotGrant[];
  /**
   * What each group the owner allowed grants everyone in it, paired or not, keyed by chat id. No
   * entry means the group waits for approval and the bot does nothing there; an empty list means
   * allowed, granting everyone nothing.
   */
  groupPermissions: Record<string, BotGroupGrant[]>;
  /** People the owner blocked (user ids): every message of theirs is ignored. */
  blockedUsers: string[];
}

export interface TelegramConfig extends BotAccessConfig {
  enabled: boolean;
  botToken: string;
  /**
   * my.telegram.org app credentials the bot signs in with over MTProto to send files over the
   * Bot API's 50 MB upload limit. 0 / '' = not set (big files are not sent).
   */
  apiId: number;
  apiHash: string;
  allowGroupCommands: boolean;
  defaultReplyMode: 'markdown' | 'png' | 'webp' | 'pdf';
  compactReply: boolean;
  /**
   * Mirror of the accounts holding the `admin` grant, written on every change so an older build
   * still finds its admins. Read only by the one-time permissions migration.
   */
  adminUserIds: number[];
  llmDirect: BotLlmDirectConfig;
  pairing: TelegramPairingState;
  channels: TelegramChannel[];
  /** Per-account grants, keyed by the stringified Telegram user id. No entry means no grants. */
  permissions: Record<string, BotGrant[]>;
  /** Missing on configs written before per-account grants; set once the migration has run. */
  permissionsVersion?: number;
  /** Copied into an account's grants when it pairs with a code; never shell or admin. */
  defaultGrants: BotGrant[];
  /**
   * What each group the owner allowed grants everyone in it, paired or not, keyed by chat id. No
   * entry means the group waits for approval and the bot does nothing there; an empty list means
   * allowed, granting everyone nothing.
   */
  groupPermissions: Record<string, BotGroupGrant[]>;
  /** People the owner blocked (user ids): every message of theirs is ignored. */
  blockedUsers: string[];
}

export interface LineConfig extends BotAccessConfig {
  enabled: boolean;
  channelAccessToken: string;
  channelSecret: string;
  port: number;
  llmDirect: BotLlmDirectConfig;
  pairing: LinePairingState;
  /** Per-account grants, keyed by the LINE user id. No entry means no grants. */
  permissions: Record<string, BotGrant[]>;
  /** Missing on configs written before per-account grants; set once the migration has run. */
  permissionsVersion?: number;
  /** Copied into an account's grants when it pairs with a code; never shell. */
  defaultGrants: BotGrant[];
  /** What each allowed group or room grants everyone in it, keyed by its id. No entry = waits for approval. */
  groupPermissions: Record<string, BotGroupGrant[]>;
  /** People the owner blocked (user ids): every message of theirs is ignored. */
  blockedUsers: string[];
}

/** A socket platform (`SocketBotPlatform`): pairing with a code, string ids, like LINE without the webhook. */
export interface SocketBotConfig extends BotAccessConfig {
  pairing: LinePairingState;
}

export interface DiscordConfig extends SocketBotConfig {
  /** The bot user's token (Developer Portal › Bot). */
  botToken: string;
}

export interface SlackConfig extends SocketBotConfig {
  /** The bot token (`xoxb-…`, OAuth & Permissions). */
  botToken: string;
  /** The app-level token with `connections:write` (`xapp-…`, Basic Information): opens Socket Mode. */
  appToken: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface ImapConfig {
  host: string;
  port: number;
}

export interface MailAccountConfig {
  /** Short and stable: message ids the model passes around start with it. */
  id: string;
  /** The address, which is also the sign-in name for both servers. */
  address: string;
  /** How it signs in. For `microsoft`, `password` holds the refresh token (stored encrypted the same way). */
  auth: MailAuthKind;
  password: string;
  smtp: { host: string; port: number };
  /** Blank host = the server the address implies (`mailProviders.ts`), or none (send only). */
  imap: ImapConfig;
}

export interface StoredTelegramConfig extends Omit<TelegramConfig, 'botToken' | 'apiHash'> {
  botTokenEncrypted: string;
  apiHashEncrypted: string;
}
export interface StoredLineConfig extends Omit<LineConfig, 'channelAccessToken' | 'channelSecret'> {
  channelAccessTokenEncrypted: string;
  channelSecretEncrypted: string;
}
export interface StoredDiscordConfig extends Omit<DiscordConfig, 'botToken'> {
  botTokenEncrypted: string;
}
export interface StoredSlackConfig extends Omit<SlackConfig, 'botToken' | 'appToken'> {
  botTokenEncrypted: string;
  appTokenEncrypted: string;
}
export interface StoredSmtpConfig extends Omit<SmtpConfig, 'password'> {
  passwordEncrypted: string;
}
export interface StoredByokInstance extends Omit<ByokInstance, 'apiKey'> {
  apiKeyEncrypted: string;
}
export interface StoredMailAccount extends Omit<MailAccountConfig, 'password'> {
  passwordEncrypted: string;
}
export type StoredConfig = Omit<Config, 'telegram' | 'line' | 'discord' | 'slack' | 'byokInstances' | 'mailAccounts'> & {
  telegram: StoredTelegramConfig;
  line: StoredLineConfig;
  discord: StoredDiscordConfig;
  slack: StoredSlackConfig;
  byokInstances: StoredByokInstance[];
  mailAccounts: StoredMailAccount[];
  /** Before 2026-10-23 there was one account: read once to move it into `mailAccounts`, then dropped. */
  smtp?: StoredSmtpConfig;
  imap?: ImapConfig;
};

export const defaultStored: StoredConfig = {
  targetUrl: PROVIDER_URLS.gemini,
  flowGenerateUrl: '',
  memoryCurateUrl: '',
  writingToolsUrl: '',
  externalEditor: '',
  externalEditorCommand: '',
  hotkey: defaultMainHotkey(process.platform === 'darwin'),
  regionHotkey: defaultRegionHotkey(process.platform === 'darwin'),
  shortcuts: {},
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
  oneShotTemporaryChat: true,
  providerFallback: true,
  closeToTray: false,
  closeActionDecided: false,
  launchAtStartup: false,
  layoutMode: 'stacked',
  markdownZoom: 100,
  readingFont: 'default',
  readingFullWidth: false,
  sidebarView: { sort: 'activity', groupByDate: true },
  showTokenUsage: true,
  windowBounds: null,
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
    margin: DEFAULT_CAPTURE_MARGIN,
    pixelRatio: 1,
    zip: false,
  },
  share: {
    instanceUrl: DEFAULT_SHARE_INSTANCE,
    expire: '1week',
    burnAfterReading: false,
    consentedAt: '',
    instanceExpires: null,
  },
  quickExport: {
    hotkey: defaultQuickExportHotkey(process.platform === 'darwin'),
    format: 'png' as CaptureFormat,
    zip: false,
  },
  youtubePrompt: '',
  promptPreferences: {
    tone: 'default',
    length: 'auto',
    customInstructions: '',
    nickname: '',
  },
  providerCommands: {
    chatgpt: { enabled: true, command: '' },
    claude: { enabled: true, command: '' },
    gemini: { enabled: true, command: '' },
    perplexity: { enabled: true, command: '' },
  },
  builtinCommands: {
    search: { enabled: true, command: '', targetUrl: '' },
    askTtlMinutes: DEFAULT_AGENT_ASK_TTL_MINUTES,
  },
  botByokCommands: {},
  telegram: {
    enabled: false,
    botTokenEncrypted: '',
    apiId: 0,
    apiHashEncrypted: '',
    allowGroupCommands: false,
    defaultReplyMode: 'markdown',
    compactReply: false,
    adminUserIds: [],
    llmDirect: { targetUrl: '' },
    pairing: { pendingCodes: [], pairedUsers: [] },
    channels: [],
    permissions: {},
    permissionsVersion: BOT_PERMISSIONS_VERSION,
    defaultGrants: [],
    groupPermissions: {},
    blockedUsers: [],
  },
  line: {
    enabled: false,
    channelAccessTokenEncrypted: '',
    channelSecretEncrypted: '',
    port: 3007,
    llmDirect: { targetUrl: '' },
    pairing: { pendingCodes: [], pairedUsers: [] },
    permissions: {},
    permissionsVersion: BOT_PERMISSIONS_VERSION,
    defaultGrants: [],
    groupPermissions: {},
    blockedUsers: [],
  },
  discord: {
    enabled: false,
    botTokenEncrypted: '',
    llmDirect: { targetUrl: '' },
    pairing: { pendingCodes: [], pairedUsers: [] },
    permissions: {},
    permissionsVersion: BOT_PERMISSIONS_VERSION,
    defaultGrants: [],
    groupPermissions: {},
    blockedUsers: [],
  },
  slack: {
    enabled: false,
    botTokenEncrypted: '',
    appTokenEncrypted: '',
    llmDirect: { targetUrl: '' },
    pairing: { pendingCodes: [], pairedUsers: [] },
    permissions: {},
    permissionsVersion: BOT_PERMISSIONS_VERSION,
    defaultGrants: [],
    groupPermissions: {},
    blockedUsers: [],
  },
  mailAccounts: [],
  mailDefaultId: '',
  byokInstances: [],
  byokGroups: [],
  mcpServers: [],
  mailEnabled: false,
  lineReaderEnabled: false,
  thunderbirdEnabled: false,
  xConnectorEnabled: false,
  taiwanRailEnabled: null,
  pttConnectorEnabled: null,
  linkRecognition: {},
  ...bySiteFlag(() => false),
  hiddenProviders: [],
  hiddenByokIds: [],
  hiddenByokGroupIds: [],
  geminiModel: EMPTY_GEMINI_CHOICE,
  geminiModelCatalog: null,
  claudeModel: EMPTY_CLAUDE_CHOICE,
  claudeModelCatalog: null,
  chatgptModel: EMPTY_CHATGPT_CHOICE,
  chatgptModelCatalog: null,
  downloadsKeep: DEFAULT_DOWNLOADS_KEEP,
};
