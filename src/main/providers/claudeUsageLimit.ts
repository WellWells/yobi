/*
 * claude.ai's usage limit, measured 2026-09-18 on a Free account that had run out.
 *
 * Every marker is an attribute or a data shape; the notice text is localized and is only quoted
 * back when no reset time can be read.
 */
export const CLAUDE_USAGE_LIMIT = 'CLAUDE_USAGE_LIMIT';

export interface ClaudeUsageLimitState {
  /** The composer notice whose Upgrade link carries `from=ratelimit`. */
  notice: boolean;
  /** The upgrade dialog a rejected send opens. */
  dialog: boolean;
  /** Epoch ms from the limit record the page keeps, when it says the wall is hit. */
  resetsAt: number | null;
  noticeText: string;
}

/**
 * Defines `claudeUsageLimit()` → `ClaudeUsageLimitState`, `claudeLimitShown()` (any signal, for
 * explaining a send that already failed) and `claudeLimitError()`. The limit record lives under a
 * codename key (`claudeai.<codename>.<org>`), so it is found by its shape rather than its name.
 */
export const CLAUDE_USAGE_LIMIT_JS = `function claudeLimitError() {
  return new Error(${JSON.stringify(`${CLAUDE_USAGE_LIMIT}: Claude usage limit reached`)});
}
function claudeLimitShown() {
  var limit = claudeUsageLimit();
  return limit.notice || limit.dialog || limit.resetsAt !== null;
}
function claudeUsageLimit() {
  function flat(el) { return el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : ''; }
  function wallResetsAt() {
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    } catch (e) { return null; }
    for (var j = 0; j < keys.length; j++) {
      if (!keys[j] || keys[j].indexOf('claudeai.') !== 0) continue;
      var record;
      try { record = JSON.parse(localStorage.getItem(keys[j]) || 'null'); } catch (e) { continue; }
      if (!record || record.atWall !== true || typeof record.resetsAt !== 'number') continue;
      var ms = record.resetsAt * 1000;
      if (ms > Date.now()) return ms;
    }
    return null;
  }
  var link = document.querySelector('[data-cds="ChatComposerNotices"] a[href*="from=ratelimit"]');
  var text = flat(link ? link.closest('[data-cds="Banner"]') : null);
  var cta = flat(link);
  if (cta && text.slice(-cta.length) === cta) text = text.slice(0, -cta.length).trim();
  return {
    notice: !!link,
    dialog: !!document.querySelector('[data-cds="Dialog"] #rate-limit-risk-reversal'),
    resetsAt: wallResetsAt(),
    noticeText: text,
  };
}`;

export const CLAUDE_READ_USAGE_LIMIT_JS = `(function () {
  ${CLAUDE_USAGE_LIMIT_JS}
  return claudeUsageLimit();
})()`;

/**
 * Refusing before the send takes an on-screen signal and an unexpired record: the notice alone
 * may be a nearing-the-limit warning, the dialog may outlive the reset, and the record alone may
 * be stale after an upgrade.
 */
export function claudeLimitBlocksSend(state: ClaudeUsageLimitState): boolean {
  return (state.notice || state.dialog) && state.resetsAt !== null;
}

export function claudeUsageLimitError(state: Pick<ClaudeUsageLimitState, 'resetsAt' | 'noticeText'>): Error {
  const reset = state.resetsAt === null ? '' : ` (resets ${new Date(state.resetsAt).toISOString()})`;
  const notice = state.resetsAt === null && state.noticeText ? ` — ${state.noticeText}` : '';
  return new Error(`${CLAUDE_USAGE_LIMIT}: Claude usage limit reached${reset}${notice}`);
}

export interface ParsedClaudeUsageLimit {
  resetsAt: number | null;
  noticeText: string;
}

/** Reads `claudeUsageLimitError()` back out of a message, wherever a caller wrapped it. */
export function parseClaudeUsageLimit(message: string): ParsedClaudeUsageLimit | null {
  const at = message.indexOf(`${CLAUDE_USAGE_LIMIT}:`);
  if (at < 0) return null;
  const rest = message.slice(at);
  const reset = /\(resets (\d{4}-\d{2}-\d{2}T[\d:.]+Z)\)/.exec(rest);
  const resetsAt = reset ? Date.parse(reset[1]) : Number.NaN;
  const notice = / — (.+)$/.exec(rest);
  return {
    resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
    noticeText: notice ? notice[1].trim() : '',
  };
}

export function isClaudeUsageLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.includes(`${CLAUDE_USAGE_LIMIT}:`);
}

/** Time of day in the system locale, with the date only when the reset is not today. */
export function formatResetTime(resetsAt: number, now = Date.now(), locale?: string): string {
  const reset = new Date(resetsAt);
  const today = new Date(now);
  const sameDay = reset.getFullYear() === today.getFullYear()
    && reset.getMonth() === today.getMonth()
    && reset.getDate() === today.getDate();
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat(locale, options).format(reset);
}
