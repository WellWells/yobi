import { FlowUserError } from '../flow/userError';

/*
 * A page that is a site's "are you human?" wall instead of the page asked for: Cloudflare's
 * challenge, DataDome's, PerimeterX's. Nobody answers it on an
 * unattended read (a search, a schedule, a bot message), so the read skips the page rather than
 * hand the wall's text on as if it were the page: a model took it for the content, and the text
 * typed into an AI site's chat made that site's own wall check fire on the chat.
 *
 * Told by structure, never by words alone: Cloudflare loads its detection script
 * (`/cdn-cgi/challenge-platform/scripts/jsd/…`) on every normal page and pages may embed Turnstile
 * in a form, so only the challenge's own marks count, and only on a page with almost no text (a
 * passed challenge can leave its variable behind on the real page).
 */

const WALL_MARKS: readonly RegExp[] = [
  /\b_cf_chl_opt\b/,
  /\/cdn-cgi\/challenge-platform\/[^"'\s]*\/orchestrate\//,
  /\bid=["']?challenge-form\b/,
  /\bcf-browser-verification\b/,
  // DataDome's challenge (its normal-page tag is `js.datadome.co`).
  /\bcaptcha-delivery\.com\b/,
  /\bid=["']?px-captcha\b/,
  // 36kr's own firewall. Its leading `__` keeps `\b` off this one.
  /\bid=["']?__waf_verification_challenge\b/,
  // ByteDance's firewall (juejin): a proof-of-work script, 2.4 KB and no text.
  /\b_wafchallengeid\b/,
];

/** A wall's own text is a sentence or two; a real page past one this short is rare. */
export const WALL_MAX_TEXT_CHARS = 1_500;

/** Whether `html` is a verification wall; `textChars` is the length of its readable text. */
export function isVerificationWall(html: string, textChars: number): boolean {
  if (textChars >= WALL_MAX_TEXT_CHARS) return false;
  return WALL_MARKS.some((mark) => mark.test(html));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

/**
 * The English diagnostic, which `/agent` reads as its observation: it says to move on, so the
 * model reads another source instead of retrying the page or reporting the wall as its content.
 */
export function verificationWallMessage(site: string): string {
  return `${site} shows a human-verification check that cannot be answered unattended — skip this page and use another source`;
}

export class VerificationWallError extends FlowUserError {
  constructor(url: string) {
    const site = hostOf(url);
    super('flow.error.verificationWall', { site }, verificationWallMessage(site));
    this.name = 'VerificationWallError';
  }
}
