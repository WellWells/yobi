const VAR_ONLY = /^\{\{[^}]+\}\}$/;
const HTTP = /^https?:\/\//i;

export function isValidUrlOrVar(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (VAR_ONLY.test(trimmed)) return true;
  return HTTP.test(trimmed);
}

export function isValidUrlListOrVar(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.every((u) => typeof u === 'string' && isValidUrlOrVar(u));
      }
    } catch {
      return false;
    }
  }
  const parts = trimmed.split(/[\n\r,]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return true;
  return parts.every((p) => isValidUrlOrVar(p));
}

const YT_HANDLE = /^@[\w.-]+$/;

export function isValidYoutubeChannelListOrVar(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.every((line) => VAR_ONLY.test(line) || HTTP.test(line) || YT_HANDLE.test(line));
}

export function isValidJsonOrEmpty(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (VAR_ONLY.test(trimmed)) return true;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function isValidYoutubeUrlOrVar(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (VAR_ONLY.test(trimmed)) return true;
  return HTTP.test(trimmed) && /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(trimmed);
}

export type OutputKeyError = 'format' | 'duplicate' | null;

export function validateOutputKey(key: string, siblingKeys: string[]): OutputKeyError {
  const trimmed = key.trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) return 'format';
  if (siblingKeys.includes(trimmed)) return 'duplicate';
  return null;
}
