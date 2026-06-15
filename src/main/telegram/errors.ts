export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const base = err.message?.trim() || err.name || 'unknown error';
    const nested = extractNestedErrorDetail(err);
    if (!nested || nested === base) return base;
    return `${base} (${nested})`;
  }
  return formatErrorDetail(err) ?? 'unknown error';
}

function extractNestedErrorDetail(err: Error): string | null {
  const maybeNested = err as Error & { error?: unknown; cause?: unknown };
  return formatErrorDetail(maybeNested.error) ?? formatErrorDetail(maybeNested.cause);
}

function formatErrorDetail(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.trim();
    return text || null;
  }
  if (value instanceof Error) {
    const text = value.message?.trim() || value.name;
    const code = readErrorCode(value);
    if (!text) return code ? `[${code}]` : null;
    if (!code || text.includes(code)) return text;
    return `${text} [${code}]`;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message.trim() : '';
  const code = typeof record.code === 'string' || typeof record.code === 'number'
    ? String(record.code)
    : '';
  if (message && code && !message.includes(code)) return `${message} [${code}]`;
  if (message) return message;
  if (code) return `[${code}]`;
  return null;
}

function readErrorCode(error: Error): string | null {
  const maybeCode = (error as Error & { code?: unknown }).code;
  if (typeof maybeCode === 'string' || typeof maybeCode === 'number') return String(maybeCode);
  return null;
}
