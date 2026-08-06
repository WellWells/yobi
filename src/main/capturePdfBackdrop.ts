import type { BrowserWindow } from 'electron';
import { sendLog } from './helpers';

/*
 * PDF exports go through Chromium's printToPDF, which keeps text as vectors but
 * cannot express two of the card's visual effects cheaply:
 *
 *   - the `mesh` backdrop (five stacked translucent radial-gradients) becomes
 *     either ten PDF shadings that every reader re-evaluates per repaint, or ten
 *     image XObjects — Skia picks unpredictably, and both are slow;
 *   - the card's blurred `box-shadow` cannot be vectorised at all, so Skia bakes
 *     the whole card footprint into one full-page greyscale soft mask.
 *
 * Both are flattened here into a single small backdrop image, captured from the
 * live page so it matches Chromium's own rendering exactly. Text, tables and
 * code stay vector — only the decorative layer behind them is rasterised.
 */

/* Exported for the test suite. */
export const BACKDROP_RASTER_WIDTH = 480;
export const BACKDROP_MAX_RASTER_HEIGHT = 4_000;
const BACKDROP_JPEG_QUALITY = 92;

/*
 * Flattening is an optimisation, so it must never spend the caller's whole
 * capture budget: a pathologically long page falls back to the CSS backdrop
 * instead of pushing the export past CAPTURE_TIMEOUT_MS.
 */
const BACKDROP_TIMEOUT_MS = 8_000;

/*
 * Makes the card paint nothing but its drop shadow, so one screenshot captures
 * the backdrop and the shadow together. An outer box-shadow is clipped to the
 * area outside its border box, so nothing that the card itself covers is lost.
 */
const GHOST_CARD_CSS = `
.capture-card { background: transparent !important; border-color: transparent !important; }
.capture-card > * { visibility: hidden !important; }
`;

/*
 * The backdrop is a smooth gradient, so it survives being captured well below
 * page resolution and stretched back. Height is capped as well, otherwise a very
 * long document would embed a needlessly tall image.
 */
export function resolveBackdropScale(logicalWidth: number, logicalHeight: number): number {
  if (!(logicalWidth > 0) || !(logicalHeight > 0)) return 1;
  const byWidth = BACKDROP_RASTER_WIDTH / logicalWidth;
  const byHeight = BACKDROP_MAX_RASTER_HEIGHT / logicalHeight;
  return Math.min(1, byWidth, byHeight);
}

/*
 * Replaces both gradient layers with the captured image and drops the shadow the
 * image now contains. `.capture-card-root` and `.capture-scene` are both given
 * the backdrop by CaptureCard, so the gradient is otherwise painted twice.
 */
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

/*
 * Best-effort: a failure here only costs the size/speed win, so the export still
 * produces a correct PDF with the original CSS backdrop.
 */
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
    /*
     * On timeout the screenshot command may still be in flight, so its own cleanup
     * has not run yet. Clearing again is idempotent and keeps a stale metrics
     * override from reaching printToPDF and distorting the page.
     */
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
