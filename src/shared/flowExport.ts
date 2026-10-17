import { FLOW_EXPORT_TYPE } from './types';
import type { FlowDefinition, FlowVariable, TriggerConfig } from './types';
import { botCommandAccessMode, readsOwnerData } from './botCommandAccess';

export const FLOW_EXPORT_VERSION = 1;

export interface FlowExportPayload {
  type: typeof FLOW_EXPORT_TYPE;
  version: typeof FLOW_EXPORT_VERSION;
  flow: FlowDefinition;
}

/**
 * Which variable fields are declaration and which hold user input. Exhaustive, so a new
 * `FlowVariable` field fails typecheck until it is classified here.
 */
const VARIABLE_FIELD_IS_USER_DATA: Record<keyof FlowVariable, boolean> = {
  key: false,
  type: false,
  label: false,
  question: false,
  hint: false,
  required: false,
  options: false,
  min: false,
  max: false,
  multiline: false,
  placeholder: false,
  pickTarget: false,
  pickUrlKey: false,
  pickWriteKeys: false,
  hiddenInSetup: false,
  platformKey: false,
  value: true,
};

/**
 * The same question for a trigger: which of its fields describe the trigger, and which name a
 * person.
 *
 * `botAllowedUserIds` is the only one that names people, and it must not travel. Shipping it
 * hands the recipient a list of someone else's Telegram and LINE ids. `botAccess` is the mode,
 * not a person, so it travels: a command limited to some accounts arrives limited to nobody until
 * the recipient picks their own, instead of arriving open to every account they have paired.
 */
const TRIGGER_FIELD_IS_USER_DATA: Record<keyof TriggerConfig, boolean> = {
  type: false,
  keys: false,
  cronExpression: false,
  scheduleMode: false,
  intervalValue: false,
  intervalUnit: false,
  weekdays: false,
  scheduleHour: false,
  scheduleMinute: false,
  repeatWithinDay: false,
  repeatEveryValue: false,
  repeatEveryUnit: false,
  endHour: false,
  endMinute: false,
  intervalMinuteOffset: false,
  monthDays: false,
  scheduleMonth: false,
  scheduleDay: false,
  onceDate: false,
  catchUpMissed: false,
  deleteAfterRun: false,
  botCommand: false,
  botCommandDescription: false,
  botInputVariable: false,
  botAccess: false,
  botAllowedUserIds: true,
  chatCommand: false,
  chatCommandDescription: false,
  chatInputVariable: false,
  systemEvent: false,
};

const USER_DATA_TRIGGER_FIELDS = (Object.keys(TRIGGER_FIELD_IS_USER_DATA) as (keyof TriggerConfig)[])
  .filter((field) => TRIGGER_FIELD_IS_USER_DATA[field]);

/**
 * A legacy trigger has no mode and reads an empty list as everyone (the admins over a flow that
 * reads the owner's own data), so stripping its list would open it up. Its mode is pinned to the
 * one it ran under before the ids go.
 */
function stripTrigger(trigger: TriggerConfig, steps: FlowDefinition['steps']): TriggerConfig {
  const out = { ...trigger };
  if (trigger.type === 'bot' && trigger.botAccess === undefined) {
    const mode = botCommandAccessMode(undefined, trigger.botAllowedUserIds, readsOwnerData(steps));
    if (mode !== 'all') out.botAccess = mode;
  }
  for (const field of USER_DATA_TRIGGER_FIELDS) delete out[field];
  return out;
}

/** Every trigger a flow can fire from, the primary one and the extras alike. */
export function stripTriggerUserIds(flow: FlowDefinition): FlowDefinition {
  const strip = (trigger: TriggerConfig): TriggerConfig => stripTrigger(trigger, flow.steps);
  return {
    ...flow,
    trigger: strip(flow.trigger),
    ...(flow.extraTriggers ? { extraTriggers: flow.extraTriggers.map(strip) } : {}),
  };
}

/**
 * Strips the values the user filled in (chat ids, local paths, addresses), keeping every field
 * that declares the variable. `value` stays '' so an imported flow keeps the shape the editor
 * reads. Values typed straight into step configs are left alone: which of those are secrets
 * would be a guess.
 */
export function stripVariableValues(flow: FlowDefinition): FlowDefinition {
  if (!flow.variables?.length) return flow;
  return {
    ...flow,
    variables: flow.variables.map((variable) => {
      const declaration = Object.fromEntries(
        Object.entries(variable)
          .filter(([field]) => !VARIABLE_FIELD_IS_USER_DATA[field as keyof FlowVariable]),
      ) as Omit<FlowVariable, 'value'>;
      return { ...declaration, value: '' };
    }),
  };
}

/** The envelope written to disk by an export, and the only place its shape is spelled out. */
export function buildFlowExportPayload(flow: FlowDefinition): FlowExportPayload {
  return {
    type: FLOW_EXPORT_TYPE,
    version: FLOW_EXPORT_VERSION,
    flow: stripTriggerUserIds(stripVariableValues(flow)),
  };
}
