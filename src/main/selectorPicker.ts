import { BrowserWindow } from 'electron';
import { CLEAN_UA } from './userAgent';
import { SILENT_WEB_PREFERENCES, muteWindow } from './silentWindow';
import { URL_PARSER_PARTITION, ensureHttpScheme } from './pageLoader';
import { executeAutomationWithTimeout } from './providers/automationExecutor';
import { buildPickerScript, type PickerStrings } from './selectorPickerScript';
import { getLangCache, t } from './i18n';
import type { ScraperPickRequest, ScraperPickResult } from '../shared/types';
import { toTokens } from '../shared/shortcuts';

const LOAD_TIMEOUT_MS = 25_000;
const PICK_TIMEOUT_MS = 180_000;

let activePicker: BrowserWindow | null = null;

interface PickedSet {
  itemSelector: string;
  titleSelector: string;
  linkSelector: string;
  count: number;
}

function pickerStrings(strings: Record<string, string>): PickerStrings {
  return {
    banner: t(strings, 'flow.skill.scraper.pickBannerList'),
    cancelHint: t(strings, 'flow.skill.scraper.pickBannerCancel')
      .replace('{{shortcut}}', toTokens('Escape', process.platform === 'darwin').join(' + ')),
    notAList: t(strings, 'flow.skill.scraper.pickNotAList'),
    scope: t(strings, 'flow.skill.scraper.pickScope'),
    rowCount: t(strings, 'flow.skill.scraper.matchCount'),
    advanced: t(strings, 'flow.skill.scraper.pickShowSelectors'),
    labelItem: t(strings, 'flow.skill.scraper.pickLabelItem'),
    labelTitle: t(strings, 'flow.skill.scraper.pickLabelTitle'),
    labelLink: t(strings, 'flow.skill.scraper.pickLabelLink'),
    rowIsLink: t(strings, 'flow.skill.scraper.pickRowIsLink'),
    noLink: t(strings, 'flow.skill.scraper.pickNoLink'),
    more: t(strings, 'flow.skill.scraper.pickMore'),
    confirm: t(strings, 'flow.skill.scraper.pickConfirm'),
    cancel: t(strings, 'dialog.cancel'),
  };
}

function joinScoped(itemSelector: string, part: string): string {
  return part ? `${itemSelector} ${part}` : itemSelector;
}

export function readPickTarget(set: PickedSet, target: ScraperPickRequest['target']): string {
  if (target === 'link') return joinScoped(set.itemSelector, set.linkSelector);
  if (target === 'title') return joinScoped(set.itemSelector, set.titleSelector);
  return set.itemSelector;
}

function parsePicked(raw: string): PickedSet | null {
  let parsed: Partial<PickedSet>;
  try {
    parsed = JSON.parse(raw) as Partial<PickedSet>;
  } catch {
    return null;
  }
  if (typeof parsed.itemSelector !== 'string' || !parsed.itemSelector) return null;
  return {
    itemSelector: parsed.itemSelector,
    titleSelector: typeof parsed.titleSelector === 'string' ? parsed.titleSelector : '',
    linkSelector: typeof parsed.linkSelector === 'string' ? parsed.linkSelector : '',
    count: Number(parsed.count) || 0,
  };
}

function assertHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`pickSelector: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`pickSelector: only http(s) URLs are allowed (got ${parsed.protocol})`);
  }
}

export async function pickSelector(args: ScraperPickRequest): Promise<ScraperPickResult | null> {
  const url = ensureHttpScheme((args?.url ?? '').trim());
  const requested = args?.target;
  const target: ScraperPickRequest['target'] =
    requested === 'link' || requested === 'title' ? requested : 'list';
  assertHttpUrl(url);

  if (activePicker && !activePicker.isDestroyed()) {
    activePicker.destroy();
  }

  const strings = getLangCache();
  const win = new BrowserWindow({
    width: 1_280,
    height: 900,
    show: false,
    title: t(strings, 'flow.skill.scraper.pickWindowTitle'),
    webPreferences: {
      partition: URL_PARSER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      disableDialogs: true,
      ...SILENT_WEB_PREFERENCES,
    },
  });
  activePicker = win;
  win.webContents.setUserAgent(CLEAN_UA);
  muteWindow(win);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  let closedByUser = false;
  win.on('closed', () => {
    closedByUser = true;
    if (activePicker === win) activePicker = null;
  });

  try {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => { if (!done) { done = true; resolve(); } };
      win.webContents.once('did-finish-load', finish);
      win.webContents.on('did-fail-load', (_e, code, _desc, _u, isMainFrame) => {
        if (isMainFrame && code !== -3) finish();
      });
      win.once('closed', finish);
      win.loadURL(url).catch(finish);
      setTimeout(finish, LOAD_TIMEOUT_MS);
    });

    if (win.isDestroyed()) return null;
    win.show();
    win.focus();

    const raw = await executeAutomationWithTimeout<string>(
      win.webContents,
      buildPickerScript(pickerStrings(strings), PICK_TIMEOUT_MS),
      PICK_TIMEOUT_MS,
      'selector-picker',
    );

    if (win.isDestroyed()) return null;
    const picked = parsePicked((raw ?? '').trim());
    if (!picked) return null;
    return {
      selector: readPickTarget(picked, target),
      count: picked.count,
      itemSelector: picked.itemSelector,
      titleSelector: picked.titleSelector,
      linkSelector: picked.linkSelector,
    };
  } catch (err) {
    if (closedByUser || win.isDestroyed()) return null;
    throw err;
  } finally {
    if (!win.isDestroyed()) win.destroy();
    if (activePicker === win) activePicker = null;
  }
}
