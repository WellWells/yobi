export const SHARE_EXPIRE_VALUES = [
  '5min', '10min', '1hour', '3hour', '6hour', '12hour', '1day', '3day', '1week', '1month', '1year', 'never',
] as const;
export type ShareExpire = (typeof SHARE_EXPIRE_VALUES)[number];

export const SHARE_EXPIRE_SECONDS: Record<ShareExpire, number> = {
  '5min': 300,
  '10min': 600,
  '1hour': 3_600,
  '3hour': 10_800,
  '6hour': 21_600,
  '12hour': 43_200,
  '1day': 86_400,
  '3day': 259_200,
  '1week': 604_800,
  '1month': 2_592_000,
  '1year': 31_536_000,
  never: Number.POSITIVE_INFINITY,
};

export const DEFAULT_SHARE_INSTANCE = 'https://privatebin.net';

export const DEFAULT_INSTANCE_EXPIRES: readonly ShareExpire[] = [
  '5min', '10min', '1hour', '3hour', '6hour', '12hour', '1day', '3day',
];

export const PRIVATEBIN_DEFAULT_EXPIRES: readonly ShareExpire[] = [
  '5min', '10min', '1hour', '1day', '1week', '1month', '1year', 'never',
];

export interface ShareExpireCache {
  url: string;
  values: ShareExpire[];
}

function sameInstance(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/\/+$/, '') === b.trim().toLowerCase().replace(/\/+$/, '');
}

export function isShareExpire(value: unknown): value is ShareExpire {
  return typeof value === 'string' && (SHARE_EXPIRE_VALUES as readonly string[]).includes(value);
}

export function normalizeShareExpireList(values: readonly unknown[]): ShareExpire[] {
  const wanted = new Set(values.filter(isShareExpire));
  return SHARE_EXPIRE_VALUES.filter((value) => wanted.has(value));
}

export function resolveShareExpires(
  instanceUrl: string,
  cache: ShareExpireCache | null | undefined,
): readonly ShareExpire[] {
  if (cache && cache.values.length > 0 && sameInstance(cache.url, instanceUrl)) return cache.values;
  if (sameInstance(instanceUrl, DEFAULT_SHARE_INSTANCE)) return DEFAULT_INSTANCE_EXPIRES;
  return PRIVATEBIN_DEFAULT_EXPIRES;
}

export function clampShareExpire(
  expire: ShareExpire,
  supported: readonly ShareExpire[],
): ShareExpire {
  if (supported.length === 0 || supported.includes(expire)) return expire;
  const wanted = SHARE_EXPIRE_SECONDS[expire];
  const below = supported.filter((value) => SHARE_EXPIRE_SECONDS[value] <= wanted);
  if (below.length === 0) {
    return supported.reduce((best, value) =>
      (SHARE_EXPIRE_SECONDS[value] < SHARE_EXPIRE_SECONDS[best] ? value : best));
  }
  return below.reduce((best, value) =>
    (SHARE_EXPIRE_SECONDS[value] > SHARE_EXPIRE_SECONDS[best] ? value : best));
}
