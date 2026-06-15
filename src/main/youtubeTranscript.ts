import { BrowserWindow, session } from 'electron';
import { CLEAN_UA } from './userAgent';

const LOAD_TIMEOUT_MS = 25_000;

const JS_SETTLE_MS = 800;

const JS_EXEC_TIMEOUT_MS = 40_000;

const YOUTUBE_PARTITION = 'persist:youtube';

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

const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com'];

export function extractYoutubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const idPattern = /^[\w-]{11}$/;

  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0];
    return idPattern.test(id) ? id : null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const vParam = parsed.searchParams.get('v');
    if (vParam && idPattern.test(vParam)) return vParam;
    const match = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
    if (match) return match[1];
  }

  return null;
}

export function youtubeThumbnailUrl(url: string): string {
  const id = extractYoutubeVideoId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
}

export function isYoutubeUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!YOUTUBE_HOSTS.includes(host)) return false;
  return extractYoutubeVideoId(url) !== null;
}

export function fetchYoutubeVideo(
  url: string,
  opts: { onLog?: (message: string) => void; show?: boolean } = {},
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
      webPreferences: {
        partition: YOUTUBE_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        disableDialogs: true,
        autoplayPolicy: 'document-user-activation-required',
      },
    });

    win.webContents.setUserAgent(CLEAN_UA);
    win.webContents.setAudioMuted(true);

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
      let execTimer: ReturnType<typeof setTimeout> | undefined;
      const execTimeout = new Promise<never>((_, rej) => {
        execTimer = setTimeout(() => rej(new Error('extraction timed out')), JS_EXEC_TIMEOUT_MS);
      });
      return (await Promise.race([
        win.webContents.executeJavaScript(EXTRACTION_SCRIPT, true),
        execTimeout,
      ]).finally(() => clearTimeout(execTimer))) as string | null;
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

/** Exported for the deterministic test suite (test/youtubeTranscript.test.ts). */
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

/** Exported for the deterministic test suite (test/youtubeTranscript.test.ts). */
export function parseExtractionResult(raw: string | null): YoutubeTranscriptResult | null {
  const result = parseVideoResult(raw);
  return result.ok ? { title: result.title, transcript: result.transcript } : null;
}

function safeDestroy(win: BrowserWindow): void {
  try {
    if (!win.isDestroyed()) win.destroy();
  } catch {
  }
}

/** Exported so the test suite can run the exact shipped script against a synthetic DOM (test/youtubeTranscript.test.ts). */
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
      // No caption tracks at all — genuinely no transcript (or a non-watch page
      // was served, e.g. a consent / bot-check wall with no player response).
      return JSON.stringify({ title, transcript: '', reason: 'no_caption_tracks' });
    }

    // The transcript can render in more than one panel instance; scope reading
    // to a single EXPANDED panel that actually holds transcript segments so we
    // never concatenate the transcript twice.
    const expandedPanel = () => Array.from(document.querySelectorAll('ytd-engagement-panel-section-list-renderer'))
      .find((p) => /EXPANDED/.test(p.getAttribute('visibility') || '')
        && (/transcript/i.test(p.getAttribute('target-id') || '')
          || p.querySelector('transcript-segment-view-model, ytd-transcript-segment-renderer')));

    const readSegments = () => {
      const root = expandedPanel() || document;
      // Two coexisting transcript UIs: legacy ytd-transcript-segment-renderer
      // (text in .segment-text) and the modern transcript-segment-view-model
      // (text in <span class="ytAttributedStringHost" role="text">). The
      // timestamp lives in a separate element in both, so targeting the caption
      // span/element excludes it.
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
      // Expand the description so its transcript section mounts.
      ['#description #expand', 'ytd-text-inline-expander #expand', 'tp-yt-paper-button#expand', '#expand'].forEach((sel) => {
        const e = document.querySelector(sel);
        if (e) { try { e.click(); } catch (x) {} }
      });
      // Language-independent: the dedicated "Show transcript" section button.
      const sectionBtn = document.querySelector(
        'ytd-video-description-transcript-section-renderer button, '
        + 'ytd-video-description-transcript-section-renderer yt-button-shape button'
      );
      if (sectionBtn) { try { sectionBtn.click(); } catch (x) {} }
      // Multilingual aria-label/text fallback.
      document.querySelectorAll('button, tp-yt-paper-button, ytd-button-renderer, yt-button-shape, a').forEach((b) => {
        const label = ((b.getAttribute && b.getAttribute('aria-label')) || '') + ' | ' + (b.textContent || '').trim();
        if (TRANSCRIPT_RE.test(label)) { try { b.click(); } catch (x) {} }
      });
    };

    // Wait for the watch page to hydrate (up to ~12s).
    for (let i = 0; i < 24 && !count('ytd-watch-metadata'); i++) await sleep(500);

    let transcript = readSegments();
    if (transcript) return JSON.stringify({ title, transcript, reason: 'ok' });

    openTranscript();
    // Poll up to ~20s for the panel to expand and render its segments.
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
