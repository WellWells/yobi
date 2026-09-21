import type { SkillType } from './types';

/**
 * Why a step failed, in the words a user would use to fix it. Deliberately coarse: every extra
 * bucket is one more thing to keep accurate against provider messages that change without notice,
 * and a bucket nobody can act on differently is not worth the maintenance.
 */
export const FLOW_ERROR_REASONS = [
  'timeout',
  'network',
  'auth',
  'http',
  'not_found',
  'parse',
  'script',
  'input',
  'blocked',
  'other',
] as const;

export type FlowErrorReason = (typeof FLOW_ERROR_REASONS)[number];

/** Steps whose own code is the likely culprit, so an unrecognised message lands on `script`. */
const SCRIPT_SKILLS = new Set<SkillType>(['js', 'browser_js', 'shell', 'run']);

/**
 * Matched top to bottom, first hit wins, so the order IS the classification policy:
 *
 * - `blocked` leads because a verification challenge often also mentions a status code, and
 *   "the site is fighting us off" is a different fix from "the request was wrong".
 * - `auth` precedes `http` so 401/403 reads as a sign-in problem rather than a generic 4xx.
 * - `not_found` claims 404 before `http` does: a page that is gone is a content problem.
 * - `timeout` precedes `network` because `ERR_CONNECTION_TIMED_OUT` and `ETIMEDOUT` are both,
 *   and "it was too slow" is the actionable half.
 */
const REASON_PATTERNS: ReadonlyArray<readonly [FlowErrorReason, RegExp]> = [
  ['blocked', /cloudflare|captcha|verification challenge|are you a robot|access denied|sandbox|not allowed|outside the allowed|blocked by|ssrf|private address|loopback address/i],
  ['auth', /\b(401|403)\b|unauthorized|forbidden|permission denied|sign in|signed out|not logged in|login required|invalid api key|api key not valid|credential|token (has )?expired/i],
  ['not_found', /\b404\b|no (items|results|matches|entries|transcript|content|text|data)\b|not found|no such|nothing matched|no matching|selector|empty (result|response|page|feed)|returned nothing/i],
  ['http', /\bhttp\s*[45]\d{2}\b|status(?: code)?\s*[45]\d{2}|\b(429|500|502|503|504)\b|rate limit|too many requests|quota|over capacity|model is (not available|overloaded)/i],
  // `timed[ _-]?out` so Chromium's ERR_CONNECTION_TIMED_OUT reads as slow rather than unreachable.
  ['timeout', /timed[ _-]?out|timeout|etimedout|esockettimedout|deadline exceeded/i],
  // Both wordings: Chromium says "Failed to fetch", Node's undici says "fetch failed".
  ['network', /err_[a-z_]+|enotfound|econnrefused|econnreset|econnaborted|eai_again|ehostunreach|enetunreach|epipe|network error|failed to fetch|fetch failed|socket hang up|dns|unable to (connect|reach)|no internet/i],
  ['parse', /\bjson\b|\bxml\b|unexpected token|unexpected end of|malformed|invalid (json|xml|rss|feed|response)|could not parse|failed to parse/i],
  ['script', /exit code|exited with|non-?zero|referenceerror|typeerror|syntaxerror|rangeerror|is not a function|is not defined|cannot read (property|properties)|command failed|script (error|failed)/i],
  ['input', /required|is missing|missing \w+|is empty|no (url|path|file|recipient|target|query|prompt) /i],
];

/**
 * Trims what a step threw down to something that can ride back to whoever sent the bot command.
 *
 * A failed command used to answer with nothing but "the flow failed", which is unactionable when
 * the cause is a mistyped group name. The message is a diagnostic string, not prose, so this
 * only flattens the whitespace and caps the length — reshaping it would be guessing at a format
 * that every skill writes differently.
 */
export function summarizeFlowError(message: string | undefined, maxChars = 300): string {
  const text = (message ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trimEnd()}\u2026`;
}

/**
 * `message` is whatever the step threw, so it may be a provider's JSON error body, a Chromium
 * `ERR_*` code, or a sentence we wrote ourselves. Nothing here assumes a shape.
 */
export function classifyFlowError(type: SkillType, message: string | undefined): FlowErrorReason {
  const text = (message ?? '').trim();
  if (!text) return SCRIPT_SKILLS.has(type) ? 'script' : 'other';
  for (const [reason, pattern] of REASON_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return SCRIPT_SKILLS.has(type) ? 'script' : 'other';
}
