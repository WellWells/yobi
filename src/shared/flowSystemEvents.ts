import type { SystemEvent } from './types';

/**
 * Screen lock and unlock come from the OS session (WTS on Windows, the distributed notification
 * on macOS); Electron reports neither on Linux. Startup and wake work everywhere.
 */
const LOCK_PLATFORMS: readonly string[] = ['win32', 'darwin'];

export function systemEventSupported(event: SystemEvent, platform: string): boolean {
  return event === 'lock' || event === 'unlock' ? LOCK_PLATFORMS.includes(platform) : true;
}

/** A system trigger saved without an event (a hand-edited file) means the commonest one. */
export function resolveSystemEvent(event: SystemEvent | undefined): SystemEvent {
  return event ?? 'startup';
}
