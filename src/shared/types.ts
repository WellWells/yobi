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

export const DEFAULT_PROVIDER_COMMANDS: Record<Provider, string> = {
  chatgpt: 'gpt',
  gemini: 'gemini',
  perplexity: 'pplx',
  duckai: 'duck',
} as const;

export const TELEGRAM_COMMAND_RE = /^[a-z][a-z0-9_]{0,31}$/;

export function buildDuckaiModelUrl(modelId: string): string {
  const url = new URL(PROVIDER_URLS.duckai);
  url.searchParams.set('model', modelId);
  return url.toString();
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
  WORKER_STATUS: 'worker:status',
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
  GET_FILE_LIST: 'file:get-list',
  SEARCH_FILE_LIST: 'file:search',
  GET_FILE_CONTENT: 'file:get-content',
  DELETE_FILE: 'file:delete',
  DELETE_ALL_FILES: 'file:delete-all',
  UPDATE_FILE_TITLE: 'file:update-title',
  UPDATE_FILE_H1: 'file:update-h1',
  UPDATE_HOTKEY: 'hotkey:update',
  GET_HOTKEY: 'hotkey:get',
  SET_HOTKEY_PAUSED: 'hotkey:set-paused',
  GET_AI_URL: 'ai:get-url',
  UPDATE_AI_URL: 'ai:update-url',
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
  UPDATE_TELEGRAM_ADMIN_USERS: 'telegram:update-admin-users',
  UPDATE_TELEGRAM_PROVIDER_COMMANDS: 'telegram:update-provider-commands',
  GENERATE_TELEGRAM_PAIRING_CODE: 'telegram:generate-pairing-code',
  REVOKE_TELEGRAM_PAIRING_CODE: 'telegram:revoke-pairing-code',
  UNPAIR_TELEGRAM_USER: 'telegram:unpair-user',
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
  EXPORT_CONFIG: 'config:export',
  IMPORT_CONFIG: 'config:import',
  SELECT_PATH: 'dialog:select-path',
  FLOW_GET_ALL: 'flow:get-all',
  FLOW_SAVE: 'flow:save',
  FLOW_DELETE: 'flow:delete',
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
} as const;

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

export type TelegramRuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';
export type TelegramReplyMode = 'markdown' | 'png' | 'webp' | 'pdf';

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

export interface TelegramProviderCommand {
  enabled: boolean;
  command: string;
  modelId?: string;
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
  adminUserIds: number[];
  providerCommands: Record<Provider, TelegramProviderCommand>;
  runtime: TelegramRuntimeSnapshot;
  pairing: TelegramPairingState;
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
  source?: 'hotkey' | 'ui' | 'telegram';
  replyTarget?: TelegramReplyTarget;
  attachments?: string[];
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

export interface FlowDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: TriggerConfig;
  extraTriggers?: TriggerConfig[];
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
  promptPreferences: PromptPreferences;
  youtubePrompt: string;
  responseTimeout: number;
  closeToTray: boolean;
  launchAtStartup: boolean;
}
