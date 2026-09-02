import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';
import type { MarkdownCaptureRequest, CaptureFormat, CaptureHeightVerdict, CaptureMode, CaptureTurn, CardLayout } from '../shared/types';
import { DEFAULT_CAPTURE_WIDTH, MAX_CAPTURE_WIDTH, MIN_CAPTURE_WIDTH, checkCaptureHeight, clampCaptureMargin, printPageSlack } from '../shared/types';
import { stripConversationMarkers } from '../shared/conversationDoc';
import { captureBackgroundCss, DEFAULT_CAPTURE_PALETTE } from '../shared/capturePalettes';
import { isSafeCaptureBackground } from '../shared/captureBackgroundGuard';
import { brandPdfMetadata } from './pdfMetadata';
import { flattenPdfBackdrop } from './capturePdfBackdrop';
import { sendLog } from './helpers';
import { SILENT_WEB_PREFERENCES, muteWindow, parkWindowOffscreen } from './silentWindow';

const CAPTURE_TIMEOUT_MS = 30_000;

interface CaptureDocumentResult {
  buffer: Buffer;
  ext: 'png' | 'webp' | 'pdf';
  mode: CaptureMode;
}

export function normalizeCaptureRequest(request: MarkdownCaptureRequest): MarkdownCaptureRequest {
  const fallback = {
    title: 'Markdown Snapshot',
    prompt: '',
    content: '',
    summary: '',
    provider: '',
    timestamp: '',
  };
  const payload = { ...fallback, ...(request?.payload ?? {}) };
  const mode: CaptureMode = request?.options?.mode === 'copy' ? 'copy' : 'save';
  const format: CaptureFormat = request?.options?.format === 'pdf'
    ? 'pdf'
    : request?.options?.format === 'webp'
      ? 'webp'
      : 'png';
  const width = Math.max(MIN_CAPTURE_WIDTH, Math.min(MAX_CAPTURE_WIDTH, Math.round(request?.options?.width || DEFAULT_CAPTURE_WIDTH)));
  const background = (request?.options?.background ?? '').trim();
  const safeBackground = isSafeCaptureBackground(background)
    ? background
    : captureBackgroundCss(DEFAULT_CAPTURE_PALETTE);
  const cardTheme = request?.options?.cardTheme === 'light' ? 'light' : 'dark';
  const cardLayout: CardLayout = request?.options?.cardLayout === 'bubble' ? 'bubble' : 'document';
  const rawTurns = Array.isArray(request?.payload?.turns) ? request.payload.turns : [];
  const turns: CaptureTurn[] = rawTurns.map((turn) => ({
    prompt: String(turn?.prompt ?? ''),
    response: String(turn?.response ?? ''),
    provider: String(turn?.provider ?? ''),
    timestamp: String(turn?.timestamp ?? ''),
  }));

  return {
    payload: {
      title: (payload.title ?? fallback.title) as string,
      prompt: stripConversationMarkers((payload.prompt ?? '') as string),
      content: stripConversationMarkers((payload.content ?? '') as string),
      summary: (payload.summary ?? '') as string,
      provider: (payload.provider ?? '') as string,
      timestamp: (payload.timestamp ?? '') as string,
      turns,
    },
    options: {
      mode,
      format,
      fileName: (request?.options?.fileName ?? '').trim(),
      showPrompt: Boolean(request?.options?.showPrompt),
      showContent: Boolean(request?.options?.showContent),
      showProvider: Boolean(request?.options?.showProvider),
      showTimestamp: Boolean(request?.options?.showTimestamp),
      showTokens: Boolean(request?.options?.showTokens),
      width,
      margin: request?.options?.margin === undefined ? undefined : clampCaptureMargin(request.options.margin),
      background: safeBackground,
      cardTheme,
      cardLayout,
      pixelRatio: request?.options?.pixelRatio === 2 ? 2 : 1,
      zip: request?.options?.zip === true,
    },
  };
}

async function loadCapturePage(win: BrowserWindow): Promise<void> {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devServerUrl) {
    const captureUrl = new URL('capture.html', devServerUrl.endsWith('/') ? devServerUrl : `${devServerUrl}/`);
    await win.loadURL(captureUrl.toString());
    return;
  }
  await win.loadFile(path.join(__dirname, '../renderer/capture.html'));
}

function attachCaptureConsoleForwarder(win: BrowserWindow): void {
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const text = (message ?? '').trim();
    if (!text) return;
    const isErrorLevel = level === 3;
    const isErrorLikeMessage = /\b(error|uncaught|exception)\b/i.test(text);
    if (!isErrorLevel && !isErrorLikeMessage) return;
    const source = sourceId ? `${sourceId}:${line}` : `line ${line}`;
    sendLog(`🧪 [captureWin:console] ${source} ${text}`);
  });
}

/**
 * Thrown before encoding when the capture cannot fit the target format. Carries the
 * measured numbers so a caller with somewhere to show them — the quick export panel —
 * can say how far over the limit it is and what width would fit, while callers without
 * a UI still get a translatable message.
 */
export class CaptureTooTallError extends Error {
  constructor(readonly format: CaptureFormat, readonly verdict: CaptureHeightVerdict) {
    // PNG and WebP share the ceiling, so PDF is the only way out — never suggest the
    // other raster format, which would fail at exactly the same height.
    super('Image height exceeds limits. Please use PDF format.');
    this.name = 'CaptureTooTallError';
  }
}

export async function captureMarkdownDocument(
  rawRequest: MarkdownCaptureRequest,
): Promise<CaptureDocumentResult> {
  const request = normalizeCaptureRequest(rawRequest);
  const logicalWidth = request.options.width;

  const captureWin = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    // macOS constrains a window's frame to the screen in both directions: back onto a
    // display, and down to that display's height. Quick export needs the opposite of
    // both — parked offscreen, and free to grow past the screen for a tall PDF page.
    enableLargerThanScreen: true,
    hiddenInMissionControl: process.platform === 'darwin',
    width: logicalWidth,
    height: 900,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      ...SILENT_WEB_PREFERENCES,
    },
  });
  muteWindow(captureWin);
  attachCaptureConsoleForwarder(captureWin);
  // A window that has never been shown stalls Chromium's rendering lifecycle, so map it
  // in the same invisible state the worker window uses: transparent and offscreen, shown
  // inactive so it never steals focus or flashes on screen. `show: true` at an extreme
  // offscreen origin used to do this, and on macOS that is exactly what surfaced the
  // window — the window server pulled the frame back onto the display.
  captureWin.setOpacity(0);
  captureWin.showInactive();
  parkWindowOffscreen(captureWin);

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Capture timed out after ${CAPTURE_TIMEOUT_MS / 1_000}s`));
    }, CAPTURE_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([
      captureMarkdownDocumentCore(captureWin, request, logicalWidth),
      timeoutPromise,
    ]);
    return result;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (!captureWin.isDestroyed()) captureWin.destroy();
  }
}

async function applyPdfDocumentTitle(
  captureWin: BrowserWindow,
  request: ReturnType<typeof normalizeCaptureRequest>,
): Promise<void> {
  const docTitle = (request.options.fileName ?? '').trim() || request.payload.title.trim();
  if (!docTitle) return;
  await captureWin.webContents.executeJavaScript(
    `document.title = ${JSON.stringify(docTitle)}, true`,
    true,
  );
}

async function captureMarkdownDocumentCore(
  captureWin: BrowserWindow,
  request: ReturnType<typeof normalizeCaptureRequest>,
  logicalWidth: number,
): Promise<CaptureDocumentResult> {
  await loadCapturePage(captureWin);

  const hasRenderFunction = await captureWin.webContents.executeJavaScript(
    `typeof window.renderCaptureCard === 'function'`,
    true,
  );
  if (!hasRenderFunction) throw new Error('capture renderer not ready');

  const serializedRequest = JSON.stringify(request);
  const serializedRequestLiteral = JSON.stringify(serializedRequest);
  const renderResult = (await captureWin.webContents.executeJavaScript(
    `window.renderCaptureCard(JSON.parse(${serializedRequestLiteral}))`,
    true,
  )) as { logicalHeight?: number } | null;

  const logicalHeight = Math.max(1, Math.ceil(renderResult?.logicalHeight ?? 1));
  const imageLogicalHeight = Math.max(1, Math.floor(renderResult?.logicalHeight ?? 1));
  const pdfHeight = logicalHeight + printPageSlack(logicalHeight);

  const heightVerdict = checkCaptureHeight(
    request.options.format,
    imageLogicalHeight,
    request.options.pixelRatio,
    logicalWidth,
  );
  if (!heightVerdict.ok) throw new CaptureTooTallError(request.options.format, heightVerdict);

  if (request.options.format === 'pdf') {
    await applyPdfDocumentTitle(captureWin, request);
    captureWin.setContentSize(logicalWidth, logicalHeight);
    await flattenPdfBackdrop(captureWin, logicalWidth, logicalHeight);
    const cssKey = await captureWin.webContents.insertCSS(
      `@page { size: ${logicalWidth}px ${pdfHeight}px; margin: 0; }` +
      `html, body { margin: 0 !important; padding: 0 !important; width: ${logicalWidth}px !important; height: ${pdfHeight}px !important; overflow: hidden !important; box-sizing: border-box !important; }` +
      // Stretch the backdrop to the whole page so its border stays exactly the configured
      // margin on all four sides, and let the last card swallow the slack as interior
      // space — :last-child rather than .capture-card so bubble layouts, which stack
      // several cards, only stretch the bottom one.
      `.capture-scene { min-height: ${pdfHeight}px !important; box-sizing: border-box !important; display: flex !important; flex-direction: column !important; }` +
      `.capture-scene > :last-child { flex: 1 1 auto !important; }`,
    );
    await captureWin.webContents.executeJavaScript(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100))))`,
      true,
    );
    try {
      const pdf = await captureWin.webContents.printToPDF({
        printBackground: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        preferCSSPageSize: true,
      });
      return { buffer: brandPdfMetadata(Buffer.from(pdf)), ext: 'pdf', mode: request.options.mode };
    } finally {
      await captureWin.webContents.removeInsertedCSS(cssKey).catch(() => undefined);
    }
  }

  const imageBuffer = await captureScreenshotCdp(
    captureWin, logicalWidth, imageLogicalHeight, request.options.format, request.options.pixelRatio,
  );
  return { buffer: imageBuffer, ext: request.options.format, mode: request.options.mode };
}

async function captureScreenshotCdp(
  win: BrowserWindow,
  logicalWidth: number,
  logicalHeight: number,
  format: 'png' | 'webp',
  pixelRatio: number,
): Promise<Buffer> {
  const debuggerSession = win.webContents.debugger;
  const alreadyAttached = debuggerSession.isAttached();
  if (!alreadyAttached) debuggerSession.attach('1.3');

  try {
    await debuggerSession.sendCommand('Page.enable');

    await debuggerSession.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: logicalWidth,
      height: logicalHeight,
      deviceScaleFactor: pixelRatio,
      mobile: false,
    });

    await win.webContents.executeJavaScript(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80))))`,
      true,
    );

    const result = (await debuggerSession.sendCommand('Page.captureScreenshot', {
      format,
      quality: format === 'webp' ? 75 : undefined,
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: logicalWidth,
        height: logicalHeight,
        scale: 1,
      },
    })) as { data: string };

    if (!result.data) throw new Error(`${format} screenshot data is empty`);
    return Buffer.from(result.data, 'base64');
  } finally {
    await debuggerSession.sendCommand('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
    if (!alreadyAttached && debuggerSession.isAttached()) debuggerSession.detach();
  }
}

export function buildCaptureSummary(raw: string): string {
  const plain = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[#>*_~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  return plain.length > 220 ? `${plain.slice(0, 220)}…` : plain;
}
