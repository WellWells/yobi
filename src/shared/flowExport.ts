import { FLOW_EXPORT_TYPE } from './types';
import type { FlowDefinition, FlowVariable, TriggerConfig } from './types';

export const FLOW_EXPORT_VERSION = 1;

export interface FlowExportPayload {
  type: typeof FLOW_EXPORT_TYPE;
  version: typeof FLOW_EXPORT_VERSION;
  flow: FlowDefinition;
}

/**
 * Which fields of a variable are its DECLARATION, and which hold what the user typed in.
 *
 * Exhaustive on purpose: adding a field to `FlowVariable` without classifying it here fails
 * typecheck, because either default is a silent wrong answer. An allowlist would quietly drop
 * new declaration fields out of every exported file, and a denylist would quietly ship the next
 * value-bearing field to whoever the flow was shared with.
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
  value: true,
};

/**
 * The same question for a trigger: which of its fields describe the trigger, and which name a
 * person.
 *
 * `botAllowedUserIds` is the only one that names people, and it must not travel. Shipping it
 * hands the recipient a list of someone else's Telegram and LINE ids, and — because their own id
 * is not on it — hands them a command that silently refuses them on first use.
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
  botCommand: false,
  botCommandDescription: false,
  botInputVariable: false,
  botAllowedUserIds: true,
  chatCommand: false,
  chatCommandDescription: false,
  chatInputVariable: false,
};

const USER_DATA_TRIGGER_FIELDS = (Object.keys(TRIGGER_FIELD_IS_USER_DATA) as (keyof TriggerConfig)[])
  .filter((field) => TRIGGER_FIELD_IS_USER_DATA[field]);

function stripTrigger(trigger: TriggerConfig): TriggerConfig {
  const out = { ...trigger };
  for (const field of USER_DATA_TRIGGER_FIELDS) delete out[field];
  return out;
}

/** Every trigger a flow can fire from, the primary one and the extras alike. */
export function stripTriggerUserIds(flow: FlowDefinition): FlowDefinition {
  return {
    ...flow,
    trigger: stripTrigger(flow.trigger),
    ...(flow.extraTriggers ? { extraTriggers: flow.extraTriggers.map(stripTrigger) } : {}),
  };
}

/**
 * Strips the values the user filled in, keeping every field that declares the variable.
 *
 * Exporting is how a flow gets shared, and the values are the part that is nobody else's
 * business: a Telegram chat id, a folder path on this machine, an email address. The variable
 * panel exists to lift exactly these out of the step configs, so leaving them in the export
 * undoes the point of it. `value` is kept as an empty string rather than removed, so an
 * imported flow still matches the shape the editor and the setup wizard read.
 *
 * Out of scope, and unchanged: a value typed straight into a step config. That is what
 * variables are the replacement for, and rewriting step configs on the way out would be a
 * guess at which of them are secrets.
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
