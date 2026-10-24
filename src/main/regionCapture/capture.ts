import { desktopCapturer, screen, systemPreferences } from 'electron';
import type { Display, NativeImage } from 'electron';
import { captureRequestSize, downscaleTarget, matchSourcesToDisplays } from './geometry';

/**
 * `ok` = capture; `ask` = macOS has never been asked, so the first capture only raises its
 * prompt; `denied` = the user (or a profile) said no. Without the permission macOS does not
 * fail the capture: it hands back the wallpaper with every window missing, which would look
 * like a working overlay over the wrong picture. Hence the check comes first.
 */
export type ScreenAccess = 'ok' | 'ask' | 'denied';

export function screenAccessVerdict(platform: NodeJS.Platform, status: string): ScreenAccess {
  if (platform !== 'darwin') return 'ok';
  if (status === 'granted') return 'ok';
  if (status === 'not-determined') return 'ask';
  if (status === 'denied' || status === 'restricted') return 'denied';
  // 'unknown': try; a capture that comes back empty is reported on its own.
  return 'ok';
}

export function screenAccess(): ScreenAccess {
  if (process.platform !== 'darwin') return 'ok';
  return screenAccessVerdict(process.platform, systemPreferences.getMediaAccessStatus('screen'));
}

/** Privacy & Security › Screen Recording (named Screen & System Audio Recording on macOS 15+). */
export const SCREEN_RECORDING_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

/**
 * Asks once with a 1×1 thumbnail, which is what makes macOS show its prompt and list Yobi under
 * Screen Recording. The picture itself is thrown away.
 */
export async function raiseScreenAccessPrompt(): Promise<void> {
  try {
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
  } catch {
  }
}

export interface DisplayShot {
  display: Display;
  /** The display at its own physical resolution. */
  image: NativeImage;
}

/**
 * Every display, frozen at native resolution, in one desktopCapturer call (each call grabs every
 * screen, so one per display would cost N times as much). A display whose picture comes back
 * empty is left out; none at all is the caller's to report.
 */
export async function captureAllDisplays(): Promise<DisplayShot[]> {
  const displays = screen.getAllDisplays();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: captureRequestSize(displays),
  });
  const shots: DisplayShot[] = [];
  for (const { display, source } of matchSourcesToDisplays(sources, displays)) {
    let image = source.thumbnail;
    if (image.isEmpty()) continue;
    const target = downscaleTarget(image.getSize(), display);
    if (target) image = image.resize({ ...target, quality: 'best' });
    shots.push({ display, image });
  }
  return shots;
}
