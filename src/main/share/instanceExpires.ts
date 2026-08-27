import { guardedFetch } from '../net/ssrfGuard';
import { normalizeInstanceUrl } from './privatebin';
import { clampShareExpire, normalizeShareExpireList, resolveShareExpires } from '../../shared/shareExpire';
import type { ShareExpire, ShareSettings } from '../../shared/types';

const PROBE_TIMEOUT_MS = 8_000;
const MAX_PROBE_BYTES = 512 * 1024;

export function parseExpireOptions(html: string): ShareExpire[] {
  const select = /<select\b[^>]*\bid=["']pasteExpiration["'][^>]*>([\s\S]*?)<\/select>/i.exec(html);
  if (!select) return [];
  const values: string[] = [];
  const option = /<option\b[^>]*\bvalue=["']([^"']*)["']/gi;
  let match = option.exec(select[1]);
  while (match) {
    values.push(match[1]);
    match = option.exec(select[1]);
  }
  return normalizeShareExpireList(values);
}

export async function probeInstanceExpires(instanceUrl: string): Promise<ShareExpire[] | null> {
  const base = normalizeInstanceUrl(instanceUrl);
  if (!base) return null;
  try {
    const res = await guardedFetch(`${base}/`, {
      method: 'GET',
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, MAX_PROBE_BYTES);
    const values = parseExpireOptions(html);
    return values.length > 0 ? values : null;
  } catch {
    return null;
  }
}

export function effectiveExpires(settings: ShareSettings): readonly ShareExpire[] {
  return resolveShareExpires(settings.instanceUrl, settings.instanceExpires);
}

export function effectiveExpire(settings: ShareSettings, requested: ShareExpire): ShareExpire {
  return clampShareExpire(requested, effectiveExpires(settings));
}
