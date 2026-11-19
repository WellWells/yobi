/**
 * The Settings page as two tools of the Yobi connector: read every setting the user can change by
 * hand, and change several at once (one confirmation). Each setting is a row of a catalog
 * (`yobiSettingsCatalog.ts`) whose writer is the one the Settings page itself calls, so a change
 * made here re-binds the hotkey, rebuilds the tray menu and so on exactly like a click would.
 *
 * Secrets, sign-ins, bot pairing and permissions, connector accounts and MCP servers are not rows:
 * they either hand out access or need the user at the screen, and stay in Settings.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolError } from '../mcp/inProcessServer';
import { ALSO_NAMED } from '../mcp/schemaAliases';

/** The Settings page's categories, in its order; `models` also covers the model pickers. */
export const SETTING_SECTIONS = [
  'models', 'answers', 'connectors', 'bots', 'general', 'appearance', 'notifications', 'links', 'export', 'shortcuts', 'statistics',
] as const;
export type SettingSection = (typeof SETTING_SECTIONS)[number];

export type SettingKind = 'boolean' | 'choice' | 'number' | 'text' | 'list';

export interface SettingSpec {
  /** Dotted and stable: `answers.tone`, `notify.flow_failure`. */
  id: string;
  section: SettingSection;
  /** What it does, in a few English words. */
  about: string;
  kind: SettingKind;
  /** For `choice` and `list`: the allowed values (read when asked: languages and sites vary). */
  choices?: () => readonly string[];
  min?: number;
  max?: number;
  /** For `text`. */
  maxLength?: number;
  read: () => unknown;
  /** Applies a value already checked against the kind; a returned string is why it was refused. */
  write: (value: never) => void | string | Promise<void | string>;
}

const DEFAULT_TEXT_MAX = 4_000;
const TRUE_WORDS = new Set(['true', 'on', 'yes', '1', 'enable', 'enabled', '開', '开', '開啟', '开启']);
const FALSE_WORDS = new Set(['false', 'off', 'no', '0', 'disable', 'disabled', '關', '关', '關閉', '关闭']);

export const SETTINGS_NOT_HERE = 'Not here, the user changes them in Settings: API keys, bot tokens and other secrets, sign-ins, '
  + 'bot pairing and who may use what, mail and calendar accounts, MCP servers, per-command keyboard shortcuts, '
  + 'the external editor\'s own command line, the share server address, programs /agent may run, knowledge base folders, backups and factory reset. '
  + 'Default models are set with yobi_set_model.';

export const YOBI_SETTINGS_TOOLS: Tool[] = [
  {
    name: 'yobi_get_settings',
    description: 'Yobi\'s settings as the Settings page has them (answer style and custom instructions, language, theme, notifications, links, export, hotkeys, connectors on/off…): each with its id, current value and allowed values.',
    inputSchema: {
      type: 'object',
      properties: {
        section: { type: 'string', enum: [...SETTING_SECTIONS], description: 'Only this part of Settings', [ALSO_NAMED]: ['category', 'page'] },
        query: { type: 'string', description: 'Words in the id or description', [ALSO_NAMED]: ['search', 'keyword', 'name'] },
      },
    },
    annotations: { title: 'Read settings', readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: 'yobi_set_settings',
    description: 'Change Yobi settings by id (from yobi_get_settings): changes = {"<id>": value, …}, or id + value for one. The user confirms; nothing changes if any id or value is wrong.',
    // Not `required`: models send one setting as {id, value} and would lose a turn to the refusal.
    inputSchema: {
      type: 'object',
      properties: {
        changes: {
          type: 'object',
          description: 'Setting id → new value, such as {"answers.tone": "casual", "notify.flow_success": true}',
          additionalProperties: true,
          [ALSO_NAMED]: ['settings', 'values', 'set'],
        },
        id: { type: 'string', description: 'One setting id, with value', [ALSO_NAMED]: ['setting', 'key'] },
        value: { description: 'The new value of id' },
      },
    },
    annotations: { title: 'Change settings', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

function allowedOf(spec: SettingSpec): unknown {
  if (spec.kind === 'number') return `${spec.min ?? ''}–${spec.max ?? ''}`;
  if (spec.kind === 'text') return `text, up to ${spec.maxLength ?? DEFAULT_TEXT_MAX} characters; "" = the built-in default`;
  const choices = spec.choices?.() ?? [];
  return spec.kind === 'list' ? `any of: ${choices.join(', ')}` : choices;
}

export function getSettings(catalog: readonly SettingSpec[], args: Record<string, unknown>): unknown {
  const section = typeof args.section === 'string' ? args.section.trim().toLowerCase() : '';
  if (section && !(SETTING_SECTIONS as readonly string[]).includes(section)) {
    throw new ToolError('invalid_arguments', `section must be one of: ${SETTING_SECTIONS.join(', ')}.`);
  }
  const words = typeof args.query === 'string' ? args.query.toLowerCase().split(/\s+/).filter(Boolean) : [];
  const rows = catalog.filter((spec) => {
    if (section && spec.section !== section) return false;
    const haystack = `${spec.id} ${spec.about}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  const sections: Record<string, Array<Record<string, unknown>>> = {};
  for (const spec of rows) {
    // A switch says true/false by its value; the full listing is long enough without it.
    (sections[spec.section] ??= []).push({
      id: spec.id, value: spec.read(), about: spec.about, ...(spec.kind === 'boolean' ? {} : { allowed: allowedOf(spec) }),
    });
  }
  return { sections, ...(rows.length === 0 ? { note: 'No setting matched; leave out query to see them all.' } : {}), not_here: SETTINGS_NOT_HERE };
}

/** The value as the setting takes it, or a sentence saying what is wrong. */
export function coerceSetting(spec: SettingSpec, raw: unknown): { value: unknown } | { problem: string } {
  switch (spec.kind) {
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw };
      const word = String(raw).trim().toLowerCase();
      if (TRUE_WORDS.has(word)) return { value: true };
      if (FALSE_WORDS.has(word)) return { value: false };
      return { problem: 'must be true or false' };
    }
    case 'number': {
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(value)) return { problem: 'must be a number' };
      if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) {
        return { problem: `must be between ${spec.min} and ${spec.max}` };
      }
      return { value };
    }
    case 'text': {
      if (typeof raw !== 'string') return { problem: 'must be text' };
      const max = spec.maxLength ?? DEFAULT_TEXT_MAX;
      return raw.length > max ? { problem: `is longer than ${max} characters` } : { value: raw };
    }
    case 'choice': {
      const choices = spec.choices?.() ?? [];
      const typed = String(raw ?? '').trim().toLowerCase();
      const match = choices.find((choice) => choice.toLowerCase() === typed)
        // "en" for en-US: a language without its region, taken when only one choice fits.
        ?? onlyOne(choices.filter((choice) => typed !== '' && choice.toLowerCase().startsWith(`${typed}-`)));
      return match !== undefined ? { value: match } : { problem: `must be one of: ${choices.join(', ')}` };
    }
    case 'list': {
      const choices = spec.choices?.() ?? [];
      const items = (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
        .map((item) => String(item).trim())
        .filter(Boolean);
      const picked: string[] = [];
      for (const item of items) {
        const match = choices.find((choice) => choice.toLowerCase() === item.toLowerCase());
        if (match === undefined) return { problem: `"${item.slice(0, 40)}" is not one of: ${choices.join(', ')}` };
        if (!picked.includes(match)) picked.push(match);
      }
      return { value: picked };
    }
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function onlyOne<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

/** Arguments of yobi_set_settings that are not a setting written at the top level. */
const CALL_KEYS = new Set(['changes', 'id', 'value', 'confirm', 'intent']);

/**
 * Every way a model wrote the changes: `changes` as an object or `[{id, value}]`, one `id` + `value`,
 * or setting ids as the call's own keys (`{"general.language": "en-US"}`).
 */
function changesOf(args: Record<string, unknown>): Array<[string, unknown]> {
  const raw = args.changes;
  const wanted: Array<[string, unknown]> = Array.isArray(raw)
    ? raw.flatMap((entry) => (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string'
      ? [[(entry as { id: string }).id, (entry as { value?: unknown }).value] as [string, unknown]]
      : []))
    : raw && typeof raw === 'object' ? Object.entries(raw as Record<string, unknown>) : [];
  if (typeof args.id === 'string' && args.id.trim()) wanted.push([args.id, args.value]);
  for (const [key, value] of Object.entries(args)) {
    if (!CALL_KEYS.has(key)) wanted.push([key, value]);
  }
  return wanted;
}

/** The row an id names: exact, else the one row whose last part it is (`language` → `general.language`). */
function findSpec(catalog: readonly SettingSpec[], id: string): SettingSpec | undefined {
  const wanted = id.trim().toLowerCase();
  return catalog.find((spec) => spec.id.toLowerCase() === wanted)
    ?? onlyOne(catalog.filter((spec) => spec.id.toLowerCase().endsWith(`.${wanted}`)));
}

export interface SettingsPlan {
  planned: Array<{ spec: SettingSpec; value: unknown }>;
  /** Why the call would change nothing; null when every change is valid. */
  refusal: string | null;
}

/**
 * Checks every change without writing anything. Also run before the user is asked to approve, so a
 * wrong guess is sent back to the model instead of costing the user an approval
 * (four approvals for one language switch, otherwise).
 */
export function planSettings(catalog: readonly SettingSpec[], args: Record<string, unknown>): SettingsPlan {
  const wanted = changesOf(args);
  if (wanted.length === 0) {
    return { planned: [], refusal: 'changes must give at least one setting id and its new value.' };
  }
  const problems: string[] = [];
  const planned: SettingsPlan['planned'] = [];
  for (const [id, raw] of wanted) {
    const spec = findSpec(catalog, id);
    if (!spec) {
      const near = catalog.filter((entry) => id.toLowerCase().split(/[._\s]+/).some((part) => part.length > 2 && entry.id.includes(part))).map((entry) => entry.id);
      problems.push(`"${id.slice(0, 60)}" is not a setting${near.length > 0 ? `; did you mean ${near.slice(0, 5).join(', ')}?` : ''}`);
      continue;
    }
    const coerced = coerceSetting(spec, raw);
    if ('problem' in coerced) problems.push(`${spec.id} ${coerced.problem}`);
    else planned.push({ spec, value: coerced.value });
  }
  if (problems.length === 0) return { planned, refusal: null };
  return { planned: [], refusal: `Nothing was changed. ${problems.join('. ')}. Read yobi_get_settings for the ids and allowed values.` };
}

/**
 * Checks every change first and refuses the whole call on any problem, then applies them in order.
 * `changed` gets the ids that really changed (for the Settings page to read them again).
 */
export async function setSettings(
  catalog: readonly SettingSpec[],
  args: Record<string, unknown>,
  changed: (ids: string[]) => void,
): Promise<unknown> {
  const { planned, refusal } = planSettings(catalog, args);
  if (refusal) throw new ToolError('invalid_arguments', refusal);

  const results: Array<Record<string, unknown>> = [];
  const changedIds: string[] = [];
  for (const { spec, value } of planned) {
    // Read before the write: some writers hand back the same object they change.
    const before = structuredClone(spec.read());
    if (sameValue(before, value)) {
      results.push({ id: spec.id, result: 'already set', value: before });
      continue;
    }
    const refused = await spec.write(value as never);
    const after = spec.read();
    if (typeof refused === 'string') {
      results.push({ id: spec.id, result: `not changed: ${refused}`, value: after });
      continue;
    }
    if (sameValue(before, after)) {
      results.push({ id: spec.id, result: 'already set', value: after });
      continue;
    }
    changedIds.push(spec.id);
    results.push({ id: spec.id, result: 'changed', from: before, to: after });
  }
  if (changedIds.length > 0) changed(changedIds);
  return { results };
}
