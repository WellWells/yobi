import type { FlowMetricsSnapshot, FlowRunMetrics } from '../shared/flowMetrics';
import { localizeUserFacingError } from './i18n';

type Strings = Record<string, string>;

/*
 * A sample nobody has a translation for is blanked rather than shown raw: the row already names the
 * reason in the user's language ("Network"), and an English `fetch failed: ETIMEDOUT` beside it says
 * nothing more to the person reading it. The raw text stays in the store and in the log.
 */
function shownMessage(raw: string, strings: Strings): string {
  const localized = localizeUserFacingError(raw, strings);
  return localized === raw ? '' : localized;
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
