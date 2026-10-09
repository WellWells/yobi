import { powerMonitor } from 'electron';
import type { SystemEvent } from '../../shared/types';
import { systemEventSupported } from '../../shared/flowSystemEvents';
import { sendLog } from '../helpers';

/**
 * Waited after the event before the flow starts. At sign-in and on wake the network is often not
 * back yet, and a flow that fetches anything would fail its first step; a lock or unlock leaves
 * the network alone, so it barely waits.
 *
 * Repeats are not throttled here: the manager skips a fire while the same flow is still queued or
 * running.
 */
export const SYSTEM_EVENT_DELAY_MS: Readonly<Record<SystemEvent, number>> = {
  startup: 10_000,
  resume: 10_000,
  unlock: 2_000,
  lock: 2_000,
};

/**
 * The flows waiting on each system event. powerMonitor is subscribed lazily, on the first system
 * trigger registered, and never unsubscribed: the handlers only look the event up here.
 */
export class SystemTriggers {
  private listeners = new Map<string, Set<SystemEvent>>();
  private timers = new Set<NodeJS.Timeout>();
  private subscribed = false;

  constructor(
    private readonly fire: (flowId: string, event: SystemEvent) => void,
    private readonly platform: string = process.platform,
  ) {}

  add(flowId: string, flowName: string, event: SystemEvent): void {
    if (!systemEventSupported(event, this.platform)) {
      sendLog(`⚠️ [Flow] "${flowName}" waits for "${event}", which this system does not report — never runs here`);
      return;
    }
    this.subscribe();
    const events = this.listeners.get(flowId) ?? new Set<SystemEvent>();
    events.add(event);
    this.listeners.set(flowId, events);
  }

  remove(flowId: string): void {
    this.listeners.delete(flowId);
  }

  clear(): void {
    this.listeners.clear();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  emit(event: SystemEvent): void {
    for (const [flowId, events] of this.listeners) {
      if (!events.has(event)) continue;
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        // Switched off or deleted during the wait: the event no longer belongs to it.
        if (this.listeners.get(flowId)?.has(event)) this.fire(flowId, event);
      }, SYSTEM_EVENT_DELAY_MS[event]);
      timer.unref?.();
      this.timers.add(timer);
    }
  }

  private subscribe(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    powerMonitor.on('resume', () => this.onPowerEvent('resume'));
    powerMonitor.on('unlock-screen', () => this.onPowerEvent('unlock'));
    powerMonitor.on('lock-screen', () => this.onPowerEvent('lock'));
  }

  private onPowerEvent(event: SystemEvent): void {
    sendLog(`🖥️ [Flow] System event: ${event}`);
    this.emit(event);
  }
}
