import { DEEPSEEK_ANSWER_CONTENT_SELECTOR } from './deepseekSendScript';

export const DEEPSEEK_LEFT_CONVERSATION = 'DEEPSEEK_LEFT_CONVERSATION';

/** How long the text must sit still, stop control gone, before an answer without its action row counts as done. */
const QUIET_MS = 3_000;
/** A new conversation is named a moment after its first answer. */
const TITLE_WAIT_MS = 3_000;

/**
 * Waits for the answer above `baseline`, then reads it.
 *
 * Done = the stop control is gone and the answer's action row is drawn (it only appears once the
 * last token lands). The copy control yields Markdown through the async clipboard or a legacy
 * selected textarea. Both paths are intercepted without touching the system clipboard. A copy
 * that yields nothing falls back to the rendered answer, which excludes the thinking block.
 */
export const DEEPSEEK_READ_JS = `
  var DS_ANSWER_CONTENT = ${JSON.stringify(DEEPSEEK_ANSWER_CONTENT_SELECTOR)};

  function dsAnswerText(row) {
    var content = row ? row.querySelector(DS_ANSWER_CONTENT) : null;
    return content ? (content.innerText || '').trim() : '';
  }

  /** The answer's own controls: role=button nodes in its row, outside the message body. */
  function dsActionButtons(row) {
    if (!row) return [];
    var out = [];
    var all = row.querySelectorAll('[role="button"]');
    var message = row.querySelector('.ds-message');
    for (var i = 0; i < all.length; i++) {
      if (message && message.contains(all[i])) continue;
      out.push(all[i]);
    }
    return out;
  }

  /** The copy control is the one whose icon cross-fades to a tick; the first control otherwise. */
  function dsCopyControl(row) {
    var buttons = dsActionButtons(row);
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].querySelector('.ds-cross-fade')) return buttons[i];
    }
    return buttons.length ? buttons[0] : null;
  }

  function dsCopyMarkdown(button) {
    return new Promise(function(resolve) {
      var done = false;
      var original = document.execCommand;
      var restores = [];
      var timer;
      function intercept(target, key, replacement) {
        var descriptor = Object.getOwnPropertyDescriptor(target, key);
        Object.defineProperty(target, key, { configurable: true, writable: true, value: replacement });
        restores.push(function() {
          if (descriptor) Object.defineProperty(target, key, descriptor);
          else delete target[key];
        });
      }
      function finish(text) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        while (restores.length) {
          try { restores.pop()(); } catch (e) {}
        }
        resolve(text || '');
      }
      function copyCommand(command) {
        if (String(command).toLowerCase() === 'copy') {
          var active = document.activeElement;
          var text = '';
          if (active && typeof active.value === 'string') {
            var start = active.selectionStart || 0;
            var end = active.selectionEnd || 0;
            text = end > start ? active.value.slice(start, end) : active.value;
          }
          if (!text) text = String(window.getSelection ? window.getSelection() : '');
          finish(text);
          return true;
        }
        return typeof original === 'function' ? original.apply(document, arguments) : false;
      }
      try {
        intercept(document, 'execCommand', copyCommand);
        var clipboard = navigator.clipboard;
        if (clipboard && typeof clipboard.writeText === 'function') {
          intercept(clipboard, 'writeText', function(text) {
            finish(String(text));
            return Promise.resolve();
          });
        }
      } catch (e) {
        // Do not click if either available clipboard path could still write to the user's clipboard.
        finish('');
        return;
      }
      timer = setTimeout(function() { finish(''); }, 2000);
      try { button.click(); } catch (e) { finish(''); }
    });
  }

  function dsConversationPath() {
    return /^\\/a\\/chat\\/s\\/[^/]+/.test(location.pathname) ? location.pathname : '';
  }

  async function dsReadTitle() {
    var deadline = Date.now() + ${TITLE_WAIT_MS};
    while (true) {
      var title = (document.title || '').trim();
      var match = /^(.*\\S)\\s+-\\s+DeepSeek$/.exec(title);
      if (match) return match[1];
      if (Date.now() >= deadline) return '';
      await sleep(200);
    }
  }

  async function deepseekWaitAndRead(submitted, opts) {
    opts = opts || {};
    var quietMs = opts.quietMs === undefined ? ${QUIET_MS} : opts.quietMs;
    var baseline = submitted.baseline;
    var conversation = dsConversationPath();

    function leftConversation() {
      var now = dsConversationPath();
      if (!conversation) { conversation = now; return false; }
      return now !== conversation;
    }
    function checkConversation() {
      if (leftConversation()) throw new Error('${DEEPSEEK_LEFT_CONVERSATION}: DeepSeek page moved to another conversation');
    }

    // waitFor swallows a throw from its condition, so leaving ends the wait and is raised after it.
    var left = false;
    await waitFor(function() {
      if (leftConversation()) { left = true; return true; }
      return dsAnswerAfter(baseline);
    }, 'new DeepSeek response', TIMEOUT, 250);
    if (left) checkConversation();

    var lastLen = -1;
    var lastChange = Date.now();
    while (true) {
      checkConversation();
      var row = dsAnswerAfter(baseline);
      var generating = dsIsGenerating();
      if (row && !generating && dsActionButtons(row).length > 0) break;
      var len = row ? (row.innerText || '').length : 0;
      if (len !== lastLen) { lastLen = len; lastChange = Date.now(); }
      if (!generating && len > 0 && Date.now() - lastChange >= quietMs) break;
      if (Date.now() - lastChange > TIMEOUT) throw new Error('Timeout: DeepSeek response stopped updating');
      await sleep(300);
    }

    var answerRow = dsAnswerAfter(baseline);
    var copy = dsCopyControl(answerRow);
    var copied = copy ? (await dsCopyMarkdown(copy)).trim() : '';
    var response = copied || dsAnswerText(answerRow);
    if (!response) throw new Error('DeepSeek response is empty');
    return { response: response, title: await dsReadTitle() };
  }
`;
