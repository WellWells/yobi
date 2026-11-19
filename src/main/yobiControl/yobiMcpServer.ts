/**
 * In-process MCP server that controls Yobi itself: its default models, flows, conversations,
 * statistics, updates, restarts and the Settings page (`yobiSettings.ts`). Takes everything it touches as parameters; the real ones are in
 * yobiConnection.ts. Who may reach it from a bot is the `manage` grant; every change goes through
 * the action gate and is confirmed (`yobiContract.ts`).
 *
 * The connector is on by default, so it carries no connector notes (they sit in every turn of every
 * run): what the model must know is in each description's first sentence, the part the catalog shows.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { FlowDefinition, OutputFile, TriggerConfig } from '../../shared/types';
import { ToolError, createToolServer, type ToolServer } from '../mcp/inProcessServer';
import { ALSO_NAMED, ENUM_ALIASES } from '../mcp/schemaAliases';
import { YOBI_SETTINGS_TOOLS, getSettings, setSettings, type SettingSpec } from './yobiSettings';
import { YOBI_API_KEY_TOOLS, testApiKeys, type YobiApiKeyDeps } from './yobiApiKeys';

export const YOBI_SERVER_NAME = 'Yobi Control';

/** Where a default model is set: the chat, AI flow building, the link analyses, and each bot platform. */
export const MODEL_TARGETS = ['chat', 'flow_build', 'maps_analysis', 'article_analysis', 'telegram', 'line', 'line_pc', 'discord', 'slack'] as const;
export type ModelTarget = (typeof MODEL_TARGETS)[number];

/** A model the user can pick: a provider's web chat, or one of their API keys or key groups. */
export interface ModelChoice {
  /** `gemini`, `byok:<id>`, `byokgroup:<id>`. */
  id: string;
  label: string;
  url: string;
}

/** Update state as the updater reports it (`updater.ts` `updateState`). */
export interface YobiUpdateState {
  current: string;
  state: string;
  version?: string;
  releaseUrl?: string;
  installsItself: boolean;
}

export type YobiConversation = OutputFile & { id: string };

export interface YobiTrashResult {
  moved: number;
  failed: number;
  busy: number;
}

export interface YobiControlDeps extends YobiApiKeyDeps {
  now: () => Date;
  version: () => string;
  listFlows: () => readonly FlowDefinition[];
  /** The next `count` runs of a schedule trigger, as ISO strings; none for other triggers. */
  nextRuns: (trigger: TriggerConfig, count: number) => string[];
  /** A schedule trigger as one English sentence ("Every 10 minutes", "Daily at 09:00"). */
  describeSchedule: (trigger: TriggerConfig) => string;
  /** Returns the ids whose state changed (a flow missing required settings stays off). */
  setFlowsEnabled: (ids: readonly string[], enabled: boolean) => Promise<string[]>;
  modelChoices: () => ModelChoice[];
  /** The URL each target uses now; '' = follows the chat model (or the app's, for a bot). */
  modelSettings: () => Partial<Record<ModelTarget, string>>;
  setModel: (target: ModelTarget, url: string) => void;
  /** Newest first; `id` is the path inside the output folder, `/`-separated. */
  listConversations: () => Promise<YobiConversation[]>;
  trashConversations: (files: readonly YobiConversation[]) => Promise<YobiTrashResult>;
  updateState: () => YobiUpdateState;
  checkForUpdates: () => Promise<void>;
  /** Installs the downloaded update once nothing is running; false when none is ready. */
  scheduleInstall: () => boolean;
  /** Restarts Yobi once nothing is running. */
  scheduleRestart: () => void;
  resetStatistics: () => void;
  /** How many tasks are running or waiting (flows, /agent, prompts). */
  queueSize: () => number;
  /** The Settings page's rows, built when asked. */
  settingsCatalog: () => Promise<SettingSpec[]>;
  /** Settings changed here: the Settings page and the chat read them again. */
  settingsChanged: (ids: string[]) => void;
}

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DELETE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

const FLOWS_ARG = {
  type: 'array',
  items: { type: 'string' },
  description: 'Flow names exactly as yobi_list_flows gives them (or their ids)',
  [ALSO_NAMED]: ['flow_ids', 'ids', 'names', 'flow', 'flow_names'],
};

export const YOBI_TOOLS: Tool[] = [
  {
    name: 'yobi_overview',
    description: 'Yobi\'s own state in short: version, update status, default models, counts of flows and conversations, tasks running, and the names of the other yobi_ tools.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Yobi overview', ...READ },
  },
  {
    name: 'yobi_list_flows',
    description: 'List the user\'s Yobi flows with on/off state, trigger and next scheduled runs (local time). from/to (HH:MM) keep flows that run in that time of day.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'HH:MM, local time; with to, only flows scheduled to run between them', [ALSO_NAMED]: ['start', 'after'] },
        to: { type: 'string', description: 'HH:MM, local time', [ALSO_NAMED]: ['end', 'before', 'until'] },
        enabled: { type: 'boolean', description: 'true = only flows that are on; false = only flows that are off' },
      },
    },
    annotations: { title: 'List flows', ...READ },
  },
  {
    name: 'yobi_set_flows_enabled',
    description: 'Turn Yobi flows on or off by name. List them first; the user confirms the change.',
    inputSchema: {
      type: 'object',
      properties: { flows: FLOWS_ARG, enabled: { type: 'boolean', description: 'true = on, false = off' } },
      required: ['flows', 'enabled'],
    },
    annotations: { title: 'Turn flows on or off', ...WRITE },
  },
  {
    name: 'yobi_list_models',
    description: 'The default model of Yobi\'s chat, AI flow building and each bot, and every model the user can pick.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'List models', ...READ },
  },
  {
    name: 'yobi_set_model',
    description: 'Set Yobi\'s default model for the chat, AI flow building or a bot; model = a choice from yobi_list_models, or "default" to follow the chat.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: [...MODEL_TARGETS],
          description: 'chat = Yobi\'s own chat; maps_analysis / article_analysis = the Google Maps review and post analysis buttons; a bot platform = that bot\'s answers',
          [ENUM_ALIASES]: {
            app: 'chat', desktop: 'chat', yobi: 'chat', linepc: 'line_pc', lineself: 'line_pc', flow: 'flow_build', flows: 'flow_build', build: 'flow_build',
            maps: 'maps_analysis', map: 'maps_analysis', reviews: 'maps_analysis', article: 'article_analysis', post: 'article_analysis', posts: 'article_analysis',
          },
          [ALSO_NAMED]: ['for', 'where', 'platform'],
        },
        model: { type: 'string', description: 'A choice id or name from yobi_list_models, or "default"', [ALSO_NAMED]: ['provider', 'choice', 'name'] },
      },
      required: ['target', 'model'],
    },
    annotations: { title: 'Set the default model', ...WRITE },
  },
  {
    name: 'yobi_list_conversations',
    description: 'List Yobi\'s saved conversations, newest first, with their ids. query filters by title.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words in the title', [ALSO_NAMED]: ['search', 'title', 'keyword'] },
        older_than_days: { type: 'number', description: 'Only conversations last changed more than this many days ago' },
        limit: { type: 'number', description: 'Default 20, at most 100' },
      },
    },
    annotations: { title: 'List conversations', ...READ },
  },
  {
    name: 'yobi_delete_conversations',
    description: 'Move Yobi conversations to Recently Deleted (restorable for a while). Pass ids from yobi_list_conversations; the user confirms.',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, description: 'Conversation ids', [ALSO_NAMED]: ['conversations', 'conversation_ids', 'files'] } },
      required: ['ids'],
    },
    annotations: { title: 'Delete conversations', ...DELETE },
  },
  {
    name: 'yobi_check_update',
    description: 'Check now whether a newer Yobi version is out.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Check for updates', ...READ, idempotentHint: false },
  },
  {
    name: 'yobi_install_update',
    description: 'Install a downloaded Yobi update: Yobi restarts once running tasks finish. The user confirms.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Install the update', ...WRITE },
  },
  {
    name: 'yobi_restart',
    description: 'Restart Yobi once running tasks finish. The user confirms.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Restart Yobi', ...WRITE },
  },
  {
    name: 'yobi_reset_statistics',
    description: 'Clear Yobi\'s usage statistics (requests, tokens, flow runs) for good. The user confirms.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'Clear statistics', ...DELETE },
  },
  ...YOBI_SETTINGS_TOOLS,
  ...YOBI_API_KEY_TOOLS,
];

const CONVERSATION_LIMIT = 20;
const CONVERSATION_LIMIT_MAX = 100;
/** Runs looked at per schedule for a time-of-day question: a week of an hourly flow. */
const RUNS_LOOKED_AT = 24 * 7;
const RUNS_SHOWN = 3;
const WEEK_MS = 7 * 24 * 60 * 60_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local wall-clock time, the form the user thinks in ("Mon 2026-11-16 07:30"). */
function localTime(date: Date): string {
  return `${WEEKDAYS[date.getDay()]} ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function minutesOf(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const match = typeof value === 'string' ? /^\s*(\d{1,2})[:：](\d{2})\s*$/.exec(value) : null;
  const hours = match ? Number(match[1]) : NaN;
  const minutes = match ? Number(match[2]) : NaN;
  if (!(hours >= 0 && hours <= 24 && minutes >= 0 && minutes < 60)) {
    throw new ToolError('invalid_time', `${field} must be a time of day as HH:MM, such as 06:00.`);
  }
  return Math.min(hours * 60 + minutes, 24 * 60);
}

/** Whether a run falls in [from, to] by time of day; a window past midnight (22:00–02:00) wraps. */
function inWindow(date: Date, from: number, to: number): boolean {
  const at = date.getHours() * 60 + date.getMinutes();
  return from <= to ? at >= from && at <= to : at >= from || at <= to;
}

function triggerList(flow: FlowDefinition): TriggerConfig[] {
  return [flow.trigger, ...(flow.extraTriggers ?? [])].filter((trigger): trigger is TriggerConfig => Boolean(trigger));
}

// The schedule in words: three upcoming runs of an every-10-minutes flow all fall tonight, and a
// model reading only those says it never runs in the morning.
function triggerName(deps: YobiControlDeps, trigger: TriggerConfig): string {
  if (trigger.type === 'bot' && trigger.botCommand) return `bot command /${trigger.botCommand}`;
  if (trigger.type === 'hotkey' && trigger.keys) return `hotkey ${trigger.keys}`;
  if (trigger.type !== 'cron') return trigger.type;
  const said = deps.describeSchedule(trigger).trim();
  return said ? `schedule: ${said}` : 'schedule';
}

function upcomingRuns(deps: YobiControlDeps, flow: FlowDefinition, count: number): Date[] {
  const runs = triggerList(flow)
    .filter((trigger) => trigger.type === 'cron')
    .flatMap((trigger) => {
      try {
        return deps.nextRuns(trigger, count);
      } catch {
        return [];
      }
    })
    .map((iso) => new Date(iso))
    .filter((date) => !Number.isNaN(date.getTime()));
  return runs.sort((a, b) => a.getTime() - b.getTime());
}

function listFlows(deps: YobiControlDeps, args: Record<string, unknown>): unknown {
  const from = minutesOf(args.from, 'from');
  const to = minutesOf(args.to, 'to');
  if ((from === null) !== (to === null)) throw new ToolError('invalid_time', 'Give both from and to, or neither.');
  const all = deps.listFlows();
  const wantEnabled = typeof args.enabled === 'boolean' ? args.enabled : null;
  const horizon = deps.now().getTime() + WEEK_MS;
  const flows = all.flatMap((flow) => {
    if (wantEnabled !== null && flow.enabled !== wantEnabled) return [];
    const windowed = from !== null && to !== null;
    const runs = upcomingRuns(deps, flow, windowed ? RUNS_LOOKED_AT : RUNS_SHOWN);
    const shown = windowed
      ? runs.filter((date) => date.getTime() <= horizon && inWindow(date, from, to))
      : runs;
    if (windowed && shown.length === 0) return [];
    return [{
      name: flow.name,
      id: flow.id,
      enabled: flow.enabled,
      triggers: triggerList(flow).map((trigger) => triggerName(deps, trigger)),
      ...(shown.length > 0 ? { next_runs: shown.slice(0, RUNS_SHOWN).map(localTime) } : {}),
    }];
  });
  return {
    total: all.length,
    enabled: all.filter((flow) => flow.enabled).length,
    ...(from !== null ? { window: `${String(args.from).trim()}–${String(args.to).trim()} local time, next 7 days` } : {}),
    now: localTime(deps.now()),
    flows,
    ...(flows.some((flow) => !flow.enabled) ? { note: 'next_runs of a flow that is off are when it would run once turned on.' } : {}),
  };
}

/** The flows the model named, each by id or exact name; an unknown or ambiguous name refuses the call. */
function namedFlows(deps: YobiControlDeps, raw: unknown): FlowDefinition[] {
  const wanted = (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim());
  if (wanted.length === 0) throw new ToolError('invalid_arguments', 'flows must name at least one flow.');
  const all = deps.listFlows();
  const picked = new Map<string, FlowDefinition>();
  for (const name of wanted) {
    const byId = all.find((flow) => flow.id === name);
    const byName = byId ? [byId] : all.filter((flow) => flow.name.trim().toLowerCase() === name.toLowerCase());
    if (byName.length === 0) throw new ToolError('not_found', `No flow is named "${name.slice(0, 80)}". List the flows and use a name exactly as given.`);
    if (byName.length > 1) {
      throw new ToolError('ambiguous', `${byName.length} flows are named "${name.slice(0, 80)}". Pass their ids instead.`, { ids: byName.map((flow) => flow.id) });
    }
    picked.set(byName[0].id, byName[0]);
  }
  return [...picked.values()];
}

async function setFlowsEnabled(deps: YobiControlDeps, args: Record<string, unknown>): Promise<unknown> {
  if (typeof args.enabled !== 'boolean') throw new ToolError('invalid_arguments', 'enabled must be true or false.');
  const enabled = args.enabled;
  const flows = namedFlows(deps, args.flows);
  // Read before the change: the flow manager updates these same objects, so afterwards every flow
  // looks "already off" and the answer cannot tell a change from none.
  const wasEnabled = new Map(flows.map((flow) => [flow.id, flow.enabled]));
  const toChange = flows.filter((flow) => flow.enabled !== enabled);
  const changed = new Set(toChange.length > 0 ? await deps.setFlowsEnabled(toChange.map((flow) => flow.id), enabled) : []);
  const result = flows.map((flow) => {
    if (wasEnabled.get(flow.id) === enabled) return { name: flow.name, result: enabled ? 'already on' : 'already off' };
    if (changed.has(flow.id)) return { name: flow.name, result: enabled ? 'turned on' : 'turned off' };
    return { name: flow.name, result: 'not turned on: it is missing required settings; the user must fill them in the flow editor' };
  });
  return { flows: result };
}

function modelLabel(choices: readonly ModelChoice[], url: string, unset: string): string {
  if (!url) return unset;
  return choices.find((choice) => choice.url === url)?.label ?? 'a model no longer available';
}

function modelSettings(deps: YobiControlDeps): Record<string, string> {
  const choices = deps.modelChoices();
  const settings = deps.modelSettings();
  const out: Record<string, string> = {};
  for (const target of MODEL_TARGETS) {
    const url = settings[target];
    if (url === undefined) continue;
    out[target] = modelLabel(choices, url, target === 'chat' ? 'not set' : 'follows the chat model');
  }
  return out;
}

function listModels(deps: YobiControlDeps): unknown {
  return {
    defaults: modelSettings(deps),
    choices: deps.modelChoices().map(({ id, label }) => ({ id, name: label })),
  };
}

const FOLLOW_WORDS = new Set(['default', 'follow', 'follow chat', 'none', 'app', '預設', '预设', '默认', '跟隨', '跟随']);

function setModel(deps: YobiControlDeps, args: Record<string, unknown>): unknown {
  const target = typeof args.target === 'string' ? args.target.trim() : '';
  if (!(MODEL_TARGETS as readonly string[]).includes(target)) {
    throw new ToolError('invalid_arguments', `target must be one of: ${MODEL_TARGETS.join(', ')}.`);
  }
  const typed = typeof args.model === 'string' ? args.model.trim() : '';
  if (!typed) throw new ToolError('invalid_arguments', 'model is required.');
  const settings = deps.modelSettings();
  if (settings[target as ModelTarget] === undefined) {
    throw new ToolError('not_available', `${target} is not set up in Yobi, so it has no model to set.`);
  }
  const choices = deps.modelChoices();
  let url = '';
  if (FOLLOW_WORDS.has(typed.toLowerCase())) {
    if (target === 'chat') throw new ToolError('invalid_arguments', 'The chat needs a model of its own; pick one from the choices.');
  } else {
    const lower = typed.toLowerCase();
    const match = choices.find((choice) => choice.id.toLowerCase() === lower)
      ?? choices.find((choice) => choice.label.toLowerCase() === lower);
    if (!match) {
      throw new ToolError('not_found', `"${typed.slice(0, 80)}" is not one of the user's models.`, { choices: choices.map(({ id, label }) => ({ id, name: label })) });
    }
    url = match.url;
  }
  const before = settings[target as ModelTarget] ?? '';
  if (before === url) return { target, model: modelLabel(choices, url, 'follows the chat model'), result: 'already set' };
  deps.setModel(target as ModelTarget, url);
  return {
    target,
    model: modelLabel(choices, url, 'follows the chat model'),
    previous: modelLabel(choices, before, target === 'chat' ? 'not set' : 'follows the chat model'),
    result: 'set',
  };
}

function ageDays(file: OutputFile, now: Date): number | null {
  const time = Date.parse(file.timestamp);
  return Number.isNaN(time) ? null : (now.getTime() - time) / (24 * 60 * 60_000);
}

async function listConversations(deps: YobiControlDeps, args: Record<string, unknown>): Promise<unknown> {
  const files = await deps.listConversations();
  const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
  const olderThan = typeof args.older_than_days === 'number' && args.older_than_days > 0 ? args.older_than_days : null;
  const limit = Math.min(Math.max(Math.floor(typeof args.limit === 'number' ? args.limit : CONVERSATION_LIMIT), 1), CONVERSATION_LIMIT_MAX);
  const now = deps.now();
  const matching = files.filter((file) => {
    if (query && !file.name.toLowerCase().includes(query)) return false;
    if (olderThan === null) return true;
    const age = ageDays(file, now);
    return age !== null && age > olderThan;
  });
  return {
    total: files.length,
    matching: matching.length,
    conversations: matching.slice(0, limit).map((file) => {
      const time = new Date(file.timestamp);
      return {
        id: file.id,
        title: file.name,
        ...(Number.isNaN(time.getTime()) ? {} : { last_changed: localTime(time) }),
        ...(file.turns ? { turns: file.turns } : {}),
        ...(file.pinned ? { pinned: true } : {}),
        ...(file.folder ? { folder: file.folder } : {}),
      };
    }),
    ...(matching.length > limit ? { note: `Only the newest ${limit} are listed.` } : {}),
  };
}

async function deleteConversations(deps: YobiControlDeps, args: Record<string, unknown>): Promise<unknown> {
  const ids = (Array.isArray(args.ids) ? args.ids : typeof args.ids === 'string' ? [args.ids] : [])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim().replace(/\\/g, '/'));
  if (ids.length === 0) throw new ToolError('invalid_arguments', 'ids must name at least one conversation.');
  const files = await deps.listConversations();
  const byId = new Map(files.map((file) => [file.id, file]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw new ToolError('not_found', `No conversation has the id ${unknown.slice(0, 3).map((id) => `"${id.slice(0, 80)}"`).join(', ')}. List the conversations and use their ids exactly; nothing was deleted.`);
  }
  const picked = [...new Set(ids)].map((id) => byId.get(id)!);
  const result = await deps.trashConversations(picked);
  return {
    moved_to_recently_deleted: result.moved,
    ...(result.busy > 0 ? { left_in_use: result.busy } : {}),
    ...(result.failed > 0 ? { failed: result.failed } : {}),
    note: 'They can be restored from Recently Deleted in Yobi\'s sidebar for a while.',
  };
}

function updateView(state: YobiUpdateState): Record<string, unknown> {
  const said: Record<string, string> = {
    unsupported: 'this copy of Yobi does not check for updates itself (a development build or the Microsoft Store edition)',
    unchecked: 'not checked yet',
    checking: 'checking now',
    latest: 'up to date',
    error: 'the last check failed (offline, or the server could not be reached)',
    available: state.installsItself ? 'a newer version is downloading' : 'a newer version is out; the user downloads it from the release page',
    downloaded: 'a newer version is downloaded and ready to install',
  };
  return {
    current_version: state.current,
    status: said[state.state] ?? state.state,
    ...(state.version ? { new_version: state.version } : {}),
    ...(state.releaseUrl ? { release_page: state.releaseUrl } : {}),
  };
}

async function checkUpdate(deps: YobiControlDeps): Promise<unknown> {
  if (deps.updateState().state !== 'unsupported') await deps.checkForUpdates();
  return updateView(deps.updateState());
}

function installUpdate(deps: YobiControlDeps): unknown {
  const state = deps.updateState();
  if (state.state !== 'downloaded' || !deps.scheduleInstall()) {
    throw new ToolError('not_ready', 'No update is downloaded and ready to install.', updateView(state));
  }
  return { result: 'scheduled', new_version: state.version ?? '', note: 'Yobi installs it and restarts once the running tasks finish; this conversation ends then.' };
}

function restart(deps: YobiControlDeps): unknown {
  deps.scheduleRestart();
  return { result: 'scheduled', note: 'Yobi restarts once the running tasks finish.' };
}

function overview(deps: YobiControlDeps, conversations: number): unknown {
  const flows = deps.listFlows();
  return {
    version: deps.version(),
    update: updateView(deps.updateState()).status,
    default_models: modelSettings(deps),
    flows: { total: flows.length, enabled: flows.filter((flow) => flow.enabled).length },
    conversations,
    tasks_running_or_waiting: deps.queueSize(),
    // With many connectors the catalog shows this server as one summary line, and models open
    // with this tool and then guess "yobi_flows" or "yobi_disable_flow".
    tools: YOBI_TOOLS.filter((tool) => tool.name !== 'yobi_overview').map((tool) => tool.name),
  };
}

export function createYobiMcpServer(deps: YobiControlDeps): ToolServer {
  return createToolServer({
    name: YOBI_SERVER_NAME,
    tools: YOBI_TOOLS,
    dispatch: async (toolName, args) => {
      switch (toolName) {
        case 'yobi_overview': return overview(deps, (await deps.listConversations()).length);
        case 'yobi_list_flows': return listFlows(deps, args);
        case 'yobi_set_flows_enabled': return setFlowsEnabled(deps, args);
        case 'yobi_list_models': return listModels(deps);
        case 'yobi_set_model': return setModel(deps, args);
        case 'yobi_list_conversations': return listConversations(deps, args);
        case 'yobi_delete_conversations': return deleteConversations(deps, args);
        case 'yobi_check_update': return checkUpdate(deps);
        case 'yobi_install_update': return installUpdate(deps);
        case 'yobi_restart': return restart(deps);
        case 'yobi_get_settings': return getSettings(await deps.settingsCatalog(), args);
        case 'yobi_set_settings': return setSettings(await deps.settingsCatalog(), args, deps.settingsChanged);
        case 'yobi_test_api_keys': return testApiKeys(deps, args);
        case 'yobi_reset_statistics':
          deps.resetStatistics();
          return { result: 'cleared' };
        default: throw new Error(`Unknown tool: ${toolName}`);
      }
    },
  });
}
