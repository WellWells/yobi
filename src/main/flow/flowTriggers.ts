import { globalShortcut } from 'electron';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { FlowDefinition, TriggerConfig } from '../../shared/types';
import { HOTKEY_SELECTION_VAR } from '../../shared/flowReferenceCheck';
import { captureSelectedText } from '../clipboard';
import { extractTemplateVariables } from './interpolation';
import { sendLog } from '../helpers';
import { isHotkeyPaused, ownsAccelerator } from '../hotkey';
import { isRegisterableAccelerator, toAccelerator } from '../../shared/shortcuts';
import {
  isOnceExpired,
  normalizeCronTrigger,
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

/**
 * Whether anything in the flow reads `{{selection}}`.
 *
 * Serialized rather than walked field by field: a reference can sit in a step config, in a
 * variable's value, or in a nested field a later skill adds, and a walk that missed one place
 * would silently hand the flow an empty selection with nothing to explain why.
 *
 * Parsed with the interpolator's own extractor rather than a regex written here, so "reference"
 * means the same thing to this check as it does at interpolation time — a hand-rolled pattern
 * disagreed about `{{ selection }}` with spaces and quietly skipped the capture.
 */
function referencesSelection(flow: FlowDefinition): boolean {
  return extractTemplateVariables(JSON.stringify(flow))
    .some((name) => name.split('.')[0].trim() === HOTKEY_SELECTION_VAR);
}

/** A miss older than this is stale news — catching it up would surprise more than it helps. */
const CATCH_UP_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

/** Long enough for the window and executor to be ready before a caught-up run starts. */
const CATCH_UP_DELAY_MS = 5_000;

export class FlowTriggerRegistry {
  private cronJobs = new Map<string, ScheduledTask[]>();
  private catchUpTimers = new Map<string, NodeJS.Timeout[]>();
  private flowHotkeys = new Map<string, string[]>();
  private onTrigger: (flowId: string, extraContext?: Record<string, string>) => void;

  constructor(onTrigger: (flowId: string, extraContext?: Record<string, string>) => void) {
    this.onTrigger = onTrigger;
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
    // Decided once at registration rather than on every press: capturing the selection costs
    // a clipboard round trip (clear, synthesize the copy, poll, restore) that a flow which
    // never reads {{selection}} should not pay for, and which would churn the user's
    // clipboard on every press of a hotkey that only wanted {{clipboard}}.
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
        this.onTrigger(flow.id);
        const firedAt = new Date().toISOString();
        patchTriggerState(key, mode === 'once' ? { lastRunAt: firedAt, onceFiredAt: firedAt } : { lastRunAt: firedAt });
      }
      if (task) this.recordNextRun(key, task);
    };

    task = cron.schedule(
      trigger.cronExpression,
      run,
      mode === 'once' ? { maxExecutions: 1 } : {},
    );
    this.appendEntry(this.cronJobs, flow.id, task);
    this.recordNextRun(key, task);

    if (allowCatchUp && mode !== 'once') this.catchUpIfMissed(flow, trigger, key, saved);
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
    if (saved?.onceFiredAt) {
      sendLog(`⏰ [Flow] One-time schedule for "${flow.name}" already ran — not re-arming`);
      return false;
    }
    if (!isOnceExpired(trigger)) return true;

    const dueAt = saved?.nextRunAt ? Date.parse(saved.nextRunAt) : Number.NaN;
    const missedRecently = Number.isFinite(dueAt) && Date.now() - dueAt <= CATCH_UP_WINDOW_MS;
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
  ): void {
    if (!trigger.catchUpMissed || !saved?.nextRunAt) return;
    const dueAt = Date.parse(saved.nextRunAt);
    if (!Number.isFinite(dueAt)) return;
    const elapsed = Date.now() - dueAt;
    if (elapsed <= 0 || elapsed > CATCH_UP_WINDOW_MS) return;
    this.scheduleCatchUp(flow, key, false);
  }

  private scheduleCatchUp(flow: FlowDefinition, key: string, isOnce: boolean): void {
    const timer = setTimeout(() => {
      sendLog(`⏰ [Flow] Catching up a missed run for "${flow.name}"`);
      this.onTrigger(flow.id);
      const firedAt = new Date().toISOString();
      patchTriggerState(key, isOnce ? { lastRunAt: firedAt, onceFiredAt: firedAt } : { lastRunAt: firedAt });
    }, CATCH_UP_DELAY_MS);
    timer.unref?.();
    this.appendEntry(this.catchUpTimers, flow.id, timer);
  }

  private recordNextRun(key: string, task: ScheduledTask): void {
    try {
      const next = task.getNextRun();
      if (next) patchTriggerState(key, { nextRunAt: next.toISOString() });
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
  }

  unregisterAll(flows: FlowDefinition[]): void {
    for (const flow of flows) {
      this.unregister(flow);
    }
  }
}
