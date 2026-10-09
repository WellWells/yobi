/**
 * Keeps signed-out Perplexity anonymous: each new conversation starts with cleared site data,
 * and a timer clears leftovers. Follow-ups and signed-in sessions are left alone.
 */
import { session } from 'electron';
import type { Cookie, Session, WebContents } from 'electron';
import { sendLog } from '../helpers';
import { llmLane } from '../flow/lanes';
import { getWorkerWin, isWorkerRevealed } from '../windows';
import { isSignInWindowOpen } from '../signInWindow';
import { isPerplexitySignedIn } from './perplexitySession';

const WORKER_PARTITION = 'persist:gemini';

/**
 * Cookies are cleared at the registrable-domain level (`perplexity.ai`, so `.count.perplexity.ai`
 * too) and never beyond it: the same partition holds the Gemini, Claude and ChatGPT sign-ins.
 */
export const PERPLEXITY_ORIGINS = ['https://www.perplexity.ai', 'https://perplexity.ai'] as const;

export const PERPLEXITY_VISITOR_DATA = [
  'cookies',
  'localStorage',
  'indexedDB',
  'cache',
  'serviceWorkers',
  'fileSystems',
  'backgroundFetch',
] as const;

/**
 * Perplexity's reply when it refuses this visitor. Matched whole, so an answer that merely
 * mentions signing up is not taken for it.
 */
const SIGN_IN_WALL_REPLY = /^sign up and repeat your request\.?$/i;

export const PERPLEXITY_SIGN_IN_WALL_ERROR = 'Perplexity asked to sign in';

export function isPerplexitySignInWall(response: string): boolean {
  return SIGN_IN_WALL_REPLY.test(response.trim());
}

const FIRST_WIPE_MS = 60_000;
export const PERPLEXITY_WIPE_INTERVAL_MS = 30 * 60_000;

function isPerplexityHost(host: string): boolean {
  const bare = host.replace(/^\./, '').toLowerCase();
  return bare === 'perplexity.ai' || bare.endsWith('.perplexity.ai');
}

export function isPerplexityPage(url: string): boolean {
  try {
    return isPerplexityHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Every cookie of perplexity.ai and its subdomains; `cookies.get({ domain })` misses `www.` and other subdomains. */
export async function perplexityCookies(ses: Session): Promise<Cookie[]> {
  return (await ses.cookies.get({})).filter((cookie) => isPerplexityHost(cookie.domain ?? ''));
}

/**
 * Forgets the anonymous visitor. A page still open on the site would write its ids straight back
 * from memory, so it is blanked first. Resolves whether there was a visitor to forget; a signed-in
 * session resolves false and is left alone.
 */
export async function forgetPerplexityVisitor(ses: Session, wc?: WebContents | null): Promise<boolean> {
  if (await isPerplexitySignedIn(ses)) return false;
  const cookies = await perplexityCookies(ses);
  if (wc && !wc.isDestroyed() && isPerplexityPage(wc.getURL())) {
    await wc.loadURL('about:blank');
  }
  await ses.clearData({ origins: [...PERPLEXITY_ORIGINS], dataTypes: [...PERPLEXITY_VISITOR_DATA] });
  return cookies.length > 0;
}

/**
 * The timer's turn: gives way to a send in progress, a sign-in (it runs in this same partition, and
 * wiping it mid-way takes the login's own cookies) and a worker on screen for a challenge.
 */
export async function wipeIdlePerplexityVisitor(): Promise<void> {
  if (llmLane.busy || isWorkerRevealed() || isSignInWindowOpen()) return;
  await llmLane.runExclusive(async () => {
    if (isWorkerRevealed() || isSignInWindowOpen()) return;
    const win = getWorkerWin();
    const wc = win && !win.isDestroyed() ? win.webContents : null;
    try {
      if (await forgetPerplexityVisitor(wc?.session ?? session.fromPartition(WORKER_PARTITION), wc)) {
        sendLog('🧹 Perplexity (signed out): cleared its cookies and site storage');
      }
    } catch (err: unknown) {
      sendLog(`⚠️ Perplexity visitor wipe failed: ${(err as Error).message}`);
    }
  });
}

let started = false;

export function startPerplexityVisitorWipe(): void {
  if (started) return;
  started = true;
  const first = setTimeout(() => {
    void wipeIdlePerplexityVisitor();
    const timer = setInterval(() => { void wipeIdlePerplexityVisitor(); }, PERPLEXITY_WIPE_INTERVAL_MS);
    timer.unref?.();
  }, FIRST_WIPE_MS);
  first.unref?.();
}
