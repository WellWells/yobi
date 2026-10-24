import type { InputEvent } from 'electron';
import { IPC } from '../shared/types';
import type { TrackpadGestureEvent } from '../shared/types';

/**
 * The scroll-gesture phases the renderer hears about. `gestureScrollUpdate` fires every frame
 * and the renderer already gets the same motion as `wheel` events, so it stays in main.
 */
const FORWARDED_PHASES: Partial<Record<InputEvent['type'], TrackpadGestureEvent['phase']>> = {
  gestureScrollBegin: 'begin',
  gestureScrollEnd: 'end',
};

/** The phase to forward for one input event, or null for everything else. */
export function trackpadGesturePhase(type: InputEvent['type']): TrackpadGestureEvent['phase'] | null {
  return FORWARDED_PHASES[type] ?? null;
}

/** The slice of `WebContents` the forwarder touches. */
export interface GestureSource {
  on(event: 'input-event', listener: (event: Electron.Event, input: InputEvent) => void): unknown;
  send(channel: string, ...args: unknown[]): void;
  isDestroyed(): boolean;
}

/**
 * macOS only: tell the renderer when a two-finger trackpad scroll begins and ends, so a row
 * swipe can snap the moment the fingers lift instead of waiting out a quiet period.
 * (BrowserWindow's `scroll-touch-*` events that used to carry this were removed in Electron 23.)
 * Windows and Linux get nothing: their list rows have no swipe (mice there have no horizontal
 * axis), so a listener would only cost an IPC per scroll. Returns whether it attached.
 */
export function forwardTrackpadGestures(contents: GestureSource, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'darwin') return false;
  contents.on('input-event', (_event, input) => {
    const phase = trackpadGesturePhase(input.type);
    if (!phase || contents.isDestroyed()) return;
    const payload: TrackpadGestureEvent = { phase };
    contents.send(IPC.TRACKPAD_GESTURE, payload);
  });
  return true;
}
