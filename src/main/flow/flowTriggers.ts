import { globalShortcut } from 'electron';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { FlowDefinition, SystemEvent, TriggerConfig } from '../../shared/types';
import { HOTKEY_SELECTION_VAR } from '../../shared/flowReferenceCheck';
import { captureSelectedText } from '../clipboard';
import { extractTemplateVariables } from './interpolation';
import { sendLog } from '../helpers';
import { isHotkeyPaused, ownsAccelerator } from '../hotkey';
import { isRegisterableAccelerator, toAccelerator } from '../../shared/shortcuts';
import {
  isOnceExpired,
  normalizeCronTrigger,
  onceDueAt,
  resolveScheduleMode,
  shouldExecuteCronTriggerNow,
  shouldNormalizeCronTrigger,
} from '../../shared/flowSchedule';
import {
  getTriggerState,
  patchTriggerState,
  triggerStateKey,
  type TriggerRunState,
} from './scheduleState';
import { firstAllowedRunBetween, nextAllowedRuns, onceIsFirstCronMatch } from './scheduleRuns';
import { SystemTriggers } from './systemTriggers';
import { resolveSystemEvent } from '../../shared/flowSystemEvents';

/**
 * Whether anything in the flow reads `{{selection}}`. Serialized so a reference in any field counts,
 * and parsed with the interpolator's own extractor so `{{ selection }}` matches here as it does at run time.
 */
function referencesSelection(flow: FlowDefinition): boolean {
  return extractTemplateVariables(JSON.stringify(flow))
    .some((name) => name.split('.')[0].trim() === HOTKEY_SELECTION_VAR);
}

/** A miss older than this is stale news — catching it up would surprise more than it helps. */
const CATCH_UP_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

/** Long enough for the window and executor to be ready before a caught-up run starts. */
const CATCH_UP_DELAY_MS = 5_000;

/** How a run was started, for the decisions made after it ends. */
export interface TriggerFire {
  /** Started by a one-time schedule (or its catch-up): the only run that may delete the flow. */
  oneTimeSchedule?: boolean;
  /** Started by this system event; skipped while the flow is already queued or running. */
  systemEvent?: SystemEvent;
}

export type TriggerHandler = (flowId: string, extraContext?: Record<string, string>, fire?: TriggerFire) => void;

export class FlowTriggerRegistry {
  private cronJobs = new Map<string, ScheduledTask[]>();
  private catchUpTimers = new Map<string, NodeJS.Timeout[]>();
  private flowHotkeys = new Map<string, string[]>();
  private onTrigger: TriggerHandler;
  private system: SystemTriggers;

  constructor(onTrigger: TriggerHandler) {
    this.onTrigger = onTrigger;
    this.system = new SystemTriggers((flowId, systemEvent) => this.onTrigger(flowId, undefined, { systemEvent }));
  }

  /** Called once per launch, after every flow is registered; never on a save or a reload. */
  fireStartup(): void {
    this.system.emit('startup');
  }

  registerAll(flows: FlowDefinition[]): void {
    for (const flow of flows) {
      if (flow.enabled) {
        this.register(flow, true);
      }
    }
  }

  /** `allowCatchUp` is only true on startup: re-saving a flow must not replay a missed run. */
  register(flow: FlowDefinition, allowCatchUp = false): void {
    const triggers = [flow.trigger, ...(flow.extraTriggers ?? [])];
    triggers.forEach((raw, index) => {
      const trigger = shouldNormalizeCronTrigger(raw) ? normalizeCronTrigger(raw) : raw;
      if (trigger.type === 'hotkey' && trigger.keys) {
        this.registerHotkey(flow, trigger.keys);
      } else if (trigger.type === 'cron' && trigger.cronExpression) {
        this.registerCron(flow, trigger, index, allowCatchUp);
      } else if (trigger.type === 'system') {
        this.system.add(flow.id, flow.name, resolveSystemEvent(trigger.systemEvent));
      }
    });
  }

  private registerHotkey(flow: FlowDefinition, keys: string): void {
    if (!isRegisterableAccelerator(keys)) {
      sendLog(`❌ [Flow] Hotkey "${keys}" is not a valid accelerator — skipping for "${flow.name}"`);
      return;
    }
    for (const [existingFlowId, existingKeys] of this.flowHotkeys) {
      if (existingFlowId !== flow.id && existingKeys.includes(keys)) {
        sendLog(`⚠️ [Flow] Hotkey "${keys}" already used by another flow — skipping for "${flow.name}"`);
        return;
      }
    }
    if (ownsAccelerator(keys)) {
      sendLog(`⚠️ [Flow] Hotkey "${keys}" is already claimed by Yobi itself (a global hotkey or another flow) — skipping for "${flow.name}"`);
      return;
    }
    // Decided at registration: capturing the selection is a clipboard round trip that a flow
    // which never reads {{selection}} should not pay for on every press.
    const wantsSelection = referencesSelection(flow);
    try {
      const ok = globalShortcut.register(toAccelerator(keys, process.platform === 'darwin'), () => {
        if (isHotkeyPaused()) return;
        if (!wantsSelection) {
          this.onTrigger(flow.id);
          return;
        }
        // The press must not wait on the capture, and the capture must not swallow the run:
        // an empty selection still starts the flow, because a flow can legitimately use
        // {{selection}} as an optional extra alongside {{clipboard}}.
        void captureSelectedText()
          .then((selection) => {
            if (!selection) {
              sendLog(`⚠️ [Flow] Hotkey "${keys}" fired with nothing selected — {{selection}} is empty for "${flow.name}"`);
            }
            this.onTrigger(flow.id, { [HOTKEY_SELECTION_VAR]: selection });
          })
          .catch((err: unknown) => {
            sendLog(`⚠️ [Flow] Could not read the selection for "${flow.name}": ${err instanceof Error ? err.message : String(err)}`);
            this.onTrigger(flow.id, { [HOTKEY_SELECTION_VAR]: '' });
          });
      });
      if (ok) {
        this.appendEntry(this.flowHotkeys, flow.id, keys);
        sendLog(`⌨️ [Flow] Hotkey "${keys}" registered for "${flow.name}"`);
      } else {
        sendLog(`❌ [Flow] Failed to register hotkey "${keys}" for "${flow.name}"`);
      }
    } catch (err) {
      sendLog(`❌ [Flow] Hotkey error for "${flow.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private registerCron(
    flow: FlowDefinition,
    trigger: TriggerConfig,
    triggerIndex: number,
    allowCatchUp: boolean,
  ): void {
    const key = triggerStateKey(flow.id, triggerIndex);
    const mode = resolveScheduleMode(trigger);
    const saved = getTriggerState(key);

    if (mode === 'once' && !this.armOnce(flow, trigger, key, saved, allowCatchUp)) return;

    if (!trigger.cronExpression || !cron.validate(trigger.cronExpression)) {
      sendLog(`❌ [Flow] Invalid cron expression "${trigger.cronExpression ?? ''}" for "${flow.name}"`);
      return;
    }

    let task: ScheduledTask | null = null;
    const run = (): void => {
      if (shouldExecuteCronTriggerNow(trigger)) {
        this.fireSchedule(flow.id, mode === 'once');
        const firedAt = new Date().toISOString();
        patchTriggerState(key, mode === 'once' ? { lastRunAt: firedAt, onceFiredAt: firedAt } : { lastRunAt: firedAt });
        if (mode === 'once') void task?.stop();
      }
      if (task) this.recordNextRun(key, task, trigger);
    };

    // node-cron counts a tick the guard skipped as an execution, so a one-shot whose cron first
    // matches an earlier year gets no budget and is stopped after its real fire instead.
    const options = mode === 'once' && onceIsFirstCronMatch(trigger) ? { maxExecutions: 1 } : {};
    task = cron.schedule(trigger.cronExpression, run, options);
    this.appendEntry(this.cronJobs, flow.id, task);
    this.recordNextRun(key, task, trigger);

    if (allowCatchUp && mode !== 'once') this.catchUpIfMissed(flow, trigger, key, saved, task);
    sendLog(`⏰ [Flow] Cron "${trigger.cronExpression}" scheduled for "${flow.name}"`);
  }

  /** Returns false when the one-shot must not be armed — cron would otherwise repeat it next year. */
  private armOnce(
    flow: FlowDefinition,
    trigger: TriggerConfig,
    key: string,
    saved: TriggerRunState | undefined,
    allowCatchUp: boolean,
  ): boolean {
    const due = onceDueAt(trigger)?.getTime() ?? Number.NaN;
    const firedAt = saved?.onceFiredAt ? Date.parse(saved.onceFiredAt) : Number.NaN;
    // A fire only counts for the moment it served: state is keyed by position, so an edited date or a
    // trigger that slid into this slot carries an older fire that must not block it.
    if (Number.isFinite(firedAt) && (Number.isNaN(due) || firedAt >= due)) {
      sendLog(`⏰ [Flow] One-time schedule for "${flow.name}" already ran — not re-arming`);
      return false;
    }
    if (!isOnceExpired(trigger)) return true;

    const dueAt = saved?.nextRunAt ? Date.parse(saved.nextRunAt) : Number.NaN;
    // Only a miss of THIS moment: a fire clears nextRunAt and an edit or a slot shift leaves
    // another moment behind; either would otherwise pass for a recent miss.
    const missedRecently = dueAt === due && Date.now() - dueAt <= CATCH_UP_WINDOW_MS;
    if (allowCatchUp && trigger.catchUpMissed && missedRecently) {
      this.scheduleCatchUp(flow, key, true);
    } else {
      sendLog(`⏰ [Flow] One-time schedule for "${flow.name}" is in the past — skipped`);
    }
    return false;
  }

  private catchUpIfMissed(
    flow: FlowDefinition,
    trigger: TriggerConfig,
    key: string,
    saved: TriggerRunState | undefined,
    task: ScheduledTask,
  ): void {
    if (!trigger.catchUpMissed || !saved?.nextRunAt) return;
    const recorded = Date.parse(saved.nextRunAt);
    if (!Number.isFinite(recorded)) return;
    const now = Date.now();
    if (recorded > now || now - recorded > CATCH_UP_WINDOW_MS) return;
    // The recorded tick may not be one the window allows; only an allowed run between it and now is a real miss.
    const dueAt = firstAllowedRunBetween(task, trigger, recorded, now);
    if (dueAt === null || dueAt >= now) return;
    this.scheduleCatchUp(flow, key, false);
  }

  private scheduleCatchUp(flow: FlowDefinition, key: string, isOnce: boolean): void {
    const timer = setTimeout(() => {
      sendLog(`⏰ [Flow] Catching up a missed run for "${flow.name}"`);
      this.fireSchedule(flow.id, isOnce);
      const firedAt = new Date().toISOString();
      patchTriggerState(key, isOnce ? { lastRunAt: firedAt, onceFiredAt: firedAt } : { lastRunAt: firedAt });
    }, CATCH_UP_DELAY_MS);
    timer.unref?.();
    this.appendEntry(this.catchUpTimers, flow.id, timer);
  }

  private fireSchedule(flowId: string, oneTime: boolean): void {
    if (oneTime) this.onTrigger(flowId, undefined, { oneTimeSchedule: true });
    else this.onTrigger(flowId);
  }

  /** Records the next run the guard allows; a schedule that can never run forgets any older one. */
  private recordNextRun(key: string, task: ScheduledTask, trigger: TriggerConfig): void {
    try {
      const [next] = nextAllowedRuns(task, trigger, 1);
      patchTriggerState(key, { nextRunAt: next?.toISOString() });
    } catch {
    }
  }

  private appendEntry<T>(map: Map<string, T[]>, flowId: string, entry: T): void {
    const list = map.get(flowId);
    if (list) list.push(entry);
    else map.set(flowId, [entry]);
  }

  unregister(flow: FlowDefinition): void {
    const hotkeys = this.flowHotkeys.get(flow.id);
    if (hotkeys) {
      for (const hotkey of hotkeys) {
        try { globalShortcut.unregister(toAccelerator(hotkey, process.platform === 'darwin')); } catch {}
      }
      this.flowHotkeys.delete(flow.id);
    }

    const cronJobs = this.cronJobs.get(flow.id);
    if (cronJobs) {
      for (const job of cronJobs) {
        job.stop();
        job.destroy();
      }
      this.cronJobs.delete(flow.id);
    }

    const timers = this.catchUpTimers.get(flow.id);
    if (timers) {
      for (const timer of timers) clearTimeout(timer);
      this.catchUpTimers.delete(flow.id);
    }

    this.system.remove(flow.id);
  }

  unregisterAll(flows: FlowDefinition[]): void {
    for (const flow of flows) {
      this.unregister(flow);
    }
  }
}
