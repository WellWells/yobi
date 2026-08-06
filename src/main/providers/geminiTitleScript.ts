export const GEMINI_TITLE_TIMEOUT_MS = 2_500;

const POLL_MS = 200;

export function buildGeminiTitleScript(timeoutMs: number = GEMINI_TITLE_TIMEOUT_MS): string {
  return `(async function geminiTitle() {
  var DEADLINE = Date.now() + ${timeoutMs};

  function idOf(href) {
    var match = /\\/app\\/([A-Za-z0-9_-]+)/.exec(href || '');
    return match ? match[1] : '';
  }

  function rowTitle(row) {
    if (!row) return '';
    var el = row.querySelector('.title-text');
    var text = el && el.textContent ? el.textContent : (row.getAttribute('aria-label') || '');
    return String(text).replace(/\\s+/g, ' ').trim();
  }

  function findRow() {
    var wanted = idOf(location.pathname);
    var rows = document.querySelectorAll('a[href*="/app/"]');
    if (wanted) {
      for (var i = 0; i < rows.length; i++) {
        if (idOf(rows[i].getAttribute('href')) === wanted) return rows[i];
      }
      // The URL names a thread the sidebar has not listed yet — waiting for the
      // right row beats reading whichever one is currently highlighted.
      return null;
    }
    // No id in the URL yet (a new chat mid-creation): the highlighted row is the
    // only thing that can identify this conversation.
    return document.querySelector('a[aria-current="page"][href*="/app/"]');
  }

  for (;;) {
    var title = rowTitle(findRow());
    if (title) return title;
    if (Date.now() >= DEADLINE) return '';
    await new Promise(function (resolve) { setTimeout(resolve, ${POLL_MS}); });
  }
})()`;
}
