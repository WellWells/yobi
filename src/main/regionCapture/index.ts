import { app, ipcMain, screen, shell } from 'electron';
import type { NativeImage } from 'electron';
import { ATTACHMENT_STASH_MAX_BYTES, IPC } from '../../shared/types';
import type { StashedAttachment } from '../../shared/types';
import { sendLog, sendToRenderer, sendWebNotification, setMainWindow } from '../helpers';
import { getLangCache, t } from '../i18n';
import { createMainWindow, getMainWin } from '../windows';
import { stashAttachmentBytes, thumbnail } from '../attachmentStash';
import { SCREEN_RECORDING_SETTINGS_URL, captureAllDisplays, raiseScreenAccessPrompt, screenAccess } from './capture';
import type { DisplayShot, ScreenAccess } from './capture';
import { cropRectInImage } from './geometry';
import { runOverlaySession } from './overlay';

/** JPEG for the overlay's backdrop only: a 4K PNG takes long enough to encode to be felt. */
const BACKDROP_JPEG_QUALITY = 90;
const FALLBACK_JPEG_QUALITY = 92;

let busy = false;
let settingsPaneOpened = false;
/** The last region, held until the chat window's renderer collects it (it may be loading). */
let pending: StashedAttachment | null = null;

export function takePendingRegionCapture(): StashedAttachment | null {
  const taken = pending;
  pending = null;
  return taken;
}

export function registerRegionCaptureHandlers(): void {
  ipcMain.handle(IPC.REGION_CAPTURE_TAKE, () => takePendingRegionCapture());
}

function notify(titleKey: string, bodyKey: string): void {
  const strings = getLangCache();
  sendWebNotification(t(strings, titleKey), t(strings, bodyKey), 'warning');
}

async function reportNoScreenAccess(access: Exclude<ScreenAccess, 'ok'>): Promise<void> {
  sendLog(`❌ Screen region capture needs the macOS Screen Recording permission (${access === 'ask' ? 'not asked yet' : 'denied'})`);
  notify('regionCapture.notify.permission.title', 'regionCapture.notify.permission.body');
  if (access === 'ask') {
    // macOS shows its own prompt, with a button to System Settings, the first time it is asked.
    await raiseScreenAccessPrompt();
    return;
  }
  // It never asks again once denied: open the pane for the user, once per run of the app.
  if (settingsPaneOpened) return;
  settingsPaneOpened = true;
  await shell.openExternal(SCREEN_RECORDING_SETTINGS_URL).catch(() => {});
}

function backdropUrl(image: NativeImage): string {
  return `data:image/jpeg;base64,${image.toJPEG(BACKDROP_JPEG_QUALITY).toString('base64')}`;
}

/** PNG keeps text sharp; a region too large for the attachment stash goes as JPEG instead. */
export function encodeRegion(image: NativeImage): { name: string; mimeType: string; data: Buffer } {
  const png = image.toPNG();
  if (png.byteLength <= ATTACHMENT_STASH_MAX_BYTES) return { name: 'screen-region.png', mimeType: 'image/png', data: png };
  return { name: 'screen-region.jpg', mimeType: 'image/jpeg', data: image.toJPEG(FALLBACK_JPEG_QUALITY) };
}

/**
 * Brings the chat window forward. A window closed on macOS (the app keeps running) is created
 * again; its renderer asks for the pending region once it has mounted.
 */
function revealMainWindow(): void {
  let win = getMainWin();
  if (!win || win.isDestroyed()) {
    createMainWindow();
    win = getMainWin();
    setMainWindow(win);
  }
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
}

function deliver(stashed: StashedAttachment): void {
  pending = stashed;
  revealMainWindow();
  sendToRenderer(IPC.REGION_CAPTURE_READY);
}

async function captureShots(): Promise<DisplayShot[] | null> {
  try {
    const shots = await captureAllDisplays();
    if (shots.length > 0) return shots;
    sendLog('❌ Screen region capture: the system returned no screen picture');
  } catch (err) {
    sendLog(`❌ Screen region capture failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  notify('regionCapture.notify.failed.title', 'regionCapture.notify.failed.body');
  return null;
}

/**
 * The region hotkey: freeze every display, let the user box a region, and put the picture in the
 * chat composer with the cursor in the input. A second press while the overlay is up is ignored.
 */
export async function runRegionCapture(): Promise<void> {
  if (busy) {
    sendLog('⏳ Screen region capture is already open — ignoring this press');
    return;
  }
  busy = true;
  try {
    const access = screenAccess();
    if (access !== 'ok') {
      await reportNoScreenAccess(access);
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    const shots = await captureShots();
    if (!shots) return;

    let selection;
    try {
      selection = await runOverlaySession(
        shots.map((shot) => ({ display: shot.display, imageUrl: backdropUrl(shot.image) })),
        { hint: t(getLangCache(), 'regionCapture.overlay.hint'), cursor, beforeClose: revealMainWindow },
      );
    } catch (err) {
      sendLog(`❌ Screen region capture failed: ${err instanceof Error ? err.message : String(err)}`);
      notify('regionCapture.notify.failed.title', 'regionCapture.notify.failed.body');
      return;
    }
    if (!selection) {
      sendLog('✂️ Screen region capture cancelled');
      return;
    }

    const shot = shots.find((candidate) => candidate.display.id === selection.displayId);
    const crop = shot ? cropRectInImage(selection.rect, selection.viewport, shot.image.getSize()) : null;
    if (!shot || !crop) {
      sendLog('⚠️ Screen region capture: the box was empty after fitting it to the screen');
      return;
    }
    const encoded = encodeRegion(shot.image.crop(crop));
    const stashed = await stashAttachmentBytes(encoded);
    deliver({ ...stashed, preview: thumbnail(stashed.path, stashed.mimeType) });
    sendLog(`✂️ Screen region ${crop.width}×${crop.height} attached to the composer`);
  } catch (err) {
    sendLog(`❌ Screen region capture failed: ${err instanceof Error ? err.message : String(err)}`);
    notify('regionCapture.notify.failed.title', 'regionCapture.notify.failed.body');
  } finally {
    busy = false;
  }
}
