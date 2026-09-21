import { connectorHoldsUserData } from '../../../shared/mcpCatalog';
import { isByokTargetUrl } from '../../../shared/types';
import { detectProvider, PROVIDER_PROMPT_POLICIES } from '../../providers';
import { INSTRUCTION_EST, readPlanFields, readStepBudget, USER_DATA_MARKER } from './agentPrompts';
import { AGENT_HELP_TOOL, OPTS_MARKER } from './agentTools';
import { readIntent } from './actionGate';
import type { GoalIntent } from './actionGate';
import { resolveToolContract } from './contractRegistry';
import { genericRisk, riskLabel } from './toolContracts';
import type { Validation } from './structuredLlm';
import type { McpTool, McpToolResult } from '../../mcp/mcpTypes';
import type { ConnectedServerTools } from '../../mcp/mcpRegistry';

export interface McpServerHandle {
  handle: string;
  serverId: string;
  serverName: string;
  /** This server reads the user's own world, so the catalog marks it and the prompt prefers it. */
  userData: boolean;
  tools: McpTool[];
}

export interface McpRuntimeIndex {
  handles: McpServerHandle[];
  byHandle: Map<string, McpServerHandle>;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'server';
}

export function buildMcpIndex(connected: ConnectedServerTools[]): McpRuntimeIndex {
  const handles: McpServerHandle[] = [];
  const used = new Set<string>();
  for (const server of connected) {
    if (server.tools.length === 0) continue;
    const base = slugify(server.serverName);
    let candidate = base;
    let n = 2;
    while (used.has(candidate)) candidate = `${base}-${n++}`;
    used.add(candidate);
    handles.push({
      handle: candidate,
      serverId: server.serverId,
      serverName: server.serverName,
      userData: connectorHoldsUserData(server.url),
      tools: server.tools,
    });
  }
  return { handles, byHandle: new Map(handles.map((h) => [h.handle, h])) };
}

export function hasMcpTools(index: McpRuntimeIndex): boolean {
  return index.handles.length > 0;
}

export function filterAgentServers(
  connected: readonly ConnectedServerTools[],
  servers: readonly { id: string; agentEnabled?: boolean }[],
): ConnectedServerTools[] {
  const allowed = new Set(servers.filter((s) => s.agentEnabled !== false).map((s) => s.id));
  return connected.filter((entry) => allowed.has(entry.serverId));
}

export function isWriteAutoApproved(
  servers: readonly { id: string; autoApproveWrites?: boolean }[],
  serverId: string,
): boolean {
  return servers.some((s) => s.id === serverId && s.autoApproveWrites === true);
}

/** The coarse read/write split, kept for callers that only need that much. `toolContracts` owns the rule. */
export function classifyMcpTool(tool: McpTool): 'read' | 'write' {
  return genericRisk(tool) === 'read' ? 'read' : 'write';
}

/** What the catalog prints next to a tool: the connector's own contract when Yobi has one. */
function toolLabel(tool: McpTool, serverId: string): string {
  return riskLabel(resolveToolContract(serverId, tool).risk({}));
}

const SCRATCH_OVERHEAD = 380;
const SAFETY_MARGIN = 1_200;
const MCP_MIN_BUDGET = 1_000;
const BYOK_CATALOG_BUDGET = 40_000;

/**
 * How many observation slots the BUDGETS reserve — deliberately fewer than the window
 * `renderScratch` prints.
 *
 * The two used to be the same number, and they measure different things. A browser run sends the
 * full turn prompt exactly twice: on turn 1, where the scratchpad is empty, and on a thread-loss
 * rebuild. Every turn in between is a delta carrying ONE observation. Reserving the whole
 * three-slot window up front therefore billed every run 11,640 of Gemini's 33,499 characters to
 * protect a prompt shape the normal path never sends — and `scratchFitFor` and `historyThatFits`
 * already trim the rebuild that does. What it bought was nothing; what it cost was the
 * conversation history, which came out at 887 characters and so fell under its own floor for any
 * goal longer than a greeting: /agent could not see the turn above it on Yobi's default provider.
 *
 * The trade this makes explicit: a rebuild after a lost thread now trims what the run had
 * gathered more aggressively. That is the exceptional path, and it degrades; the reserve was
 * charged on every run, and it did not.
 */
export const MCP_SCRATCH_RESERVE_SLOTS = 1;

export function mcpScratchReserveChars(scratchSlots: number, observationLimit: number): number {
  return scratchSlots * (observationLimit + SCRATCH_OVERHEAD);
}

export function mcpCatalogBudgetChars(
  providerUrl: string,
  builtinCatalogLen: number,
  goalLen: number,
  scratchSlots: number,
  observationLimit: number,
  historyLen = 0,
): number {
  if (isByokTargetUrl(providerUrl)) return BYOK_CATALOG_BUDGET;
  const policy = PROVIDER_PROMPT_POLICIES[detectProvider(providerUrl)];
  const cap = policy.maxCharsPlusBreaks ?? policy.maxBytes ?? 0;
  const scratchCost = mcpScratchReserveChars(scratchSlots, observationLimit);
  const budget = cap - INSTRUCTION_EST - builtinCatalogLen - goalLen - historyLen - scratchCost - SAFETY_MARGIN;
  return budget < MCP_MIN_BUDGET ? 0 : budget;
}

function firstSentence(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  const dot = trimmed.indexOf('. ');
  const sentence = dot > 0 ? trimmed.slice(0, dot + 1) : trimmed;
  return sentence.length > 130 ? `${sentence.slice(0, 129)}…` : sentence;
}

const MAX_ARGS_SHOWN = 12;

function argSummary(schema: McpTool['inputSchema']): string {
  const props = schema?.properties;
  if (!props || typeof props !== 'object') return 'none';
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  const keys = Object.keys(props);
  if (keys.length === 0) return 'none';
  const shown = keys.slice(0, MAX_ARGS_SHOWN).map((k) => (required.has(k) ? `${k}*` : k));
  if (keys.length > MAX_ARGS_SHOWN) shown.push('…');
  return shown.join(', ');
}

function renderToolLine(tool: McpTool, serverId: string): string {
  const rw = toolLabel(tool, serverId);
  const desc = firstSentence(tool.description ?? '');
  return `- ${tool.name} (${rw}): ${desc} args: ${argSummary(tool.inputSchema)}`;
}

/**
 * Description budgets for a tier-1 line, widest first. Under contention the descriptions are
 * squeezed before any tool is dropped: a tool the model cannot see at all is worse than one
 * whose description is clipped, because disclosing the connector is only useful if the model can
 * see every instrument it might pick. The last step is a floor, not a target — below roughly
 * thirty characters a description stops distinguishing one tool from the next, and omitting is
 * the more honest outcome.
 */
const BRIEF_DESC_LIMITS = [72, 48, 32] as const;
const BRIEF_ARGS_SHOWN = 4;

function briefDesc(text: string, limit: number): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

/**
 * Tier-1 line: name, read/write, a clipped description and the REQUIRED arguments only — about
 * half the cost of a full line, which is what lets more than one connector be disclosed at once
 * on a browser provider. The description is clipped rather than dropped on purpose: disclosing a
 * connector is only useful if the model can judge which tool fits, and a bare name cannot carry
 * that judgement. `OPTS_MARKER` is shared with the built-in catalog so the model learns one
 * grammar, not two.
 */
function renderBriefToolLine(tool: McpTool, serverId: string, descLimit: number): string {
  const rw = toolLabel(tool, serverId);
  const schema = tool.inputSchema;
  const props = schema?.properties;
  const keyCount = props && typeof props === 'object' ? Object.keys(props).length : 0;
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const shown = required.slice(0, BRIEF_ARGS_SHOWN);
  const args = shown.length > 0 ? ` args: ${shown.map((key) => `${String(key)}*`).join(', ')}` : '';
  const opts = keyCount > shown.length ? ` ${OPTS_MARKER}` : '';
  return `- ${tool.name} (${rw}): ${briefDesc(tool.description ?? '', descLimit)}${args}${opts}`;
}

export interface McpCatalogFill {
  text: string;
  includedCount: number;
  omitted: number;
  /** True when the tools were listed as tier-1 briefs, so the prompt has to explain `tool_help`. */
  brief: boolean;
}

interface CatalogBlock {
  serverId: string;
  handle: string;
  header: string;
  lines: string[];
  tools: readonly McpTool[];
  used: number;
  next: number;
}

/**
 * What a hidden tail says. The old line — `(+78 more tool(s) not shown due to length limits.)` —
 * told the model something existed and gave it no way to ask for it, so on Gemini with four
 * connectors two thirds of the user's tools were not merely undisclosed but unreachable. This one
 * names the server and the call that expands it, and it is emitted per server because
 * `fillCatalog` hands out equal shares: a 78-tool server hides a long tail while the 3-tool
 * server beside it hides nothing, and one global count cannot say which is which.
 */
function tailLine(handle: string, hidden: number, canHelp: boolean): string {
  const ask = canHelp
    ? `call "${AGENT_HELP_TOOL}" with that handle for the full list`
    : 'no room in this prompt for the rest';
  return `  …and ${hidden} more tool(s) on [${handle}] — ${ask}.`;
}

/**
 * Upper bound on one `tailLine`, wide enough for a 60-character handle. Like the section heading
 * and the footer it replaces, a tail is not charged against the catalog budget — it comes out of
 * `SAFETY_MARGIN`. Charging it instead was tried and reverted: reserving one per server before
 * the layout puts a cliff in the small budgets, where the reserve can exceed the budget and no
 * tool fits at all. Bounded rather than charged: at most one tail per connected server, so four
 * connectors overspend by at most 640 against a 1,200 margin. Pinned in `test/mcpTools.test.ts`.
 */
export const TAIL_LINE_MAX = 160;

/**
 * Equal shares first, leftovers second. Filling greedily in registry order — which is
 * `config.json` add-order, NOT the order the user named the connectors — let the oldest
 * connector eat the whole budget while the one just asked for contributed nothing. That failure
 * is silent: a run that keeps its built-in tools never throws `AgentScopeError('no-room')`.
 */
function fillCatalog(
  index: McpRuntimeIndex,
  budgetChars: number,
  render: (tool: McpTool, serverId: string) => string,
  canHelp = true,
): Omit<McpCatalogFill, 'brief'> {
  const blocks: CatalogBlock[] = index.handles.map((server) => ({
    serverId: server.serverId,
    handle: server.handle,
    header: `[${server.handle}] ${server.serverName}${server.userData ? ` ${USER_DATA_MARKER}` : ''}:`,
    lines: [],
    tools: server.tools,
    used: 0,
    next: 0,
  }));
  if (blocks.length === 0) return { text: '', includedCount: 0, omitted: 0 };

  const take = (block: CatalogBlock, limit: number): void => {
    while (block.next < block.tools.length) {
      const line = render(block.tools[block.next], block.serverId);
      // A header is only charged once its server actually contributes a tool, so a server that
      // cannot fit even one line costs nothing instead of spending the budget on its own name.
      const cost = line.length + 1 + (block.lines.length === 0 ? block.header.length + 1 : 0);
      if (block.used + cost > limit) return;
      if (block.lines.length === 0) block.lines.push(block.header);
      block.lines.push(line);
      block.used += cost;
      block.next += 1;
    }
  };

  const spent = (): number => blocks.reduce((sum, block) => sum + block.used, 0);
  const share = Math.floor(budgetChars / blocks.length);
  for (const block of blocks) take(block, share);
  for (const block of blocks) take(block, block.used + (budgetChars - spent()));

  // The tail rides under its own server's block, so the model reads "these fitted, that many did
  // not" in one place. A server that could not fit even one line gets the tail ALONE, with no
  // header: the header rule — never spend the budget on a bare name — still holds, and the tail
  // already names the handle, which is the only thing the model needs to ask for the rest.
  const lines = blocks.flatMap((block) => {
    const hidden = block.tools.length - block.next;
    if (hidden === 0) return block.lines;
    return [...block.lines, tailLine(block.handle, hidden, canHelp)];
  });
  const includedCount = spentTools(blocks);
  const omitted = blocks.reduce((sum, block) => sum + (block.tools.length - block.next), 0);
  return { text: lines.join('\n'), includedCount, omitted };
}

function spentTools(blocks: readonly CatalogBlock[]): number {
  return blocks.reduce((sum, block) => sum + block.next, 0);
}

/** How many tool names a summary line carries as the scent of what its server is for. */
const SUMMARY_SAMPLE = 4;

/**
 * Spread across the list rather than taken off the front. A 40-tool mail server lists its folder
 * and account tools first, so a sample of the first four describes a file browser and says
 * nothing about the calendar, the contacts or the filters sitting behind the same handle.
 */
function sampleToolNames(tools: readonly McpTool[], count: number): string[] {
  if (tools.length <= count) return tools.map((tool) => tool.name);
  const step = (tools.length - 1) / (count - 1);
  return Array.from({ length: count }, (_unused, index) => tools[Math.round(index * step)].name);
}

/**
 * The third catalog tier: one line per SERVER instead of one per tool.
 *
 * Tiers 1 and 2 both scale with the tools CONNECTED rather than with the tools a goal could use.
 * Measured on four connected servers (127 tools), tier 2 spends ~8,500 characters of Gemini's
 * 33,499 on every run — including the run that only wanted a currency conversion — and that is
 * the block that squeezes the conversation history and the observations.
 *
 * Nothing is hidden by this, which is the difference between a summary and the omission it
 * replaces: `tool_help` with a bare handle already returns a server's full tier-1 listing, and
 * `resolveMcpTool` matches against the runtime index rather than against whatever the prompt
 * rendered, so a tool reached that way is callable. A run WITHOUT `tool_help` has no way back,
 * which is why the caller must not choose this tier when `canHelp` is false.
 */
export function buildMcpSummary(index: McpRuntimeIndex, canHelp: boolean): string {
  return index.handles.map((server) => {
    const marker = server.userData ? ` ${USER_DATA_MARKER}` : '';
    const names = sampleToolNames(server.tools, SUMMARY_SAMPLE).join(', ');
    const open = canHelp ? ` — call "${AGENT_HELP_TOOL}" with "${server.handle}" for the full list` : '';
    return `- [${server.handle}] ${server.serverName}${marker} — ${server.tools.length} tools, e.g. ${names}${open}.`;
  }).join('\n');
}

/**
 * Full lines while they fit, tier-1 briefs when they do not. The fallback is measured, not
 * guessed: it is only taken when it discloses strictly more tools than the full listing did.
 */
export function buildMcpCatalog(
  index: McpRuntimeIndex,
  budgetChars: number,
  canHelp = true,
): McpCatalogFill {
  const full = fillCatalog(index, budgetChars, renderToolLine, canHelp);
  if (full.omitted === 0) return { ...full, brief: false };

  let best = full;
  let bestIsBrief = false;
  for (const limit of BRIEF_DESC_LIMITS) {
    const attempt = fillCatalog(index, budgetChars, (tool, serverId) => renderBriefToolLine(tool, serverId, limit), canHelp);
    if (attempt.includedCount > best.includedCount) {
      best = attempt;
      bestIsBrief = true;
    }
    if (attempt.omitted === 0) break;
  }
  return { ...best, brief: bestIsBrief };
}

/**
 * One server's tools, tier-1, for a `tool_help` call that named a bare handle. Squeezed by the
 * same ladder the catalog uses and tailed the same way, because the observation this lands in has
 * a cap of its own — a 78-tool server does not fit a browser provider's 3,500 characters either,
 * and a listing that ran off the end would hide the tail a second time.
 */
export function describeMcpServer(
  index: McpRuntimeIndex,
  handle: string,
  budgetChars: number,
): string | null {
  const server = index.byHandle.get(handle);
  if (!server) return null;
  const single: McpRuntimeIndex = { handles: [server], byHandle: new Map([[handle, server]]) };
  const room = Math.max(0, budgetChars - TAIL_LINE_MAX);
  let last = '';
  for (const limit of BRIEF_DESC_LIMITS) {
    const attempt = fillCatalog(single, room, (tool, serverId) => renderBriefToolLine(tool, serverId, limit));
    last = attempt.text;
    if (attempt.omitted === 0) return attempt.text;
  }
  return last;
}

/**
 * `tool_help` for a connector tool. Returns null — not an error — when the name is not one, so
 * the caller can fall through to the built-in catalog lookup with the same single tool call.
 */
export function describeMcpTool(
  index: McpRuntimeIndex,
  wanted: string,
  serverListBudget = 0,
): string | null {
  const raw = wanted.trim();
  if (!raw) return null;
  const colon = raw.indexOf(':');
  if (colon > 0) {
    const server = index.byHandle.get(raw.slice(0, colon));
    const tool = server?.tools.find((t) => t.name === raw.slice(colon + 1));
    if (server && tool) return `${renderToolLine(tool, server.serverId)}${schemaHint(tool)}`;
  }
  // A bare handle lists the server. Checked before the bare tool-name search, because a name that
  // is BOTH a handle and a tool almost certainly means the server the catalog just advertised —
  // and that tool is still reachable the explicit way, as `handle:tool`.
  if (serverListBudget > 0 && index.byHandle.has(raw)) {
    return describeMcpServer(index, raw, serverListBudget);
  }
  const matches = index.handles.flatMap((server) => server.tools
    .filter((tool) => tool.name === raw)
    .map((tool) => ({ handle: server.handle, serverId: server.serverId, tool })));
  if (matches.length === 1) return `${renderToolLine(matches[0].tool, matches[0].serverId)}${schemaHint(matches[0].tool)}`;
  if (matches.length > 1) {
    const servers = matches.map((match) => `"${match.handle}:${raw}"`).join(', ');
    return `ERROR: "${raw}" exists on more than one server — ask again as one of: ${servers}.`;
  }
  return null;
}

export const MCP_SCHEMA_HINT_BUDGET = 1_200;
const SCHEMA_DESC_LIMITS = [140, 80, 40] as const;
const MAX_ENUM_VALUES = 12;
const MAX_NESTED_KEYS = 8;
const MAX_SPEC_DEPTH = 2;

type JsonSchema = Record<string, unknown>;

function asSchema(value: unknown): JsonSchema | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonSchema) : null;
}

function enumSpec(values: readonly unknown[]): string {
  const shown = values.slice(0, MAX_ENUM_VALUES).map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
  if (values.length > MAX_ENUM_VALUES) shown.push('…');
  return `one of: ${shown.join('|')}`;
}

function objectSpec(schema: JsonSchema): string {
  const props = asSchema(schema.properties);
  const keys = props ? Object.keys(props) : [];
  if (keys.length === 0) return 'object';
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const shown = keys.slice(0, MAX_NESTED_KEYS).map((key) => (required.has(key) ? `${key}*` : key));
  if (keys.length > MAX_NESTED_KEYS) shown.push('…');
  return `object{${shown.join(', ')}}`;
}

/**
 * One argument's shape in a single phrase. Enum values and the keys of a nested object are the
 * parts that decide whether a call is accepted at all, so they are spelled out; everything below
 * `MAX_SPEC_DEPTH` collapses to a bare type rather than nesting without end.
 */
function typeSpec(raw: unknown, depth = 0): string {
  const schema = asSchema(raw);
  if (!schema) return 'any';
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return enumSpec(schema.enum);
  if (schema.const !== undefined) return `= ${JSON.stringify(schema.const)}`;

  const variants = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(variants) && variants.length > 0) {
    if (depth >= MAX_SPEC_DEPTH) return 'any';
    return [...new Set(variants.map((variant) => typeSpec(variant, depth + 1)))].join(' | ');
  }

  const type = Array.isArray(schema.type) ? schema.type.map(String).join('|') : schema.type;
  if (type === 'array') return depth >= MAX_SPEC_DEPTH ? 'array' : `array<${typeSpec(schema.items, depth + 1)}>`;
  if (type === 'object') return depth >= MAX_SPEC_DEPTH ? 'object' : objectSpec(schema);
  return typeof type === 'string' && type.length > 0 ? type : 'any';
}

interface SchemaEntry {
  head: string;
  desc: string;
}

function schemaEntries(schema: JsonSchema): SchemaEntry[] {
  const props = asSchema(schema.properties);
  if (!props) return [];
  const required = (Array.isArray(schema.required) ? schema.required.map(String) : [])
    .filter((key) => Object.hasOwn(props, key));
  const requiredSet = new Set(required);
  // Required first, so a budget squeeze can only ever cost an argument the call could omit.
  const ordered = [...required, ...Object.keys(props).filter((key) => !requiredSet.has(key))];
  return ordered.map((key) => {
    const prop = asSchema(props[key]);
    const desc = typeof prop?.description === 'string' ? prop.description.replace(/\s+/g, ' ').trim() : '';
    return { head: `- ${key}${requiredSet.has(key) ? '*' : ''} (${typeSpec(prop)})`, desc };
  });
}

function withDesc(entry: SchemaEntry, limit: number): string {
  if (limit <= 0 || !entry.desc) return entry.head;
  const desc = entry.desc.length > limit ? `${entry.desc.slice(0, limit - 1)}…` : entry.desc;
  return `${entry.head}: ${desc}`;
}

/**
 * Heads are the floor and whatever is left buys descriptions, in required-first order. A uniform
 * tier is tried first so the listing reads consistently; only when no tier fits does it fall back
 * to explaining as many arguments as the budget allows.
 */
function fitDescriptions(entries: readonly SchemaEntry[], budget: number): string {
  for (const limit of SCHEMA_DESC_LIMITS) {
    const text = entries.map((entry) => withDesc(entry, limit)).join('\n');
    if (text.length <= budget) return text;
  }
  const lines = entries.map((entry) => entry.head);
  let used = lines.join('\n').length;
  const narrowest = SCHEMA_DESC_LIMITS[SCHEMA_DESC_LIMITS.length - 1];
  for (let i = 0; i < entries.length; i++) {
    const widened = withDesc(entries[i], narrowest);
    const growth = widened.length - lines[i].length;
    if (used + growth > budget) continue;
    lines[i] = widened;
    used += growth;
  }
  return lines.join('\n');
}

/** Bare heads still overflow: keep the ones that fit and say plainly how many did not. */
function dropOverflow(entries: readonly SchemaEntry[], budget: number): string {
  const footerCost = `\n(+${entries.length} more argument(s) omitted.)`.length;
  const kept: string[] = [];
  let used = 0;
  for (const entry of entries) {
    if (used + entry.head.length + 1 + footerCost > budget) break;
    kept.push(entry.head);
    used += entry.head.length + 1;
  }
  const omitted = entries.length - kept.length;
  return omitted === 0 ? kept.join('\n') : `${kept.join('\n')}\n(+${omitted} more argument(s) omitted.)`;
}

/**
 * A readable digest of a tool's input schema, required arguments first, inside a fixed budget.
 *
 * This was `JSON.stringify(inputSchema).slice(0, 1_200)`. On a real connector schema that cut
 * lands mid-object: for Notion's update-page it fell just after `"command":`, hiding the six legal
 * values of the one argument the model had to get right, along with `content_updates` and its
 * `old_str`/`new_str` shape. A severed blob still reads as a whole schema, so the model could not
 * tell it was guessing, and every write in the run failed on invented argument names. Enum values
 * and nested shapes decide whether a call is accepted, so they are never traded away; only
 * descriptions are squeezed, and anything the budget still cannot hold is reported as missing.
 */
export function schemaHint(tool: McpTool): string {
  const schema = asSchema(tool.inputSchema);
  if (!schema) return '';
  const entries = schemaEntries(schema);
  if (entries.length === 0) return `\nInput schema for ${tool.name}: no arguments.`;

  const header = `\nInput schema for ${tool.name} (* = required):\n`;
  const budget = MCP_SCHEMA_HINT_BUDGET - header.length;
  const heads = entries.map((entry) => entry.head).join('\n');
  return header + (heads.length > budget ? dropOverflow(entries, budget) : fitDescriptions(entries, budget));
}

const ARGUMENT_ERROR = /\b(invalid|validation|unrecognized|malformed)|\b(required|expected|missing|unknown)\b.{0,40}\b(argument|arguments|param|parameter|parameters|field|property|input|option|value)\b/i;

/**
 * Does the failure look like the arguments were wrong, rather than the call itself failing? Only
 * then is the schema worth its share of the observation budget — a rate limit or an outage gains
 * nothing from it and would crowd out the message the model actually has to read.
 */
export function isArgumentError(text: string): boolean {
  return ARGUMENT_ERROR.test(text);
}

export function validateMcpArguments(tool: McpTool, args: Record<string, unknown>): { ok: boolean; error?: string } {
  const required = tool.inputSchema?.required;
  if (!Array.isArray(required)) return { ok: true };
  // An empty string is a value, not an absence: Thunderbird's searchMessages documents `query: ""`
  // as "match everything", and refusing it cost a run a whole turn.
  const missing = required.filter((key) => {
    const value = (args ?? {})[key];
    return value === undefined || value === null;
  });
  if (missing.length > 0) return { ok: false, error: `Missing required argument(s): ${missing.join(', ')}` };
  return { ok: true };
}

export function formatMcpObservation(result: McpToolResult): string {
  const text = result.text || '(empty result)';
  return result.isError ? `ERROR: ${text}` : text;
}

export interface McpAction {
  thought: string;
  action: 'call_mcp';
  server: string;
  name: string;
  arguments: Record<string, unknown>;
  plan?: string[];
  planDone?: number[];
  /** Same field as on `AgentAction`: the validator is chosen per RESPONSE, so both shapes read it. */
  stepsNeeded?: number;
  intent?: GoalIntent;
}

export function validateMcpAction(obj: Record<string, unknown>, index: McpRuntimeIndex): Validation<McpAction> {
  const thought = typeof obj.thought === 'string' ? obj.thought : '';
  const server = typeof obj.server === 'string' ? obj.server.trim() : '';
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';

  const handle = index.byHandle.get(server);
  if (!handle) {
    return { ok: false, error: `"server" must be one of: ${index.handles.map((h) => `"${h.handle}"`).join(', ')}. Got "${server}".` };
  }
  if (!handle.tools.some((tool) => tool.name === name)) {
    return { ok: false, error: `"name" must be a tool on server "${server}". Got "${name}".` };
  }
  const rawArgs = obj.arguments;
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {};
  return {
    ok: true,
    value: { thought, action: 'call_mcp', server, name, arguments: args, ...readPlanFields(obj), ...readStepBudget(obj), ...readIntent(obj) },
  };
}

export function resolveMcpTool(index: McpRuntimeIndex, server: string, name: string): { serverId: string; tool: McpTool } | undefined {
  const handle = index.byHandle.get(server);
  const tool = handle?.tools.find((t) => t.name === name);
  return handle && tool ? { serverId: handle.serverId, tool } : undefined;
}
