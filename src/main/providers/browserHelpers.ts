import { INJECTED_SLEEP_JS } from './common';

export const BROWSER_HELPER_PREAMBLE = `
${INJECTED_SLEEP_JS}

function waitFor(sel, timeoutMs) {
  var budget = (timeoutMs === undefined || timeoutMs === null) ? 15000 : timeoutMs;
  var start = Date.now();
  return new Promise(function(resolve, reject) {
    var existing = document.querySelector(sel);
    if (existing) { resolve(existing); return; }
    var handle = setInterval(function() {
      var el = document.querySelector(sel);
      if (el) { clearInterval(handle); resolve(el); return; }
      if (Date.now() - start > budget) {
        clearInterval(handle);
        reject(new Error('waitFor timeout: ' + sel));
      }
    }, 200);
  });
}

function read(sel) {
  var el = document.querySelector(sel);
  if (!el) return '';
  return el.innerText || el.textContent || '';
}

function readAll(sel) {
  var out = [];
  var nodes = document.querySelectorAll(sel);
  for (var i = 0; i < nodes.length; i++) {
    out.push(nodes[i].innerText || nodes[i].textContent || '');
  }
  return out;
}

// React-safe value set: clear, simulate a paste, then fall back to the native
// value setter so frameworks that wrap the value property still see the change.
function fill(sel, value) {
  var el = document.querySelector(sel);
  if (!el) throw new Error('fill: no element for ' + sel);
  var text = (value === undefined || value === null) ? '' : String(value);
  el.focus();
  if (el.isContentEditable) {
    try { document.execCommand('selectAll', false, null); } catch (e) {}
    var dtc = new DataTransfer();
    dtc.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dtc, bubbles: true, cancelable: true }));
    if (!(el.innerText || '').trim() && text) {
      try { document.execCommand('insertText', false, text); } catch (e) {}
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  el.value = '';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  var dt = new DataTransfer();
  dt.setData('text/plain', text);
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  if (el.value !== text) {
    var proto = (el.tagName === 'TEXTAREA') ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) { desc.set.call(el, text); } else { el.value = text; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // Fire keyup/change/blur too: plain login/ERP forms commonly wire validation to
  // onkeyup / onblur, and won't treat the field as filled without them.
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

// Click: pointer/mouse pre-sequence for framework buttons that track press state,
// then the NATIVE .click() so inline onclick="..." handlers (and delegated
// listeners) fire reliably and exactly once. A synthetic 'click' event alone
// misses some inline-handler / isTrusted-gated buttons.
function click(sel) {
  var el = (typeof sel === 'string') ? document.querySelector(sel) : sel;
  if (!el) throw new Error('click: no element for ' + sel);
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  var pre = ['pointerdown', 'mousedown', 'pointerup', 'mouseup'];
  for (var i = 0; i < pre.length; i++) {
    el.dispatchEvent(new MouseEvent(pre[i], { bubbles: true, cancelable: true, view: window }));
  }
  if (typeof el.click === 'function') { el.click(); }
  else { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); }
}

// screenshot(name?) -> Promise<savedPath>. Bridged to the main process by the
// browserPage preload (window.__yobi.capturePage); rejects if the bridge is absent.
function screenshot(name) {
  if (window.__yobi && window.__yobi.capturePage) {
    return window.__yobi.capturePage(name || '');
  }
  return Promise.reject(new Error('screenshot bridge unavailable'));
}
`;
