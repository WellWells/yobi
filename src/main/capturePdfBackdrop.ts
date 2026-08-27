import type { BrowserWindow } from 'electron';
import { sendLog } from './helpers';

export const BACKDROP_RASTER_WIDTH = 480;
export const BACKDROP_MAX_RASTER_HEIGHT = 4_000;
const BACKDROP_JPEG_QUALITY = 92;

const BACKDROP_TIMEOUT_MS = 8_000;

const GHOST_CARD_CSS = `
.capture-card { background: transparent !important; border-color: transparent !important; }
.capture-card > * { visibility: hidden !important; }
`;

export function resolveBackdropScale(logicalWidth: number, logicalHeight: number): number {
  if (!(logicalWidth > 0) || !(logicalHeight > 0)) return 1;
  const byWidth = BACKDROP_RASTER_WIDTH / logicalWidth;
  const byHeight = BACKDROP_MAX_RASTER_HEIGHT / logicalHeight;
  return Math.min(1, byWidth, byHeight);
}

export function buildBackdropScript(dataUrl: string): string {
  const url = JSON.stringify(dataUrl);
  return `(() => {
  const root = document.querySelector('.capture-card-root');
  if (root) root.style.background = 'none';
  const scene = document.querySelector('.capture-scene');
  if (scene) {
    scene.style.background = 'none';
    scene.style.backgroundImage = 'url(' + ${url} + ')';
    scene.style.backgroundSize = '100% 100%';
    scene.style.backgroundRepeat = 'no-repeat';
  }
  for (const card of document.querySelectorAll('.capture-card')) card.style.boxShadow = 'none';
  return true;
})()`;
}

async function nextPaint(win: BrowserWindow, settleMs: number): Promise<void> {
  await win.webContents.executeJavaScript(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, ${settleMs}))))`,
    true,
  );
}

async function captureBackdropImage(
  win: BrowserWindow,
  logicalWidth: number,
  logicalHeight: number,
  scale: number,
): Promise<string> {
  const debuggerSession = win.webContents.debugger;
  const alreadyAttached = debuggerSession.isAttached();
  if (!alreadyAttached) debuggerSession.attach('1.3');

  try {
    await debuggerSession.sendCommand('Page.enable');
    await debuggerSession.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: logicalWidth,
      height: logicalHeight,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await nextPaint(win, 80);

    const result = (await debuggerSession.sendCommand('Page.captureScreenshot', {
      format: 'jpeg',
      quality: BACKDROP_JPEG_QUALITY,
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: logicalWidth, height: logicalHeight, scale },
    })) as { data?: string };

    if (!result.data) throw new Error('backdrop screenshot data is empty');
    return `data:image/jpeg;base64,${result.data}`;
  } finally {
    await debuggerSession.sendCommand('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
    if (!alreadyAttached && debuggerSession.isAttached()) debuggerSession.detach();
  }
}

export async function flattenPdfBackdrop(
  win: BrowserWindow,
  logicalWidth: number,
  logicalHeight: number,
): Promise<boolean> {
  const scale = resolveBackdropScale(logicalWidth, logicalHeight);
  let ghostCssKey: string | null = null;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`backdrop capture timed out after ${BACKDROP_TIMEOUT_MS / 1_000}s`)),
      BACKDROP_TIMEOUT_MS,
    );
  });

  try {
    ghostCssKey = await win.webContents.insertCSS(GHOST_CARD_CSS);
    await nextPaint(win, 60);
    const dataUrl = await Promise.race([
      captureBackdropImage(win, logicalWidth, logicalHeight, scale),
      deadline,
    ]);
    await win.webContents.removeInsertedCSS(ghostCssKey);
    ghostCssKey = null;
    await win.webContents.executeJavaScript(buildBackdropScript(dataUrl), true);
    await nextPaint(win, 60);
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    sendLog(`⚠️ [capture] PDF backdrop flattening skipped: ${reason}`);
    if (ghostCssKey) await win.webContents.removeInsertedCSS(ghostCssKey).catch(() => undefined);
    if (win.webContents.debugger.isAttached()) {
      await win.webContents.debugger
        .sendCommand('Emulation.clearDeviceMetricsOverride')
        .catch(() => undefined);
    }
    return false;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
