import type { WebContents } from 'electron';
import { loadURLFollowingIdentity } from '../navigationIdentity';
import { PROVIDER_URLS } from '../../shared/types';
import type { Provider } from '../../shared/types';

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * `url` is on the provider's own host, exactly (no subdomains, no legacy hosts); false when it does
 * not parse. Unlike `providerFromUrl`, nothing falls back to Gemini.
 */
export function isProviderHost(url: string, provider: Provider): boolean {
  try {
    return new URL(url).hostname === new URL(PROVIDER_URLS[provider]).hostname;
  } catch {
    return false;
  }
}

export async function navigateAndWait(
  wc: WebContents,
  url: string,
  timeoutMs = 30_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Navigation timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    wc.once('did-finish-load', () => {
      clearTimeout(timer);
      resolve();
    });
    loadURLFollowingIdentity(wc, url).catch((err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** The tab title, or '' when the page cannot be read. */
export async function readDocumentTitle(wc: WebContents): Promise<string> {
  try {
    return String(await wc.executeJavaScript('document.title', false) ?? '');
  } catch {
    return '';
  }
}

/** Waits out a navigation already in flight; `navigateAndWait` starts one instead. */
export async function waitForPageLoad(wc: WebContents, timeoutMs: number): Promise<void> {
  if (!wc.isLoading()) return;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Post-navigation page load timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    wc.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
  });
}

/** Longer than any challenge page: past it the words are a chat that quotes one, not the check. */
export const CHALLENGE_PAGE_MAX_TEXT_CHARS = 1_500;

/*
 * Cloudflare's interstitial, told by structure only, never by its title or words (they follow
 * the visitor's language). `appSelector` is the site's own composer: present means past the
 * challenge, whatever marks linger. The challenge form counts anywhere; the challenge variable and
 * its `/orchestrate/` script (not the detection script every Cloudflare page loads) only on a page
 * as short as a challenge. A chat is page text too: a verification wall typed into Claude as a
 * tool result would make every later turn fail as "Claude wants a Cloudflare check".
 * Turnstile is no mark: it also sits in sign-in forms.
 */
export function cloudflareChallengeProbe(appSelector: string): string {
  return `(function() {
    if (document.querySelector(${JSON.stringify(appSelector)})) return false;
    if (document.querySelector('#challenge-form, .cf-browser-verification')) return true;
    var text = document.body ? document.body.innerText : '';
    if (text.length >= ${CHALLENGE_PAGE_MAX_TEXT_CHARS}) return false;
    return Boolean(window._cf_chl_opt) ||
      Boolean(document.querySelector('script[src*="/cdn-cgi/challenge-platform/"][src*="/orchestrate/"]'));
  })()`;
}

export async function isCloudflareChallengeActive(wc: WebContents, appSelector: string): Promise<boolean> {
  try {
    return (await wc.executeJavaScript(cloudflareChallengeProbe(appSelector), false)) as boolean;
  } catch {
    return false;
  }
}

export const INJECTED_SLEEP_JS = `function sleep(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
  }`;

// Checks once before the first interval: a condition that already holds resolves at once instead
// of paying one interval for nothing on every step.
export const INJECTED_WAIT_FOR_JS = `function waitFor(conditionFn, label, timeout, interval) {
    if (timeout  === undefined) timeout  = TIMEOUT;
    if (interval === undefined) interval = 300;
    var waitStart = Date.now();
    return new Promise(function(resolve, reject) {
      var initial;
      try { initial = conditionFn(); } catch(e) { initial = undefined; }
      if (initial) { resolve(initial); return; }
      var handle = setInterval(function() {
        if (Date.now() - waitStart > timeout) {
          clearInterval(handle);
          reject(new Error('Timeout waiting for: ' + (label || 'condition')));
          return;
        }
        var result;
        try { result = conditionFn(); } catch(e) { return; }
        if (result) { clearInterval(handle); resolve(result); }
      }, interval);
    });
  }`;

export const INJECTED_INTERCEPT_COPY_JS = `function interceptCopy(button) {
    return new Promise(function(resolve) {
      var finished = false;
      function finish(value) {
        if (finished) return;
        finished = true;
        resolve(value || '');
      }
      try {
        var cb = navigator.clipboard;
        var proto = cb ? Object.getPrototypeOf(cb) : null;
        if (!cb || !proto) {
          button.click();
          setTimeout(function() { finish(''); }, 2000);
          return;
        }
        var origWrite     = proto.write;
        var origWriteText = proto.writeText;
        function restore() { proto.write = origWrite; proto.writeText = origWriteText; }
        function finishWithRestore(v) { restore(); finish(v); }
        proto.writeText = function(text) {
          finishWithRestore(text);
          return Promise.resolve();
        };
        proto.write = async function(items) {
          try {
            for (var i = 0; i < items.length; i++) {
              if (items[i].types && items[i].types.includes('text/plain')) {
                var blob = await items[i].getType('text/plain');
                finishWithRestore(await blob.text());
                return;
              }
            }
          } catch (e) {}
          finishWithRestore('');
        };
        button.click();
        setTimeout(function() { finishWithRestore(''); }, 2200);
      } catch (err) {
        try { button.click(); } catch (e) {}
        setTimeout(function() { finish(''); }, 2000);
      }
    });
  }`;
