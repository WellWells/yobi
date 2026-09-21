/**
 * Deciding whether the worker can keep the page it is already on.
 *
 * Every browser send used to begin with a full `loadURL`, even when the worker was already
 * sitting on exactly the page the prompt was going to. Resuming a stored thread paid for that
 * twice — once to validate the thread, once inside the provider runner — which measured 2.0-2.2s
 * per load on Gemini, 1.9s on ChatGPT and 3.3s on Perplexity, before a single character was
 * typed. All three drive their next turn straight into the live SPA with no navigation at all
 * (verified against the live pages on 2026-09-16), so the reload buys nothing but latency.
 *
 * What it did buy was a total state reset, and that is the part this module has to replace: a
 * page is only reusable when it is the same page, idle, and holding nothing from the last run.
 */
import type { WebContents } from 'electron';
import { navigateAndWait, sleep } from './common';
import type { Provider } from '../../shared/types';
import { GEMINI_INPUT_SELECTOR, GEMINI_STOP_SELECTOR } from './geminiReadScript';
import { GEMINI_CHIP_SELECTOR } from './geminiUpload';
import {
  CHATGPT_ASSISTANT_TURN_SELECTOR,
  CHATGPT_ATTACHMENT_TILE_SELECTOR,
  CHATGPT_INPUT_SELECTORS,
  CHATGPT_STOP_SELECTOR,
  CHATGPT_USER_TURN_SELECTOR,
} from './chatgptSendScript';
import {
  CLAUDE_ASSISTANT_TURN_SELECTOR,
  CLAUDE_ATTACHMENT_TILE_SELECTOR,
  CLAUDE_INPUT_SELECTOR,
  CLAUDE_SEND_SELECTOR,
  CLAUDE_USER_TURN_SELECTOR,
} from './claudeSendScript';
import {
  PPLX_FINAL_TEXT_SELECTOR,
  PPLX_INPUT_SELECTORS,
  PPLX_RESPONSE_SELECTOR,
  PPLX_STOP_ICON_ID,
} from './perplexityReadScript';

export interface PageReusePolicy {
  /** Evaluated in the page: true when it can take another prompt in the conversation it shows. */
  readyExpression: string;
  /** Evaluated in the page: true when it holds no conversation at all. */
  emptyExpression: string;
  /**
   * Evaluated in the page: true once a loaded thread shows its own history. Only for providers
   * whose dead thread first renders a live-looking shell at the thread URL and redirects
   * client-side afterwards, so the URL alone proves nothing at `load`.
   */
  threadSettledExpression?: string;
}

export interface PageTarget {
  /**
   * True when the prompt belongs to the conversation already on screen. A resumed thread is
   * supposed to be full of answers; a one-shot send must never inherit them.
   */
  continuingThread: boolean;
}

export function parseHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

/** Origin plus path: what the providers use to identify one conversation. */
export function pageIdentity(parsed: URL): string {
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

export function isSamePage(a: string, b: string): boolean {
  const left = parseHttpUrl(a);
  const right = parseHttpUrl(b);
  if (!left || !right) return false;
  return pageIdentity(left) === pageIdentity(right);
}

const GEMINI_READY = `(function () {
  var composer = document.querySelector(${JSON.stringify(GEMINI_INPUT_SELECTOR)});
  if (!composer) return false;
  if ((composer.innerText || composer.textContent || '').trim()) return false;
  if (document.querySelector(${JSON.stringify(GEMINI_STOP_SELECTOR)})) return false;
  if (document.querySelector(${JSON.stringify(GEMINI_CHIP_SELECTOR)})) return false;
  return true;
})()`;

const CHATGPT_READY = `(function () {
  var composer = document.querySelector(${JSON.stringify(CHATGPT_INPUT_SELECTORS.join(', '))});
  if (!composer) return false;
  if ((composer.innerText || composer.textContent || '').trim()) return false;
  if (document.querySelector(${JSON.stringify(CHATGPT_STOP_SELECTOR)})) return false;
  var form = document.querySelector('form[data-type="unified-composer"]');
  if (form && form.querySelectorAll(${JSON.stringify(CHATGPT_ATTACHMENT_TILE_SELECTOR)}).length) return false;
  return true;
})()`;

// The stop control is the reading of "it has finished": it is present for exactly as long as
// Perplexity is answering. The final-text wrapper is mounted with the first token, so it only
// rules out a page whose last answer sits outside one.
const PERPLEXITY_READY = `(function () {
  var composer = document.querySelector(${JSON.stringify(PPLX_INPUT_SELECTORS.join(', '))});
  if (!composer) return false;
  if ((composer.innerText || composer.textContent || '').trim()) return false;
  var stops = document.querySelectorAll('[data-ask-input-container="true"] button use');
  for (var i = 0; i < stops.length; i++) {
    var href = stops[i].getAttribute('href') || stops[i].getAttribute('xlink:href') || '';
    if (href === ${JSON.stringify(PPLX_STOP_ICON_ID)}) return false;
  }
  var answers = document.querySelectorAll(${JSON.stringify(PPLX_RESPONSE_SELECTOR)});
  if (!answers.length) return true;
  var last = answers[answers.length - 1];
  var wrapper = last.closest ? last.closest(${JSON.stringify(PPLX_FINAL_TEXT_SELECTOR)}) : null;
  return !!(wrapper && wrapper.querySelectorAll(${JSON.stringify(PPLX_RESPONSE_SELECTOR)}).length <= 1);
})()`;

// Claude swaps its send button for a stop button while it answers, and a finished answer is the only
// one whose node reads `data-is-streaming="false"` — a turn still waiting for its first token has
// no attribute at all yet.
const CLAUDE_READY = `(function () {
  var composer = document.querySelector(${JSON.stringify(CLAUDE_INPUT_SELECTOR)});
  if (!composer) return false;
  if ((composer.innerText || composer.textContent || '').trim()) return false;
  if (!document.querySelector(${JSON.stringify(CLAUDE_SEND_SELECTOR)})) return false;
  if (document.querySelector(${JSON.stringify(CLAUDE_ATTACHMENT_TILE_SELECTOR)})) return false;
  var answers = document.querySelectorAll(${JSON.stringify(CLAUDE_ASSISTANT_TURN_SELECTOR)});
  for (var i = 0; i < answers.length; i++) {
    if (answers[i].getAttribute('data-is-streaming') !== 'false') return false;
  }
  return true;
})()`;

function emptyOf(selector: string): string {
  return `document.querySelectorAll(${JSON.stringify(selector)}).length === 0`;
}

export const PAGE_REUSE: Record<Provider, PageReusePolicy> = {
  gemini: {
    readyExpression: GEMINI_READY,
    emptyExpression: emptyOf('model-response'),
  },
  chatgpt: {
    readyExpression: CHATGPT_READY,
    emptyExpression: emptyOf(`${CHATGPT_USER_TURN_SELECTOR}, ${CHATGPT_ASSISTANT_TURN_SELECTOR}`),
  },
  claude: {
    readyExpression: CLAUDE_READY,
    emptyExpression: emptyOf(`${CLAUDE_USER_TURN_SELECTOR}, ${CLAUDE_ASSISTANT_TURN_SELECTOR}`),
    // Measured 2026-09-18: a deleted or foreign /chat/<id> renders the chat shell — composer
    // included — at that URL, then moves to /new ~1.2 s after `load`.
    threadSettledExpression: `!(${emptyOf(`${CLAUDE_USER_TURN_SELECTOR}, ${CLAUDE_ASSISTANT_TURN_SELECTOR}`)})`,
  },
  perplexity: {
    readyExpression: PERPLEXITY_READY,
    emptyExpression: emptyOf(PPLX_RESPONSE_SELECTOR),
  },
};

async function probe(wc: WebContents, expression: string): Promise<boolean> {
  return (await wc.executeJavaScript(expression, false)) === true;
}

async function canReusePage(
  wc: WebContents,
  url: string,
  policy: PageReusePolicy | null,
  target: PageTarget,
): Promise<boolean> {
  if (!policy) return false;
  try {
    if (wc.isLoading()) return false;
    if (!isSamePage(wc.getURL(), url)) return false;
    if (!(await probe(wc, policy.readyExpression))) return false;
    if (target.continuingThread) return true;
    return await probe(wc, policy.emptyExpression);
  } catch {
    // A page that cannot answer the probe cannot be trusted to hold the next prompt either.
    return false;
  }
}

const THREAD_SETTLE_TIMEOUT_MS = 10_000;
const THREAD_SETTLE_POLL_MS = 150;

/**
 * After a thread has been loaded: `'left'` when the page moved off it (the thread is gone), else
 * `'settled'` once its history shows — or `'timeout'`, still on the thread, when it never did.
 * A provider without a settle probe is judged by its URL alone.
 */
export async function waitForThreadSettled(
  wc: WebContents,
  threadUrl: string,
  policy: PageReusePolicy | null,
  timeoutMs = THREAD_SETTLE_TIMEOUT_MS,
): Promise<'settled' | 'left' | 'timeout'> {
  const expression = policy?.threadSettledExpression;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (!isSamePage(wc.getURL(), threadUrl)) return 'left';
    if (!expression) return 'settled';
    try {
      if (await probe(wc, expression)) return isSamePage(wc.getURL(), threadUrl) ? 'settled' : 'left';
    } catch {
      // Mid-navigation the page cannot answer; the next poll will.
    }
    if (Date.now() >= deadline) return 'timeout';
    await sleep(THREAD_SETTLE_POLL_MS);
  }
}

/**
 * Put the worker on `url`, reloading only when the page it already has cannot serve the prompt.
 * Idempotent on purpose: `runAutomation` validates a resumed thread through this and then the
 * provider runner asks for the same page again, and the second ask has to be free.
 */
export async function ensureOnPage(
  wc: WebContents,
  url: string,
  policy: PageReusePolicy | null,
  target: PageTarget,
): Promise<'reused' | 'loaded'> {
  if (await canReusePage(wc, url, policy, target)) return 'reused';
  await navigateAndWait(wc, url);
  return 'loaded';
}
