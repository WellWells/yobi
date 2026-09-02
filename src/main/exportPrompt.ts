import { app, BrowserWindow, dialog, nativeTheme, screen, shell } from 'electron';
import * as path from 'node:path';
import { config } from './config';
import { getLangCache, t } from './i18n';
import { effectiveTheme, themeBackground } from '../shared/themes';
import {
  CAPTURE_WIDTHS, SHARE_CONSENT_KEYS, clampShareExpire,
  captureWidthLabelKey, clampCaptureMargin, normalizeExportChoice, snapCaptureWidth,
} from '../shared/types';
import { effectiveExpires } from './share/instanceExpires';
import type {
  ExportPromptChoice, ExportPromptPayload, PanelHeight, QuickExportFormat,
  ShareResultAction, ShareResultState,
} from '../shared/types';

const PROMPT_TIMEOUT_MS = 300_000;
const PROMPT_WIDTH = 440;
const PROMPT_FALLBACK_HEIGHT = 268;
const PROMPT_MIN_HEIGHT = 180;
const PROMPT_MAX_HEIGHT = 700;
const FIRST_HEIGHT_TIMEOUT_MS = 3_000;

let activePanel: BrowserWindow | null = null;

async function loadPromptPage(win: BrowserWindow): Promise<void> {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devServerUrl) {
    const promptUrl = new URL('prompt.html', devServerUrl.endsWith('/') ? devServerUrl : `${devServerUrl}/`);
    await win.loadURL(promptUrl.toString());
    return;
  }
  await win.loadFile(path.join(__dirname, '../renderer/prompt.html'));
}

function promptBounds(height: number): { x: number; y: number; width: number; height: number } {
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  return {
    x: Math.round(workArea.x + (workArea.width - PROMPT_WIDTH) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width: PROMPT_WIDTH,
    height,
  };
}

function clampHeight(value: number): number {
  return Math.min(PROMPT_MAX_HEIGHT, Math.max(PROMPT_MIN_HEIGHT, Math.round(value)));
}

async function nextPanelHeight(win: BrowserWindow): Promise<PanelHeight> {
  const measured = (await win.webContents.executeJavaScript('window.nextPanelHeight()', true)) as PanelHeight;
  if (!measured || !Number.isFinite(measured.total) || measured.total <= 0) {
    throw new Error('panel reported no height');
  }
  return { panel: clampHeight(measured.panel), total: clampHeight(measured.total) };
}

function resizeKeepingTop(win: BrowserWindow, height: number): void {
  const current = win.getBounds();
  const { workArea } = screen.getDisplayNearestPoint({ x: current.x, y: current.y });
  const fitted = Math.min(height, workArea.height);
  win.setBounds({
    x: current.x,
    y: Math.max(workArea.y, Math.min(current.y, workArea.y + workArea.height - fitted)),
    width: PROMPT_WIDTH,
    height: fitted,
  });
}

export function panelPlacement(height: PanelHeight, lastPanel: number): 'centre' | 'anchor' {
  return height.panel === lastPanel ? 'anchor' : 'centre';
}

function trackPanelHeight(win: BrowserWindow, firstPanelHeight: number): void {
  let lastPanel = firstPanelHeight;
  void (async () => {
    while (!win.isDestroyed()) {
      try {
        const height = await nextPanelHeight(win);
        if (win.isDestroyed()) return;
        if (panelPlacement(height, lastPanel) === 'centre') {
          lastPanel = height.panel;
          win.setBounds(promptBounds(height.total));
        } else {
          resizeKeepingTop(win, height.total);
        }
      } catch {
        return;
      }
    }
  })();
}

export interface ExportPanel {
  showShareResult(state: ShareResultState): Promise<ShareResultAction>;
  openExternally(url: string): Promise<void>;
  chooseSavePath(defaultPath: string, ext: string): Promise<string | null>;
}

const SHARE_RESULT_ACTIONS: readonly ShareResultAction[] = ['revoke', 'open', 'done'];

function panelHandle(win: BrowserWindow): ExportPanel {
  const closed = new Promise<'done'>((resolve) => win.once('closed', () => resolve('done')));
  return {
    async showShareResult(state) {
      if (win.isDestroyed()) return 'done';
      const answered = (win.webContents.executeJavaScript(
        `window.renderShareResult(JSON.parse(${JSON.stringify(JSON.stringify(state))}))`,
        true,
      ) as Promise<unknown>).catch(() => 'done');
      const action = await Promise.race([answered, closed]);
      return SHARE_RESULT_ACTIONS.includes(action as ShareResultAction) ? (action as ShareResultAction) : 'done';
    },
    async chooseSavePath(defaultPath, ext) {
      const options = { defaultPath, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] };
      const result = win.isDestroyed()
        ? await dialog.showSaveDialog(options)
        : await dialog.showSaveDialog(win, options);
      return result.canceled || !result.filePath ? null : result.filePath;
    },
    async openExternally(url) {
      if (!win.isDestroyed()) {
        win.setAlwaysOnTop(false);
        win.setSkipTaskbar(false);
      }
      await shell.openExternal(url);
    },
  };
}

function buildPayload(defaults: ExportPromptDefaults): ExportPromptPayload {
  const strings = getLangCache();
  const share = config.share;
  const capture = config.captureSettings;
  const supportedExpires = effectiveExpires(share);
  return {
    defaultName: defaults.defaultName,
    notice: defaults.notice,
    format: defaults.format,
    zip: defaults.zip,
    width: snapCaptureWidth(defaults.width),
    margin: clampCaptureMargin(defaults.margin),
    palette: defaults.palette ?? capture.palette,
    backgroundStyle: capture.backgroundStyle,
    direction: capture.direction,
    theme: effectiveTheme(config.theme, nativeTheme.shouldUseDarkColors),
    strings: {
      title: t(strings, 'quickExport.panel.title'),
      fileName: t(strings, 'quickExport.panel.fileName'),
      zip: t(strings, 'quickExport.panel.zip'),
      size: t(strings, 'capture.size'),
      copy: t(strings, 'quickExport.panel.copy'),
      save: t(strings, 'quickExport.panel.save'),
      cancel: t(strings, 'quickExport.panel.cancel'),
      theme: t(strings, 'capture.palette'),
      margin: t(strings, 'capture.margin'),
      share: {
        format: t(strings, 'quickExport.panel.format.text'),
        instance: t(strings, 'share.settings.instance'),
        expire: t(strings, 'share.settings.expire'),
        burn: t(strings, 'share.settings.burn'),
        create: t(strings, 'share.create'),
        creating: t(strings, 'share.creating'),
        consentIntro: t(strings, 'share.consent.intro', { instance: instanceHost(share.instanceUrl) }),
        consentAccept: t(strings, 'share.consent.accept'),
      },
    },
    sizes: CAPTURE_WIDTHS.map((value) => ({
      value,
      label: t(strings, captureWidthLabelKey(value)),
    })),
    share: {
      consented: Boolean(share.consentedAt),
      instanceHost: instanceHost(share.instanceUrl),
      expire: clampShareExpire(share.expire, supportedExpires),
      burnAfterReading: share.burnAfterReading,
      expires: supportedExpires.map((value) => ({ value, label: t(strings, `share.expire.${value}`) })),
      consentPoints: SHARE_CONSENT_KEYS.map((key) => ({ key, text: t(strings, key) })),
    },
  };
}

export function instanceHost(instanceUrl: string): string {
  return instanceUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

interface ExportPromptDefaults {
  defaultName: string;
  notice?: string;
  format: QuickExportFormat;
  zip: boolean;
  width: number;
  margin: number;
  palette?: string;
}

/**
 * `'reopen'` keeps the panel up for another attempt. The object form carries a reason to
 * show above the controls, so a failure the user can act on — a capture too tall for the
 * chosen format — costs them a re-pick rather than a dismissed panel and a lost hotkey.
 */
export type PerformOutcome = 'done' | 'reopen' | { reopen: true; notice?: string };

export function retryDefaults(choice: ExportPromptChoice, previous: ExportPromptDefaults): ExportPromptDefaults {
  if (choice.kind !== 'capture') return previous;
  return {
    defaultName: choice.fileName || previous.defaultName,
    format: choice.format,
    zip: choice.zip,
    width: choice.width,
    margin: choice.margin,
    palette: choice.palette,
  };
}

export async function runWithExportPrompt(
  defaults: ExportPromptDefaults,
  perform: (choice: ExportPromptChoice, panel: ExportPanel) => Promise<PerformOutcome | void>,
): Promise<ExportPromptChoice | null> {
  if (activePanel && !activePanel.isDestroyed()) {
    activePanel.show();
    activePanel.focus();
    return null;
  }

  const win = new BrowserWindow({
    ...promptBounds(PROMPT_FALLBACK_HEIGHT),
    useContentSize: true,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: themeBackground(config.theme, nativeTheme.shouldUseDarkColors),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  activePanel = win;
  win.on('closed', () => { if (activePanel === win) activePanel = null; });

  const panel = panelHandle(win);
  const closed = new Promise<null>((resolve) => win.once('closed', () => resolve(null)));
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const expired = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), PROMPT_TIMEOUT_MS);
  });

  let attempt = defaults;
  let shown = false;
  try {
    await loadPromptPage(win);

    while (!win.isDestroyed()) {
      const payload = buildPayload(attempt);
      const answered = (win.webContents.executeJavaScript(
        `window.renderExportPrompt(JSON.parse(${JSON.stringify(JSON.stringify(payload))}))`,
        true,
      ) as Promise<unknown>).catch(() => null);

      if (!shown && !win.isDestroyed()) {
        shown = true;
        const fallback: PanelHeight = { panel: PROMPT_FALLBACK_HEIGHT, total: PROMPT_FALLBACK_HEIGHT };
        let height = fallback;
        try {
          height = await Promise.race([
            nextPanelHeight(win),
            new Promise<PanelHeight>((resolve) => setTimeout(() => resolve(fallback), FIRST_HEIGHT_TIMEOUT_MS)),
          ]);
        } catch {  }
        if (win.isDestroyed()) return null;
        win.setBounds(promptBounds(height.total));
        win.show();
        win.focus();
        trackPanelHeight(win, height.panel);
      }

      const answer = await Promise.race([answered, closed, expired]);

      const choice = normalizeExportChoice(answer, {
        format: attempt.format,
        zip: attempt.zip,
        width: attempt.width,
        margin: attempt.margin,
        palette: attempt.palette ?? config.captureSettings.palette,
        expire: clampShareExpire(config.share.expire, effectiveExpires(config.share)),
        burnAfterReading: config.share.burnAfterReading,
      });
      if (!choice) return null;

      const outcome = await perform(choice, panel);
      const detailed = typeof outcome === 'object' && outcome !== null ? outcome : null;
      if (!(detailed ? detailed.reopen : outcome === 'reopen')) return choice;
      attempt = { ...retryDefaults(choice, attempt), notice: detailed?.notice };
      if (!win.isDestroyed()) win.focus();
    }
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (!win.isDestroyed()) win.destroy();
  }
}
