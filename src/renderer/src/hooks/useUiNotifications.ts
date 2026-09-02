import { useEffect } from 'react';
import { notifications } from '@mantine/notifications';
import { ipcEvents } from '../api/electronApi';
import type { UiNotificationPayload } from '../../../shared/types';

/**
 * Renders the notices main already emits, in the window.
 *
 * Main sends every notice on two channels: a native OS notification and this one. The
 * native one is right while the window is hidden — which is most of the time for a global
 * hotkey — but it is also the one an OS can refuse without telling anybody: macOS shows
 * nothing at all until the app is allowed in System Settings, and suppresses banners for
 * the frontmost app even when it is. Electron cannot ask whether it is allowed, so the two
 * channels are run in parallel rather than as a fallback, and a failure is never silent
 * wherever the user happens to be looking. This channel had no subscriber at all until
 * a quick export failed on a Mac and said so to nobody.
 */
const LEVEL_COLORS: Record<NonNullable<UiNotificationPayload['level']>, string> = {
  success: 'var(--success)',
  info: 'var(--accent)',
  warning: 'var(--warning)',
  error: 'var(--error)',
};

// Long enough to read a sentence; a failure earns twice that, since it usually names
// something to go and do.
const DISMISS_MS = 5_000;
const DISMISS_MS_ERROR = 10_000;

export function useUiNotifications(): void {
  useEffect(() => ipcEvents.onUiNotification((payload: UiNotificationPayload) => {
    const level = payload.level ?? 'success';
    notifications.show({
      title: payload.title,
      message: payload.body,
      autoClose: level === 'error' ? DISMISS_MS_ERROR : DISMISS_MS,
      withBorder: true,
      // Only 'brand' is a real palette colour in this theme, so the accent is set through
      // the component's own CSS variable rather than a colour name Mantine cannot resolve.
      style: { '--notification-color': LEVEL_COLORS[level] } as React.CSSProperties,
    });
  }), []);
}
