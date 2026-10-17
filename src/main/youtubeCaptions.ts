import { BrowserWindow, session } from 'electron';
import { YOUTUBE_PARTITION, youtubeLane } from './flow/lanes';
import { num, obj, str } from './flow/skills/jsonPick';
import type { Json } from './flow/skills/jsonPick';
import { SILENT_WEB_PREFERENCES, muteWindow, parkWindowOffscreen } from './silentWindow';
import { userAgentForUrl } from './userAgent';
import type { YoutubeCaptionTrack } from './youtubeVideoInfo';
import { youtubeWatchUrl } from '../shared/youtubeUrl';
import { raceAbort } from './promiseRace';

/*
 * A YouTube video's captions with their timing, for an .srt file: the watch page is opened in a
 * hidden window, its player is asked to turn the track on, and the script keeps the caption answer
 * the player fetches itself; the track is turned off and on again until an answer has text.
 */

/** The whole read: the page, the player and its caption request. */
export const CAPTIONS_READ_MS = 60_000;
const POLL_MS = 400;
/** One poll's script; it only reads and asks, so anything slower is a page that is not answering. */
const SCRIPT_MS = 5_000;
/** An answer still missing this long after asking: ask again (the first one can come back empty). */
const ASK_AGAIN_MS = 3_000;

function baseLanguage(code: string): string {
  return code.toLowerCase().split('-')[0];
}

/**
 * The track an .srt is made of: a person's captions in the video's own language, else YouTube's
 * automatic ones (in that language first), else the track YouTube picks itself, else the first.
 * The video's language is the language of YouTube's own pick, or of its automatic track. Null when
 * the video has no captions.
 */
export function pickCaptionTrack(tracks: readonly YoutubeCaptionTrack[], defaultIndex: number): YoutubeCaptionTrack | null {
  const usable = tracks.filter((track) => track.languageCode);
  const preferred = tracks[defaultIndex]?.languageCode ? tracks[defaultIndex] : undefined;
  const own = preferred?.languageCode ?? usable.find((track) => track.asr)?.languageCode ?? '';
  const sameLanguage = (track: YoutubeCaptionTrack): boolean => own !== '' && baseLanguage(track.languageCode) === baseLanguage(own);
  return usable.find((track) => !track.asr && track.languageCode === own)
    ?? usable.find((track) => !track.asr && sameLanguage(track))
    ?? usable.find((track) => track.asr && sameLanguage(track))
    ?? usable.find((track) => track.asr)
    ?? preferred
    ?? usable[0]
    ?? null;
}

/**
 * Runs in the watch page on every poll; safe to run again after the page reloaded itself. Wraps
 * `fetch` and `XMLHttpRequest` once to keep the first non-empty answer for this track (an answer
 * in another format is asked again, token and all, as `json3`), asks the player for the track when
 * no answer came within `ASK_AGAIN_MS` and none is on its way, and gives back `{ body }` once there
 * is one, else what it has seen so far (player there, times asked, requests, empty answers) for
 * the log when it never comes.
 */
export function captionsScript(track: YoutubeCaptionTrack): string {
  return `(() => {
  const want = { lang: ${JSON.stringify(track.languageCode)}, asr: ${track.asr} };
  const s = window.__yobiCaptions
    || (window.__yobiCaptions = { body: '', askedAt: 0, asked: 0, seen: 0, empty: 0, inFlight: 0 });
  const wanted = (raw) => {
    try {
      const url = new URL(raw, location.href);
      if (!/\\/api\\/timedtext$/.test(url.pathname)) return null;
      if (url.searchParams.get('lang') !== want.lang || url.searchParams.has('tlang')) return null;
      if ((url.searchParams.get('kind') === 'asr') !== want.asr) return null;
      return url;
    } catch (e) {
      return null;
    }
  };
  if (!s.hooked) {
    s.hooked = true;
    const pageFetch = window.fetch;
    const keep = (url, body) => {
      if (!body) s.empty++;
      if (s.body || !body) return;
      if (url.searchParams.get('fmt') === 'json3') {
        s.body = body;
        return;
      }
      url.searchParams.set('fmt', 'json3');
      pageFetch.call(window, url.href, { credentials: 'include' })
        .then((response) => response.text())
        .then((text) => { if (text && !s.body) s.body = text; })
        .catch(() => {});
    };
    const started = () => {
      s.seen++;
      s.inFlight++;
    };
    const ended = () => {
      s.inFlight = Math.max(0, s.inFlight - 1);
    };
    window.fetch = function (input) {
      const result = pageFetch.apply(this, arguments);
      const url = wanted(typeof input === 'string' ? input : String((input && input.url) || ''));
      if (url) {
        started();
        result.then((response) => response.clone().text()).then((text) => keep(url, text)).catch(() => {}).then(ended);
      }
      return result;
    };
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, raw) {
      this.__yobiCaptions = wanted(String(raw));
      return open.apply(this, arguments);
    };
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      const url = this.__yobiCaptions;
      if (url) {
        started();
        this.addEventListener('load', () => { try { keep(url, this.responseText); } catch (e) {} });
        this.addEventListener('loadend', ended);
      }
      return send.apply(this, arguments);
    };
  }
  if (s.body) return { body: s.body };
  const player = document.getElementById('movie_player');
  const ready = Boolean(player && typeof player.setOption === 'function');
  const state = { player: ready, asked: s.asked, seen: s.seen, empty: s.empty };
  // A request for the track still on its way is never cut short by asking again.
  if (!ready || s.inFlight > 0 || Date.now() - s.askedAt < ${ASK_AGAIN_MS}) return state;
  s.askedAt = Date.now();
  s.asked++;
  try {
    player.loadModule('captions');
    player.setOption('captions', 'track', {});
    player.setOption('captions', 'track', { languageCode: want.lang, kind: want.asr ? 'asr' : '' });
  } catch (e) {}
  return state;
})()`;
}

/** What the page's script had seen when the read gave up, for the log. */
function describeState(state: Json): string {
  if (state.player !== true) return 'no player on the page';
  return `asked the player ${num(state.asked)} times, ${num(state.seen)} requests for the track, ${num(state.empty)} empty`;
}

function stopped(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('YouTube captions read stopped');
}

/**
 * The track's `json3` captions, parsed. Holds `youtubeLane` (the session is shared with the
 * transcript read, whose retry clears it); a Stop ends the wait for the lane and the read at once
 * with the signal's reason. Throws when the page gives no answer within `CAPTIONS_READ_MS` or the
 * answer is not JSON.
 */
export async function readYoutubeCaptions(videoId: string, track: YoutubeCaptionTrack, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const run = youtubeLane.runExclusive(async () => {
    signal?.throwIfAborted();
    return readInWindow(videoId, track, signal);
  });
  return raceAbort(run, signal, stopped);
}

async function readInWindow(videoId: string, track: YoutubeCaptionTrack, signal: AbortSignal | undefined): Promise<unknown> {
  const url = youtubeWatchUrl(videoId);
  const win = new BrowserWindow({
    width: 1_280,
    height: 900,
    show: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    hiddenInMissionControl: process.platform === 'darwin',
    webPreferences: {
      session: session.fromPartition(YOUTUBE_PARTITION),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      disableDialogs: true,
      ...SILENT_WEB_PREFERENCES,
    },
  });
  muteWindow(win);
  win.webContents.setUserAgent(userAgentForUrl(url));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let loadError = '';
  // YouTube reloads the page once on its own (`themeRefresh`), which aborts the first load (-3).
  win.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) loadError = `${description} (${code})`;
  });
  const script = captionsScript(track);
  const started = Date.now();
  let last = 'the page never answered';
  try {
    // Mapped, not merely created: a never-shown window stalls rendering, and the watch page then
    // never builds its player. Transparent before it is mapped, so it never
    // flashes at its default spot before parking.
    win.setOpacity(0);
    win.showInactive();
    parkWindowOffscreen(win);
    void win.loadURL(url).catch(() => {});
    while (Date.now() - started < CAPTIONS_READ_MS) {
      signal?.throwIfAborted();
      if (loadError) throw new Error(`The YouTube page did not load: ${loadError}`);
      // Mid-navigation the page has no world to run in, or a busy page does not answer: the next
      // poll tries again, so a hung script never holds the lane past the deadline.
      const answer = obj(await Promise.race([
        win.webContents.executeJavaScript(script, true).catch(() => null) as Promise<unknown>,
        new Promise((resolve) => setTimeout(resolve, SCRIPT_MS, null)),
      ]));
      const body = str(answer?.body);
      if (body) return JSON.parse(body) as unknown;
      if (answer) last = describeState(answer);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    signal?.throwIfAborted();
    throw new Error(`YouTube gave no ${track.languageCode} captions within ${CAPTIONS_READ_MS / 1_000} s (${last})`);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
