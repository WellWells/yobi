import type { TriggerConfig } from './types';
import { BOT_COMMAND_RE } from './types';
import { parseCronToScheduleFields } from './flowSchedule';

// Trigger grammar validation for AI-generated flows. Policy: an ABSENT trigger
// (or explicit "manual") is fine, but a trigger of a declared type that is
// missing or mangling its discriminating field returns an error — silently
// degrading to manual would drop the user's requested trigger AND break any
// step referencing the trigger-seeded input variable with a confusing message.

export type TriggerValidationResult =
  | { ok: true; trigger: TriggerConfig }
  | { ok: false; error: string };

const ACCEL_MODIFIER_RE = /^(commandorcontrol|cmdorctrl|command|cmd|control|ctrl|alt|option|altgr|shift|super|meta)$/i;
// Keys that Electron registers without a modifier (function + media/volume keys).
const ACCEL_BARE_KEY_RE = /^(f([1-9]|1[0-9]|2[0-4])|volumeup|volumedown|volumemute|mediaplaypause|medianexttrack|mediaprevioustrack|mediastop)$/i;
const ACCEL_KEY_RE = /^([0-9a-z]|f([1-9]|1[0-9]|2[0-4])|plus|space|tab|capslock|numlock|scrolllock|backspace|delete|insert|return|enter|up|down|left|right|home|end|pageup|pagedown|escape|esc|printscreen|volumeup|volumedown|volumemute|mediaplaypause|medianexttrack|mediaprevioustrack|mediastop|num[0-9]|numdec|numadd|numsub|nummult|numdiv|[`~!@#$%^&*()\-_=[\]{};:'",.<>/?\\|])$/i;

function isValidAccelerator(keys: string): boolean {
  const parts = keys.split('+').map((p) => p.trim());
  if (parts.some((p) => !p)) return false;
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  if (!ACCEL_KEY_RE.test(key)) return false;
  if (!modifiers.every((m) => ACCEL_MODIFIER_RE.test(m))) return false;
  return modifiers.length > 0 || ACCEL_BARE_KEY_RE.test(key);
}

// Sanity check only — node-cron does the authoritative validation at
// registration time; this catches LLM output that is not cron syntax at all.
// node-cron also accepts a 6-field form with a leading seconds field.
function isPlausibleCronExpression(expression: string): boolean {
  const parts = expression.split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.slice(parts.length - 5);
  const numeric = /^[\d*,/-]+$/;
  const named = /^[\da-z*,/-]+$/i;
  return (parts.length === 5 || numeric.test(parts[0]))
    && numeric.test(minute) && numeric.test(hour) && numeric.test(dayOfMonth)
    && named.test(month) && named.test(dayOfWeek);
}

export function validateTrigger(raw: unknown): TriggerValidationResult {
  const manual: TriggerValidationResult = { ok: true, trigger: { type: 'manual' } };
  if (typeof raw !== 'object' || raw === null) return manual;
  const tr = raw as Record<string, unknown>;
  if (tr.type === undefined || tr.type === 'manual') return manual;

  if (tr.type === 'hotkey') {
    const keys = typeof tr.keys === 'string' ? tr.keys.trim() : '';
    if (!keys) return { ok: false, error: 'Hotkey trigger is missing "keys"' };
    if (!isValidAccelerator(keys)) {
      return { ok: false, error: `Invalid hotkey "${keys}" — use an Electron accelerator like "CommandOrControl+Shift+Y" (modifiers joined with "+", one key at the end) or a bare media/volume/function key` };
    }
    return { ok: true, trigger: { type: 'hotkey', keys } };
  }
  if (tr.type === 'cron') {
    const cronExpression = typeof tr.cronExpression === 'string' ? tr.cronExpression.trim() : '';
    if (!cronExpression) return { ok: false, error: 'Cron trigger is missing "cronExpression"' };
    if (!isPlausibleCronExpression(cronExpression)) {
      return { ok: false, error: `Invalid cronExpression "${cronExpression}" — use standard 5-field cron (minute hour day-of-month month day-of-week), e.g. "0 8 * * 1-5", or 6 fields with leading seconds` };
    }
    const scheduleFields = parseCronToScheduleFields(cronExpression);
    return { ok: true, trigger: scheduleFields ? { type: 'cron', cronExpression, ...scheduleFields } : { type: 'cron', cronExpression } };
  }
  if (tr.type === 'bot' || tr.type === 'chat') {
    const commandKey = tr.type === 'bot' ? 'botCommand' : 'chatCommand';
    const command = typeof tr[commandKey] === 'string' ? (tr[commandKey] as string).trim().replace(/^\//, '').toLowerCase() : '';
    if (!command) return { ok: false, error: `${tr.type === 'bot' ? 'Bot' : 'Chat'} trigger is missing "${commandKey}"` };
    if (!BOT_COMMAND_RE.test(command)) {
      return { ok: false, error: `Invalid ${commandKey} "${command}" — commands must start with a lowercase letter and use only a-z, 0-9 and _ (max 32 chars)` };
    }
    if (tr.type === 'bot') {
      return {
        ok: true,
        trigger: {
          type: 'bot',
          botCommand: command,
          botCommandDescription: typeof tr.botCommandDescription === 'string' ? tr.botCommandDescription : '',
          botInputVariable: typeof tr.botInputVariable === 'string' && tr.botInputVariable.trim() ? tr.botInputVariable.trim() : 'input',
        },
      };
    }
    return {
      ok: true,
      trigger: {
        type: 'chat',
        chatCommand: command,
        chatCommandDescription: typeof tr.chatCommandDescription === 'string' ? tr.chatCommandDescription : '',
        chatInputVariable: typeof tr.chatInputVariable === 'string' && tr.chatInputVariable.trim() ? tr.chatInputVariable.trim() : 'input',
      },
    };
  }
  return { ok: false, error: `Unknown trigger type "${String(tr.type)}" — use "manual", "hotkey", "cron", "bot" or "chat"` };
}
