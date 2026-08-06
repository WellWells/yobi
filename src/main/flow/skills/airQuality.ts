import { sendLog } from '../../helpers';
import { getLangCache, t } from '../../i18n';
import { DATA_KEY_MOENV, getDataKey } from '../../dataKeyStore';
import { aqiI18nKey, aqiLevel, aqiStatusEn, haversineKm, normalizeMoenvStatus } from '../../../shared/aqiScale';
import { envelope, fetchJson, geocodePlace } from './dataSources';
import type { GeocodedPlace } from './dataSources';

const OPEN_METEO_AQ = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const MOENV_AQI = 'https://data.moenv.gov.tw/api/v2/aqx_p_432';

const MAX_STATION_KM = 50;

interface Reading {
  location: string;
  station: string;
  aqi: number | null;
  level: number;
  pollutant: string;
  pm2_5: number | null;
  pm10: number | null;
  ozone: number | null;
  no2: number | null;
  so2: number | null;
  co: number | null;
  gasUnits: string;
  europeanAqi: number | null;
  source: 'open-meteo' | 'moenv';
  observedAt: string;
}

function num(raw: unknown): number | null {
  const n = Number(String(raw ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

function str(value: number | null): string {
  return value == null ? '' : String(value);
}

function buildEnvelope(r: Reading): string {
  const statusLocal = r.level === 0
    ? ''
    : t(getLangCache(), aqiI18nKey(r.level));
  const json = JSON.stringify({
    location: r.location,
    station: r.station,
    aqi: r.aqi,
    level: r.level,
    status: aqiStatusEn(r.level),
    statusLocal,
    pollutant: r.pollutant,
    pm2_5: r.pm2_5,
    pm10: r.pm10,
    ozone: r.ozone,
    no2: r.no2,
    so2: r.so2,
    co: r.co,
    gasUnits: r.gasUnits,
    europeanAqi: r.europeanAqi,
    source: r.source,
    observedAt: r.observedAt,
  });
  return envelope(json, {
    location: r.location,
    station: r.station,
    aqi: str(r.aqi),
    level: String(r.level),
    status: aqiStatusEn(r.level),
    statusLocal,
    pollutant: r.pollutant,
    pm2_5: str(r.pm2_5),
    pm10: str(r.pm10),
    europeanAqi: str(r.europeanAqi),
    source: r.source,
    observedAt: r.observedAt,
    isFailed: '0',
  });
}

async function readOpenMeteo(place: GeocodedPlace, timeoutMs: number): Promise<Reading | null> {
  const url = `${OPEN_METEO_AQ}?latitude=${place.latitude}&longitude=${place.longitude}`
    + '&current=us_aqi,european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide'
    + '&timezone=auto';
  const data = await fetchJson(url, timeoutMs) as { current?: Record<string, number> };
  const cur = data.current;
  if (!cur) return null;
  const aqi = num(cur.us_aqi);
  return {
    location: place.displayName,
    station: '',
    aqi,
    level: aqi == null ? 0 : aqiLevel(aqi),
    pollutant: '',
    pm2_5: num(cur.pm2_5),
    pm10: num(cur.pm10),
    ozone: num(cur.ozone),
    no2: num(cur.nitrogen_dioxide),
    so2: num(cur.sulphur_dioxide),
    co: num(cur.carbon_monoxide),
    gasUnits: 'µg/m³',
    europeanAqi: num(cur.european_aqi),
    source: 'open-meteo',
    observedAt: String(cur.time ?? ''),
  };
}

interface MoenvRecord {
  sitename?: string;
  county?: string;
  aqi?: string;
  pollutant?: string;
  status?: string;
  'pm2.5'?: string;
  pm10?: string;
  o3?: string;
  no2?: string;
  so2?: string;
  co?: string;
  longitude?: string;
  latitude?: string;
  siteid?: string;
  publishtime?: string;
}

export function pickNearestStation(
  lat: number,
  lon: number,
  records: MoenvRecord[],
): { record: MoenvRecord; km: number } | null {
  let best: { record: MoenvRecord; km: number } | null = null;
  const seen = new Set<string>();
  for (const record of records) {
    const id = String(record.siteid ?? record.sitename ?? '');
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const sLat = num(record.latitude);
    const sLon = num(record.longitude);
    if (sLat == null || sLon == null) continue;
    const km = haversineKm(lat, lon, sLat, sLon);
    if (!best || km < best.km) best = { record, km };
  }
  return best;
}

async function readMoenv(place: GeocodedPlace, apiKey: string, timeoutMs: number): Promise<Reading | null> {
  const url = `${MOENV_AQI}?api_key=${encodeURIComponent(apiKey)}&limit=1000&sort=ImportDate%20desc&format=JSON`;
  const data = await fetchJson(url, timeoutMs) as { records?: MoenvRecord[] };
  const records = Array.isArray(data.records) ? data.records : [];
  if (records.length === 0) return null;

  const nearest = pickNearestStation(place.latitude, place.longitude, records);
  if (!nearest) return null;
  if (nearest.km > MAX_STATION_KM) {
    sendLog(`🌫️ [Flow] Air quality: nearest MOENV station is ${Math.round(nearest.km)} km away — using the global source`);
    return null;
  }

  const r = nearest.record;
  const aqi = num(r.aqi);
  const level = aqi == null ? normalizeMoenvStatus(r.status ?? '') : aqiLevel(aqi);
  const county = (r.county ?? '').trim();
  const site = (r.sitename ?? '').trim();
  return {
    location: place.displayName,
    station: county && site ? `${county}${site}` : site,
    aqi,
    level,
    pollutant: (r.pollutant ?? '').trim(),
    pm2_5: num(r['pm2.5']),
    pm10: num(r.pm10),
    ozone: num(r.o3),
    no2: num(r.no2),
    so2: num(r.so2),
    co: num(r.co),
    gasUnits: 'ppb (CO: ppm)',
    europeanAqi: null,
    source: 'moenv',
    observedAt: (r.publishtime ?? '').trim(),
  };
}

export async function execAirQuality(config: Record<string, string>, timeoutMs: number): Promise<string> {
  const location = (config.location ?? '').trim();
  const source = config.source === 'global' || config.source === 'taiwan' ? config.source : 'auto';

  const fail = (message: string): string => {
    sendLog(`🌫️ [Flow] Air quality: ${message}`);
    return envelope(message, { location, level: '0', isFailed: '1' });
  };

  if (!location) return fail('air_quality: a location is required');

  try {
    const place = await geocodePlace(location, timeoutMs);
    if (!place) return fail(`air_quality: location not found "${location}"`);

    const apiKey = getDataKey(DATA_KEY_MOENV).trim();
    const wantsTaiwan = source === 'taiwan' || (source === 'auto' && place.countryCode === 'TW');
    if (wantsTaiwan && !apiKey) {
      sendLog('🌫️ [Flow] Air quality: no MOENV API key set — using the global source');
    }

    let reading: Reading | null = null;
    if (wantsTaiwan && apiKey) {
      try {
        reading = await readMoenv(place, apiKey, timeoutMs);
      } catch (err) {
        sendLog(`🌫️ [Flow] Air quality: MOENV unavailable (${err instanceof Error ? err.message : String(err)}) — using the global source`);
      }
    }
    if (!reading) reading = await readOpenMeteo(place, timeoutMs);
    if (!reading) return fail(`air_quality: no data for "${place.displayName}"`);

    const where = reading.station || reading.location;
    sendLog(`🌫️ [Flow] Air quality: ${where} AQI ${reading.aqi ?? '—'} ${aqiStatusEn(reading.level)} (${reading.source})`);
    return buildEnvelope(reading);
  } catch (err) {
    return fail(`air quality source unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
}
