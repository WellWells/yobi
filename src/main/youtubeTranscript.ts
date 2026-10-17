import { BrowserWindow, session } from 'electron';
import { userAgentForUrl } from './userAgent';
import { YOUTUBE_PARTITION, youtubeLane } from './flow/lanes';
import { SILENT_WEB_PREFERENCES, muteWindow, parkWindowOffscreen } from './silentWindow';
import { withTimeout } from './promiseRace';
import { extractYoutubeVideoId } from '../shared/youtubeUrl';

const LOAD_TIMEOUT_MS = 25_000;

const JS_SETTLE_MS = 800;

const JS_EXEC_TIMEOUT_MS = 40_000;

export interface YoutubeTranscriptResult {
  title: string;
  transcript: string;
}

export interface YoutubeVideoResult {
  title: string;
  transcript: string;
  ok: boolean;
}

const FAILED_VIDEO_RESULT: YoutubeVideoResult = { title: '', transcript: '', ok: false };

export { isYoutubeUrl, youtubeThumbnailUrl } from '../shared/youtubeUrl';
export { extractYoutubeVideoId };

export function fetchYoutubeVideo(
  url: string,
  opts: { onLog?: (message: string) => void; show?: boolean } = {},
): Promise<YoutubeVideoResult> {
  // Inside the module rather than at each call site: the retry's clearStorageData() is what
  // makes two concurrent fetches destroy each other, and it is not visible from out there.
  return youtubeLane.runExclusive(() => fetchYoutubeVideoExclusive(url, opts));
}

function fetchYoutubeVideoExclusive(
  url: string,
  opts: { onLog?: (message: string) => void; show?: boolean },
): Promise<YoutubeVideoResult> {
  const log = opts.onLog ?? (() => {});
  const visible = opts.show === true;

  const videoId = extractYoutubeVideoId(url);
  if (!videoId) return Promise.resolve(FAILED_VIDEO_RESULT);

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  return new Promise((resolve) => {
    let settled = false;

    const win = new BrowserWindow({
      x: visible ? 80 : -20_000,
      y: visible ? 80 : -20_000,
      width: 1_280,
      height: 900,
      show: visible,
      skipTaskbar: !visible,
      focusable: visible,
      hasShadow: visible,
      hiddenInMissionControl: !visible && process.platform === 'darwin',
      webPreferences: {
        partition: YOUTUBE_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        disableDialogs: true,
        ...SILENT_WEB_PREFERENCES,
      },
    });

    win.webContents.setUserAgent(userAgentForUrl(watchUrl));
    muteWindow(win);
    // Electron has no popup blocker: a window.open() from the page would show a real window.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    if (!visible) {
      // Mapped, not merely created: a never-shown window stalls rendering, and the watch page then
      // never builds its description or transcript panel. Transparent before it is mapped, so it
      // never flashes before parking.
      win.setOpacity(0);
      win.showInactive();
      parkWindowOffscreen(win);
    }

    const finish = (result: YoutubeVideoResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(overall);
      safeDestroy(win);
      resolve(result);
    };

    const overall = setTimeout(() => {
      log('⏱️ YouTube: gave up — page never finished loading or extraction stalled');
      finish(FAILED_VIDEO_RESULT);
    }, (LOAD_TIMEOUT_MS + JS_EXEC_TIMEOUT_MS) * 2 + 5_000);

    const waitForLoad = (): Promise<boolean> => new Promise((res) => {
      let done = false;
      const settleLoad = (ok: boolean): void => {
        if (done) return;
        done = true;
        clearTimeout(loadTimer);
        win.webContents.off('did-finish-load', onFinish);
        win.webContents.off('did-fail-load', onFail);
        res(ok);
      };
      const onFinish = (): void => settleLoad(true);
      const onFail = (_event: unknown, errorCode: number, _desc: string, _url: string, isMainFrame: boolean): void => {
        if (!isMainFrame || errorCode === -3) return;
        log(`❌ YouTube: watch page failed to load (error code ${errorCode})`);
        settleLoad(false);
      };
      const loadTimer = setTimeout(() => settleLoad(false), LOAD_TIMEOUT_MS);
      win.webContents.once('did-finish-load', onFinish);
      win.webContents.on('did-fail-load', onFail);
    });

    const extract = async (): Promise<string | null> => {
      await sleep(JS_SETTLE_MS);
      return (await withTimeout(
        win.webContents.executeJavaScript(EXTRACTION_SCRIPT, true),
        JS_EXEC_TIMEOUT_MS,
        () => new Error('extraction timed out'),
      )) as string | null;
    };

    const logFailure = (raw: string | null, result: YoutubeVideoResult): void => {
      let reason = raw === null ? 'extractor script error' : 'unknown';
      try {
        const parsed = JSON.parse(raw ?? 'null') as { reason?: unknown };
        if (typeof parsed?.reason === 'string') reason = parsed.reason;
      } catch {}
      log(`▶️ YouTube: no transcript (${reason}; ${result.title ? `title="${result.title}"` : 'no title — page may not have loaded the video'})`);
    };

    const attempt = async (): Promise<YoutubeVideoResult> => {
      const loaded = await waitForLoad();
      if (settled || !loaded) return FAILED_VIDEO_RESULT;
      log('▶️ YouTube: watch page loaded — opening transcript panel…');
      const raw = await extract().catch(() => null);
      if (settled) return FAILED_VIDEO_RESULT;
      const result = parseVideoResult(raw);
      if (!result.ok) logFailure(raw, result);
      return result;
    };

    const run = async (): Promise<void> => {
      win.loadURL(watchUrl).catch(() => {});
      const first = await attempt();
      if (settled) return;
      if (first.ok) { finish(first); return; }

      log('🧹 YouTube: clearing cookies + storage for this session and retrying…');
      try {
        await session.fromPartition(YOUTUBE_PARTITION).clearStorageData();
      } catch {}
      if (settled) return;

      win.loadURL(watchUrl).catch(() => {});
      finish(await attempt());
    };

    void run();
  });
}

export async function fetchYoutubeTranscript(url: string): Promise<YoutubeTranscriptResult | null> {
  const result = await fetchYoutubeVideo(url);
  return result.ok ? { title: result.title, transcript: result.transcript } : null;
}

export function parseVideoResult(raw: string | null): YoutubeVideoResult {
  if (!raw) return FAILED_VIDEO_RESULT;
  try {
    const parsed = JSON.parse(raw) as Partial<YoutubeTranscriptResult>;
    const transcript = typeof parsed.transcript === 'string' ? parsed.transcript.trim() : '';
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    return { title, transcript, ok: transcript.length > 0 };
  } catch {
    return FAILED_VIDEO_RESULT;
  }
}

function safeDestroy(win: BrowserWindow): void {
  try {
    if (!win.isDestroyed()) win.destroy();
  } catch {
  }
}

export const EXTRACTION_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const TRANSCRIPT_RE = /transcript|顯示轉錄|轉錄稿|逐字稿|文字稿|字幕記錄|文字起こし|スクリプト|대본|스크립트|자막 기록|transcripci|transcription|transkript|trascrizione|расшифровка|стенограмма/i;
  try {
    const count = (s) => document.querySelectorAll(s).length;
    const pr = window.ytInitialPlayerResponse;
    const title = (pr && pr.videoDetails && pr.videoDetails.title)
      || document.title.replace(/\\s*-\\s*YouTube\\s*$/, '')
      || '';

    const tracks = pr && pr.captions
      && pr.captions.playerCaptionsTracklistRenderer
      && pr.captions.playerCaptionsTracklistRenderer.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return JSON.stringify({ title, transcript: '', reason: 'no_caption_tracks' });
    }

    const expandedPanel = () => Array.from(document.querySelectorAll('ytd-engagement-panel-section-list-renderer'))
      .find((p) => /EXPANDED/.test(p.getAttribute('visibility') || '')
        && (/transcript/i.test(p.getAttribute('target-id') || '')
          || p.querySelector('transcript-segment-view-model, ytd-transcript-segment-renderer')));

    const readSegments = () => {
      const root = expandedPanel() || document;
      const nodes = root.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model');
      if (!nodes.length) return '';
      const parts = [];
      nodes.forEach((n) => {
        const el = n.querySelector('.segment-text')
          || n.querySelector('yt-formatted-string.segment-text')
          || n.querySelector('span.ytAttributedStringHost[role="text"]')
          || n.querySelector('.ytAttributedStringHost')
          || n.querySelector('.yt-core-attributed-string');
        const txt = ((el && (el.innerText || el.textContent)) || '').trim();
        if (txt) parts.push(txt);
      });
      return parts.join(' ').replace(/\\s+/g, ' ').trim();
    };

    const openTranscript = () => {
      ['#description #expand', 'ytd-text-inline-expander #expand', 'tp-yt-paper-button#expand', '#expand'].forEach((sel) => {
        const e = document.querySelector(sel);
        if (e) { try { e.click(); } catch (x) {} }
      });
      const sectionBtn = document.querySelector(
        'ytd-video-description-transcript-section-renderer button, '
        + 'ytd-video-description-transcript-section-renderer yt-button-shape button'
      );
      if (sectionBtn) { try { sectionBtn.click(); } catch (x) {} }
      document.querySelectorAll('button, tp-yt-paper-button, ytd-button-renderer, yt-button-shape, a').forEach((b) => {
        const label = ((b.getAttribute && b.getAttribute('aria-label')) || '') + ' | ' + (b.textContent || '').trim();
        if (TRANSCRIPT_RE.test(label)) { try { b.click(); } catch (x) {} }
      });
    };

    for (let i = 0; i < 24 && !count('ytd-watch-metadata'); i++) await sleep(500);

    let transcript = readSegments();
    if (transcript) return JSON.stringify({ title, transcript, reason: 'ok' });

    openTranscript();
    for (let i = 0; i < 50; i++) {
      await sleep(400);
      transcript = readSegments();
      if (transcript) return JSON.stringify({ title, transcript, reason: 'ok' });
      if (i === 6 || i === 16) openTranscript();
    }

    return JSON.stringify({ title, transcript: '', reason: 'panel_not_rendered' });
  } catch (e) {
    return null;
  }
})();`;
