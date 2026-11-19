import type { FlowMetricsSnapshot, FlowRunMetrics } from '../shared/flowMetrics';
import { localizeUserFacingError } from './i18n';

type Strings = Record<string, string>;

/*
 * A sample nobody has a translation for is shown as stored (already masked and cut). Blanked,
 * it would leave only the one-word reason ("Sign-in"), and an RSS `HTTP 403` could not be told
 * from a LINE `V3_TOKEN_CLIENT_LOGGED_OUT` without the log, which by then may no longer hold
 * that run: every failure has to say what it was so it can be found and fixed.
 */
function shownMessage(raw: string, strings: Strings): string {
  return localizeUserFacingError(raw, strings);
}

function localizeFlows(flows: Record<string, FlowRunMetrics>, strings: Strings): Record<string, FlowRunMetrics> {
  const result: Record<string, FlowRunMetrics> = {};
  for (const [flowId, flow] of Object.entries(flows)) {
    const steps: FlowRunMetrics['steps'] = {};
    for (const [stepId, step] of Object.entries(flow.steps)) {
      steps[stepId] = step.samples.length === 0
        ? step
        : {
          ...step,
          samples: step.samples.map((sample) => ({
            ...sample,
            message: shownMessage(sample.message, strings),
          })),
        };
    }
    result[flowId] = { ...flow, steps };
  }
  return result;
}

/**
 * The copy the statistics page gets. The store keeps each sample in the step's own English — the
 * reason buckets were classified from it and it is what the log says — so the wording a person
 * reads is decided here, on the way out, the way every other user-facing error is. Doing it on the
 * way out rather than when recording means a language switch also covers samples already stored.
 */
export function localizeFlowSnapshot(data: FlowMetricsSnapshot, strings: Strings): FlowMetricsSnapshot {
  const daily: FlowMetricsSnapshot['daily'] = {};
  for (const [date, flows] of Object.entries(data.daily)) daily[date] = localizeFlows(flows, strings);
  return { ...data, flows: localizeFlows(data.flows, strings), daily };
}
