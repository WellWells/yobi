export interface DuckaiModelInfo {
  id: string;
  label: string;
  isActive: boolean;
}

export const PROVIDER_URLS = {
  gemini: 'https://gemini.google.com/',
  perplexity: 'https://www.perplexity.ai/',
  chatgpt: 'https://chatgpt.com/',
  duckai: 'https://duck.ai/',
} as const;

export type Provider = keyof typeof PROVIDER_URLS;

export const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  chatgpt: 'ChatGPT',
  duckai: 'Duck AI',
} as const;

export const PROVIDERS = ['chatgpt', 'gemini', 'perplexity', 'duckai'] as const;

export const AUTH_PROVIDERS = ['chatgpt', 'gemini', 'perplexity'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

// Providers whose web UI refuses to answer without a signed-in account. Gemini answers
// anonymously (sign-in only unlocks uploads) and Duck AI needs no account at all, so a
// missing session there is not an error — they stay out of this list.
export const LOGIN_REQUIRED_PROVIDERS = ['chatgpt', 'perplexity'] as const;
export type LoginRequiredProvider = (typeof LOGIN_REQUIRED_PROVIDERS)[number];

// Model picks carry the exact PROVIDER_URLS value (the picker resolves anything else back
// to a built-in), so exact match is the same identity test the picker itself uses.
// Returns null for models that work without an account: Gemini, Duck AI, BYOK.
export function loginRequiredProviderForUrl(url: string): LoginRequiredProvider | null {
  return LOGIN_REQUIRED_PROVIDERS.find((provider) => PROVIDER_URLS[provider] === url) ?? null;
}

export const DEFAULT_PROVIDER_COMMANDS: Record<Provider, string> = {
  chatgpt: 'gpt',
  gemini: 'gemini',
  perplexity: 'pplx',
  duckai: 'duck',
} as const;

export const BOT_COMMAND_RE = /^[a-z][a-z0-9_]{0,31}$/;

export function buildDuckaiModelUrl(modelId: string): string {
  const url = new URL(PROVIDER_URLS.duckai);
  url.searchParams.set('model', modelId);
  return url.toString();
}

export function duckaiModelIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes('duck.ai')) return null;
    return parsed.searchParams.get('model');
  } catch {
    return null;
  }
}

export function providerFromUrl(url: string): Provider {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('perplexity.ai')) return 'perplexity';
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
    if (host.includes('duck.ai')) return 'duckai';
  } catch {
  }
  return 'gemini';
}

// Provider type is purely a UI convenience (display label + base-URL prefill +
// model placeholder) — the call path is identical OpenAI-compatible HTTP for
// every instance, so a specific vendor is never elevated. 'openai' is the
// generic type covering OpenAI, OpenRouter, Together, Groq, local servers, etc.;
// 'gemini' exists only because its base URL is worth prefilling.
export const BYOK_PROVIDER_TYPES = ['openai', 'gemini'] as const;
export type ByokProviderType = (typeof BYOK_PROVIDER_TYPES)[number];

export const BYOK_PROVIDER_TYPE_LABELS: Record<ByokProviderType, string> = {
  openai: 'OpenAI-compatible',
  gemini: 'Gemini API',
} as const;

export const BYOK_DEFAULT_BASE_URLS: Record<ByokProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
} as const;

// BYOK instances ride the existing "provider = URL string" selection mechanism
// via a synthetic scheme. Both hostname sniffers (providerFromUrl/detectProvider)
// fall back to 'gemini' for unknown URLs, so every consumer must check isByokUrl
// BEFORE sniffing. Parsed by hand: WHATWG URL host parsing for non-special
// schemes is not something we want to depend on.
const BYOK_URL_PREFIX = 'byok://';

export function buildByokUrl(instanceId: string): string {
  return `${BYOK_URL_PREFIX}${instanceId}/`;
}

export function isByokUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith(BYOK_URL_PREFIX);
}

export function byokIdFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith(BYOK_URL_PREFIX)) return null;
  const id = trimmed.slice(BYOK_URL_PREFIX.length).split(/[/?#]/, 1)[0]?.trim();
  return id ? id : null;
}

// A group of BYOK keys selected for round-robin rotation rides the same
// "provider = URL string" mechanism as single keys, via its own synthetic scheme.
// 'byokgroup://' is deliberately NOT a prefix of 'byok://' (…group… vs …://…), so
// isByokUrl / byokIdFromUrl never match a group url and vice versa.
const BYOK_GROUP_URL_PREFIX = 'byokgroup://';

export function buildByokGroupUrl(groupId: string): string {
  return `${BYOK_GROUP_URL_PREFIX}${groupId}/`;
}

export function isByokGroupUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith(BYOK_GROUP_URL_PREFIX);
}

export function byokGroupIdFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith(BYOK_GROUP_URL_PREFIX)) return null;
  const id = trimmed.slice(BYOK_GROUP_URL_PREFIX.length).split(/[/?#]/, 1)[0]?.trim();
  return id ? id : null;
}

// True for any target that must route through the BYOK HTTP path — a single key
// OR a group — instead of browser automation. Every place that used isByokUrl to
// mean "this is a BYOK target, don't hostname-sniff / don't load a page" must use
// this so groups are handled identically to single keys.
export function isByokTargetUrl(url: string): boolean {
  return isByokUrl(url) || isByokGroupUrl(url);
}

// Model sources the user has hidden from every picker. Display-only: no execution
// path in the main process consults this.
export interface HiddenSources {
  providers: Provider[];
  duckaiModelIds: string[];
  byokIds: string[];
  byokGroupIds: string[];
}

// Order matters. The two BYOK branches must precede the providerFromUrl fallback:
// that helper matches on hostname, and 'byok://<id>' parses to an empty hostname, so
// it falls through to its 'gemini' default. Reach the last line with a BYOK url and
// hiding Gemini silently hides every key the user owns. A BYOK source is hidden only
// by its own id, never by a provider.
export function isModelUrlHidden(url: string, hidden: HiddenSources): boolean {
  const byokId = byokIdFromUrl(url);
  if (byokId !== null) return hidden.byokIds.includes(byokId);
  const byokGroupId = byokGroupIdFromUrl(url);
  if (byokGroupId !== null) return hidden.byokGroupIds.includes(byokGroupId);
  const duckaiModelId = duckaiModelIdFromUrl(url);
  if (duckaiModelId !== null) {
    return hidden.providers.includes('duckai') || hidden.duckaiModelIds.includes(duckaiModelId);
  }
  return hidden.providers.includes(providerFromUrl(url));
}

export interface ByokInstanceSnapshot {
  id: string;
  name: string;
  providerType: ByokProviderType;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keyPreview: string;
}

// Persisted group definition — holds no secrets, only references key ids.
export interface ByokGroup {
  id: string;
  name: string;
  memberIds: string[];
}

export interface ByokGroupSnapshot {
  id: string;
  name: string;
  // Only ids that still reference an existing key (dangling members pruned) —
  // the count/badges the UI shows always match keys that actually exist.
  memberIds: string[];
}

export interface ByokGroupSaveRequest {
  id?: string;
  name: string;
  memberIds: string[];
}

export interface ByokSettingsSnapshot {
  instances: ByokInstanceSnapshot[];
  groups: ByokGroupSnapshot[];
}

export interface ByokInstanceSaveRequest {
  id?: string;
  name: string;
  providerType: ByokProviderType;
  baseUrl: string;
  model: string;
  apiKey: string;
}

// Probe an endpoint before/without saving. apiKey may be blank when editing an
// existing instance (id set) — main falls back to the stored key.
export interface ByokConnectionProbe {
  id?: string;
  name?: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
}

export interface ByokModelsResult {
  ok: boolean;
  models: string[];
  message?: string;
}

export interface ByokTestResult {
  ok: boolean;
  reply?: string;
  message?: string;
}

export interface PromptAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  path: string;
  previewUrl?: string;
}

export interface ProviderAttachmentPolicy {
  maxFiles: number;
}

export const PROVIDER_ATTACHMENT_POLICIES: Record<Provider, ProviderAttachmentPolicy> = {
  gemini: { maxFiles: 10 },
  chatgpt: { maxFiles: 0 },
  perplexity: { maxFiles: 0 },
  duckai: { maxFiles: 0 },
};

export const IPC = {
  LOG: 'log',
  STATUS: 'status',
  QUEUE_UPDATE: 'queue:update',
  UPDATE_AVAILABLE: 'update:available',
  UPDATE_NOT_AVAILABLE: 'update:not-available',
  UPDATE_ERROR: 'update:error',
  FILE_LIST: 'file:list',
  FILE_CONTENT: 'file:content',
  UI_NOTIFICATION: 'ui:notification',
  HOTKEY_CHANGED: 'hotkey:changed',
  TELEGRAM_RUNTIME: 'telegram:runtime',
  LINE_RUNTIME: 'line:runtime',
  ACCOUNT_STATUS_CHANGED: 'account:status-changed',

  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  SHOW_WORKER: 'show-worker',
  HIDE_WORKER: 'hide-worker',
  GET_ACCOUNT_STATUSES: 'account:get-statuses',
  OPEN_ACCOUNT_LOGIN: 'account:open-login',
  ACCOUNT_LOGOUT: 'account:logout',
  PROVIDER_CLEAR_DATA: 'provider:clear-data',
  UPDATE_CHECK: 'update:check',
  GET_UPDATE_SOURCE: 'update:get-source',
  GET_FILE_LIST: 'file:get-list',
  SEARCH_FILE_LIST: 'file:search',
  GET_FILE_CONTENT: 'file:get-content',
  DELETE_FILE: 'file:delete',
  DELETE_FILES: 'file:delete-many',
  DELETE_ALL_FILES: 'file:delete-all',
  UPDATE_FILE_TITLE: 'file:update-title',
  UPDATE_FILE_H1: 'file:update-h1',
  UPDATE_HOTKEY: 'hotkey:update',
  GET_HOTKEY: 'hotkey:get',
  SET_HOTKEY_PAUSED: 'hotkey:set-paused',
  GET_AI_URL: 'ai:get-url',
  UPDATE_AI_URL: 'ai:update-url',
  GET_HIDDEN_SOURCES: 'sources:get-hidden',
  UPDATE_HIDDEN_SOURCES: 'sources:update-hidden',
  GET_LANGUAGE_LIST: 'language:get-list',
  GET_LANGUAGE_CONTENT: 'language:get-content',
  GET_CURRENT_LOCALE: 'language:get-current',
  SET_CURRENT_LOCALE: 'language:set-current',
  SET_LOCALE_AUTO: 'language:set-auto',
  OPEN_THIRD_PARTY_LICENSES: 'license:open-third-party',
  OPEN_EXTERNAL_URL: 'url:open-external',
  TRIGGER_PROMPT: 'prompt:trigger',
  TRIGGER_PROMPT_WITH_OPTIONS: 'prompt:trigger-with-options',
  GET_SYNC_SYSTEM_LANGUAGE_TO_MODEL: 'prompt:get-sync-system-language-to-model',
  UPDATE_SYNC_SYSTEM_LANGUAGE_TO_MODEL: 'prompt:update-sync-system-language-to-model',
  GET_NOTIFY_ON_COMPLETE: 'notify:get-on-complete',
  UPDATE_NOTIFY_ON_COMPLETE: 'notify:update-on-complete',
  RESET_SETTINGS: 'settings:reset',
  SHOW_IN_FOLDER: 'file:show-in-folder',
  OPEN_PATH: 'file:open-path',
  CAPTURE_MARKDOWN_IMAGE: 'markdown:capture-image',
  CANCEL_QUEUE_TASK: 'queue:cancel-task',
  FORCE_SKIP_ACTIVE_TASK: 'queue:force-skip-active',
  COPY_TEXT_TO_CLIPBOARD: 'clipboard:write-text',
  GET_TELEGRAM_SETTINGS: 'telegram:get-settings',
  UPDATE_TELEGRAM_ENABLED: 'telegram:update-enabled',
  UPDATE_TELEGRAM_BOT_TOKEN: 'telegram:update-bot-token',
  UPDATE_TELEGRAM_ALLOW_GROUP_COMMANDS: 'telegram:update-allow-group-commands',
  UPDATE_TELEGRAM_DEFAULT_REPLY_MODE: 'telegram:update-default-reply-mode',
  UPDATE_TELEGRAM_COMPACT_REPLY: 'telegram:update-compact-reply',
  UPDATE_TELEGRAM_ADMIN_USERS: 'telegram:update-admin-users',
  UPDATE_TELEGRAM_LLM_DIRECT: 'telegram:update-llm-direct',
  GET_BOT_PROVIDER_COMMANDS: 'bot:get-provider-commands',
  UPDATE_BOT_PROVIDER_COMMANDS: 'bot:update-provider-commands',
  GENERATE_TELEGRAM_PAIRING_CODE: 'telegram:generate-pairing-code',
  REVOKE_TELEGRAM_PAIRING_CODE: 'telegram:revoke-pairing-code',
  UNPAIR_TELEGRAM_USER: 'telegram:unpair-user',
  GET_LINE_SETTINGS: 'line:get-settings',
  UPDATE_LINE_ENABLED: 'line:update-enabled',
  UPDATE_LINE_CREDENTIALS: 'line:update-credentials',
  UPDATE_LINE_PORT: 'line:update-port',
  UPDATE_LINE_LLM_DIRECT: 'line:update-llm-direct',
  GENERATE_LINE_PAIRING_CODE: 'line:generate-pairing-code',
  REVOKE_LINE_PAIRING_CODE: 'line:revoke-pairing-code',
  UNPAIR_LINE_USER: 'line:unpair-user',
  REFRESH_LINE_ACCOUNT: 'line:refresh-account',
  GET_EMAIL_SETTINGS: 'email:get-settings',
  UPDATE_EMAIL_ENABLED: 'email:update-enabled',
  UPDATE_EMAIL_CREDENTIALS: 'email:update-credentials',
  GET_PROMPT_PREFERENCES: 'prompt:get-preferences',
  UPDATE_PROMPT_PREFERENCES: 'prompt:update-preferences',
  GET_YOUTUBE_PROMPT: 'youtube:get-prompt',
  UPDATE_YOUTUBE_PROMPT: 'youtube:update-prompt',
  GET_RESPONSE_TIMEOUT: 'response:get-timeout',
  UPDATE_RESPONSE_TIMEOUT: 'response:update-timeout',
  GET_APP_VERSION: 'app:get-version',
  GET_APP_ICON_DATA_URL: 'app:get-icon-data-url',
  GET_CLOSE_TO_TRAY: 'tray:get-close-to-tray',
  UPDATE_CLOSE_TO_TRAY: 'tray:update-close-to-tray',
  GET_LAUNCH_AT_STARTUP: 'startup:get-launch',
  UPDATE_LAUNCH_AT_STARTUP: 'startup:update-launch',
  LAUNCH_AT_STARTUP_CHANGED: 'startup:launch-changed',
  NOTIFY_ON_COMPLETE_CHANGED: 'notify:on-complete-changed',
  DUCKAI_FETCH_MODELS: 'duckai:fetch-models',
  BYOK_GET_SETTINGS: 'byok:get-settings',
  BYOK_SAVE_INSTANCE: 'byok:save-instance',
  BYOK_DELETE_INSTANCE: 'byok:delete-instance',
  BYOK_LIST_MODELS: 'byok:list-models',
  BYOK_TEST_INSTANCE: 'byok:test-instance',
  BYOK_SAVE_GROUP: 'byok:save-group',
  BYOK_DELETE_GROUP: 'byok:delete-group',
  NAVIGATE_SETTINGS: 'navigate:settings',
  SHOW_CLOSE_DIALOG: 'close-dialog:show',
  RESPOND_CLOSE_DIALOG: 'close-dialog:respond',
  CLOSE_TO_TRAY_CHANGED: 'tray:close-to-tray-changed',
  GET_THEME: 'theme:get',
  UPDATE_THEME: 'theme:update',
  THEME_CHANGED: 'theme:changed',
  GET_LAYOUT_MODE: 'ui:get-layout-mode',
  UPDATE_LAYOUT_MODE: 'ui:update-layout-mode',
  GET_MARKDOWN_ZOOM: 'ui:get-markdown-zoom',
  UPDATE_MARKDOWN_ZOOM: 'ui:update-markdown-zoom',
  GET_CAPTURE_SETTINGS: 'capture:get-settings',
  UPDATE_CAPTURE_SETTINGS: 'capture:update-settings',
  OPEN_CONFIG_DIR: 'config:open-dir',
  BACKUP_CATEGORIES: 'backup:categories',
  BACKUP_EXPORT: 'backup:export',
  BACKUP_INSPECT: 'backup:inspect',
  BACKUP_IMPORT: 'backup:import',
  SELECT_PATH: 'dialog:select-path',
  FLOW_GET_ALL: 'flow:get-all',
  FLOW_SAVE: 'flow:save',
  FLOW_DELETE: 'flow:delete',
  FLOW_DELETE_MANY: 'flow:delete-many',
  FLOW_SET_ENABLED_MANY: 'flow:set-enabled-many',
  FLOW_DUPLICATE: 'flow:duplicate',
  FLOW_MOVE: 'flow:move',
  FLOW_REORDER: 'flow:reorder',
  FLOW_EXECUTE: 'flow:execute',
  FLOW_RUN_CHAT_COMMAND: 'flow:run-chat-command',
  FLOW_ABORT: 'flow:abort',
  FLOW_GENERATE: 'flow:generate',
  FLOW_EXECUTION_LOG: 'flow:execution-log',
  FLOW_EXECUTION_STARTED: 'flow:execution-started',
  FLOW_EXECUTION_ENDED: 'flow:execution-ended',
  FLOW_EXPORT: 'flow:export',
  FLOW_EXPORT_RESULT: 'flow:export-result',
  RSS_HAS_CHECKPOINT: 'rss:has-checkpoint',
  RSS_CLEAR_CHECKPOINT: 'rss:clear-checkpoint',
  RSS_DISCOVER_FEED: 'rss:discover-feed',
  SCRAPER_HAS_CHECKPOINT: 'scraper:has-checkpoint',
  SCRAPER_CLEAR_CHECKPOINT: 'scraper:clear-checkpoint',
  YT_SUBS_HAS_CHECKPOINT: 'youtube-subs:has-checkpoint',
  YT_SUBS_CLEAR_CHECKPOINT: 'youtube-subs:clear-checkpoint',
  CAPTURE_PAGE: 'browser:capture-page',
  METRICS_GET: 'metrics:get',
  METRICS_RESET: 'metrics:reset',
  METRICS_CHANGED: 'metrics:changed',
  GET_METRICS_ENABLED: 'metrics:get-enabled',
  UPDATE_METRICS_ENABLED: 'metrics:update-enabled',
  GET_NOTIFY_EVENTS: 'notify:get-events',
  UPDATE_NOTIFY_EVENTS: 'notify:update-events',
  TEMP_CHAT_GET_MODE: 'temp-chat:get-mode',
  TEMP_CHAT_SET_MODE: 'temp-chat:set-mode',
  TEMP_CHAT_MODE_CHANGED: 'temp-chat:mode-changed',
  TEMP_CHAT_RESULT: 'temp-chat:result',
} as const;

// In-memory reply payload for temporary chat mode — replaces the .md file that
// would normally be written and broadcast via FILE_LIST.
export interface TempChatResult {
  content: string;
}

// Per-event notification switches, checked at each send site in addition to
// the master notifyOnComplete gate inside sendWebNotification.
export interface NotifyEventPrefs {
  chatComplete: boolean;
  chatFailure: boolean;
  flowSuccess: boolean;
  flowFailure: boolean;
}

// --- Local usage metrics (device-local counters, never uploaded) ---

export type MetricDomain = 'chat' | 'flow';
export type MetricOutcome = 'success' | 'failure' | 'timeout';

export interface MetricCounts {
  success: number;
  failure: number;
  timeout: number;
}

export interface DailyMetricCounts {
  chat: MetricCounts;
  flow: MetricCounts;
}

export interface MetricsSnapshot {
  chat: MetricCounts;
  flow: MetricCounts;
  // Keyed by local date (YYYY-MM-DD); pruned to a rolling retention window.
  daily: Record<string, DailyMetricCounts>;
}

export interface FlowExecutionEvent {
  flowId: string;
  name: string;
}

export interface FeedCandidate {
  url: string;
  title: string;
}

export interface SelectPathRequest {
  mode?: 'file' | 'folder';
  filters?: { name: string; extensions: string[] }[];
  readContent?: boolean;
}

export interface SelectPathResult {
  path: string;
  content?: string;
}

export type BackupCategoryId = 'config' | 'flows' | 'checkpoints' | 'memory' | 'outputs';

export const BACKUP_CATEGORY_IDS: readonly BackupCategoryId[] = [
  'config',
  'flows',
  'checkpoints',
  'memory',
  'outputs',
] as const;

// Availability + item count for one category, used to populate the export modal.
export interface BackupCategoryInfo {
  id: BackupCategoryId;
  count: number;
  available: boolean;
}

export interface BackupExportResult {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
}

// Per-category overwrite impact shown on the import warning page: how many items
// the backup carries vs. how many currently exist on disk.
export interface BackupInspectItem {
  id: BackupCategoryId;
  incomingCount: number;
  currentCount: number;
}

export interface BackupInspectResult {
  valid: boolean;
  error?: string;
  appVersion?: string;
  createdAt?: string;
  items: BackupInspectItem[];
}

export interface BackupImportResult {
  ok: boolean;
  restored: BackupCategoryId[];
  snapshot?: SettingsSnapshot;
  error?: string;
}

export type AppStatus = 'idle' | 'processing';

export type WorkerAttention = 'idle' | 'login' | 'verification';

export interface AccountStatus {
  provider: AuthProvider;
  loggedIn: boolean;
}

export interface QueueState {
  total: number;
  current: number;
  status: AppStatus;
  items: QueueTaskItem[];
}

export interface QueueTaskItem {
  id: string;
  promptSummary: string;
  status: 'running' | 'queued';
}

export interface OutputFile {
  name: string;
  path: string;
  timestamp: string;
  preview: string;
  provider?: string;
}

export interface UiNotificationPayload {
  title: string;
  body: string;
  level?: 'success' | 'info' | 'warning' | 'error';
  action?: {
    id: 'open-worker-window';
    label: string;
  };
}

export interface UpdateAvailablePayload {
  version: string;
  releaseUrl: string;
}

export type UpdateSource = 'store' | 'github';

export type TelegramRuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';
export type TelegramReplyMode = 'markdown' | 'png' | 'webp' | 'pdf';
// What '/output <arg>' can select. 'compact' is not a reply mode but the compact
// switch: picking any real format turns the switch off.
export type TelegramOutputChoice = TelegramReplyMode | 'compact';

export interface TelegramPendingCode {
  code: string;
  sessionId: string;
  createdAt: string;
  expiresAt: string;
}

export interface TelegramPairedUser {
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  pairedAt: string;
}

export interface TelegramPairingState {
  pendingCodes: TelegramPendingCode[];
  pairedUsers: TelegramPairedUser[];
}

// One AI provider's slash command, shared by the Telegram and LINE bots.
export interface BotProviderCommand {
  enabled: boolean;
  command: string;
  modelId?: string;
}

// Command-free chat: plain (non-command) bot messages forwarded straight to an
// AI provider. Shared by the Telegram and LINE bots, one config each.
// targetUrl '' = follow the app's default provider.
export interface BotLlmDirectConfig {
  enabled: boolean;
  targetUrl: string;
}

export interface TelegramReplyTarget {
  chatId: number;
  userId: number;
  requestMessageId?: number;
  queuedMessageId?: number;
  command: string;
}

export interface TelegramRuntimeSnapshot {
  status: TelegramRuntimeStatus;
  botUsername?: string;
  errorMessage?: string;
  updatedAt: string;
}

export interface TelegramSettingsSnapshot {
  enabled: boolean;
  hasToken: boolean;
  tokenPreview: string;
  allowGroupCommands: boolean;
  defaultReplyMode: TelegramReplyMode;
  compactReply: boolean;
  adminUserIds: number[];
  llmDirect: BotLlmDirectConfig;
  runtime: TelegramRuntimeSnapshot;
  pairing: TelegramPairingState;
}

// --- LINE bot (webhook receiver + push sender) ---

export type LineRuntimeStatus = 'idle' | 'starting' | 'running' | 'error';

// Read back from the Messaging API so the settings page can flag the two silent
// misconfigurations that make a correctly-built bot look dead.
export interface LineAccountInfo {
  basicId: string;
  displayName: string;
  // The Official Account's Chat feature is On, so LINE answers users itself.
  chatModeOn: boolean;
  // undefined when LINE has no webhook URL registered for the channel (404).
  webhookActive?: boolean;
  addFriendUrl: string;
  checkedAt: string;
}

export interface LineRuntimeSnapshot {
  status: LineRuntimeStatus;
  // The loopback URL the local webhook server listens on, shown so the user can
  // point their tunnel at it. The public LINE webhook URL is <tunnel>/line/webhook.
  listenUrl?: string;
  webhookPath?: string;
  errorMessage?: string;
  account?: LineAccountInfo;
  updatedAt: string;
}

export interface LinePendingCode {
  code: string;
  createdAt: string;
  expiresAt: string;
}

export interface LinePairedUser {
  userId: string;
  displayName?: string;
  pairedAt: string;
}

export interface LinePairingState {
  pendingCodes: LinePendingCode[];
  pairedUsers: LinePairedUser[];
}

// Renderer view of a pending code. The deep link is assembled in the main
// process (it needs the account's basicId), so the UI never rebuilds it.
export interface LinePendingCodeView extends LinePendingCode {
  deepLink: string;
}

export interface LinePairingSnapshot {
  pendingCodes: LinePendingCodeView[];
  pairedUsers: LinePairedUser[];
}

// Where a LINE-originated task result is pushed back. LINE reply tokens expire
// (~30s, single use), so async AI results are delivered via pushMessage. chatId
// is the push destination: the userId in a 1:1 chat, the groupId/roomId when the
// task was triggered by tagging the bot in a group.
export interface LineReplyTarget {
  userId: string;
  chatId: string;
}

export interface LineSettingsSnapshot {
  enabled: boolean;
  hasChannelAccessToken: boolean;
  channelAccessTokenPreview: string;
  hasChannelSecret: boolean;
  channelSecretPreview: string;
  port: number;
  pairing: LinePairingSnapshot;
  webhookPath: string;
  llmDirect: BotLlmDirectConfig;
  runtime: LineRuntimeSnapshot;
}

// Sent from the LINE settings form. Blank fields keep the stored secret
// (mirrors UPDATE_EMAIL_CREDENTIALS), so the UI never has to echo secrets back.
export interface LineCredentialsUpdate {
  channelAccessToken: string;
  channelSecret: string;
}

export interface EmailSettingsSnapshot {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  hasPassword: boolean;
  passwordPreview: string;
}

export interface SmtpCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface Task {
  id: string;
  prompt: string;
  instruction?: string;
  targetUrl?: string;
  title?: string;
  source?: 'hotkey' | 'ui' | 'telegram' | 'line';
  replyTarget?: TelegramReplyTarget;
  lineReplyTarget?: LineReplyTarget;
  attachments?: string[];
  // Display name of the person who sent the bot message. Snapshotted at enqueue
  // time (the task may run minutes later, after they unpair) and used instead of
  // the local nickname preference, which names the desktop user, not the sender.
  requesterName?: string;
}

export interface PromptTriggerOptions {
  prompt: string;
  targetUrl?: string;
  attachments?: string[];
}

export type CaptureFormat = 'png' | 'webp' | 'pdf';
export type CaptureMode = 'save' | 'copy';
export type CardTheme = 'light' | 'dark';

export interface CaptureSettings {
  palette: string;
  direction: string;
  showPrompt: boolean;
  showProvider: boolean;
  showTimestamp: boolean;
  format: CaptureFormat;
}

export interface MarkdownCapturePayload {
  title: string;
  prompt: string;
  content: string;
  summary: string;
  provider: string;
  timestamp: string;
}

export interface MarkdownCaptureOptions {
  mode: CaptureMode;
  format: CaptureFormat;
  fileName?: string;
  showPrompt: boolean;
  showContent: boolean;
  showProvider: boolean;
  showTimestamp: boolean;
  width: number;
  background: string;
  cardTheme: CardTheme;
}

export interface MarkdownCaptureRequest {
  payload: MarkdownCapturePayload;
  options: MarkdownCaptureOptions;
}

export interface MarkdownCaptureResult {
  ok: boolean;
  filePath?: string;
  error?: string;
}

export type SkillType = 'shell' | 'run' | 'js' | 'browser' | 'browser_open' | 'browser_js' | 'browser_close' | 'llm' | 'clipboard' | 'delay' | 'notify' | 'capture' | 'bot' | 'rss' | 'stop' | 'comment' | 'scraper' | 'loop' | 'end_loop' | 'if' | 'end_if' | 'sysinfo' | 'http' | 'youtube' | 'youtube_subs' | 'power' | 'restart_app' | 'file_write' | 'file_read' | 'file_list' | 'file_delete' | 'file_download' | 'email_send' | 'text' | 'stock' | 'forex' | 'weather' | 'random' | 'break' | 'continue';

export interface SkillInstance {
  id: string;
  type: SkillType;
  label: string;
  config: Record<string, string>;
  outputKey: string;
}

export type TriggerType = 'hotkey' | 'cron' | 'manual' | 'bot' | 'chat';

// Messaging platforms a `bot` trigger can arrive from and a `bot` step can send
// to. 'auto' is a `bot` step's config value only: it resolves to the platform
// that triggered the run, and to 'telegram' when nothing bot-shaped did.
export type BotPlatform = 'telegram' | 'line';
export const BOT_PLATFORMS: readonly BotPlatform[] = ['telegram', 'line'] as const;

export function isBotPlatform(value: string): value is BotPlatform {
  return (BOT_PLATFORMS as readonly string[]).includes(value);
}
export type ScheduleMode = 'interval' | 'weekly';

export interface TriggerConfig {
  type: TriggerType;
  keys?: string;
  cronExpression?: string;
  scheduleMode?: ScheduleMode;
  intervalValue?: number;
  intervalUnit?: 'minutes' | 'hours';
  weekdays?: number[];
  scheduleHour?: number;
  scheduleMinute?: number;
  repeatWithinDay?: boolean;
  repeatEveryValue?: number;
  repeatEveryUnit?: 'minutes' | 'hours';
  endHour?: number;
  endMinute?: number;
  botCommand?: string;
  botCommandDescription?: string;
  botInputVariable?: string;
  chatCommand?: string;
  chatCommandDescription?: string;
  chatInputVariable?: string;
}

// A flow-level setting, filled in once (on import, or in the flow's settings
// panel) and read by any number of steps as {{var.<key>}}. It exists so a
// template can ship with its own placeholders declared up front — a template's
// steps reference {{var.chatId}} instead of an empty config field the importer
// would otherwise have to hunt for.
//
// NOT a place for secrets: flows.json is plaintext and every variable also
// surfaces in a run's `outputs`. Secrets belong in the global config, encrypted
// via safeStorage (see the Telegram token / SMTP password).
export type FlowVariableType =
  | 'text' | 'number' | 'select' | 'chat' | 'folder' | 'file' | 'feed' | 'url';

export const FLOW_VARIABLE_TYPES: readonly FlowVariableType[] =
  ['text', 'number', 'select', 'chat', 'folder', 'file', 'feed', 'url'] as const;

export interface FlowVariableOption {
  value: string;
  label: string;
}

export interface FlowVariable {
  key: string;
  type: FlowVariableType;
  label: string;
  /** Asked during setup; falls back to `label` when blank. */
  question?: string;
  hint?: string;
  value: string;
  required?: boolean;
  /** `select` only. */
  options?: FlowVariableOption[];
  /** `number` only. */
  min?: string;
  max?: string;
  /** text/url/feed only: render a multi-line box (e.g. one channel per line). */
  multiline?: boolean;
  /** Greyed example shown inside an empty text/url/feed field. */
  placeholder?: string;
}

export interface FlowDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: TriggerConfig;
  extraTriggers?: TriggerConfig[];
  variables?: FlowVariable[];
  steps: SkillInstance[];
  createdAt: string;
  updatedAt: string;
}

export type FlowStepStatus = 'pending' | 'running' | 'completed' | 'error' | 'skipped';

export interface FlowExecutionLog {
  flowId: string;
  stepId: string;
  stepIndex: number;
  status: FlowStepStatus;
  output?: string;
  error?: string;
  timestamp: string;
}

export interface FlowExecutionResult {
  flowId: string;
  success: boolean;
  outputs: Record<string, string>;
  error?: string;
  completedSteps: number;
  totalSteps: number;
  completedAt: string;
  aborted?: boolean;
  finalOutput?: string;
}

export interface ChatCommandResult {
  result: FlowExecutionResult;
  filePath?: string;
}

export type FlowGenerationResult =
  | { ok: true; flow: FlowDefinition }
  | { ok: false; error: string };

export type PromptTone = 'default' | 'professional' | 'casual' | 'direct';
export type PromptLength = 'auto' | 'concise' | 'detailed';

export interface CustomTemplate {
  id: string;
  name: string;
  prompt: string;
}

export interface PromptPreferences {
  tone: PromptTone;
  length: PromptLength;
  customInstructions: string;
  customTemplates: CustomTemplate[];
  nickname?: string;
}

export interface SettingsSnapshot {
  hotkey: string;
  locale: string;
  theme: string;
  syncSystemLanguageToModel: boolean;
  notifyOnComplete: boolean;
  notifyEvents: NotifyEventPrefs;
  metricsEnabled: boolean;
  promptPreferences: PromptPreferences;
  youtubePrompt: string;
  responseTimeout: number;
  closeToTray: boolean;
  launchAtStartup: boolean;
}
