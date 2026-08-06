export const AQI_LEVEL = {
  good: 1,
  moderate: 2,
  unhealthySensitive: 3,
  unhealthy: 4,
  veryUnhealthy: 5,
  hazardous: 6,
} as const;

const BANDS: ReadonlyArray<readonly [number, number]> = [
  [50, AQI_LEVEL.good],
  [100, AQI_LEVEL.moderate],
  [150, AQI_LEVEL.unhealthySensitive],
  [200, AQI_LEVEL.unhealthy],
  [300, AQI_LEVEL.veryUnhealthy],
];

export const AQI_STATUS_EN: Record<number, string> = {
  0: 'Unknown',
  1: 'Good',
  2: 'Moderate',
  3: 'Unhealthy for Sensitive Groups',
  4: 'Unhealthy',
  5: 'Very Unhealthy',
  6: 'Hazardous',
};

export const AQI_I18N_KEYS: Record<number, string> = {
  0: 'aqi.status.0',
  1: 'aqi.status.1',
  2: 'aqi.status.2',
  3: 'aqi.status.3',
  4: 'aqi.status.4',
  5: 'aqi.status.5',
  6: 'aqi.status.6',
};

export function aqiLevel(aqi: number): number {
  if (!Number.isFinite(aqi) || aqi < 0) return 0;
  for (const [max, level] of BANDS) {
    if (aqi <= max) return level;
  }
  return AQI_LEVEL.hazardous;
}

export function aqiStatusEn(level: number): string {
  return AQI_STATUS_EN[level] ?? AQI_STATUS_EN[0];
}

export function aqiI18nKey(level: number): string {
  return AQI_I18N_KEYS[level] ?? AQI_I18N_KEYS[0];
}

const MOENV_STATUS_LEVEL: Record<string, number> = {
  良好: AQI_LEVEL.good,
  普通: AQI_LEVEL.moderate,
  對敏感族群不健康: AQI_LEVEL.unhealthySensitive,
  對所有族群不健康: AQI_LEVEL.unhealthy,
  非常不健康: AQI_LEVEL.veryUnhealthy,
  危害: AQI_LEVEL.hazardous,
};

export function normalizeMoenvStatus(raw: string): number {
  return MOENV_STATUS_LEVEL[(raw ?? '').trim()] ?? 0;
}

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
