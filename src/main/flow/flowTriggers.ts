import { globalShortcut } from 'electron';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { FlowDefinition, TriggerConfig } from '../../shared/types';
import { sendLog } from '../helpers';
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
    for (const [existingFlowId, existingKeys] of this.flowHotkeys) {
      if (existingFlowId !== flow.id && existingKeys.includes(keys)) {
        sendLog(`⚠️ [AgentFlow] Hotkey "${keys}" already used by another flow — skipping for "${flow.name}"`);
        return;
      }
    }
    try {
      const ok = globalShortcut.register(keys, () => {
        this.onTrigger(flow.id);
      });
      if (ok) {
        this.appendEntry(this.flowHotkeys, flow.id, keys);
        sendLog(`⌨️ [AgentFlow] Hotkey "${keys}" registered for "${flow.name}"`);
      } else {
        sendLog(`❌ [AgentFlow] Failed to register hotkey "${keys}" for "${flow.name}"`);
      }
    } catch (err) {
      sendLog(`❌ [AgentFlow] Hotkey error for "${flow.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private registerCron(flow: FlowDefinition, trigger: TriggerConfig): void {
    if (!trigger.cronExpression || !cron.validate(trigger.cronExpression)) {
      sendLog(`❌ [AgentFlow] Invalid cron expression "${trigger.cronExpression ?? ''}" for "${flow.name}"`);
      return;
    }
    const task = cron.schedule(trigger.cronExpression, () => {
      if (!shouldExecuteCronTriggerNow(trigger)) return;
      this.onTrigger(flow.id);
    });
    this.appendEntry(this.cronJobs, flow.id, task);
    sendLog(`⏰ [AgentFlow] Cron "${trigger.cronExpression}" scheduled for "${flow.name}"`);
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
        try { globalShortcut.unregister(hotkey); } catch {}
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
