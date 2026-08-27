import type { WebContents } from 'electron';
import { sleep } from './common';

const CHOOSER_SELECTOR = '[jsname="oYxtQd"][role="combobox"]';
const OPTION_SELECTOR = '[role="option"][data-value]';
const PREFERRED_ALTERNATES = ['en-US', 'en-GB', 'ja', 'ko'];

const MENU_OPEN_MS = 600;
const NAVIGATION_TIMEOUT_MS = 15_000;
const CHOOSER_TIMEOUT_MS = 15_000;
const CHOOSER_POLL_MS = 250;

export interface LanguageResetResult {
  switched: boolean;
  from: string;
  to: string;
}

interface LanguageState {
  current: string;
  values: string[];
}

export function pickAlternateLanguage(current: string, values: string[]): string | null {
  const others = values.filter((value) => value && value !== current);
  if (others.length === 0) return null;
  const preferred = PREFERRED_ALTERNATES.find((value) => others.includes(value));
  return preferred ?? others[0];
}

export function buildLanguageReadScript(): string {
  return `(() => {
    if (!document.querySelector(${JSON.stringify(CHOOSER_SELECTOR)})) return null;
    const options = Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(OPTION_SELECTOR)}));
    const selected = options.filter(function (o) { return o.getAttribute('aria-selected') === 'true'; })[0];
    const fromUrl = new URLSearchParams(location.search).get('hl') || '';
    return {
      current: selected ? selected.getAttribute('data-value') : fromUrl,
      values: options.map(function (o) { return o.getAttribute('data-value'); }).filter(Boolean),
    };
  })()`;
}

export function buildChooserPresentScript(): string {
  return `!!document.querySelector(${JSON.stringify(CHOOSER_SELECTOR)})`;
}

export function buildLanguagePickScript(value: string): string {
  return `(async () => {
    const chooser = document.querySelector(${JSON.stringify(CHOOSER_SELECTOR)});
    if (!chooser) return false;
    chooser.click();
    await new Promise(function (r) { setTimeout(r, ${MENU_OPEN_MS}); });
    const option = document.querySelector('[role="option"][data-value="' + ${JSON.stringify(value)} + '"]');
    if (!option) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
      return false;
    }
    option.scrollIntoView({ block: 'center' });
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) {
      option.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
    return true;
  })()`;
}

function waitForNavigation(
  wc: WebContents,
  timeoutMs: number,
): { done: Promise<boolean>; cancel(): void } {
  let settle: (value: boolean) => void = () => undefined;
  const done = new Promise<boolean>((resolve) => { settle = resolve; });

  function finish(value: boolean): void {
    clearTimeout(timer);
    wc.removeListener('did-navigate', onNavigate);
    settle(value);
  }
  function onNavigate(): void {
    finish(true);
  }

  const timer = setTimeout(() => finish(false), timeoutMs);
  wc.on('did-navigate', onNavigate);
  return { done, cancel: () => finish(false) };
}

async function waitForChooser(wc: WebContents, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await wc.executeJavaScript(buildChooserPresentScript(), false)) === true) return true;
    } catch {
      return false;
    }
    await sleep(CHOOSER_POLL_MS);
  }
  return false;
}

async function readLanguageState(wc: WebContents): Promise<LanguageState | null> {
  try {
    const state = (await wc.executeJavaScript(buildLanguageReadScript(), false)) as LanguageState | null;
    if (!state || !state.current || !Array.isArray(state.values)) return null;
    return state;
  } catch {
    return null;
  }
}

async function selectLanguage(wc: WebContents, value: string): Promise<boolean> {
  const navigation = waitForNavigation(wc, NAVIGATION_TIMEOUT_MS);
  let clicked = false;
  try {
    clicked = (await wc.executeJavaScript(buildLanguagePickScript(value), false)) === true;
  } catch {
    clicked = false;
  }
  if (!clicked) {
    navigation.cancel();
    return false;
  }
  if (!(await navigation.done)) return false;
  return waitForChooser(wc, CHOOSER_TIMEOUT_MS);
}

function readLanguageFromUrl(wc: WebContents): string {
  try {
    return new URL(wc.getURL()).searchParams.get('hl') ?? '';
  } catch {
    return '';
  }
}

async function restoreLanguage(wc: WebContents, value: string): Promise<boolean> {
  if (await selectLanguage(wc, value)) return true;
  try {
    const url = new URL(wc.getURL());
    url.searchParams.set('hl', value);
    await wc.loadURL(url.toString());
    return true;
  } catch {
    return false;
  }
}

async function ensureLanguage(wc: WebContents, value: string): Promise<void> {
  if (readLanguageFromUrl(wc) === value) return;
  await restoreLanguage(wc, value);
}

export async function runGoogleSignInLanguageReset(wc: WebContents): Promise<LanguageResetResult> {
  const state = await readLanguageState(wc);
  if (!state) return { switched: false, from: '', to: '' };

  const alternate = pickAlternateLanguage(state.current, state.values);
  if (!alternate) return { switched: false, from: state.current, to: '' };

  if (!(await selectLanguage(wc, alternate))) {
    await ensureLanguage(wc, state.current);
    return { switched: false, from: state.current, to: '' };
  }
  if (!(await restoreLanguage(wc, state.current))) {
    return { switched: false, from: state.current, to: alternate };
  }
  return { switched: true, from: state.current, to: alternate };
}
