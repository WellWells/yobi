/**
 * The composer's Stop, carried to the provider's own page: click the site's stop control so it
 * ends the answer it is writing. The read loop then sees generation over and returns, which frees
 * the worker for the next send instead of holding it until the dropped answer is complete.
 *
 * Found by the same language-free selectors the read scripts use to tell "still generating".
 */
import type { WebContents } from 'electron';
import { providerFromUrl } from '../../shared/types';
import type { Provider } from '../../shared/types';
import { GEMINI_STOP_SELECTOR } from './geminiReadScript';
import { CLAUDE_STOP_SELECTOR } from './claudeSendScript';
import { PPLX_STOP_ICON_ID } from './perplexityReadScript';
import { DEEPSEEK_DISABLED_CLASS, DEEPSEEK_INPUT_SELECTOR, DEEPSEEK_SEND_SELECTOR } from './deepseekSendScript';

/** ChatGPT's stop is a real button; the selector the read uses also matches a turn's state attribute. */
const CHATGPT_STOP_BUTTON_SELECTOR = 'button[data-testid="stop-button"]';

function clickExpression(findStop: string): string {
  return `(function () {
  function usable(b) { return !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true'; }
  var stop = (function () { ${findStop} })();
  if (!usable(stop)) return false;
  stop.click();
  return true;
})()`;
}

export const STOP_GENERATION_SCRIPTS: Record<Provider, string> = {
  gemini: clickExpression(`
    var hit = document.querySelector(${JSON.stringify(GEMINI_STOP_SELECTOR)});
    return hit ? (hit.closest('button') || hit) : null;`),
  chatgpt: clickExpression(`
    return document.querySelector(${JSON.stringify(CHATGPT_STOP_BUTTON_SELECTOR)});`),
  perplexity: clickExpression(`
    var uses = document.querySelectorAll('[data-ask-input-container="true"] button use');
    for (var i = 0; i < uses.length; i++) {
      var href = uses[i].getAttribute('href') || uses[i].getAttribute('xlink:href') || '';
      if (href === ${JSON.stringify(PPLX_STOP_ICON_ID)}) return uses[i].closest('button');
    }
    return null;`),
  claude: clickExpression(`
    return document.querySelector(${JSON.stringify(CLAUDE_STOP_SELECTOR)});`),
  // While answering, DeepSeek's send control is the stop control: enabled over an empty composer.
  deepseek: clickExpression(`
    var composer = document.querySelector(${JSON.stringify(DEEPSEEK_INPUT_SELECTOR)});
    if (!composer || String(composer.value || '').trim()) return null;
    var el = composer;
    for (var i = 0; el && i < 8; i++) {
      el = el.parentElement;
      var send = el ? el.querySelector(${JSON.stringify(DEEPSEEK_SEND_SELECTOR)}) : null;
      if (send) {
        return (' ' + send.className + ' ').indexOf(${JSON.stringify(` ${DEEPSEEK_DISABLED_CLASS} `)}) === -1 ? send : null;
      }
    }
    return null;`),
};

/** True when a stop control was found and clicked; never throws (the page may be mid-navigation). */
export async function clickStopGeneration(wc: WebContents, targetUrl: string): Promise<boolean> {
  const provider = providerFromUrl(targetUrl);
  const script = STOP_GENERATION_SCRIPTS[provider];
  if (!script || wc.isDestroyed()) return false;
  try {
    return await wc.executeJavaScript(script, true) === true;
  } catch {
    return false;
  }
}
