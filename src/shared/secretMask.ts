interface SecretPattern {
  re: RegExp;
  label: string;
}

/**
 * Last-line redaction of tool output. It inspects the output, so it does not care how a path was
 * spelled or whether a script wrote the file; it cannot beat encoded output (base64, chunking).
 *
 * Three passes, in increasing order of what they assume:
 *   1. STRUCTURED: a known vendor prefix.
 *   2. KEY-SHAPE: the field name marks a credential (`"access_token": "…"`, `API_KEY=…`,
 *      `Authorization: Bearer …`), whatever the value looks like.
 *   3. ENTROPY: a long high-entropy run with no name and no prefix.
 */

const STRUCTURED: SecretPattern[] = [
  { re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, label: 'PRIVATE KEY' },
  { re: /"private_key"\s*:\s*"(?:[^"\\]|\\.)*"/g, label: 'PRIVATE KEY' },
  { re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, label: 'AWS KEY' },
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g, label: 'TOKEN' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, label: 'TOKEN' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, label: 'TOKEN' },
  { re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, label: 'TOKEN' },
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, label: 'TOKEN' },
  // Vendors whose credentials commonly sit in files an agent is pointed at.
  { re: /\b(?:ntn|secret)_[A-Za-z0-9]{40,}\b/g, label: 'TOKEN' },
  { re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, label: 'TOKEN' },
  { re: /\bdop_v1_[a-f0-9]{64}\b/g, label: 'TOKEN' },
  { re: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, label: 'JWT' },
];

/**
 * Field names that make the value beside them a credential, whatever it looks like. Exact-ish words,
 * not a substring match on "key", so ordinary JSON like `{"monkey": "banana"}` passes untouched.
 */
const CREDENTIAL_WORD = '(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|'
  + 'api[_-]?key|apikey|auth[_-]?token|session[_-]?token|secret[_-]?key|private[_-]?key|'
  + 'password|passwd|passphrase|credential|authorization|bearer|token|secret)';

const KEY_SHAPE: SecretPattern[] = [
  // JSON / YAML: "access_token": "…"   or   access_token: "…"
  {
    re: new RegExp(`("?\\b${CREDENTIAL_WORD}"?\\s*[:=]\\s*")([^"\\n]{6,})(")`, 'gi'),
    label: 'SECRET',
  },
  // .env / ini / shell export:  API_KEY=…    SOME_TOKEN = …
  {
    re: new RegExp(`^(\\s*(?:export\\s+)?[A-Za-z0-9_.-]*${CREDENTIAL_WORD}[A-Za-z0-9_.-]*\\s*=\\s*)(\\S{6,})$`, 'gim'),
    label: 'SECRET',
  },
  // HTTP header, in a curl line or a response dump.
  { re: /\b(Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)(\S{6,})/gi, label: 'SECRET' },
  // Command-line flags that carry a secret inline.
  { re: /(\s--?(?:password|token|api[-_]?key|secret)[= ])(\S{6,})/gi, label: 'SECRET' },
  // A URL query parameter. Needed because URLs are exempt from the entropy pass below, so this
  // is the only rule that sees a token handed over in a link.
  {
    re: new RegExp(`([?&]${CREDENTIAL_WORD}=)([^&\\s"']{6,})`, 'gi'),
    label: 'SECRET',
  },
];

function redactStructured(text: string): string {
  let out = text;
  for (const { re, label } of STRUCTURED) out = out.replace(re, `[REDACTED ${label}]`);
  return out;
}

function redactKeyShapes(text: string): string {
  let out = text;
  for (const { re, label } of KEY_SHAPE) {
    // A two-group rule hands the match OFFSET to the third parameter; only a string is a tail.
    out = out.replace(re, (_match, lead: string, _value: string, tail: unknown) =>
      `${lead}[REDACTED ${label}]${typeof tail === 'string' ? tail : ''}`);
  }
  return out;
}

function entropyPerChar(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * Two token shapes, because one class cannot cover both without eating ordinary text. `BASE64ISH`
 * covers plain base64/hex runs; `COMPOSITE` adds `:` and `.` so a token built from parts is one run,
 * and excludes `/` and `\` so long URLs and Windows paths do not qualify.
 */
const BASE64ISH = /[A-Za-z0-9+/=_-]{40,}/g;
const COMPOSITE = /[A-Za-z0-9+=_.:-]{40,}/g;
const ENTROPY_THRESHOLD = 3.5;

/**
 * URLs are held out of the entropy pass: `BASE64ISH` includes `/`, so a long link's path reads as a
 * high-entropy run and would be destroyed. Safe only because credentials in a URL are caught by
 * name instead (the query-parameter rule in KEY_SHAPE).
 */
const URL_RUN = /\bhttps?:\/\/[^\s"'<>)\]]+/gi;

function redactHighEntropy(text: string): string {
  const redact = (match: string): string =>
    (entropyPerChar(match) >= ENTROPY_THRESHOLD ? '[REDACTED SECRET]' : match);

  const urls: string[] = [];
  const parked = text.replace(URL_RUN, (url) => {
    urls.push(url);
    return `\u0000URL${urls.length - 1}\u0000`;
  });
  const scanned = parked.replace(BASE64ISH, redact).replace(COMPOSITE, redact);
  return scanned.replace(/\u0000URL(\d+)\u0000/g, (_m, i: string) => urls[Number(i)] ?? '');
}

/**
 * `localSource` says the bytes came from the user's own machine (a file, the clipboard, sysinfo,
 * a shell command) rather than from a web page. Only those get the entropy pass, because a web
 * page is full of long opaque identifiers that are not secrets and redacting them would make the
 * observation worthless.
 *
 * The first two passes run on EVERYTHING. A credential named by its own field is a credential
 * whether it arrived from disk or from an API response.
 */
export function maskSecrets(text: string, localSource: boolean): string {
  if (!text) return text;
  const named = redactKeyShapes(redactStructured(text));
  return localSource ? redactHighEntropy(named) : named;
}
