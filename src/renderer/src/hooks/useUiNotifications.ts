import { useEffect } from 'react';
import { notifications } from '@mantine/notifications';
import { ipcEvents } from '../api/electronApi';
import type { UiNotificationPayload } from '../../../shared/types';

/**
 * Renders, in the window, the notices the OS could not show.
 *
 * Main tries the native OS notification first and sends on this channel only when
 * Electron reports it did not go out: the platform has no notifications, the OS answered
 * `failed` (macOS before the app is allowed in System Settings), or it never answered
 * `show` inside the grace period. So a notice appears once, never as a banner and a toast
 * together, and a failure is still never silent. This channel had no subscriber at all
 * until a quick export failed on a Mac and said so to nobody.
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
