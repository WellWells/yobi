import type { WebContents } from 'electron';

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
    wc.loadURL(url).catch((err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function isCloudflareChallengeActive(wc: WebContents): Promise<boolean> {
  try {
    return (await wc.executeJavaScript(
      `!!(
          document.querySelector('#challenge-form') ||
          document.querySelector('.cf-browser-verification') ||
          document.querySelector('[id*="cf-chl"]') ||
          document.title.includes('Just a moment') ||
          (document.body && (
            document.body.innerText.includes('\u6b63\u5728\u57f7\u884c\u5b89\u5168\u9a57\u8b49') ||
            document.body.innerText.includes('Checking your browser') ||
            document.body.innerText.includes('checking your browser') ||
            document.body.innerText.includes('Verify you are human')
          ))
        )`,
      false,
    )) as boolean;
  } catch {
    return false;
  }
}

export const INJECTED_SLEEP_JS = `function sleep(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
  }`;

export const INJECTED_WAIT_FOR_JS = `function waitFor(conditionFn, label, timeout, interval) {
    if (timeout  === undefined) timeout  = TIMEOUT;
    if (interval === undefined) interval = 300;
    var waitStart = Date.now();
    return new Promise(function(resolve, reject) {
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
