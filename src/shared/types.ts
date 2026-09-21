import { SHARE_EXPIRE_VALUES } from './shareExpire';
import { CAPTURE_PALETTES } from './capturePalettes';
import type { ShareExpire, ShareExpireCache } from './shareExpire';
import type { TurnMeta } from './conversationDoc';
import type { TokenUsage } from './tokenEstimate';
import type { Theme } from './themes';

export const PROVIDER_URLS = {
  gemini: 'https://gemini.google.com/',
  claude: 'https://claude.ai/new',
  chatgpt: 'https://chatgpt.com/',
  perplexity: 'https://www.perplexity.ai/',
} as const;

export type Provider = keyof typeof PROVIDER_URLS;

export const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: 'Gemini',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
} as const;

/** Display order everywhere providers are listed: the model menu, Settings, bot commands. */
export const PROVIDERS = ['gemini', 'claude', 'chatgpt', 'perplexity'] as const;

export const AUTH_PROVIDERS = ['gemini', 'claude', 'chatgpt', 'perplexity'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const LOGIN_REQUIRED_PROVIDERS = ['claude', 'chatgpt', 'perplexity'] as const;
export type LoginRequiredProvider = (typeof LOGIN_REQUIRED_PROVIDERS)[number];

export function loginRequiredProviderForUrl(url: string): LoginRequiredProvider | null {
  return LOGIN_REQUIRED_PROVIDERS.find((provider) => PROVIDER_URLS[provider] === url) ?? null;
}

export const DEFAULT_PROVIDER_COMMANDS: Record<Provider, string> = {
  chatgpt: 'gpt',
  claude: 'claude',
  gemini: 'gemini',
  perplexity: 'pplx',
} as const;

export const BOT_COMMAND_RE = /^[a-z][a-z0-9_]{0,31}$/;

export const BOT_BUILTIN_COMMAND_KEYS = ['agent', 'search'] as const;
export type BotBuiltinCommandKey = (typeof BOT_BUILTIN_COMMAND_KEYS)[number];

export const DEFAULT_BUILTIN_COMMANDS: Record<BotBuiltinCommandKey, string> = {
  agent: 'agent',
  search: 'search',
} as const;

export const DEFAULT_AGENT_ASK_TTL_MINUTES = 5;
export const AGENT_ASK_TTL_MIN_MINUTES = 1;
export const AGENT_ASK_TTL_MAX_MINUTES = 5;

export function providerFromUrl(url: string): Provider {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('perplexity.ai')) return 'perplexity';
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
    if (host === 'claude.ai' || host.endsWith('.claude.ai')) return 'claude';
  } catch {
  }
  return 'gemini';
}

/**
 * Duck.ai was removed in 2026-09. A target saved before then (chat model, bot command, flow step)
 * still names it, and `providerFromUrl` would call it Gemini while the runner navigated to duck.ai.
 * Every stored target passes through here so it lands on Gemini instead.
 */
export function migrateRemovedTargetUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'duck.ai' || host.endsWith('.duck.ai')) return PROVIDER_URLS.gemini;
  } catch {
  }
  return url;
}

export const BYOK_PROVIDER_TYPES = [
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'deepseek',
  'xai',
  'groq',
  'mistral',
  'perplexity',
  'qwen',
  'moonshot',
  'cerebras',
  'minimax',
  'zai',
  'custom',
] as const;
export type ByokProviderType = (typeof BYOK_PROVIDER_TYPES)[number];

export const BYOK_PROVIDER_TYPE_LABELS: Record<ByokProviderType, string> = {
  openai: 'ChatGPT (OpenAI)',
  anthropic: 'Claude (Anthropic)',
  gemini: 'Gemini (Google)',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  xai: 'Grok (xAI)',
  groq: 'Groq',
  mistral: 'Mistral',
  perplexity: 'Perplexity',
  qwen: 'Qwen (DashScope)',
  moonshot: 'Kimi (Moonshot)',
  cerebras: 'Cerebras',
  minimax: 'MiniMax',
  zai: 'GLM (Z.ai)',
  custom: 'OpenAI-compatible',
} as const;

export const BYOK_DEFAULT_BASE_URLS: Record<ByokProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
  xai: 'https://api.x.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  perplexity: 'https://api.perplexity.ai',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  moonshot: 'https://api.moonshot.ai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  minimax: 'https://api.minimax.io/v1',
  zai: 'https://api.z.ai/api/paas/v4',
  custom: '',
} as const;

export const BYOK_MODEL_EXAMPLES: Record<ByokProviderType, string> = {
  openai: 'gpt-5.6-luna',
  anthropic: 'claude-opus-4-8',
  gemini: 'models/gemini-3.1-flash-lite',
  openrouter: 'anthropic/claude-sonnet-5',
  deepseek: 'deepseek-chat',
  xai: 'grok-4.5',
  groq: 'llama-3.3-70b-versatile',
  mistral: 'mistral-large-latest',
  perplexity: 'sonar-pro',
  qwen: 'qwen-plus',
  moonshot: 'kimi-k2-0905-preview',
  cerebras: 'llama-3.3-70b',
  minimax: 'MiniMax-M3',
  zai: 'glm-5.3',
  custom: '',
} as const;

export function detectByokProviderType(baseUrl: string): ByokProviderType {
  const trimmed = baseUrl.trim().replace(/\/+$/, '').toLowerCase();
  if (!trimmed) return 'custom';
  for (const type of BYOK_PROVIDER_TYPES) {
    const known = BYOK_DEFAULT_BASE_URLS[type];
    if (known && trimmed === known.toLowerCase()) return type;
  }
  return 'custom';
}

/** Google's own Gemini API host, the only BYOK endpoint that accepts a YouTube URL as video input. */
export function isGeminiApiBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl.trim()).hostname.toLowerCase() === new URL(BYOK_DEFAULT_BASE_URLS.gemini).hostname;
  } catch {
    return false;
  }
}

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

export function isByokTargetUrl(url: string): boolean {
  return isByokUrl(url) || isByokGroupUrl(url);
}

export interface HiddenSources {
  providers: Provider[];
  byokIds: string[];
  byokGroupIds: string[];
}

export function isModelUrlHidden(url: string, hidden: HiddenSources): boolean {
  const byokId = byokIdFromUrl(url);
  if (byokId !== null) return hidden.byokIds.includes(byokId);
  const byokGroupId = byokGroupIdFromUrl(url);
  if (byokGroupId !== null) return hidden.byokGroupIds.includes(byokGroupId);
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

export interface ByokGroup {
  id: string;
  name: string;
  memberIds: string[];
}

export interface ByokGroupSnapshot {
  id: string;
  name: string;
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

/** Stable id/command of the in-process, opt-in LINE PC reader connector. */
export const BUILTIN_LINE_SERVER_ID = 'builtin-line';

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  createdAt: string;
  headerName?: string;
  agentEnabled?: boolean;
  autoApproveWrites?: boolean;
  /** Slash command that drives this server on its own (`/notion`). Persisted so a rename cannot move it. */
  commandName?: string;
}

/** The in-process LINE connector's descriptor. Single source shared by the registry (which
 * hosts it) and the agent IPC (which resolves a disclosed `/line` command against config). */
export function builtinLineServerConfig(): McpServerConfig {
  return {
    id: BUILTIN_LINE_SERVER_ID,
    name: 'LINE',
    url: 'builtin://line',
    enabled: true,
    agentEnabled: true,
    autoApproveWrites: false,
    createdAt: new Date(0).toISOString(),
    commandName: 'line',
  };
}

export type McpConnectionStatus = 'disconnected' | 'connecting' | 'needs_auth' | 'connected' | 'error';

export interface McpServerView extends McpServerConfig {
  status: McpConnectionStatus;
  toolCount: number;
  authorized: boolean;
  hasToken: boolean;
  error?: string;
  tools: McpToolInfo[];
}

export interface McpToolInfo {
  name: string;
  description: string;
}

export interface McpServerSaveRequest {
  id?: string;
  name?: string;
  url: string;
  token?: string;
  headerName?: string;
  agentEnabled?: boolean;
  autoApproveWrites?: boolean;
  commandName?: string;
}

export interface McpServerActionResult {
  ok: boolean;
  servers: McpServerView[];
  error?: string;
}

export interface PromptAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  path: string;
  previewUrl?: string;
}

export const ATTACHMENT_STASH_MAX_BYTES = 25 * 1024 * 1024;

export interface AttachmentStashRequest {
  name: string;
  mimeType: string;
  data: Uint8Array;
}

export interface StashedAttachment {
  path: string;
  name: string;
  size: number;
  mimeType: string;
  preview?: string;
}

export interface ProviderAttachmentPolicy {
  maxFiles: number;
}

export const PROVIDER_ATTACHMENT_POLICIES: Record<Provider, ProviderAttachmentPolicy> = {
  gemini: { maxFiles: 10 },
  chatgpt: { maxFiles: 10 },
  claude: { maxFiles: 10 },
  perplexity: { maxFiles: 0 },
};

/**
 * The providers that accept uploads, named for the three places that disclose the capability:
 * the skill spec sent to the model, the flow config hint and the bot's rejection reply. Derived
 * from the policies above on purpose — ChatGPT gained uploads while all three still said "Gemini
 * only", which made the app tell users (and the model) that a working feature did not exist.
 */
export const UPLOAD_CAPABLE_PROVIDER_LABELS = PROVIDERS
  .filter((provider) => PROVIDER_ATTACHMENT_POLICIES[provider].maxFiles > 0)
  .map((provider) => PROVIDER_LABELS[provider])
  .join(' / ');

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
  SECRET_HEALTH_CHANGED: 'secret:health-changed',
  GET_SECRET_HEALTH: 'secret:get-health',
  DELETE_BROKEN_SECRET: 'secret:delete-broken',

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
  START_CONVERSATION: 'file:start-conversation',
  UPDATE_HOTKEY: 'hotkey:update',
  GET_HOTKEY: 'hotkey:get',
  SET_HOTKEY_PAUSED: 'hotkey:set-paused',
  GET_HOTKEY_ENABLED: 'hotkey:get-enabled',
  SET_HOTKEY_ENABLED: 'hotkey:set-enabled',
  GET_SHORTCUTS: 'shortcuts:get',
  UPDATE_SHORTCUTS: 'shortcuts:update',
  GET_AI_URL: 'ai:get-url',
  UPDATE_AI_URL: 'ai:update-url',
  GET_HIDDEN_SOURCES: 'sources:get-hidden',
  UPDATE_HIDDEN_SOURCES: 'sources:update-hidden',
  GET_LANGUAGE_LIST: 'language:get-list',
  GET_LANGUAGE_CONTENT: 'language:get-content',
  OPEN_LANGUAGES_FOLDER: 'language:open-folder',
  GET_CURRENT_LOCALE: 'language:get-current',
  SET_CURRENT_LOCALE: 'language:set-current',
  SET_LOCALE_AUTO: 'language:set-auto',
  OPEN_THIRD_PARTY_LICENSES: 'license:open-third-party',
  OPEN_EXTERNAL_URL: 'url:open-external',
  TRIGGER_PROMPT: 'prompt:trigger',
  TRIGGER_PROMPT_WITH_OPTIONS: 'prompt:trigger-with-options',
  CHAT_TURN: 'chat:turn',
  GET_SYNC_SYSTEM_LANGUAGE_TO_MODEL: 'prompt:get-sync-system-language-to-model',
  UPDATE_SYNC_SYSTEM_LANGUAGE_TO_MODEL: 'prompt:update-sync-system-language-to-model',
  GET_NOTIFY_ON_COMPLETE: 'notify:get-on-complete',
  UPDATE_NOTIFY_ON_COMPLETE: 'notify:update-on-complete',
  RESET_SETTINGS: 'settings:reset',
  SHOW_IN_FOLDER: 'file:show-in-folder',
  OPEN_PATH: 'file:open-path',
  CAPTURE_MARKDOWN_IMAGE: 'markdown:capture-image',
  SHARE_CREATE_LINK: 'share:create-link',
  SHARE_REVOKE_LINK: 'share:revoke-link',
  GET_SHARE_SETTINGS: 'share:get-settings',
  UPDATE_SHARE_SETTINGS: 'share:update-settings',
  CANCEL_QUEUE_TASK: 'queue:cancel-task',
  FORCE_SKIP_ACTIVE_TASK: 'queue:force-skip-active',
  COPY_TEXT_TO_CLIPBOARD: 'clipboard:write-text',
  ATTACHMENT_STASH_BYTES: 'attachment:stash-bytes',
  ATTACHMENT_FROM_CLIPBOARD: 'attachment:from-clipboard',
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
  GET_BOT_BUILTIN_COMMANDS: 'bot:get-builtin-commands',
  UPDATE_BOT_BUILTIN_COMMANDS: 'bot:update-builtin-commands',
  GET_BOT_BYOK_COMMANDS: 'bot:get-byok-commands',
  UPDATE_BOT_BYOK_COMMANDS: 'bot:update-byok-commands',
  GENERATE_TELEGRAM_PAIRING_CODE: 'telegram:generate-pairing-code',
  REVOKE_TELEGRAM_PAIRING_CODE: 'telegram:revoke-pairing-code',
  UNPAIR_TELEGRAM_USER: 'telegram:unpair-user',
  FORGET_TELEGRAM_CHANNEL: 'telegram:forget-channel',
  GET_LINE_SETTINGS: 'line:get-settings',
  UPDATE_LINE_ENABLED: 'line:update-enabled',
  UPDATE_LINE_CREDENTIALS: 'line:update-credentials',
  UPDATE_LINE_PORT: 'line:update-port',
  UPDATE_LINE_LLM_DIRECT: 'line:update-llm-direct',
  GENERATE_LINE_PAIRING_CODE: 'line:generate-pairing-code',
  REVOKE_LINE_PAIRING_CODE: 'line:revoke-pairing-code',
  UNPAIR_LINE_USER: 'line:unpair-user',
  LIST_LINE_CHATS: 'line:list-chats',
  REFRESH_LINE_ACCOUNT: 'line:refresh-account',
  GET_EMAIL_SETTINGS: 'email:get-settings',
  UPDATE_EMAIL_ENABLED: 'email:update-enabled',
  UPDATE_EMAIL_CREDENTIALS: 'email:update-credentials',
  GET_DATA_KEY_STATUS: 'datakey:get-status',
  UPDATE_DATA_KEY: 'datakey:update',
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
  MEMORY_GET: 'memory:get',
  MEMORY_SET_ENABLED: 'memory:set-enabled',
  MEMORY_ADD: 'memory:add',
  MEMORY_UPDATE: 'memory:update',
  MEMORY_DELETE: 'memory:delete',
  MEMORY_CLEAR: 'memory:clear',
  MEMORY_UNDO: 'memory:undo',
  MEMORY_SET_BOT_SELF: 'memory:set-bot-self',
  MEMORY_CHANGED: 'memory:changed',
  MEMORY_CURATE_GET_MODEL: 'memory:curate-get-model',
  MEMORY_CURATE_PROPOSE: 'memory:curate-propose',
  MEMORY_CURATE_CANCEL: 'memory:curate-cancel',
  MEMORY_CURATE_APPLY: 'memory:curate-apply',
  MEMORY_CURATE_UNDO: 'memory:curate-undo',
  GEMINI_MODEL_GET: 'gemini-model:get',
  GEMINI_MODEL_SET: 'gemini-model:set',
  GEMINI_MODEL_REFRESH: 'gemini-model:refresh',
  GEMINI_MODEL_CHANGED: 'gemini-model:changed',
  CLAUDE_MODEL_GET: 'claude-model:get',
  CLAUDE_MODEL_SET: 'claude-model:set',
  CLAUDE_MODEL_REFRESH: 'claude-model:refresh',
  CLAUDE_MODEL_CHANGED: 'claude-model:changed',
  CHATGPT_MODEL_GET: 'chatgpt-model:get',
  CHATGPT_MODEL_SET: 'chatgpt-model:set',
  CHATGPT_MODEL_REFRESH: 'chatgpt-model:refresh',
  CHATGPT_MODEL_CHANGED: 'chatgpt-model:changed',
  BYOK_GET_SETTINGS: 'byok:get-settings',
  BYOK_SAVE_INSTANCE: 'byok:save-instance',
  BYOK_DELETE_INSTANCE: 'byok:delete-instance',
  BYOK_LIST_MODELS: 'byok:list-models',
  BYOK_TEST_INSTANCE: 'byok:test-instance',
  BYOK_SAVE_GROUP: 'byok:save-group',
  BYOK_DELETE_GROUP: 'byok:delete-group',
  MCP_LIST_SERVERS: 'mcp:list-servers',
  MCP_SAVE_SERVER: 'mcp:save-server',
  MCP_DELETE_SERVER: 'mcp:delete-server',
  MCP_CONNECT_SERVER: 'mcp:connect-server',
  MCP_DISCONNECT_SERVER: 'mcp:disconnect-server',
  MCP_SET_BUILTIN_ENABLED: 'mcp:set-builtin-enabled',
  MCP_SERVER_STATUS: 'mcp:server-status',
  NAVIGATE_SETTINGS: 'navigate:settings',
  SHOW_CLOSE_DIALOG: 'close-dialog:show',
  RESPOND_CLOSE_DIALOG: 'close-dialog:respond',
  AGENT_CONFIRM_SHOW: 'agent-confirm:show',
  AGENT_CONFIRM_RESPOND: 'agent-confirm:respond',
  /**
   * Main has already settled a confirmation the renderer is still showing (it timed out, the run
   * was cancelled, or the window closed). Without it the stale modal stays up and the NEXT
   * request pops into the same box under the user's cursor — one click lands on nothing, the
   * second lands on a command they never read.
   */
  AGENT_CONFIRM_DISMISS: 'agent-confirm:dismiss',
  CLOSE_TO_TRAY_CHANGED: 'tray:close-to-tray-changed',
  GET_THEME: 'theme:get',
  UPDATE_THEME: 'theme:update',
  THEME_CHANGED: 'theme:changed',
  GET_LAYOUT_MODE: 'ui:get-layout-mode',
  UPDATE_LAYOUT_MODE: 'ui:update-layout-mode',
  GET_SHOW_TOKEN_USAGE: 'ui:get-show-token-usage',
  UPDATE_SHOW_TOKEN_USAGE: 'ui:update-show-token-usage',
  GET_MARKDOWN_ZOOM: 'ui:get-markdown-zoom',
  UPDATE_MARKDOWN_ZOOM: 'ui:update-markdown-zoom',
  GET_CAPTURE_SETTINGS: 'capture:get-settings',
  UPDATE_CAPTURE_SETTINGS: 'capture:update-settings',
  GET_QUICK_EXPORT: 'capture:get-quick-export',
  UPDATE_QUICK_EXPORT: 'capture:update-quick-export',
  OPEN_CONFIG_DIR: 'config:open-dir',
  OPEN_LOG_DIR: 'log:open-dir',
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
  FLOW_BUILD_PROGRESS: 'flow:build-progress',
  FLOW_GET_AI_URL: 'flow:get-ai-url',
  FLOW_CREATED: 'flow:created',
  FLOW_EXECUTION_LOG: 'flow:execution-log',
  FLOW_EXECUTION_STARTED: 'flow:execution-started',
  FLOW_EXECUTION_ENDED: 'flow:execution-ended',
  FLOW_PREVIEW_SCHEDULE: 'flow:preview-schedule',
  FLOW_EXPORT: 'flow:export',
  FLOW_EXPORT_RESULT: 'flow:export-result',
  AGENT_RUN: 'agent:run',
  AGENT_TRACE: 'agent:trace',
  AGENT_CANCEL: 'agent:cancel',
  AGENT_RESUME: 'agent:resume',
  AGENT_LIST_RESUMABLE: 'agent:list-resumable',
  AGENT_GET_RUN: 'agent:get-run',
  AGENT_DISCARD: 'agent:discard',
  AGENT_SET_CONNECTORS: 'agent:set-connectors',
  RSS_HAS_CHECKPOINT: 'rss:has-checkpoint',
  RSS_CLEAR_CHECKPOINT: 'rss:clear-checkpoint',
  RSS_DISCOVER_FEED: 'rss:discover-feed',
  SCRAPER_HAS_CHECKPOINT: 'scraper:has-checkpoint',
  SCRAPER_CLEAR_CHECKPOINT: 'scraper:clear-checkpoint',
  SCRAPER_PICK_SELECTOR: 'scraper:pick-selector',
  YT_SUBS_HAS_CHECKPOINT: 'youtube-subs:has-checkpoint',
  YT_SUBS_CLEAR_CHECKPOINT: 'youtube-subs:clear-checkpoint',
  CAPTURE_PAGE: 'browser:capture-page',
  METRICS_GET: 'metrics:get',
  METRICS_CONVERSATION_TOKENS: 'metrics:conversation-tokens',
  METRICS_RESET: 'metrics:reset',
  METRICS_CHANGED: 'metrics:changed',
  FLOW_METRICS_GET: 'flow-metrics:get',
  FLOW_METRICS_CHANGED: 'flow-metrics:changed',
  GET_METRICS_ENABLED: 'metrics:get-enabled',
  UPDATE_METRICS_ENABLED: 'metrics:update-enabled',
  GET_NOTIFY_EVENTS: 'notify:get-events',
  UPDATE_NOTIFY_EVENTS: 'notify:update-events',
  TEMP_CHAT_GET_MODE: 'temp-chat:get-mode',
  TEMP_CHAT_SET_MODE: 'temp-chat:set-mode',
  TEMP_CHAT_MODE_CHANGED: 'temp-chat:mode-changed',
  TEMP_CHAT_RESULT: 'temp-chat:result',
} as const;

export interface TempChatResult {
  content: string;
}

export interface NotifyEventPrefs {
  chatComplete: boolean;
  chatFailure: boolean;
  flowSuccess: boolean;
  flowFailure: boolean;
}

export type MetricDomain = 'chat' | 'flow';
export type MetricOutcome = 'success' | 'failure' | 'timeout';

export interface MetricCounts {
  success: number;
  failure: number;
  timeout: number;
}

export interface TokenCounts {
  input: number;
  output: number;
}

/** Per BYOK key. `cooldowns` counts rate-limit backoffs, which are not request failures. */
export interface KeyMetrics {
  requests: MetricCounts;
  tokens: TokenCounts;
  cooldowns: number;
}

/**
 * Two levels, deliberately separate: `runs` is what the user started (one queued chat task,
 * one whole flow run), `requests` is how many times that reached a model. A single `/agent`
 * run is one chat run and many requests; a flow with three llm steps is one flow run and
 * three requests. Collapsing them is what made "total executions" unreadable.
 */
export interface DomainMetrics {
  runs: MetricCounts;
  requests: MetricCounts;
  tokens: TokenCounts;
  keys: Record<string, KeyMetrics>;
}

export interface DailyMetricCounts {
  chat: DomainMetrics;
  flow: DomainMetrics;
  /** Every metered token, including calls made outside a chat or flow (e.g. flow authoring). */
  tokens: TokenCounts;
  keys: Record<string, KeyMetrics>;
}

export interface MetricsSnapshot {
  chat: DomainMetrics;
  flow: DomainMetrics;
  tokens: TokenCounts;
  keys: Record<string, KeyMetrics>;
  daily: Record<string, DailyMetricCounts>;
  /** YYYY-MM-DD of the first recorded day; empty until something is recorded. */
  since: string;
}

export interface FlowExecutionEvent {
  flowId: string;
  name: string;
}

export interface FeedCandidate {
  url: string;
  title: string;
}

export interface ScraperPickRequest {
  url: string;
  target: 'title' | 'link' | 'list';
}

export interface ScraperPickResult {
  selector: string;
  count: number;
  itemSelector: string;
  titleSelector: string;
  linkSelector: string;
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

export type BackupCategoryId = 'config' | 'flows' | 'checkpoints' | 'memory' | 'userMemory' | 'outputs';

export const BACKUP_CATEGORY_IDS: readonly BackupCategoryId[] = [
  'config',
  'flows',
  'checkpoints',
  'memory',
  'userMemory',
  'outputs',
] as const;

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
  progress?: string;
  agentRunId?: string;
  clientToken?: string;
}

export interface OutputFile {
  name: string;
  path: string;
  timestamp: string;
  preview: string;
  provider?: string;
  turns?: number;
}

export interface StartedConversation {
  path: string;
  file: OutputFile;
  content: string;
  files: OutputFile[];
}

/** Every place a secret is stored behind safeStorage. */
export type SecretScope = 'telegram' | 'line' | 'smtp' | 'byok' | 'mcp' | 'dataKey';

/**
 * Where the user goes to re-enter a scope's secret, and what to call it. The label keys are
 * spelled out rather than built at the call site so `npm run i18n:check` can see them used.
 * 'flow' is not a settings category: those two are configured inside flow steps.
 */
export const SECRET_SCOPE_META: Record<SecretScope, { category: string; labelKey: string }> = {
  telegram: { category: 'bots', labelKey: 'secret.scope.telegram' },
  line: { category: 'bots', labelKey: 'secret.scope.line' },
  smtp: { category: 'flow', labelKey: 'secret.scope.smtp' },
  byok: { category: 'accounts', labelKey: 'secret.scope.byok' },
  mcp: { category: 'connectors', labelKey: 'secret.scope.mcp' },
  dataKey: { category: 'flow', labelKey: 'secret.scope.dataKey' },
} as const;

export interface SecretFailure {
  scope: SecretScope;
  /** Instance/server/key id when a scope holds several secrets; '' for singletons. */
  id: string;
  /** Field discriminator inside a scope, e.g. 'channelAccessToken'. */
  field: string;
  /** Name to show the user (BYOK instance, MCP server); '' when the scope speaks for itself. */
  label: string;
}

/**
 * 'intact'  — the OS key still decrypts our canary, so a failure is that one blob.
 * 'rotated' — the canary itself no longer decrypts: the whole key changed.
 * 'unknown' — no canary written yet (fresh install, or an upgrade from before canaries).
 */
export type SecretKeyState = 'intact' | 'rotated' | 'unknown';

export interface SecretHealth {
  keyState: SecretKeyState;
  /**
   * False means the OS keychain itself is out of reach right now (no libsecret, a locked or
   * denied macOS Keychain). The ciphertext is probably still fine, so this must never be
   * treated as a permanent loss and must never offer to delete anything.
   */
  encryptionAvailable: boolean;
  failures: SecretFailure[];
}

/** Identifies the one stored secret a delete request is aimed at. */
export interface SecretTarget {
  scope: SecretScope;
  id: string;
  field: string;
}

export interface UiNotificationPayload {
  title: string;
  body: string;
  level?: 'success' | 'info' | 'warning' | 'error';
  action?: {
    id: 'open-worker-window' | 'open-secret-settings';
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

export type TelegramChatKind = 'group' | 'supergroup' | 'channel';

export interface TelegramChannel {
  chatId: number;
  title: string;
  username?: string;
  chatType?: TelegramChatKind;
  canPost: boolean;
  discoveredAt: string;
  lostAt?: string;
}

export type BotContactKind = 'user' | 'chat';

export type BotReachability = 'ok' | 'blocked' | 'deactivated' | 'removed' | 'not_found' | 'no_rights';

export interface BotContact {
  platform: BotPlatform;
  kind: BotContactKind;
  id: string;
  title?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  chatType?: TelegramChatKind;
  pairedAt?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  reachability: BotReachability;
  unreachableSince?: string;
  lastError?: string;
}

export interface TelegramKnownUser {
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  resolvedAt: string;
}

export interface BotProviderCommand {
  enabled: boolean;
  command: string;
}

export interface BotLlmDirectConfig {
  enabled: boolean;
  targetUrl: string;
}

export interface BotBuiltinCommand {
  enabled: boolean;
  command: string;
  targetUrl: string;
}

export interface BotBuiltinCommands extends Record<BotBuiltinCommandKey, BotBuiltinCommand> {
  askTtlMinutes: number;
}

export type BotByokCommands = Record<string, boolean>;

export interface BotByokCommandInfo {
  id: string;
  kind: 'key' | 'group';
  name: string;
  command: string;
  enabled: boolean;
  hidden: boolean;
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
  channels: TelegramChannel[];
  knownUsers: TelegramKnownUser[];
  contacts: BotContact[];
}

export type LineRuntimeStatus = 'idle' | 'starting' | 'running' | 'error';

export interface LineAccountInfo {
  basicId: string;
  displayName: string;
  chatModeOn: boolean;
  webhookActive?: boolean;
  addFriendUrl: string;
  checkedAt: string;
}

export interface LineRuntimeSnapshot {
  status: LineRuntimeStatus;
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

export interface LinePendingCodeView extends LinePendingCode {
  deepLink: string;
}

export interface LinePairingSnapshot {
  pendingCodes: LinePendingCodeView[];
  pairedUsers: LinePairedUser[];
}

export interface LineReplyTarget {
  userId: string;
  chatId: string;
}

/** One pickable conversation for the line_read step's chat picker. */
export interface LineChatOption {
  id: string;
  name: string;
  type: string;
}

/**
 * `reason` is what the picker renders: 'disabled' earns a link to Settings, anything else is a
 * plain message. A failure must never look like "you have no chats".
 */
export type LineChatListResult =
  | { ok: true; chats: LineChatOption[] }
  | { ok: false; reason: 'disabled' | 'error'; message: string };

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

export interface DataKeyStatus {
  hasKey: boolean;
  preview: string;
}

export const DATA_KEY_MOENV = 'moenv';

/**
 * The LINE PC wxSQLite3 passphrase. Scanning it out of LINE's process memory takes ~80s, so it
 * is kept between launches — in the data-key store rather than config.json, because that store
 * is the one secret file the backup archive does NOT collect.
 */
export const DATA_KEY_LINE_DB = 'line.dbKey';

export interface SmtpCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface Task {
  id: string;
  prompt: string;
  displayPrompt?: string;
  instruction?: string;
  targetUrl?: string;
  title?: string;
  source?: 'hotkey' | 'ui' | 'telegram' | 'line';
  replyTarget?: TelegramReplyTarget;
  lineReplyTarget?: LineReplyTarget;
  attachments?: string[];
  ephemeralAttachments?: boolean;
  requesterName?: string;
  conversationPath?: string;
  placeholderTitle?: string;
  sendId?: string;
  sessionKey?: string;
  /** The prompt carries fetched outside content (a page or a transcript), not only what the user typed. */
  external?: boolean;
}

export interface PromptTriggerOptions {
  prompt: string;
  targetUrl?: string;
  attachments?: string[];
  conversationPath?: string;
  sendId?: string;
}

export interface ChatTurnEvent {
  sendId: string;
  conversationPath: string;
  phase: 'done' | 'error';
  prompt?: string;
  response?: string;
  meta?: TurnMeta;
  error?: string;
}

export type CaptureFormat = 'png' | 'webp' | 'pdf';
export type CaptureMode = 'save' | 'copy';
export type CardTheme = 'light' | 'dark';

export type CardLayout = 'document' | 'bubble';

export type CaptureRange = 'all' | 'last';

export const CAPTURE_WIDTHS = [720, 1000, 1200] as const;

export const CAPTURE_WIDTH_LABEL_KEYS: Record<number, string> = {
  720: 'capture.size.phone',
  1000: 'capture.size.standard',
  1200: 'capture.size.wide',
};

export function captureWidthLabelKey(width: number): string {
  return CAPTURE_WIDTH_LABEL_KEYS[width] ?? 'capture.size.standard';
}

export function snapCaptureWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_CAPTURE_WIDTH;
  return CAPTURE_WIDTHS.reduce((best, value) =>
    Math.abs(value - width) < Math.abs(best - width) ? value : best);
}

export const DEFAULT_CAPTURE_MARGIN = 40;
export const MAX_CAPTURE_MARGIN = 120;
export const CAPTURE_MARGIN_STEP = 10;
export const CAPTURE_MARGIN_MARKS = [0, 40, 80, 120] as const;

export function clampCaptureMargin(margin: unknown): number {
  const value = typeof margin === 'number' ? margin : Number.NaN;
  if (!Number.isFinite(value)) return DEFAULT_CAPTURE_MARGIN;
  return Math.max(0, Math.min(MAX_CAPTURE_MARGIN, Math.round(value)));
}

export const DEFAULT_CAPTURE_WIDTH = 1000;
export const MIN_CAPTURE_WIDTH = 600;
export const MAX_CAPTURE_WIDTH = 1200;

/**
 * The ceiling for any raster capture, in ENCODED pixels (logical height x pixel ratio).
 *
 * Two unrelated mechanisms land on the same number, both measured 2026-08-28 against a
 * real Chromium:
 *  - WebP stores each dimension in 14 bits, so 16383 is a hard format ceiling. At an
 *    encoded height of 16382 the encoder returned 48008 bytes; at 16384, nothing at all.
 *  - PNG has no format limit, but Chromium's max texture size does. A capture of encoded
 *    height 26798 came back at full size and passed every surface check — yet row 16384
 *    onward was the document drawn a second time from the top. It does not fail loudly;
 *    it hands back a plausible image that is wrong.
 *
 * The PNG half is why "it produced bytes" is not evidence a capture succeeded.
 */
export const MAX_CAPTURE_ENCODED_HEIGHT = 16_383;

/**
 * Extra page height a PDF export needs beyond the measured layout.
 *
 * printToPDF does not photograph the screen: Chromium lays the document out a second
 * time through its print engine, and that layout comes out slightly TALLER — per-line
 * rounding accumulating over a few hundred line boxes. Sizing the page from the screen
 * layout therefore left the bottom of the card off the page, where the injected
 * `overflow: hidden` silently clipped it, and the export came back with a bottom border
 * thinner than the other three.
 *
 * The inflation is NOT a fixed ratio, so it cannot be extrapolated from one sample.
 * Rasterising the real exports and measuring the bottom band row by row (2026-08-29):
 * a 7995px document inflated about 0.09%, but a 14524px one needed at least 0.37%. What
 * drives it is how many line boxes the content produces — tables and code blocks — not
 * the height alone. 1% + 8px covers both, with roughly 3x headroom over the worse of the
 * two. Whatever is left over is absorbed inside the card rather than between the card and
 * the page edge, so the border stays exactly the configured margin on all four sides.
 */
export function printPageSlack(logicalHeight: number): number {
  return Math.ceil(Math.max(0, logicalHeight) * 0.01) + 8;
}

export interface CaptureHeightVerdict {
  ok: boolean;
  /** What the encoder actually sees: the logical height multiplied by the pixel ratio. */
  encodedHeight: number;
  limit: number;
  /** A wider capture that should fit, or null when even the widest one will not. */
  suggestedWidth: number | null;
}

/**
 * The encoder sees `logicalHeight * pixelRatio`, not the logical height.
 * Comparing the logical height let tall documents through to a WebP encoder that returns
 * nothing at all and a PNG encoder that returns the document drawn twice.
 */
export function checkCaptureHeight(
  format: CaptureFormat,
  logicalHeight: number,
  pixelRatio: number,
  width: number,
): CaptureHeightVerdict {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio >= 1 ? pixelRatio : 1;
  const encodedHeight = Math.ceil(Math.max(0, logicalHeight) * ratio);
  const limit = MAX_CAPTURE_ENCODED_HEIGHT;
  if (format === 'pdf' || encodedHeight <= limit) {
    return { ok: true, encodedHeight, limit, suggestedWidth: null };
  }
  return {
    ok: false,
    encodedHeight,
    limit,
    suggestedWidth: widerCaptureWidth(width, encodedHeight, limit),
  };
}

/**
 * Reflowed text shortens roughly in proportion to how much wider it gets, so the width
 * that fits is about `width * encodedHeight / limit`, taken with headroom. The estimate
 * only has to be good enough to suggest: being wrong costs another in-panel notice.
 */
function widerCaptureWidth(width: number, encodedHeight: number, limit: number): number | null {
  const needed = (width * encodedHeight * 1.1) / limit;
  return CAPTURE_WIDTHS.find((value) => value > width && value >= needed) ?? null;
}

export {
  SHARE_EXPIRE_VALUES, SHARE_EXPIRE_SECONDS, DEFAULT_SHARE_INSTANCE, DEFAULT_INSTANCE_EXPIRES,
  PRIVATEBIN_DEFAULT_EXPIRES, clampShareExpire, isShareExpire, normalizeShareExpireList, resolveShareExpires,
} from './shareExpire';
export type { ShareExpire, ShareExpireCache } from './shareExpire';

export interface ShareSettings {
  instanceUrl: string;
  expire: ShareExpire;
  burnAfterReading: boolean;
  consentedAt: string;
  instanceExpires: ShareExpireCache | null;
}

export interface ShareLinkRequest {
  markdown: string;
  expire: ShareExpire;
  burnAfterReading: boolean;
}

export const SHARE_CONSENT_KEYS = [
  'share.consent.thirdParty',
  'share.consent.encrypted',
  'share.consent.anyoneWithLink',
  'share.consent.expires',
  'share.consent.browserCeiling',
] as const;
export type ShareConsentKey = (typeof SHARE_CONSENT_KEYS)[number];

export type ShareErrorCode =
  | 'unreachable'
  | 'rejected'
  | 'blocked'
  | 'empty'
  | 'noConsent'
  | 'unknown';

export interface ShareLinkResult {
  ok: boolean;
  url?: string;
  deleteUrl?: string;
  error?: ShareErrorCode;
  detail?: string;
}

export interface CaptureSettings {
  palette: string;
  backgroundStyle: string;
  direction: string;
  showPrompt: boolean;
  showProvider: boolean;
  showTimestamp: boolean;
  showTokens: boolean;
  format: CaptureFormat;
  cardLayout: CardLayout;
  range: CaptureRange;
  width: number;
  margin: number;
  pixelRatio: number;
  zip: boolean;
}

export type QuickExportFormat = CaptureFormat | 'text';

export interface QuickExportSettings {
  enabled: boolean;
  hotkey: string;
  format: QuickExportFormat;
  zip: boolean;
}

export function defaultQuickExportHotkey(isMac: boolean): string {
  return isMac ? 'Command+Ctrl+H' : 'Alt+H';
}

export function defaultMainHotkey(isMac: boolean): string {
  return isMac ? 'Command+Ctrl+G' : 'Alt+G';
}

export type HotkeyBindResult = 'ok' | 'conflict' | 'taken';

export interface PanelHeight {
  panel: number;
  total: number;
}

export interface ExportPromptPayload {
  defaultName: string;
  /** Why the previous attempt failed, shown above the controls when the panel reopens. */
  notice?: string;
  format: QuickExportFormat;
  zip: boolean;
  width: number;
  margin: number;
  palette: string;
  backgroundStyle: string;
  direction: string;
  theme: Theme;
  strings: {
    title: string;
    fileName: string;
    zip: string;
    size: string;
    copy: string;
    save: string;
    cancel: string;
    theme: string;
    margin: string;
    share: ExportPromptShareStrings;
  };
  sizes: Array<{ value: number; label: string }>;
  share: ExportPromptShareState;
}

export interface ExportPromptShareStrings {
  format: string;
  instance: string;
  expire: string;
  burn: string;
  create: string;
  creating: string;
  consentIntro: string;
  consentAccept: string;
}

export interface ExportPromptShareState {
  consented: boolean;
  instanceHost: string;
  expire: ShareExpire;
  burnAfterReading: boolean;
  expires: Array<{ value: ShareExpire; label: string }>;
  consentPoints: Array<{ key: ShareConsentKey; text: string }>;
}

export interface ShareResultState {
  url: string;
  revoked: boolean;
  burned: boolean;
  error: string;
  strings: {
    hint: string;
    copied: string;
    open: string;
    burnBlocked: string;
    revoke: string;
    revoked: string;
    done: string;
  };
}

export type ShareResultAction = 'revoke' | 'open' | 'done';

export type CaptureExportAction = 'copy' | 'save';

export interface CaptureExportChoice {
  kind: 'capture';
  fileName: string;
  format: CaptureFormat;
  zip: boolean;
  width: number;
  margin: number;
  palette: string;
  action: CaptureExportAction;
}

export interface ShareExportChoice {
  kind: 'share';
  expire: ShareExpire;
  burnAfterReading: boolean;
  consentAccepted: boolean;
}

export type ExportPromptChoice = CaptureExportChoice | ShareExportChoice;

export function captureRidesAsImage(format: string, zip: boolean): boolean {
  return !zip && format === 'png';
}

const CAPTURE_FORMATS: readonly CaptureFormat[] = ['png', 'webp', 'pdf'];

export interface ExportChoiceFallback {
  format: QuickExportFormat;
  zip: boolean;
  width: number;
  margin: number;
  palette: string;
  expire: ShareExpire;
  burnAfterReading: boolean;
}

export function normalizeExportChoice(
  raw: unknown,
  fallback: ExportChoiceFallback,
): ExportPromptChoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<CaptureExportChoice> & Partial<ShareExportChoice>;

  if (value.kind === 'share') {
    return {
      kind: 'share',
      expire: SHARE_EXPIRE_VALUES.includes(value.expire as ShareExpire)
        ? (value.expire as ShareExpire)
        : fallback.expire,
      burnAfterReading: typeof value.burnAfterReading === 'boolean'
        ? value.burnAfterReading
        : fallback.burnAfterReading,
      consentAccepted: value.consentAccepted === true,
    };
  }

  return {
    kind: 'capture',
    fileName: typeof value.fileName === 'string' ? value.fileName.trim() : '',
    format: CAPTURE_FORMATS.includes(value.format as CaptureFormat)
      ? (value.format as CaptureFormat)
      : captureFormatOf(fallback.format),
    zip: typeof value.zip === 'boolean' ? value.zip : fallback.zip,
    width: (CAPTURE_WIDTHS as readonly number[]).includes(value.width as number)
      ? (value.width as number)
      : snapCaptureWidth(fallback.width),
    margin: typeof value.margin === 'number'
      ? clampCaptureMargin(value.margin)
      : clampCaptureMargin(fallback.margin),
    palette: CAPTURE_PALETTES.some((entry) => entry.key === value.palette)
      ? (value.palette as string)
      : fallback.palette,
    action: value.action === 'save' ? 'save' : 'copy',
  };
}

export function captureFormatOf(format: QuickExportFormat): CaptureFormat {
  return format === 'text' ? 'png' : format;
}

export interface CaptureTurn {
  prompt: string;
  response: string;
  provider?: string;
  timestamp?: string;
  tokens?: string;
}

export interface MarkdownCapturePayload {
  title: string;
  prompt: string;
  content: string;
  summary: string;
  provider: string;
  timestamp: string;
  turns?: CaptureTurn[];
  tokensTotal?: string;
}

export interface MarkdownCaptureOptions {
  mode: CaptureMode;
  format: CaptureFormat;
  fileName?: string;
  showPrompt: boolean;
  showContent: boolean;
  showProvider: boolean;
  showTimestamp: boolean;
  showTokens: boolean;
  width: number;
  margin?: number;
  background: string;
  cardTheme: CardTheme;
  cardLayout: CardLayout;
  pixelRatio: number;
  zip: boolean;
}

export interface MarkdownCaptureRequest {
  payload: MarkdownCapturePayload;
  options: MarkdownCaptureOptions;
}

export interface MarkdownCaptureResult {
  ok: boolean;
  filePath?: string;
  error?: string;
  canceled?: boolean;
}

export type SkillType = 'shell' | 'run' | 'js' | 'browser' | 'browser_open' | 'browser_js' | 'browser_close' | 'llm' | 'clipboard' | 'delay' | 'notify' | 'capture' | 'share' | 'bot' | 'rss' | 'stop' | 'comment' | 'scraper' | 'search' | 'research' | 'gmap_reviews' | 'line_read' | 'loop' | 'end_loop' | 'if' | 'end_if' | 'on_change' | 'sysinfo' | 'http' | 'youtube' | 'youtube_subs' | 'power' | 'restart_app' | 'file_write' | 'file_read' | 'file_list' | 'file_delete' | 'file_download' | 'email_send' | 'text' | 'stock' | 'forex' | 'weather' | 'air_quality' | 'random' | 'break' | 'continue';

export interface SkillInstance {
  id: string;
  type: SkillType;
  label: string;
  config: Record<string, string>;
  outputKey: string;
}

export type TriggerType = 'hotkey' | 'cron' | 'manual' | 'bot' | 'chat';

export type BotPlatform = 'telegram' | 'line';
export const BOT_PLATFORMS: readonly BotPlatform[] = ['telegram', 'line'] as const;

export function isBotPlatform(value: string): value is BotPlatform {
  return (BOT_PLATFORMS as readonly string[]).includes(value);
}
export type ScheduleMode = 'interval' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'once';

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
  /** interval + hours: fire at this minute past the hour. */
  intervalMinuteOffset?: number;
  /** monthly: days 1-31, plus LAST_DAY_OF_MONTH (-1) for the month's final day. */
  monthDays?: number[];
  /** yearly: 1-12. */
  scheduleMonth?: number;
  /** yearly: 1-31. */
  scheduleDay?: number;
  /** once: 'YYYY-MM-DD'. */
  onceDate?: string;
  /** Run once on next launch when the machine was off at the scheduled time. */
  catchUpMissed?: boolean;
  botCommand?: string;
  botCommandDescription?: string;
  botInputVariable?: string;
  /** Bot user ids allowed to run this command; empty or absent means every paired user. */
  botAllowedUserIds?: string[];
  chatCommand?: string;
  chatCommandDescription?: string;
  chatInputVariable?: string;
}

export interface SchedulePreview {
  /** ISO timestamps of the next fire times, straight from the scheduler that will run them. */
  runs: string[];
  expression: string;
  expired?: boolean;
  error?: string;
}

export type FlowVariableType =
  | 'text' | 'number' | 'select' | 'chat' | 'lineChat' | 'folder' | 'file' | 'feed' | 'url';

export const FLOW_VARIABLE_TYPES: readonly FlowVariableType[] =
  ['text', 'number', 'select', 'chat', 'lineChat', 'folder', 'file', 'feed', 'url'] as const;

export interface FlowVariableOption {
  value: string;
  label: string;
}

export interface FlowVariable {
  key: string;
  type: FlowVariableType;
  label: string;
  question?: string;
  hint?: string;
  value: string;
  required?: boolean;
  options?: FlowVariableOption[];
  min?: string;
  max?: string;
  multiline?: boolean;
  placeholder?: string;
  pickTarget?: 'title' | 'link' | 'list';
  pickUrlKey?: string;
  pickWriteKeys?: { title?: string; link?: string };
  hiddenInSetup?: boolean;
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

export const FLOW_EXPORT_TYPE = 'flow-export';
export const LEGACY_FLOW_EXPORT_TYPE = 'agentflow-export';

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
  tokenUsage?: TokenUsage;
  finalOutput?: string;
  lastLlmProvider?: string;
  titleHint?: string;
  /**
   * Steps that failed but were swallowed by `emitFailFlag`. The run still reports `success`,
   * so this is the only place the loss is visible to the caller.
   */
  softFailures?: number;
}

export interface ChatCommandResult {
  result: FlowExecutionResult;
  filePath?: string;
}

export const BUILTIN_NEW_COMMAND = 'new';
export const BUILTIN_NEW_FLOW_ID = '__builtin:new__';
export const BUILTIN_NEW_ALIAS = 'clear';

export const BUILTIN_CHAT_COMMAND = 'chat';
export const BUILTIN_CHAT_FLOW_ID = '__builtin:chat__';

export const BUILTIN_MODEL_COMMAND = 'model';
export const BUILTIN_MODEL_FLOW_ID = '__builtin:model__';

export const BUILTIN_SEARCH_COMMAND = 'search';
export const BUILTIN_SEARCH_FLOW_ID = '__builtin:search__';
export const BUILTIN_SEARCH_ALIAS = 's';

export const BUILTIN_QUICKSEARCH_COMMAND = 'quicksearch';
export const BUILTIN_QUICKSEARCH_FLOW_ID = '__builtin:quicksearch__';
export const BUILTIN_QUICKSEARCH_ALIAS = 'qs';

export type SearchMode = 'standard' | 'quick';

export interface SearchCommandResult {
  success: boolean;
  error?: string;
  filePath?: string;
}

export const BUILTIN_AGENT_COMMAND = 'agent';
export const BUILTIN_AGENT_FLOW_ID = '__builtin:agent__';

export const AGENT_ASK_TOOL = 'ask_user';

export interface AgentCommandResult {
  success: boolean;
  error?: string;
  filePath?: string;
  question?: string;
  /** Answers the question offers, in the order shown; the chosen text is sent back as the answer. */
  choices?: string[];
  runId?: string;
  /**
   * The connectors the run itself holds, reported with a question. A run resumed from the banner has
   * no composer scope to record, and the reply typed under its connector still has to match one.
   */
  mcpServerIds?: string[];
}

/**
 * One change the agent proposed and what became of it — the persisted, renderer-safe view of the
 * main process's action record. Read by the next turn in the conversation and by the trace view.
 */
export interface AgentActionSummary {
  step: number;
  server: string;
  tool: string;
  label: string;
  at: string;
  verdict: 'ready' | 'blocked';
  reasons?: { code: string; message: string }[];
  confirmed?: 'auto' | 'approved' | 'denied';
  outcome?: string;
  summary?: string;
  verification?: { status: string; evidence: string };
}

export interface AgentTurnRecord {
  /** The step: one per call, the number the model and the trace rows use. */
  index: number;
  /**
   * The model decision that produced this step. A `call_tools` batch files several steps under one
   * turn, and a resumed run continues the TURN count from here. Absent on records written before
   * batches existed, where a turn was always exactly one step and `index` is it.
   */
  turn?: number;
  thought: string;
  tool: string;
  config: Record<string, string>;
  observation: string;
  status: 'ok' | 'error';
}

export type AgentRunStatus = 'running' | 'failed' | 'cancelled' | 'done' | 'awaiting';

export interface AgentRunState {
  runId: string;
  goal: string;
  providerUrl: string;
  conversationPath?: string;
  attachments?: string[];
  /**
   * The MCP servers the user disclosed for this run. Persisted, so a resume discloses the same
   * set. Read through `readRunConnectors` — runs written before this was plural hold a singular
   * `mcpServerId`, and a resume that silently loses its scope widens what the agent may touch.
   */
  mcpServerIds?: readonly string[];
  /** Legacy single-server scope. Migrated on read; never written. */
  mcpServerId?: string;
  /** The slash command that started the run, for the conversation badge. */
  mcpCommandName?: string;
  /**
   * The "web" capability this run was started with. `undefined` means on — the default, and what
   * every run written before the toggle existed had. A resume must keep it: re-enabling the web
   * on resume would widen a run the user deliberately narrowed.
   */
  web?: boolean;
  status: AgentRunStatus;
  /**
   * The step ceiling this run negotiated for itself. Absent on runs written before the ceiling
   * was self-assessed, and on runs that never raised it — a resume falls back to the default,
   * which is what those runs had anyway.
   */
  maxTurns?: number;
  /** What the first action said the GOAL lets this run change. Kept so a resume starts from it. */
  intent?: { change: string[]; content: string };
  /** The append-only checklist and completed item numbers, preserved across resumes. */
  plan?: { steps: string[]; done: number[] };
  /**
   * The facts this run read and every change it proposed, with what became of each. A later turn in
   * the same conversation loads these instead of trusting the answer text written about them.
   */
  evidence?: { facts: unknown[]; actions: AgentActionSummary[] };
  turns: AgentTurnRecord[];
  result?: { title: string; content: string };
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunSummary {
  runId: string;
  goal: string;
  status: AgentRunStatus;
  turns: number;
  updatedAt: string;
}

export type AgentStageLabel =
  | 'planning' | 'fetching' | 'read' | 'analyzing' | 'synthesizing' | 'repairing'
  | 'delegating' | 'confirming' | 'verifying'
  /** Flow building: matching the request against the skill list, and writing the steps. */
  | 'discovering' | 'building';

export type AgentTraceEvent =
  | { kind: 'thinking'; turn: number; provider?: string }
  | { kind: 'tool'; turn: number; tool: string; config: Record<string, string>; thought?: string }
  | { kind: 'plan'; steps: string[]; done: number[] }
  | { kind: 'stage'; turn: number; label: AgentStageLabel; detail?: string }
  | { kind: 'observation'; turn: number; tool: string; status: 'ok' | 'error'; preview: string }
  | { kind: 'synthesizing' }
  | { kind: 'done'; title: string }
  | { kind: 'question'; question: string; choices?: string[] }
  | { kind: 'failed'; error: string }
  | { kind: 'cancelled' };

export interface AgentTracePayload {
  runId: string;
  event: AgentTraceEvent;
}

export type FlowGenerationResult =
  | { ok: true; flow: FlowDefinition }
  | { ok: false; error: string };

export interface FlowAssessment {
  skills: string[];
  trigger: TriggerType;
  outline: string[];
  gaps: string[];
  /**
   * What the assessor could not work out from the request, and would otherwise have invented a
   * value for — a missing feed URL, recipient or report source. Empty when the request is
   * concrete enough to build from, which is the common case and the one that must stay fast.
   */
  questions: string[];
  verdict: 'full' | 'partial' | 'none';
}

export type FlowAssessResult =
  | { ok: true; assessment: FlowAssessment }
  | { ok: false; error: string };

/** The five phases of building a flow, in the order they run. */
export const FLOW_BUILD_PHASES = ['understand', 'discover', 'plan', 'build', 'verify'] as const;

export type FlowBuildPhase = typeof FLOW_BUILD_PHASES[number];

/** An integration a step needs before it can do anything, and that the user has to set up once. */
export type FlowSetupNeed = 'bot' | 'email' | 'line';

export interface FlowBuildBlocker {
  skill: SkillType;
  need: FlowSetupNeed;
}

export type FlowBuildIssueKind =
  /** A required config field the generator left blank or filled with a placeholder. */
  | 'blank'
  /** An in-loop step that would strand the whole batch when one item fails. */
  | 'failsoft'
  /** A step whose integration is not set up yet. */
  | 'setup';

export interface FlowBuildIssue {
  kind: FlowBuildIssueKind;
  /** 1-based, matching how steps are numbered everywhere else the user sees them. */
  step: number;
  skill: SkillType;
  /** The config key at fault for 'blank'; the integration for 'setup'. */
  detail: string;
}

export interface FlowBuildReport {
  skills: SkillType[];
  steps: number;
  trigger: TriggerType;
  issues: FlowBuildIssue[];
  gaps: string[];
}

export type FlowBuildEvent =
  | { kind: 'phase'; phase: FlowBuildPhase; status: 'active' | 'done' | 'failed'; detail?: string }
  /** The model the request actually went to — not always the one the user picked. */
  | { kind: 'provider'; label: string }
  /** What the request resolved to, and what of it is not set up yet. */
  | { kind: 'tools'; skills: SkillType[]; blocked: FlowBuildBlocker[] }
  | { kind: 'outline'; outline: string[] }
  | { kind: 'questions'; questions: string[] }
  | { kind: 'done'; report: FlowBuildReport; flowName: string }
  | { kind: 'failed'; phase: FlowBuildPhase; error: string; blocked?: FlowBuildBlocker[] };

export interface FlowBuildPayload {
  buildId: string;
  event: FlowBuildEvent;
}

/** One question the build asked, paired with what the user answered. */
export interface FlowClarification {
  question: string;
  answer: string;
}

/** One build attempt; `answers` is present only on a retry that carries the user's replies. */
export interface FlowBuildRequestPayload {
  description: string;
  buildId: string;
  answers?: FlowClarification[];
  /** The model the user picked for this build. Empty falls back the way it always has. */
  providerUrl?: string;
}

export type FlowBuildOutcome =
  | { status: 'created'; flow: FlowDefinition; report: FlowBuildReport }
  | { status: 'questions'; questions: string[] }
  | { status: 'failed'; phase: FlowBuildPhase; error: string; blocked?: FlowBuildBlocker[] };

export type AgentConfirmRequestData =
  | { kind: 'flow'; flowName: string; stepTypes: string[]; sensitiveTypes: string[] }
  | {
    kind: 'mcp';
    serverName: string;
    toolName: string;
    argsPreview: string;
    /** Resolved facts the user can judge (which account, which message, who receives it). */
    rows?: AgentConfirmRow[];
    /** False for sending, deleting and built-in connectors, where "always allow" cannot apply. */
    allowAlways?: boolean;
    danger?: boolean;
  }
  | { kind: 'shell'; command: string; interpreter: string; cwd: string };

export interface AgentConfirmRow {
  key: string;
  value: string;
  /** Localized value instead of `value`, with `vars` interpolated. */
  valueKey?: string;
  vars?: Record<string, string>;
}

export type AgentConfirmPayload = AgentConfirmRequestData & { id: string };

/**
 * `approveAlways` means different things per kind and deliberately so: for `mcp` it is
 * persisted into that server's settings, for `shell` it lasts only until this run ends. Never
 * unify them — a shell allow-all that survived the app restart is a different product.
 */
export type AgentConfirmChoice = 'approve' | 'approveAlways' | 'deny';

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
  hotkeyEnabled: boolean;
  shortcuts: Record<string, { combo?: string; off?: true }>;
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
