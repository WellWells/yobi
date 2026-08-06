import { BrowserWindow, session } from 'electron';
import { CLEAN_UA } from './userAgent';
import { SILENT_WEB_PREFERENCES, muteWindow } from './silentWindow';
import { computeVerdictTier, VERDICT_I18N_KEYS, VERDICT_LABEL_EN } from '../shared/steamVerdict';

export function localizedVerdict(rating: string, total: string, langData: Record<string, string>): { verdict: string; tier: string } {
  const tier = computeVerdictTier(Number(rating), Number(total));
  if (tier < 0) return { verdict: '', tier: '' };
  const label = langData[VERDICT_I18N_KEYS[tier]] ?? VERDICT_LABEL_EN[tier] ?? '';
  return { verdict: label, tier: String(tier) };
}

const PARTITION = 'persist:gmaps';
const LOAD_TIMEOUT_MS = 25_000;
const JS_SETTLE_MS = 600;
const JS_EXEC_TIMEOUT_MS = 15_000;

export interface PlaceStats {
  rating: string;
  total: string;
  distribution: string;
  positive: string;
}

export const STATS_EXTRACTION_SCRIPT = `(async () => {
  const parseNum = (s) => ((/[\\d][\\d,]*(?:\\.\\d+)?/.exec(s || '') || [''])[0]).replace(/,/g, '');
  const grab = () => {
    const all = [...document.querySelectorAll('[aria-label]')];
    const rIdx = all.findIndex((e) => /^\\s*[0-5][.,]\\d(\\s|$)/.test(e.getAttribute('aria-label') || ''));
    if (rIdx < 0) return null;
    const rating = parseNum(all[rIdx].getAttribute('aria-label'));
    const distribution = all.map((e) => (e.getAttribute('aria-label') || '').trim())
      .filter((l) => /[、,]/.test(l) && (l.match(/\\d[\\d,]*/g) || []).length >= 2 && /^[1-5]\\D/.test(l))
      .slice(0, 5)
      // "<star> …、<count> reviews": the count is the LAST number in the row —
      // a comma-separator locale ("5 stars, 2,000 reviews") makes the middle a
      // spurious group, so never assume it is the second one.
      .map((l) => { const n = l.match(/\\d[\\d,]*/g) || []; return (n[n.length - 1] || '').replace(/,/g, ''); });
    const total = distribution.length === 5
      ? String(distribution.reduce((sum, c) => sum + (Number(c) || 0), 0))
      : '';
    if (!rating || !total) return null;
    return { rating, total, distribution };
  };
  const deadline = Date.now() + 9000;
  while (Date.now() < deadline) {
    const found = grab();
    if (found) return JSON.stringify(found);
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
})()`;

export function parsePlaceStats(raw: string | null): PlaceStats | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { rating?: unknown; total?: unknown; distribution?: unknown };
    const rating = typeof parsed.rating === 'string' ? parsed.rating : '';
    const total = typeof parsed.total === 'string' ? parsed.total : '';
    if (!rating || !total) return null;
    const dist = Array.isArray(parsed.distribution)
      ? parsed.distribution.filter((v): v is string => typeof v === 'string')
      : [];
    let distribution = '';
    let positive = '';
    if (dist.length === 5) {
      distribution = dist.map((count, i) => `${5 - i}★=${count}`).join(', ');
      const nums = dist.map((c) => Number(c) || 0);
      const sum = nums.reduce((a, b) => a + b, 0);
      if (sum > 0) positive = String(Math.round(((nums[0] + nums[1]) / sum) * 100));
    }
    return { rating, total, distribution, positive };
  } catch {
    return null;
  }
}

function safeDestroy(win: BrowserWindow): void {
  if (!win.isDestroyed()) win.destroy();
}

export async function fetchPlaceStats(
  placeUrl: string,
  opts: { onLog?: (message: string) => void } = {},
): Promise<PlaceStats | null> {
  const log = opts.onLog ?? (() => {});
  if (!placeUrl) return null;

  try {
    await session.fromPartition(PARTITION).cookies.set({
      url: 'https://www.google.com',
      name: 'CONSENT',
      value: 'YES+cb.20210328-17-p0.en+FX+000',
      domain: '.google.com',
    });
  } catch {}

  return new Promise((resolve) => {
    let settled = false;
    const win = new BrowserWindow({
      x: -20_000,
      y: -20_000,
      width: 1_280,
      height: 900,
      show: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        disableDialogs: true,
        ...SILENT_WEB_PREFERENCES,
      },
    });
    win.webContents.setUserAgent(CLEAN_UA);
    muteWindow(win);

    const finish = (stats: PlaceStats | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(overall);
      safeDestroy(win);
      resolve(stats);
    };

    const overall = setTimeout(() => {
      log('Maps Reviews: gave up reading the overall rating (page never settled)');
      finish(null);
    }, LOAD_TIMEOUT_MS + JS_EXEC_TIMEOUT_MS + 5_000);

    const waitForLoad = (): Promise<boolean> => new Promise((res) => {
      let done = false;
      const settle = (ok: boolean): void => {
        if (done) return;
        done = true;
        clearTimeout(loadTimer);
        win.webContents.off('did-finish-load', onFinish);
        win.webContents.off('did-fail-load', onFail);
        res(ok);
      };
      const onFinish = (): void => settle(true);
      const onFail = (_e: unknown, code: number, _d: string, _u: string, isMainFrame: boolean): void => {
        if (!isMainFrame || code === -3) return;
        settle(false);
      };
      const loadTimer = setTimeout(() => settle(false), LOAD_TIMEOUT_MS);
      win.webContents.once('did-finish-load', onFinish);
      win.webContents.on('did-fail-load', onFail);
    });

    const run = async (): Promise<void> => {
      win.loadURL(placeUrl).catch(() => {});
      const loaded = await waitForLoad();
      if (settled || !loaded) return finish(null);
      await new Promise((r) => setTimeout(r, JS_SETTLE_MS));
      let execTimer: ReturnType<typeof setTimeout> | undefined;
      const execTimeout = new Promise<never>((_, rej) => {
        execTimer = setTimeout(() => rej(new Error('extraction timed out')), JS_EXEC_TIMEOUT_MS);
      });
      const raw = await Promise.race([
        win.webContents.executeJavaScript(STATS_EXTRACTION_SCRIPT, true) as Promise<string | null>,
        execTimeout,
      ]).catch(() => null).finally(() => clearTimeout(execTimer));
      const stats = parsePlaceStats(raw as string | null);
      if (stats) log(`Maps Reviews: overall ${stats.rating}★ from ${stats.total} reviews`);
      finish(stats);
    };

    void run();
  });
}
