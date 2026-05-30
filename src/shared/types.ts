// src/shared/types.ts — Shared type definitions between main/preload/renderer

// ── AI Provider Registry ─────────────────────────────────────────────────────
// Single source of truth for all AI provider URLs and labels.
// To add a new provider: add an entry here, then create a provider module
// under src/main/providers/ and register it in providers/index.ts.

// Duck AI model entry returned by fetchDuckaiModels (main) and DUCKAI_FETCH_MODELS IPC.
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

// ── IPC Channel Names ────────────────────────────────────────────────────────
export const IPC = {
  // Main → Renderer
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

  // Renderer → Main
  SHOW_WORKER: 'show-worker',
  HIDE_WORKER: 'hide-worker',
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
  GET_LICENSE: 'license:get',
  OPEN_EXTERNAL_URL: 'url:open-external',
  TRIGGER_PROMPT: 'prompt:trigger',
  TRIGGER_PROMPT_WITH_OPTIONS: 'prompt:trigger-with-options',
  GET_CUSTOM_PROMPT: 'prompt:get-custom',
  UPDATE_CUSTOM_PROMPT: 'prompt:update-custom',
  GET_SYNC_SYSTEM_LANGUAGE_TO_MODEL: 'prompt:get-sync-system-language-to-model',
  UPDATE_SYNC_SYSTEM_LANGUAGE_TO_MODEL: 'prompt:update-sync-system-language-to-model',
  GET_NOTIFY_ON_COMPLETE: 'notify:get-on-complete',
  UPDATE_NOTIFY_ON_COMPLETE: 'notify:update-on-complete',
  RESET_SETTINGS: 'settings:reset',
  SHOW_IN_FOLDER: 'file:show-in-folder',
  OPEN_PATH: 'file:open-path',
  CAPTURE_MARKDOWN_IMAGE: 'markdown:capture-image',
  CANCEL_QUEUE_TASK: 'queue:cancel-task',
  COPY_TEXT_TO_CLIPBOARD: 'clipboard:write-text',
  GET_TELEGRAM_SETTINGS: 'telegram:get-settings',
  UPDATE_TELEGRAM_ENABLED: 'telegram:update-enabled',
  UPDATE_TELEGRAM_BOT_TOKEN: 'telegram:update-bot-token',
  UPDATE_TELEGRAM_ALLOW_GROUP_COMMANDS: 'telegram:update-allow-group-commands',
  UPDATE_TELEGRAM_DEFAULT_REPLY_MODE: 'telegram:update-default-reply-mode',
  UPDATE_TELEGRAM_ADMIN_USERS: 'telegram:update-admin-users',
  GENERATE_TELEGRAM_PAIRING_CODE: 'telegram:generate-pairing-code',
  REVOKE_TELEGRAM_PAIRING_CODE: 'telegram:revoke-pairing-code',
  UNPAIR_TELEGRAM_USER: 'telegram:unpair-user',
  GET_PROMPT_PREFERENCES: 'prompt:get-preferences',
  UPDATE_PROMPT_PREFERENCES: 'prompt:update-preferences',
  GET_RESPONSE_TIMEOUT: 'response:get-timeout',
  UPDATE_RESPONSE_TIMEOUT: 'response:update-timeout',
  GET_APP_VERSION: 'app:get-version',
  GET_APP_ICON_DATA_URL: 'app:get-icon-data-url',
  // Tray / window behavior
  GET_CLOSE_TO_TRAY: 'tray:get-close-to-tray',
  UPDATE_CLOSE_TO_TRAY: 'tray:update-close-to-tray',
  GET_AUTO_SHOW_TRAY: 'tray:get-auto-show-tray',
  UPDATE_AUTO_SHOW_TRAY: 'tray:update-auto-show-tray',
  // Startup auto-launch
  GET_LAUNCH_AT_STARTUP: 'startup:get-launch',
  UPDATE_LAUNCH_AT_STARTUP: 'startup:update-launch',
  LAUNCH_AT_STARTUP_CHANGED: 'startup:launch-changed',  // main → renderer push
  // Notify-state push (main → renderer, e.g. toggled via tray menu)
  NOTIFY_ON_COMPLETE_CHANGED: 'notify:on-complete-changed',
  DUCKAI_FETCH_MODELS: 'duckai:fetch-models',
  // Navigate (main → renderer)
  NAVIGATE_SETTINGS: 'navigate:settings',
  // Close dialog (main ↔ renderer)
  SHOW_CLOSE_DIALOG: 'close-dialog:show',
  RESPOND_CLOSE_DIALOG: 'close-dialog:respond',
  // Close-to-tray state push (main → renderer, e.g. saved via close dialog)
  CLOSE_TO_TRAY_CHANGED: 'tray:close-to-tray-changed',
  // Theme persistence (persisted in main config so it survives rebuilds)
  GET_THEME: 'theme:get',
  UPDATE_THEME: 'theme:update',
  THEME_CHANGED: 'theme:changed',
  // UI layout preferences (persisted in main config)
  GET_LAYOUT_MODE: 'ui:get-layout-mode',
  UPDATE_LAYOUT_MODE: 'ui:update-layout-mode',
  GET_MARKDOWN_ZOOM: 'ui:get-markdown-zoom',
  UPDATE_MARKDOWN_ZOOM: 'ui:update-markdown-zoom',
  // Capture / export settings
  GET_CAPTURE_SETTINGS: 'capture:get-settings',
  UPDATE_CAPTURE_SETTINGS: 'capture:update-settings',
  OPEN_CONFIG_DIR: 'config:open-dir',
  EXPORT_CONFIG: 'config:export',
  IMPORT_CONFIG: 'config:import',
  // AgentFlow (Flow Automation)
  FLOW_GET_ALL: 'flow:get-all',
  FLOW_SAVE: 'flow:save',
  FLOW_DELETE: 'flow:delete',
  FLOW_DUPLICATE: 'flow:duplicate',
  FLOW_MOVE: 'flow:move',
  FLOW_EXECUTE: 'flow:execute',
  FLOW_EXECUTION_LOG: 'flow:execution-log',
  FLOW_EXECUTION_STARTED: 'flow:execution-started',
  FLOW_EXECUTION_ENDED: 'flow:execution-ended',
  FLOW_EXPORT: 'flow:export',
  // RSS Checkpoint
  RSS_HAS_CHECKPOINT: 'rss:has-checkpoint',
  RSS_CLEAR_CHECKPOINT: 'rss:clear-checkpoint',
  // Scraper Checkpoint
  SCRAPER_HAS_CHECKPOINT: 'scraper:has-checkpoint',
  SCRAPER_CLEAR_CHECKPOINT: 'scraper:clear-checkpoint',
} as const;

export interface FlowExecutionEvent {
  flowId: string;
  name: string;
}

// ── Status ───────────────────────────────────────────────────────────────────
export type AppStatus = 'idle' | 'processing';

// ── Queue ────────────────────────────────────────────────────────────────────
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

// ── File ─────────────────────────────────────────────────────────────────────
export interface OutputFile {
  name: string;
  path: string;
  timestamp: string; // ISO string
  preview: string;   // first 80 chars of content
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

// ── Telegram ──────────────────────────────────────────────────────────────────
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

export interface TelegramReplyTarget {
  chatId: number;
  userId: number;
  requestMessageId?: number;
  queuedMessageId?: number;
  command: 'gpt' | 'gemini' | 'pplx';
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
  runtime: TelegramRuntimeSnapshot;
  pairing: TelegramPairingState;
}

// ── Task ─────────────────────────────────────────────────────────────────────
export interface Task {
  id: string;
  prompt: string;
  instruction?: string;
  targetUrl?: string;
  source?: 'hotkey' | 'ui' | 'telegram';
  replyTarget?: TelegramReplyTarget;
}

export interface PromptTriggerOptions {
  prompt: string;
  targetUrl?: string;
}

export type CaptureFormat = 'png' | 'webp' | 'pdf';
export type CaptureMode = 'save' | 'copy';

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

// ── AgentFlow (Flow Automation) ──────────────────────────────────────────────

export type SkillType = 'shell' | 'browser' | 'llm' | 'clipboard' | 'utility' | 'bot' | 'rss' | 'stop' | 'comment' | 'scraper' | 'loop' | 'end_loop';

export interface SkillInstance {
  id: string;
  type: SkillType;
  label: string;
  config: Record<string, string>;
  outputKey: string;
}

export type TriggerType = 'hotkey' | 'cron' | 'manual' | 'bot';
export type ScheduleMode = 'interval' | 'weekly';

export interface TriggerConfig {
  type: TriggerType;
  keys?: string;
  cronExpression?: string;
  // Human-friendly schedule builder fields (auto-computed into cronExpression)
  scheduleMode?: ScheduleMode;
  intervalValue?: number;
  intervalUnit?: 'minutes' | 'hours';
  weekdays?: number[];      // 0=Sun, 1=Mon, ..., 6=Sat
  scheduleHour?: number;
  scheduleMinute?: number;
  repeatWithinDay?: boolean;
  repeatEveryValue?: number;
  repeatEveryUnit?: 'minutes' | 'hours';
  endHour?: number;
  endMinute?: number;
  // Bot trigger fields (type === 'bot')
  botCommand?: string;             // command name without slash, e.g. "my_cmd"
  botCommandDescription?: string;  // displayed in Telegram help
  botInputVariable?: string;       // context variable seeded from argument text, e.g. "input"
}

export interface FlowDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: TriggerConfig;
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
}

// ── Prompt Preferences ───────────────────────────────────────────────────────
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
  geminiUrl: string;
  locale: string;
  theme: string;
  syncSystemLanguageToModel: boolean;
  notifyOnComplete: boolean;
  promptPreferences: PromptPreferences;
  responseTimeout: number;
  closeToTray: boolean;
  launchAtStartup: boolean;
}
