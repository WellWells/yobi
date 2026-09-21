interface SecretPattern {
  re: RegExp;
  label: string;
}

/**
 * The last layer, and with a shell tool in the allowlist it is the one that actually has to hold.
 *
 * Everything above it inspects a path or a command STRING, and a shell command has neither until
 * cmd.exe expands it. This inspects the OUTPUT, so it does not care how the path was spelled, whether
 * the file was renamed first, or whether a script wrote it. What it cannot beat is encoding: a
 * command that base64s or chunks its output defeats every rule here, and nothing in this file
 * pretends otherwise.
 *
 * It failed once in production and the failure shaped the design. A Notion OAuth token
 * (`<uuid>:<16 chars>:<32 chars>`) was printed verbatim: the only entropy rule ran on runs of
 * `[A-Za-z0-9+/=_-]` of length >= 40, the colons split it into 36/16/32, and nothing matched.
 * The Anthropic token in the same file WAS caught, purely because `sk-` is a known prefix — so the
 * generic half of the masker was doing no work at all.
 *
 * Three passes now, in increasing order of how much they assume:
 *   1. STRUCTURED — a known vendor prefix. Zero false positives, only catches what it knows.
 *   2. KEY-SHAPE  — the field NAME says it is a credential (`"access_token": "…"`, `API_KEY=…`,
 *      `Authorization: Bearer …`). This is what catches a token of a shape nobody has seen, and
 *      it is the pass that would have caught the Notion one, because the file is JSON.
 *   3. ENTROPY    — a long high-entropy run, for a bare secret with no name and no prefix.
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
  // Added with the shell tool: the vendors whose credentials sit in the files an agent is most
  // likely to be pointed at.
  { re: /\b(?:ntn|secret)_[A-Za-z0-9]{40,}\b/g, label: 'TOKEN' },
  { re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, label: 'TOKEN' },
  { re: /\bdop_v1_[a-f0-9]{64}\b/g, label: 'TOKEN' },
  { re: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, label: 'JWT' },
];

/**
 * Field names that make the value beside them a credential regardless of what it looks like.
 *
 * This is the pass that does not need to recognise the token, only the question it answers — which
 * is why it survives a vendor inventing a new format. Kept deliberately narrow on the NAME side
 * (an exact-ish word list, not a substring match on "key") so that ordinary JSON data is not
 * shredded: `{"monkey": "banana"}` must come through untouched.
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
    out = out.replace(re, (_match, lead: string, _value: string, tail?: string) =>
      `${lead}[REDACTED ${label}]${tail ?? ''}`);
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
 * Two token shapes, because one class cannot cover both without eating ordinary text.
 *
 * `BASE64ISH` is the original: a plain run, which covers base64 and hex secrets.
 * `COMPOSITE` adds `:` and `.` so a token assembled from parts — the shape that leaked — is seen
 * as ONE run instead of three short ones. It deliberately excludes `/` and `\`, because with them
 * a long URL and a Windows path both qualify, and redacting those makes observations useless.
 * Verified against `C:\Users\…\agentEngine.ts`, a 59-char article URL, `v20.11.1` and an ISO
 * timestamp: none of them matches.
 */
const BASE64ISH = /[A-Za-z0-9+/=_-]{40,}/g;
const COMPOSITE = /[A-Za-z0-9+=_.:-]{40,}/g;
const ENTROPY_THRESHOLD = 3.5;

/**
 * URLs are held out of the entropy pass, and this is a fix to a PRE-EXISTING false positive that
 * adding `shell` to the local-source set made routine. `BASE64ISH` contains `/`, so the tail of
 * any reasonably long link — `com/some/fairly/long/article-path-2026` — is a 40-character
 * high-entropy run, and `git remote -v`, `npm ls` or a pasted link came back as
 * `https://example.[REDACTED SECRET]`. An observation full of destroyed URLs is a failed run.
 *
 * Holding them out is only safe because the credential-bearing part of a URL is caught by NAME
 * instead: the query-parameter rule in KEY_SHAPE above.
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
