import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';
import type { MarkdownCaptureRequest, CaptureFormat, CaptureMode } from '../shared/types';
import { sendLog } from './helpers';

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
  const width = Math.max(860, Math.min(1_600, Math.round(request?.options?.width || 1_200)));
  const background = (request?.options?.background ?? '').trim();
  const safeBackground = /^(linear-gradient|radial-gradient)\(.+\)$/i.test(background)
    ? background
    : 'linear-gradient(140deg, #0f172a 0%, #1e293b 55%, #334155 100%)';
  const cardTheme = request?.options?.cardTheme === 'light' ? 'light' : 'dark';

  return {
    payload: {
      title: (payload.title ?? fallback.title) as string,
      prompt: (payload.prompt ?? '') as string,
      content: (payload.content ?? '') as string,
      summary: (payload.summary ?? '') as string,
      provider: (payload.provider ?? '') as string,
      timestamp: (payload.timestamp ?? '') as string,
    },
    options: {
      mode,
      format,
      fileName: (request?.options?.fileName ?? '').trim(),
      showPrompt: Boolean(request?.options?.showPrompt),
      showContent: Boolean(request?.options?.showContent),
      showProvider: Boolean(request?.options?.showProvider),
      showTimestamp: Boolean(request?.options?.showTimestamp),
      width,
      background: safeBackground,
      cardTheme,
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

export async function captureMarkdownDocument(
  rawRequest: MarkdownCaptureRequest,
): Promise<CaptureDocumentResult> {
  const request = normalizeCaptureRequest(rawRequest);
  const logicalWidth = request.options.width;

  const captureWin = new BrowserWindow({
    show: true,
    x: -99_999,
    y: -99_999,
    skipTaskbar: true,
    focusable: false,
    width: logicalWidth,
    height: 900,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  attachCaptureConsoleForwarder(captureWin);

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
  const imageLogicalHeight = logicalHeight;
  const pdfHeight = logicalHeight - 1;

  if (request.options.format !== 'pdf' && logicalHeight > 20_000) {
    throw new Error('Image height exceeds limits. Please use PDF format.');
  }

  if (request.options.format === 'pdf') {
    captureWin.setContentSize(logicalWidth, logicalHeight);
    const cssKey = await captureWin.webContents.insertCSS(
      `@page { size: ${logicalWidth}px ${pdfHeight}px; margin: 0; }` +
      `html, body { margin: 0 !important; padding: 0 !important; width: ${logicalWidth}px !important; height: ${pdfHeight}px !important; overflow: hidden !important; box-sizing: border-box !important; }`,
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
      return { buffer: Buffer.from(pdf), ext: 'pdf', mode: request.options.mode };
    } finally {
      await captureWin.webContents.removeInsertedCSS(cssKey).catch(() => undefined);
    }
  }

  const imageBuffer = await captureScreenshotCdp(
    captureWin, logicalWidth, imageLogicalHeight, request.options.format,
  );
  return { buffer: imageBuffer, ext: request.options.format, mode: request.options.mode };
}

async function captureScreenshotCdp(
  win: BrowserWindow,
  logicalWidth: number,
  logicalHeight: number,
  format: 'png' | 'webp',
): Promise<Buffer> {
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
