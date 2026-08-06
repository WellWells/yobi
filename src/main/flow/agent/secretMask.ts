interface SecretPattern {
  re: RegExp;
  label: string;
}

const STRUCTURED: SecretPattern[] = [
  { re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, label: 'PRIVATE KEY' },
  { re: /"private_key"\s*:\s*"(?:[^"\\]|\\.)*"/g, label: 'PRIVATE KEY' },
  { re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, label: 'AWS KEY' },
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g, label: 'TOKEN' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, label: 'TOKEN' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, label: 'TOKEN' },
  { re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, label: 'TOKEN' },
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, label: 'TOKEN' },
];

function redactStructured(text: string): string {
  let out = text;
  for (const { re, label } of STRUCTURED) out = out.replace(re, `[REDACTED ${label}]`);
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

const LONG_TOKEN = /[A-Za-z0-9+/=_-]{40,}/g;
const ENTROPY_THRESHOLD = 3.5;

function redactHighEntropy(text: string): string {
  return text.replace(LONG_TOKEN, (match) => (entropyPerChar(match) >= ENTROPY_THRESHOLD ? '[REDACTED SECRET]' : match));
}

export function maskSecrets(text: string, localSource: boolean): string {
  if (!text) return text;
  const structured = redactStructured(text);
  return localSource ? redactHighEntropy(structured) : structured;
}
