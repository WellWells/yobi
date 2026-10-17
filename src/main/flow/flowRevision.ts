import type { FlowDefinition, SkillInstance, SkillType, TriggerConfig } from '../../shared/types';
import { DEFAULT_SKILL_CONFIG } from '../../shared/flowSkillSchema';
import { botStepTargets } from '../../shared/botRecipients';
import { createEntityId } from './flowPersistence';
import { botTriggerAccess, isBotCommandAdminOnly, isBotCommandRestricted } from '../../shared/botCommandAccess';

/**
 * Laying a model's revision over a saved flow, and saying what it changed. Pure, so the two
 * things that must hold are testable without a model: a step the change left alone keeps its id
 * (its seen-cache is keyed by it), and nothing the model never saw — the switch, the variables,
 * the people a bot command is limited to, schedule-editor fields — is lost on the way back.
 */

/** Steps that act on the computer: a flow that gains one is reviewed before it runs. */
export const SENSITIVE_STEP_TYPES: ReadonlySet<string> = new Set<string>([
  'shell', 'run', 'js', 'browser_js', 'power', 'restart_app', 'file_delete',
]);

/** A step's config as it behaves: defaults filled in, and a bot's older `chatId` read as `chatIds`. */
function comparableConfig(step: SkillInstance): string {
  const config: Record<string, string> = { ...(DEFAULT_SKILL_CONFIG[step.type] ?? {}), ...step.config };
  if (step.type === 'bot') {
    config.chatIds = botStepTargets(config);
    delete config.chatId;
  }
  return JSON.stringify(config, Object.keys(config).sort());
}

/** Config keys the compiler has no field for. It never sees them, so it cannot have meant to drop them. */
function unseenKeys(step: SkillInstance): Record<string, string> {
  const defaults = DEFAULT_SKILL_CONFIG[step.type] ?? {};
  return Object.fromEntries(Object.entries(step.config).filter(([key]) => !(key in defaults) && !(step.type === 'bot' && key === 'chatId')));
}

/** A bot command as the bot registers it: the validator lowercases the model's, a hand-edited file may not. */
function botCommandOf(trigger: TriggerConfig): string {
  return (trigger.botCommand ?? '').trim().replace(/^\//, '').toLowerCase();
}

const MEANING_FIELDS = [
  'type', 'keys', 'cronExpression', 'botCommand', 'botCommandDescription', 'botInputVariable',
  'chatCommand', 'chatCommandDescription', 'chatInputVariable', 'systemEvent',
] as const;

/**
 * What a trigger does, without the fields the schedule editor derives or remembers. The validator
 * rebuilds a cron trigger from its expression and drops the rest (the once-date, catch-up), so an
 * echoed-back trigger never equals the saved object even when the model left it alone.
 */
function triggerMeaning(trigger: TriggerConfig): string {
  return JSON.stringify(MEANING_FIELDS.map((field) => String(trigger[field] ?? '').trim()));
}

/** Who may run a bot command: the mode and the ids, only the fields the trigger actually has. */
type BotAccessFields = Pick<TriggerConfig, 'botAccess' | 'botAllowedUserIds'>;

function accessOf(trigger: TriggerConfig): BotAccessFields {
  return {
    ...(trigger.botAccess !== undefined ? { botAccess: trigger.botAccess } : {}),
    ...(trigger.botAllowedUserIds !== undefined ? { botAllowedUserIds: [...trigger.botAllowedUserIds] } : {}),
  };
}

function hasAccess(trigger: TriggerConfig): boolean {
  return trigger.botAccess !== undefined || Boolean(trigger.botAllowedUserIds?.length);
}

/**
 * Who may run a bot command the saved flow did not have. One saved command gone and one new one
 * is a rename: it keeps that command's access. Anything else is limited to everyone the flow
 * already allowed (the union of its lists, in the explicit 'users' mode so that a union of empty
 * lists stays nobody; the admins when every command was the admins'), because the model never saw
 * who may run them. A flow with a command open
 * to everyone already reached everyone, so the default widens nothing there; a flow with no bot
 * command gets the default any new command gets.
 */
function newCommandAccess(
  previousBots: readonly TriggerConfig[],
  vanished: readonly TriggerConfig[],
  newCount: number,
): BotAccessFields | undefined {
  if (vanished.length === 1 && newCount === 1) return accessOf(vanished[0]!);
  if (previousBots.length === 0 || previousBots.some((trigger) => !isBotCommandRestricted(botTriggerAccess(trigger)))) return undefined;
  if (previousBots.every((trigger) => isBotCommandAdminOnly(botTriggerAccess(trigger)))) return { botAccess: 'admins' };
  return { botAccess: 'users', botAllowedUserIds: [...new Set(previousBots.flatMap((trigger) => trigger.botAllowedUserIds ?? []))] };
}

/** The saved access of a command still in the revision; a restricted one wins over an open duplicate. */
function sameCommandAccess(sameCommand: readonly TriggerConfig[]): BotAccessFields | undefined {
  const pick = sameCommand.find((trigger) => isBotCommandRestricted(botTriggerAccess(trigger))) ?? sameCommand.find(hasAccess);
  return pick ? accessOf(pick) : undefined;
}

/**
 * The revised triggers laid over the saved ones. An unchanged trigger stays the saved object,
 * schedule-editor fields and all. Who may run a bot command was never shown to the model, so it
 * is carried over: to the same command, to a renamed one, and never dropped so that a restricted
 * flow opens up.
 */
function keptTriggers(revised: readonly TriggerConfig[], previous: readonly TriggerConfig[]): TriggerConfig[] {
  const previousBots = previous.filter((trigger) => trigger.type === 'bot');
  const revisedCommands = new Set(revised.filter((trigger) => trigger.type === 'bot').map(botCommandOf));
  const previousCommands = new Set(previousBots.map(botCommandOf));
  const vanished = previousBots.filter((trigger) => !revisedCommands.has(botCommandOf(trigger)));
  const newCount = revised.filter((trigger) => trigger.type === 'bot' && !previousCommands.has(botCommandOf(trigger))).length;
  const newAccess = newCommandAccess(previousBots, vanished, newCount);
  return revised.map((next) => {
    const same = previous.find((trigger) => triggerMeaning(trigger) === triggerMeaning(next));
    if (same) return same;
    if (next.type !== 'bot') return next;
    if (hasAccess(next)) return next;
    const sameCommand = previousBots.filter((trigger) => botCommandOf(trigger) === botCommandOf(next));
    const access = sameCommand.length ? sameCommandAccess(sameCommand) : newAccess;
    return access && (access.botAccess !== undefined || access.botAllowedUserIds?.length) ? { ...next, ...access } : next;
  });
}

function withoutAccess(trigger: TriggerConfig): TriggerConfig {
  const { botAccess: _mode, botAllowedUserIds: _ids, ...rest } = trigger;
  return rest;
}

/**
 * An earlier version's triggers, put back over the current ones. Who may run a bot command is the
 * current flow's decision and a restore must not undo a narrowing made since: a command the flow
 * still has keeps today's access; a renamed one keeps the access of the one it replaced; any other
 * is limited as `edit_flow` limits a new command. Only where nothing applies does the version's own
 * access stand — the current flow then has no command, or one open to everyone, so it widens nothing.
 */
export function restoredTriggers(version: readonly TriggerConfig[], current: readonly TriggerConfig[]): TriggerConfig[] {
  const currentBots = current.filter((trigger) => trigger.type === 'bot');
  const currentCommands = new Set(currentBots.map(botCommandOf));
  const versionCommands = new Set(version.filter((trigger) => trigger.type === 'bot').map(botCommandOf));
  const vanished = currentBots.filter((trigger) => !versionCommands.has(botCommandOf(trigger)));
  const newCount = version.filter((trigger) => trigger.type === 'bot' && !currentCommands.has(botCommandOf(trigger))).length;
  const decided = newCommandAccess(currentBots, vanished, newCount) !== undefined;
  const stripped = version.map((trigger) => (
    trigger.type === 'bot' && (currentCommands.has(botCommandOf(trigger)) || decided) ? withoutAccess(trigger) : trigger
  ));
  return keptTriggers(stripped, current);
}

/**
 * The revision laid over the saved flow. Identity, timestamps, the enabled switch and the
 * variables stay the saved flow's; the steps keep the id the model gave back only when it names a
 * step of the same type that no earlier step already claimed.
 */
export function mergeRevision(
  original: FlowDefinition,
  revised: FlowDefinition,
  stepIds: ReadonlyArray<string | undefined>,
  newId: () => string = createEntityId,
): FlowDefinition {
  const byId = new Map(original.steps.map((step) => [step.id, step]));
  const claimed = new Set<string>();
  const steps = revised.steps.map((step, index) => {
    const id = stepIds[index];
    const before = id ? byId.get(id) : undefined;
    if (!before || before.type !== step.type || claimed.has(before.id)) return { ...step, id: newId() };
    claimed.add(before.id);
    return { ...step, id: before.id, config: { ...unseenKeys(before), ...step.config } };
  });
  const [trigger, ...extraTriggers] = keptTriggers(
    [revised.trigger, ...(revised.extraTriggers ?? [])],
    [original.trigger, ...(original.extraTriggers ?? [])],
  );
  const { extraTriggers: _previousExtras, ...rest } = original;
  return {
    ...rest,
    name: revised.name || original.name,
    description: revised.description,
    trigger: trigger!,
    ...(extraTriggers.length ? { extraTriggers } : {}),
    steps,
  };
}

export interface StepRef {
  label: string;
  type: SkillType;
}

export interface FlowDiff {
  added: StepRef[];
  removed: StepRef[];
  changed: StepRef[];
  renamedFrom?: string;
  trigger: boolean;
}

export function sameStep(a: SkillInstance, b: SkillInstance): boolean {
  return a.type === b.type && a.label === b.label && a.outputKey === b.outputKey && comparableConfig(a) === comparableConfig(b);
}

function triggerKey(flow: FlowDefinition): string {
  return [flow.trigger, ...(flow.extraTriggers ?? [])].map(triggerMeaning).join('|');
}

export function diffFlows(before: FlowDefinition, after: FlowDefinition): FlowDiff {
  const ref = (step: SkillInstance): StepRef => ({ label: step.label, type: step.type });
  const afterIds = new Set(after.steps.map((step) => step.id));
  const beforeById = new Map(before.steps.map((step) => [step.id, step]));
  return {
    added: after.steps.filter((step) => !beforeById.has(step.id)).map(ref),
    removed: before.steps.filter((step) => !afterIds.has(step.id)).map(ref),
    changed: after.steps.filter((step) => {
      const previous = beforeById.get(step.id);
      return previous !== undefined && !sameStep(previous, step);
    }).map(ref),
    ...(before.name !== after.name ? { renamedFrom: before.name } : {}),
    trigger: triggerKey(before) !== triggerKey(after),
  };
}

export function isEmptyDiff(diff: FlowDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0 && !diff.renamedFrom && !diff.trigger;
}
