import React, { useEffect } from 'react';
import { VisuallyHidden } from '@mantine/core';
import { ipcEvents } from '../api/electronApi';
import { announce, useAnnouncerStore } from '../store/announcerStore';
import { useI18nStore } from '../store/i18nStore';
import { fillTemplate } from '../../../shared/fillTemplate';
import type { ChatTurnEvent, FlowExecutionEvent } from '../../../shared/types';

type Translate = (key: string) => string;

const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** A finished reply is announced, not read: the answer is on the page to read at the user's pace. */
export function chatTurnAnnouncement(event: ChatTurnEvent, t: Translate): string | null {
  if (event.phase !== 'done' || event.stopped) return null;
  return t('a11y.d.announce.replyDone');
}

/**
 * Yobi's own link flows (a pasted post or video, ids `builtin-…`): the chat turn they write is what
 * gets announced. Checked by prefix — the link-site registry is too heavy for the first paint.
 */
const BUILTIN_FLOW_PREFIX = 'builtin-';

/** A flow run's outcome, for the user's own flows. */
export function flowEndAnnouncement(event: FlowExecutionEvent, t: Translate): string | null {
  if (!event.outcome || event.flowId.startsWith(BUILTIN_FLOW_PREFIX)) return null;
  const template = event.outcome === 'succeeded'
    ? t('a11y.d.announce.flowSucceeded')
    : event.outcome === 'stopped' ? t('a11y.d.announce.flowStopped') : t('a11y.d.announce.flowFailed');
  return fillTemplate(template, { name: event.name });
}

/**
 * The window's one polite live region (WCAG 4.1.3), mounted once at the root: whatever `announce()`
 * is given, plus a finished chat reply and a finished flow run. Always in the DOM, so a screen
 * reader is already watching it when the words change.
 */
export function LiveAnnouncer(): React.ReactElement {
  const message = useAnnouncerStore((s) => s.message);
  const seq = useAnnouncerStore((s) => s.seq);
  const t = useI18nStore((s) => s.t);
  const isReady = useI18nStore((s) => s.isReady);

  useEffect(() => {
    if (!isReady) return;
    const say = (text: string | null): void => { if (text) announce(text); };
    const unsubs = [
      ipcEvents.onChatTurn((event) => say(chatTurnAnnouncement(event, t))),
      ipcEvents.onFlowExecutionEnded((event) => say(flowEndAnnouncement(event, t))),
    ];
    return () => unsubs.forEach((off) => off());
  }, [isReady, t]);

  return (
    <VisuallyHidden role="status" aria-live="polite" aria-atomic="true" data-live-announcer="">
      {/* The trailing no-break space alternates so a repeat of the same words is still a change. */}
      {message}{seq % 2 === 1 ? NO_BREAK_SPACE : ''}
    </VisuallyHidden>
  );
}
