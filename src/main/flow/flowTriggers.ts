import { globalShortcut } from 'electron';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { FlowDefinition, TriggerConfig } from '../../shared/types';
import { sendLog } from '../helpers';
import { isHotkeyPaused, ownsAccelerator } from '../hotkey';
import { isRegisterableAccelerator, toAccelerator } from '../../shared/shortcuts';
import { normalizeCronTrigger, shouldExecuteCronTriggerNow, shouldNormalizeCronTrigger } from '../../shared/flowSchedule';

export class FlowTriggerRegistry {
  private cronJobs = new Map<string, ScheduledTask[]>();
  private flowHotkeys = new Map<string, string[]>();
  private onTrigger: (flowId: string) => void;

  constructor(onTrigger: (flowId: string) => void) {
    this.onTrigger = onTrigger;
  }

  registerAll(flows: FlowDefinition[]): void {
    for (const flow of flows) {
      if (flow.enabled) {
        this.register(flow);
      }
    }
  }

  register(flow: FlowDefinition): void {
    const triggers = [flow.trigger, ...(flow.extraTriggers ?? [])];
    for (const raw of triggers) {
      const trigger = shouldNormalizeCronTrigger(raw) ? normalizeCronTrigger(raw) : raw;
      if (trigger.type === 'hotkey' && trigger.keys) {
        this.registerHotkey(flow, trigger.keys);
      } else if (trigger.type === 'cron' && trigger.cronExpression) {
        this.registerCron(flow, trigger);
      }
    }
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
    try {
      const ok = globalShortcut.register(toAccelerator(keys, process.platform === 'darwin'), () => {
        if (isHotkeyPaused()) return;
        this.onTrigger(flow.id);
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

  private registerCron(flow: FlowDefinition, trigger: TriggerConfig): void {
    if (!trigger.cronExpression || !cron.validate(trigger.cronExpression)) {
      sendLog(`❌ [Flow] Invalid cron expression "${trigger.cronExpression ?? ''}" for "${flow.name}"`);
      return;
    }
    const task = cron.schedule(trigger.cronExpression, () => {
      if (!shouldExecuteCronTriggerNow(trigger)) return;
      this.onTrigger(flow.id);
    });
    this.appendEntry(this.cronJobs, flow.id, task);
    sendLog(`⏰ [Flow] Cron "${trigger.cronExpression}" scheduled for "${flow.name}"`);
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
  }

  unregisterAll(flows: FlowDefinition[]): void {
    for (const flow of flows) {
      this.unregister(flow);
    }
  }
}
