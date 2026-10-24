import type { FlowDefinition, SkillInstance, SkillType } from './types';
import { HOTKEY_SELECTION_VAR } from './flowReferenceCheck';
import { extractTemplateVariables } from './templateVariables';

/**
 * Who may run a flow's bot command, on top of the pairing check. A non-empty list narrows the
 * command to those ids; under the legacy reading an empty list means anyone paired.
 *
 * Ids are compared as strings: Telegram's are numeric and LINE's start with `U`, so one list can
 * hold both without a namespace prefix.
 */
export function normalizeAllowedUserIds(raw: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw ?? []) {
    const id = String(entry).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Who a flow's bot command is open to: `all` is every paired account, `users` is exactly the
 * listed ids (an empty list is nobody), `admins` is the owner ("me") and accounts holding the
 * Telegram admin grant, in their own private chat only. Explicit so that emptying a restricted
 * list, or importing one with stripped ids, never opens the command to everyone.
 */
export type BotCommandAccessMode = 'all' | 'users' | 'admins';

export function isBotCommandAccessMode(value: unknown): value is BotCommandAccessMode {
  return value === 'all' || value === 'users' || value === 'admins';
}

/**
 * Steps that read the owner's own data on this computer: LINE chats, the Telegram group talk the bot
 * kept, their calendars, their mail, files, the clipboard, the screen, its facts, and the apps reached
 * through their connectors.
 */
const OWNER_DATA_STEP_TYPES: ReadonlySet<SkillType> = new Set<SkillType>([
  'line_read', 'telegram_read', 'calendar', 'mail_fetch', 'file_read', 'file_list', 'clipboard', 'capture', 'sysinfo', 'mcp',
]);

/**
 * Variables every run is seeded with that hold the owner's data: the clipboard at the start of the
 * run, and the text selected when a hotkey started it. Referenced from any step, they read it with
 * no clipboard step at all.
 */
const OWNER_DATA_VARIABLES: ReadonlySet<string> = new Set(['clipboard', HOTKEY_SELECTION_VAR]);

type StepShape = Pick<SkillInstance, 'type' | 'config'>;

function referencesOwnerData(config: StepShape['config'] | undefined): boolean {
  return Object.values(config ?? {}).some((value) => typeof value === 'string'
    && extractTemplateVariables(value).some((name) => OWNER_DATA_VARIABLES.has(name.split('.')[0]!.trim())));
}

/**
 * Whether a step reads the owner's own data: a step of that kind (a clipboard step only when it
 * reads), an llm step that puts their personal memory in its prompt, or any step whose fields use
 * `{{clipboard}}` or `{{selection}}`.
 */
function stepReadsOwnerData(step: StepShape): boolean {
  if (OWNER_DATA_STEP_TYPES.has(step.type) && !(step.type === 'clipboard' && (step.config?.action ?? '').trim() === 'write')) return true;
  // Any value but off: the run reads the interpolated one, so '{{m}}' set to 'true' counts too.
  if (step.type === 'llm' && !['', 'false'].includes((step.config?.useUserMemory ?? '').trim())) return true;
  return referencesOwnerData(step.config);
}

/** Whether a flow's steps read the owner's own data. */
export function readsOwnerData(steps: readonly StepShape[] | undefined): boolean {
  return (steps ?? []).some(stepReadsOwnerData);
}

/**
 * Whether a whole flow reads the owner's own data: its steps, or a trigger that watches a folder —
 * every new file there is handed to the steps and may be attached to what they send.
 */
export function flowReadsOwnerData(flow: Pick<FlowDefinition, 'trigger' | 'extraTriggers' | 'steps'>): boolean {
  return readsOwnerData(flow.steps)
    || [flow.trigger, ...(flow.extraTriggers ?? [])].some((trigger) => trigger?.type === 'file');
}

/**
 * Steps that act as the owner: they write to this computer's disk (any folder, any extension), put
 * text on the clipboard the owner pastes from, send mail from the owner's account, make requests
 * of any method from the owner's machine and network, or open a page in the flows' persistent
 * browser session (`browser_open`): signed in wherever the owner signed in there, its title and
 * address readable without a script, and with `show` a window on the owner's screen. Fine in the
 * owner's own flow; another admin's flow with one is kept off for the owner to review.
 */
export const OWNER_ACTION_STEP_TYPES: ReadonlySet<SkillType> = new Set<SkillType>([
  'file_write', 'file_download', 'youtube_download', 'x_media', 'email_send', 'http', 'clipboard',
  'browser_open',
]);

/** Whether a flow's steps act as the owner (a clipboard step only when it writes). */
export function actsAsOwner(steps: readonly StepShape[] | undefined): boolean {
  return (steps ?? []).some((step) => (
    OWNER_ACTION_STEP_TYPES.has(step.type)
    && !(step.type === 'clipboard' && (step.config?.action ?? '').trim() !== 'write')
  ));
}

/** The access fields of a trigger or a registered command, whichever name the caller uses. */
export interface BotCommandAccess {
  access?: BotCommandAccessMode;
  allowedUserIds?: readonly string[];
  /** The command's flow reads the owner's own data: without a mode it reads as `admins`. */
  ownerData?: boolean;
}

/**
 * The mode a command actually runs under. A trigger without the field keeps the legacy reading:
 * a non-empty list is those ids, and an empty one is everyone — except over a flow that reads the owner's own data, where it is the admins.
 */
export function botCommandAccessMode(
  access: unknown,
  allowedUserIds: readonly string[] | undefined,
  ownerData = false,
): BotCommandAccessMode {
  if (isBotCommandAccessMode(access)) return access;
  if (normalizeAllowedUserIds(allowedUserIds).length > 0) return 'users';
  return ownerData ? 'admins' : 'all';
}

function modeOf(command: BotCommandAccess): BotCommandAccessMode {
  return botCommandAccessMode(command.access, command.allowedUserIds, command.ownerData === true);
}

/** True when only some accounts may run the command, so only their own chats list it. */
export function isBotCommandRestricted(command: BotCommandAccess): boolean {
  return modeOf(command) !== 'all';
}

/** True when only the owner and admins may run the command: the caller has to say who is asking. */
export function isBotCommandAdminOnly(command: BotCommandAccess): boolean {
  return modeOf(command) === 'admins';
}

/**
 * Who is asking, beyond the id. `admin`: the owner or an admin-grant holder, still paired, asking
 * in their own private chat. Absent = not one.
 */
export interface BotCommandCaller {
  admin: boolean;
}

/** May this account run the command? Pairing is checked separately; this only narrows it. */
export function isBotCommandAllowed(command: BotCommandAccess, userId: string, caller?: BotCommandCaller): boolean {
  const mode = modeOf(command);
  if (mode === 'all') return true;
  if (mode === 'admins') return caller?.admin === true;
  return normalizeAllowedUserIds(command.allowedUserIds).includes(String(userId).trim());
}

/** A command limited to listed accounts with nobody listed: it answers no one. */
export function isBotCommandClosed(command: BotCommandAccess): boolean {
  return modeOf(command) === 'users' && normalizeAllowedUserIds(command.allowedUserIds).length === 0;
}

/** A trigger's access fields under the names the predicates read; `steps` are its flow's. */
export function botTriggerAccess(
  trigger: { botAccess?: BotCommandAccessMode; botAllowedUserIds?: readonly string[] },
  steps?: readonly StepShape[],
): BotCommandAccess {
  const access: BotCommandAccess = { access: trigger.botAccess, allowedUserIds: trigger.botAllowedUserIds };
  return readsOwnerData(steps) ? { ...access, ownerData: true } : access;
}

/**
 * Whether every registered command of a flow is limited to admins, so a bot may start the flow
 * only for one of them. The flow runner's last check behind the chat handlers.
 */
export function isFlowAdminOnly(commands: readonly { flowId: string; access?: BotCommandAccessMode }[], flowId: string): boolean {
  const own = commands.filter((command) => command.flowId === flowId);
  return own.length > 0 && own.every((command) => command.access === 'admins');
}
