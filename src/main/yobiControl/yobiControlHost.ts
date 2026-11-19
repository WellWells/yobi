/**
 * What the Yobi connector reaches that only exists once the app has started: the flow manager and
 * the queue. Set by `index.ts` after both exist (setter injection: no import of mutable app state).
 */
import type { FlowDefinition } from '../../shared/types';

export interface YobiControlHost {
  listFlows: () => FlowDefinition[];
  /** Turns flows on or off, tells the window, and returns the ids that changed. */
  setFlowsEnabled: (ids: readonly string[], enabled: boolean) => Promise<string[]>;
  /** Running and waiting tasks across the prompt queue and the flow queue. */
  queueSize: () => number;
}

let host: YobiControlHost | null = null;

export function setYobiControlHost(next: YobiControlHost): void {
  host = next;
}

export function getYobiControlHost(): YobiControlHost | null {
  return host;
}
