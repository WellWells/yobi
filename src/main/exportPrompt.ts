import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import * as path from 'node:path';
import { config } from './config';
import { getLangCache, t } from './i18n';
import { effectiveTheme, themeBackground } from '../shared/themes';
import {
  CAPTURE_WIDTHS, SHARE_CONSENT_KEYS, SHARE_EXPIRE_VALUES,
  captureWidthLabelKey, normalizeExportChoice, snapCaptureWidth,
} from '../shared/types';
import type {
  ExportPromptChoice, ExportPromptPayload, QuickExportFormat, ShareResultAction, ShareResultState,
} from '../shared/types';

const PROMPT_TIMEOUT_MS = 300_000;
const PROMPT_WIDTH = 440;
const PROMPT_FALLBACK_HEIGHT = 268;
const PROMPT_MIN_HEIGHT = 180;
const PROMPT_MAX_HEIGHT = 520;
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

/*
 * Resolves with the panel's height the moment it has one to report, and thereafter only
 * when that height actually changes. The panel morphs between stages — and switching
 * format never round-trips through main — so measuring once before showing is not enough.
 */
async function nextPanelHeight(win: BrowserWindow): Promise<number> {
  const measured = (await win.webContents.executeJavaScript('window.nextPanelHeight()', true)) as number;
  if (!Number.isFinite(measured) || measured <= 0) throw new Error('panel reported no height');
  return Math.min(PROMPT_MAX_HEIGHT, Math.max(PROMPT_MIN_HEIGHT, Math.round(measured)));
}

function trackPanelHeight(win: BrowserWindow): void {
  void (async () => {
    while (!win.isDestroyed()) {
      try {
        const height = await nextPanelHeight(win);
        if (win.isDestroyed()) return;
        win.setBounds(promptBounds(height));
      } catch {
        return;
      }
    }
  })();
}

/* The panel is a bridge-less window: every stage after the first is another round-trip. */
export interface ExportPanel {
  showShareResult(state: ShareResultState): Promise<ShareResultAction>;
}

function panelHandle(win: BrowserWindow): ExportPanel {
  /* One listener for the whole handle — the result stage can be shown more than once. */
  const closed = new Promise<'done'>((resolve) => win.once('closed', () => resolve('done')));
  return {
    async showShareResult(state) {
      if (win.isDestroyed()) return 'done';
      const answered = (win.webContents.executeJavaScript(
        `window.renderShareResult(JSON.parse(${JSON.stringify(JSON.stringify(state))}))`,
        true,
      ) as Promise<unknown>).catch(() => 'done');
      const action = await Promise.race([answered, closed]);
      return action === 'revoke' ? 'revoke' : 'done';
    },
  };
}

function buildPayload(defaults: ExportPromptDefaults): ExportPromptPayload {
  const strings = getLangCache();
  const share = config.share;
  return {
    defaultName: defaults.defaultName,
    format: defaults.format,
    zip: defaults.zip,
    width: snapCaptureWidth(defaults.width),
    theme: effectiveTheme(config.theme, nativeTheme.shouldUseDarkColors),
    strings: {
      title: t(strings, 'quickExport.panel.title'),
      fileName: t(strings, 'quickExport.panel.fileName'),
      zip: t(strings, 'quickExport.panel.zip'),
      size: t(strings, 'capture.size'),
      copy: t(strings, 'quickExport.panel.copy'),
      cancel: t(strings, 'quickExport.panel.cancel'),
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
      expire: share.expire,
      burnAfterReading: share.burnAfterReading,
      expires: SHARE_EXPIRE_VALUES.map((value) => ({ value, label: t(strings, `share.expire.${value}`) })),
      consentPoints: SHARE_CONSENT_KEYS.map((key) => ({ key, text: t(strings, key) })),
    },
  };
}

export function instanceHost(instanceUrl: string): string {
  return instanceUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

interface ExportPromptDefaults {
  defaultName: string;
  format: QuickExportFormat;
  zip: boolean;
  width: number;
}

export async function runWithExportPrompt(
  defaults: ExportPromptDefaults,
  perform: (choice: ExportPromptChoice, panel: ExportPanel) => Promise<void>,
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

  const payload = buildPayload(defaults);

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    await loadPromptPage(win);
    if (win.isDestroyed()) return null;

    const answered = (win.webContents.executeJavaScript(
      `window.renderExportPrompt(JSON.parse(${JSON.stringify(JSON.stringify(payload))}))`,
      true,
    ) as Promise<unknown>).catch(() => null);

    if (!win.isDestroyed()) {
      /*
       * Raced rather than simply awaited: a first render that never commits would otherwise
       * leave the window hidden forever with no way to dismiss it. Falling back here is no
       * worse than the fixed height this used to show, and the tracker corrects it on the
       * next height change.
       */
      let height = PROMPT_FALLBACK_HEIGHT;
      try {
        height = await Promise.race([
          nextPanelHeight(win),
          new Promise<number>((resolve) => setTimeout(() => resolve(PROMPT_FALLBACK_HEIGHT), FIRST_HEIGHT_TIMEOUT_MS)),
        ]);
      } catch { /* keep the fallback */ }
      if (win.isDestroyed()) return null;
      win.setBounds(promptBounds(height));
      win.show();
      win.focus();
      trackPanelHeight(win);
    }

    const answer = await Promise.race([
      answered,
      new Promise<null>((resolve) => win.once('closed', () => resolve(null))),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), PROMPT_TIMEOUT_MS);
      }),
    ]);

    const choice = normalizeExportChoice(answer, {
      format: defaults.format,
      zip: defaults.zip,
      width: defaults.width,
      expire: config.share.expire,
      burnAfterReading: config.share.burnAfterReading,
    });
    if (!choice) return null;
    await perform(choice, panelHandle(win));
    return choice;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (!win.isDestroyed()) win.destroy();
  }
}
