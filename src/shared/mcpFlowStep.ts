import { parseJsonLenient } from './llmJsonExtract';

/**
 * What the tool of an `mcp` flow step does, in the words the editor shows: `read` only reads,
 * `write` changes something in the connected app, `delete` throws something away. Stored in the
 * step (`access`) when the user picks the tool, so the import gate can classify a flow without
 * connecting to anything; the run checks the live tool again (`mcpStepRefusal`).
 */
export type McpStepAccess = 'read' | 'write' | 'delete';

const ACCESS_RANK: Readonly<Record<McpStepAccess, number>> = { read: 0, write: 1, delete: 2 };

/** The access a step was saved with, or null when it has none (an AI-built or hand-written step). */
export function storedMcpAccess(value: string | undefined): McpStepAccess | null {
  const access = (value ?? '').trim();
  return access === 'read' || access === 'write' || access === 'delete' ? access : null;
}

/** The more dangerous of what was stored and what the live tool does: a run never trusts the lower one. */
export function effectiveMcpAccess(stored: McpStepAccess | null, live: McpStepAccess): McpStepAccess {
  if (!stored) return live;
  return ACCESS_RANK[stored] >= ACCESS_RANK[live] ? stored : live;
}

/**
 * Why a run does not call the tool, or null when it may.
 * - `botWrite`: a Telegram/LINE message started the run and the tool is not read-only. Saving the
 *   flow was the owner's consent to what it changes; a person messaging the bot never gave one.
 * - `unconfirmedDelete`: the tool deletes, but the step was not saved as deleting. Deleting is what
 *   locks the import button, so a step that never said so (a flow from elsewhere, an AI-built one,
 *   a server that changed its tool) must be picked again in the editor first.
 */
export type McpStepRefusal = 'botWrite' | 'unconfirmedDelete';

export function mcpStepRefusal(stored: McpStepAccess | null, live: McpStepAccess, botRun: boolean): McpStepRefusal | null {
  const access = effectiveMcpAccess(stored, live);
  if (botRun && access !== 'read') return 'botWrite';
  if (access === 'delete' && stored !== 'delete') return 'unconfirmedDelete';
  return null;
}

/** The most text one step hands on; the rest is cut and a line says so. */
export const MCP_OUTPUT_MAX_CHARS = 30_000;

/** One input field of a tool, read off its input schema for the editor's hint. */
export interface McpFlowToolField {
  name: string;
  /** The schema type ("string", "number|null", "object"), "" when the schema gives none. */
  type: string;
  required: boolean;
  /** Allowed values, when the schema lists them (strings and numbers only, capped). */
  options?: string[];
}

export interface McpFlowTool {
  name: string;
  /** The tool's display name (MCP `title`, the app's own wording for a built-in connector). */
  title?: string;
  access: McpStepAccess;
  fields: McpFlowToolField[];
}

/**
 * `connected`: the tools are listed. `needsSignIn`: it will not connect without the user signing
 * in (or switching it back on) in Settings. `unavailable`: it tried and failed. `missing`: no such
 * connector is set up.
 */
export type McpFlowToolsStatus = 'connected' | 'needsSignIn' | 'unavailable' | 'missing';

export interface McpFlowToolsRequest {
  serverId: string;
  /** Connect it first when it can be without a sign-in (never opens a browser). */
  connect?: boolean;
  /** The picked tool and the arguments typed for it, for `selectedAccess`. */
  tool?: string;
  args?: string;
}

export interface McpFlowToolsResult {
  status: McpFlowToolsStatus;
  tools: McpFlowTool[];
  /** The picked tool's access with these arguments (a Notion edit that may delete content). */
  selectedAccess?: McpStepAccess;
}

const MAX_FIELD_OPTIONS = 20;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function schemaType(schema: Record<string, unknown>): string {
  const { type } = schema;
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return type.filter((part): part is string => typeof part === 'string').join('|');
  if (asObject(schema.properties)) return 'object';
  return '';
}

/**
 * The top-level fields of a tool's input schema. Only names, types and allowed values: the schema's
 * descriptions are written for a model and stay in the main process.
 */
export function schemaFields(inputSchema: unknown): McpFlowToolField[] {
  const schema = asObject(inputSchema);
  const properties = asObject(schema?.properties);
  if (!schema || !properties) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : []);
  return Object.entries(properties).map(([name, raw]) => {
    const property = asObject(raw) ?? {};
    const options = Array.isArray(property.enum)
      ? property.enum.filter((value) => typeof value === 'string' || typeof value === 'number').slice(0, MAX_FIELD_OPTIONS).map(String)
      : [];
    return {
      name,
      type: schemaType(property),
      required: required.has(name),
      ...(options.length > 0 ? { options } : {}),
    };
  });
}

function emptyValue(type: string): unknown {
  const first = type.split('|')[0];
  if (first === 'number' || first === 'integer') return 0;
  if (first === 'boolean') return false;
  if (first === 'array') return [];
  if (first === 'object') return {};
  return '';
}

/** Arguments to start from when a tool is picked: its required fields, empty. "" when it has none. */
export function argumentsSkeleton(fields: readonly McpFlowToolField[]): string {
  const required = fields.filter((field) => field.required);
  if (required.length === 0) return '';
  return JSON.stringify(Object.fromEntries(required.map((field) => [field.name, emptyValue(field.type)])), null, 2);
}

/**
 * `repaired`: the JSON only parsed after a repair that rewrote it (a missing value read as null),
 * so the editor shows what will be sent.
 */
export type McpArgumentsResult =
  | { ok: true; value: Record<string, unknown>; repaired: boolean }
  | { ok: false; reason: 'notJson' | 'notObject' };

const PLACEHOLDER = /\{\{([^}]+)\}\}/g;
const RAW_PREFIX = '\u0000yobi-raw:';
const RAW_EXACT = /^\u0000yobi-raw:(\d+)\u0000$/;

/**
 * Swaps each `{{name}}` that stands where a JSON value goes (`"limit": {{count}}`) for a quoted
 * marker, so the template parses; one inside a string is left for `fillValue`.
 */
function markBarePlaceholders(template: string): { text: string; names: string[] } {
  const names: string[] = [];
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < template.length; i++) {
    const ch = template[i];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += template[i + 1] ?? '';
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '{' && template[i + 1] === '{') {
      const end = template.indexOf('}}', i + 2);
      if (end > i + 2) {
        names.push(template.slice(i + 2, end).trim());
        out += JSON.stringify(`${RAW_PREFIX}${names.length - 1}\u0000`);
        i = end + 1;
        continue;
      }
    }
    out += ch;
  }
  return { text: out, names };
}

/** A bare placeholder's value as JSON when it is JSON (a number, a list from an earlier step), else as text. */
function rawValue(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

function fillValue(value: unknown, names: readonly string[], lookup: (name: string) => string): unknown {
  if (typeof value === 'string') {
    const raw = RAW_EXACT.exec(value);
    if (raw) return rawValue(lookup(names[Number(raw[1])] ?? ''));
    return value.replace(PLACEHOLDER, (_, name: string) => lookup(name.trim()));
  }
  if (Array.isArray(value)) return value.map((item) => fillValue(item, names, lookup));
  const object = asObject(value);
  if (!object) return value;
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [
    key.replace(PLACEHOLDER, (_, name: string) => lookup(name.trim())),
    fillValue(item, names, lookup),
  ]));
}

/**
 * A step's arguments with its `{{variables}}` filled in. The template is parsed BEFORE anything is
 * filled in: a value is only ever a value, so text from a feed or a page cannot add or change an
 * argument by carrying quotes and commas. Inside a string a variable is inserted as text; standing
 * alone (`"limit": {{count}}`) it is read as JSON when it is JSON, else as text. The template may
 * be loosely written (trailing commas, single quotes): it gets the same repair a model's JSON gets.
 */
export function interpolateMcpArguments(template: string, lookup: (name: string) => string): McpArgumentsResult {
  if (!template.trim()) return { ok: true, value: {}, repaired: false };
  const marked = markBarePlaceholders(template);
  const parsed = parseJsonLenient(marked.text);
  if (parsed === undefined) return { ok: false, reason: 'notJson' };
  const object = asObject(parsed.value);
  if (!object) return { ok: false, reason: 'notObject' };
  return { ok: true, value: fillValue(object, marked.names, lookup) as Record<string, unknown>, repaired: parsed.repaired };
}

/** Arguments already filled in (the run's own JSON), parsed without touching any `{{…}}` they now contain. */
export function parseMcpArguments(text: string): McpArgumentsResult {
  if (!text.trim()) return { ok: true, value: {}, repaired: false };
  const parsed = parseJsonLenient(text);
  if (parsed === undefined) return { ok: false, reason: 'notJson' };
  const object = asObject(parsed.value);
  return object ? { ok: true, value: object, repaired: parsed.repaired } : { ok: false, reason: 'notObject' };
}

/** Required fields the arguments leave out. */
export function missingRequiredArguments(args: Record<string, unknown>, fields: readonly McpFlowToolField[]): string[] {
  return fields.filter((field) => field.required && !Object.hasOwn(args, field.name)).map((field) => field.name);
}
