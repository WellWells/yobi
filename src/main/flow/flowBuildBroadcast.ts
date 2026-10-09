import { IPC } from '../../shared/types';
import type { FlowBuildEvent, FlowBuildFailureReason, FlowBuildPayload } from '../../shared/types';
import { sendToRenderer } from '../helpers';
import { localizeUserFacingError, t } from '../i18n';

type Strings = Record<string, string>;

/**
 * Why a build failed, as the panel, the `/agent` build card and the notification word it. A
 * reply the validator kept rejecting is said as such: the raw text is the repair instruction
 * written for the model ("The assessment needs a non-empty "skills" array").
 */
export function buildFailureText(
  failure: { error: string; reason?: FlowBuildFailureReason },
  strings: Strings,
): string {
  if (failure.reason === 'invalid_output') return t(strings, 'flow.build.failed.invalidOutput');
  return localizeUserFacingError(failure.error, strings);
}

/**
 * A failure as the build panel and the `/agent` build card show it: in the user's language.
 * Only the broadcast copy is translated — the outcome `runFlowBuild` returns keeps the raw text
 * for the log, the classifiers and the `BUILD_DECLINED` comparison.
 */
export function localizeBuildEvent(event: FlowBuildEvent, strings: Strings): FlowBuildEvent {
  if (event.kind === 'failed') return { ...event, error: buildFailureText(event, strings) };
  if (event.kind === 'phase' && event.status === 'failed' && event.detail) {
    return { ...event, detail: localizeUserFacingError(event.detail, strings) };
  }
  return event;
}

/** The one way a build event reaches the renderer, for the Flow Builder and `/agent` alike. */
export function sendBuildEvent(buildId: string, event: FlowBuildEvent, strings: Strings): void {
  sendToRenderer(
    IPC.FLOW_BUILD_PROGRESS,
    { buildId, event: localizeBuildEvent(event, strings) } satisfies FlowBuildPayload,
  );
}
