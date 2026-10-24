/**
 * Decides whether the worker can keep the page it is already on instead of reloading it: a page
 * is reusable only when it is the same page, idle, and holding nothing from the last run.
 */
import type { WebContents } from 'electron';
import { navigateAndWait, sleep } from './common';
import { providerFromUrl } from '../../shared/types';
import type { Provider } from '../../shared/types';
import {
  GEMINI_INPUT_SELECTOR,
  GEMINI_STOP_SELECTOR,
  GEMINI_TEMPORARY_CHAT_ACTIVE_SELECTOR,
} from './geminiReadScript';
import { GEMINI_CHIP_SELECTOR } from './geminiUpload';
import {
  CHATGPT_ASSISTANT_TURN_SELECTOR,
  CHATGPT_ATTACHMENT_TILE_SELECTOR,
  CHATGPT_COMPOSER_FORM_SELECTOR,
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
  /**
   * Evaluated in the page: true while it is the provider's temporary chat. Origin and path
   * cannot tell `chatgpt.com/` from its temporary twin. Absent where Yobi never opens one.
   */
  temporaryExpression?: string;
}

export interface PageTarget {
  /**
   * True when the prompt belongs to the conversation already on screen. A resumed thread is
   * supposed to be full of answers; a one-shot send must never inherit them.
   */
  continuingThread: boolean;
  /** A new conversation that has to be the provider's temporary chat. */
  temporary?: boolean;
}

/** The query that turns a provider's new-chat page into its temporary chat; it survives the send. */
export const TEMPORARY_CHAT_QUERY: Partial<Record<Provider, { name: string; value: string }>> = {
  chatgpt: { name: 'temporary-chat', value: 'true' },
  claude: { name: 'incognito', value: '' },
};

function temporaryQueryExpression(provider: 'chatgpt' | 'claude'): string {
  return `new URLSearchParams(location.search).has(${JSON.stringify(TEMPORARY_CHAT_QUERY[provider]?.name)})`;
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

const THREAD_PATH_PATTERNS: Record<Provider, RegExp> = {
  gemini: /^\/app\/[^/]+\/?$/,
  chatgpt: /^\/c\/[^/]+\/?$/,
  claude: /^\/chat\/[^/]+\/?$/,
  perplexity: /^\/search\/[^/]+\/?$/,
};

export function extractThreadUrl(provider: Provider, url: string): string | null {
  const pattern = THREAD_PATH_PATTERNS[provider];
  const parsed = parseHttpUrl(url);
  if (!parsed) return null;
  if (providerFromUrl(parsed.href) !== provider) return null;
  if (!pattern.test(parsed.pathname)) return null;
  return pageIdentity(parsed);
}

/**
 * Whether the page `ensureOnPage` landed on may still be rendering answers from before this send,
 * so an answer count read now could grow by itself and has to hold still before it anchors the
 * send. A kept page settled on its previous turn, and a freshly loaded page that is not a thread
 * (a new conversation's landing page) has no answers to render.
 */
export function landingMayStillRender(
  wc: WebContents,
  landing: 'reused' | 'loaded',
  target: PageTarget,
): boolean {
  if (landing === 'reused') return false;
  if (target.continuingThread) return true;
  // A one-shot send whose target is itself a conversation link loads that conversation's answers.
  const url = wc.getURL();
  return extractThreadUrl(providerFromUrl(url), url) !== null;
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
  var form = document.querySelector(${JSON.stringify(CHATGPT_COMPOSER_FORM_SELECTOR)});
  if (form && form.querySelectorAll(${JSON.stringify(CHATGPT_ATTACHMENT_TILE_SELECTOR)}).length) return false;
  return true;
})()`;

// The stop control marks an answer in progress; the final-text wrapper is not a completion signal.
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

// No send button means still answering; a missing data-is-streaming also does, so compare to 'false'.
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
    temporaryExpression: `!!document.querySelector(${JSON.stringify(GEMINI_TEMPORARY_CHAT_ACTIVE_SELECTOR)})`,
  },
  chatgpt: {
    readyExpression: CHATGPT_READY,
    emptyExpression: emptyOf(`${CHATGPT_USER_TURN_SELECTOR}, ${CHATGPT_ASSISTANT_TURN_SELECTOR}`),
    temporaryExpression: temporaryQueryExpression('chatgpt'),
  },
  claude: {
    readyExpression: CLAUDE_READY,
    emptyExpression: emptyOf(`${CLAUDE_USER_TURN_SELECTOR}, ${CLAUDE_ASSISTANT_TURN_SELECTOR}`),
    threadSettledExpression: `!(${emptyOf(`${CLAUDE_USER_TURN_SELECTOR}, ${CLAUDE_ASSISTANT_TURN_SELECTOR}`)})`,
    temporaryExpression: temporaryQueryExpression('claude'),
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
    if (!(await probe(wc, policy.emptyExpression))) return false;
    if (!policy.temporaryExpression) return true;
    return (await probe(wc, policy.temporaryExpression)) === Boolean(target.temporary);
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
