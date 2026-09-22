import React, { useEffect } from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { fileApi, ipcEvents, systemApi } from '../api/electronApi';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { useSecretHealthStore } from '../store/secretHealthStore';
import { SECRET_SCOPE_META } from '../../../shared/types';
import type { UiNotificationPayload } from '../../../shared/types';

/**
 * The app's single in-window notice surface.
 *
 * Notices reach the user two ways, and only two: the OS banner the main process raises
 * (`helpers.ts` → `emitNotification`), and this one when the window itself has something to
 * say. The window used to have TWO — this top-right Mantine queue, plus a hand-rolled card
 * pinned bottom-right in ChatView with its own 4.5s timer and no severity at all, so the same
 * class of event ("a thing you asked for finished") appeared in different corners, in different
 * boxes, for different lengths of time, depending on which module raised it. Everything in the
 * window now goes through `showAppNotice`.
 *
 * The OS banner is still the other surface and still lands wherever the platform puts it
 * (bottom-right on Windows). That split is deliberate and documented in `src/main/CLAUDE.md`:
 * a banner is the right channel while the window is hidden. What was not deliberate was the
 * window disagreeing with itself.
 */

export type NoticeLevel = NonNullable<UiNotificationPayload['level']>;

// Only 'brand' is a real palette colour in this theme, so the accent is set through the
// component's own CSS variable rather than a colour name Mantine cannot resolve.
const LEVEL_COLORS: Record<NoticeLevel, string> = {
  success: 'var(--success)',
  info: 'var(--accent)',
  warning: 'var(--warning)',
  error: 'var(--error)',
};

// Long enough to read a sentence; a failure earns twice that, since it usually names
// something to go and do. A notice carrying buttons does not auto-close at all — 4.5s was
// never long enough to notice a button, read it and aim at it.
const DISMISS_MS = 5_000;
const DISMISS_MS_ERROR = 10_000;

export interface AppNotice {
  /** The bold first line. Falls back to the message when omitted. */
  title?: string;
  message?: string;
  level?: NoticeLevel;
  /** A saved file: the notice grows "show in folder" / "open" and stops auto-closing. */
  filePath?: string;
  /** Action the main process attached to an OS notice that fell back to this surface. */
  action?: UiNotificationPayload['action'];
}

/**
 * Ids raised from inside the window, so a caller can retract its own notices without also
 * clearing one the main process just handed over (`notifications.clean()` takes everything).
 */
const windowNoticeIds = new Set<string>();

function runPayloadAction(action: NonNullable<UiNotificationPayload['action']>): void {
  if (action.id === 'open-worker-window') {
    systemApi.showWorker();
    return;
  }
  // The payload names the action, not which secret failed — the store knows that, and it is
  // the reason the notice exists at all.
  const [failure] = useSecretHealthStore.getState().failures;
  useAppStore.getState().openSettingsCategory(failure ? SECRET_SCOPE_META[failure.scope].category : 'accounts');
}

function noticeBody(detail: string | undefined, notice: AppNotice): React.ReactNode {
  const { t } = useI18nStore.getState();
  const { filePath, action } = notice;
  if (!filePath && !action) return detail;

  const text = detail ? <Text fz="var(--font-size-sm)">{detail}</Text> : null;
  return (
    <Stack gap={8}>
      {text}
      <Group gap={8}>
        {filePath ? (
          <>
            <Button variant="default" size="compact-xs" onClick={() => void fileApi.showInFolder(filePath)}>
              {t('capture.toast.openFolder')}
            </Button>
            <Button size="compact-xs" onClick={() => void fileApi.openPath(filePath)}>
              {t('capture.toast.openNow')}
            </Button>
          </>
        ) : null}
        {action ? (
          <Button variant="default" size="compact-xs" onClick={() => runPayloadAction(action)}>
            {action.label}
          </Button>
        ) : null}
      </Group>
    </Stack>
  );
}

/** Raises a notice in the window and returns its id, so the caller can retract it. */
export function showAppNotice(notice: AppNotice): string {
  const level = notice.level ?? 'success';
  const hasActions = Boolean(notice.filePath || notice.action);
  // A single-line notice reads better as the bold heading than as grey body text under an
  // empty one, so a message with no title of its own becomes the heading.
  const heading = notice.title ?? notice.message;
  const detail = notice.title ? notice.message : undefined;
  let id = '';
  id = notifications.show({
    title: heading,
    message: noticeBody(detail, notice),
    autoClose: hasActions ? false : (level === 'error' ? DISMISS_MS_ERROR : DISMISS_MS),
    withBorder: true,
    withCloseButton: true,
    style: { '--notification-color': LEVEL_COLORS[level] } as React.CSSProperties,
    onClose: () => windowNoticeIds.delete(id),
  });
  windowNoticeIds.add(id);
  return id;
}

/** Retracts every notice this window raised. Used when the context they described is gone. */
export function hideAppNotices(): void {
  for (const id of windowNoticeIds) notifications.hide(id);
  windowNoticeIds.clear();
}

/**
 * Renders, in the window, the notices the OS could not show.
 *
 * Main tries the native OS notification first and sends on this channel only when Electron
 * reports it did not go out: the platform has no notifications, the OS answered `failed`
 * (macOS before the app is allowed in System Settings), or it never answered `show` inside the
 * grace period. So a notice appears once, never as a banner and a toast together, and a failure
 * is still never silent. This channel had no subscriber at all until a quick export failed on a
 * Mac and said so to nobody.
 */
export function useUiNotifications(): void {
  useEffect(() => ipcEvents.onUiNotification((payload: UiNotificationPayload) => {
    showAppNotice({
      title: payload.title,
      message: payload.body,
      level: payload.level ?? 'success',
      action: payload.action,
    });
  }), []);
}
