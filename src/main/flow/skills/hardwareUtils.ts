export const PROBE_TIMEOUT_MS = 6_000;
const BYTES_PER_GB = 1024 ** 3;

export function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return () => (cached ??= fn());
}

export function joinParts(parts: Array<string | number | null | undefined>, sep = ' '): string {
  return parts.map((p) => String(p ?? '').trim()).filter(Boolean).join(sep);
}

export function formatGb(bytes: number): string {
  return `${(bytes / BYTES_PER_GB).toFixed(bytes >= BYTES_PER_GB ? 0 : 1)} GB`;
}

export function formatMbAsGb(megabytes: number): string {
  const gb = megabytes / 1024;
  return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
}

export function formatDiskSize(bytes: number): string {
  const gb = bytes / BYTES_PER_GB;
  return gb >= 1000 ? `${(gb / 1024).toFixed(1)} TB` : `${gb.toFixed(0)} GB`;
}

function withTimeout(promise: Promise<string>): Promise<string> {
  return Promise.race([
    promise,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error('probe timed out')), PROBE_TIMEOUT_MS)),
  ]);
}

export function safe(fn: () => Promise<string>): Promise<string> {
  return withTimeout(fn())
    .then((value) => value.trim() || 'unknown')
    .catch(() => 'unknown');
}
