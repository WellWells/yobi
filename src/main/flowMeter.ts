import type { MetricOutcome, SkillType } from '../shared/types';
import type { FlowStepOutcome } from '../shared/flowMetrics';

/**
 * The seam between the executor and the counters, in the shape `tokenMeter` and `llmMeter`
 * already use. The executor stays free of any store, so a test can watch the exact event
 * stream a flow produces without touching disk.
 */
export interface FlowStepEvent {
  flowId: string;
  stepId: string;
  type: SkillType;
  outcome: FlowStepOutcome;
  durationMs: number;
  /** Present for `soft` and `hard`; raw, so the sink decides how to mask and truncate it. */
  error?: string;
}

export interface FlowRunEvent {
  flowId: string;
  outcome: MetricOutcome;
  /** The run finished, but at least one step failed inside it. */
  degraded: boolean;
}

export interface FlowMeterSinks {
  onStep: (event: FlowStepEvent) => void;
  onRun: (event: FlowRunEvent) => void;
}

let sinks: FlowMeterSinks | null = null;

export function setFlowMeterSinks(next: FlowMeterSinks | null): void {
  sinks = next;
}

/**
 * Counting must never be able to fail a flow: a bad regex or a full disk in the sink would
 * otherwise surface as the step itself failing, which is precisely the signal this exists to
 * measure.
 */
export function recordFlowStep(event: FlowStepEvent): void {
  try {
    sinks?.onStep(event);
  } catch (err: unknown) {
    console.warn(`[flow-metrics] step record failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function recordFlowRun(event: FlowRunEvent): void {
  try {
    sinks?.onRun(event);
  } catch (err: unknown) {
    console.warn(`[flow-metrics] run record failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
