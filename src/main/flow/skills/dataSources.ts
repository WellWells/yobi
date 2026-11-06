import { sendLog } from '../../helpers';
import { envelope, fetchJson } from './skillFetch';
import { forecastResult, forecastUrl, readForecastRequest, wmoText } from './weatherForecast';
import type { HourlyForecast } from './weatherForecast';

export {
  exchangeOffsetSec, formatExchangeTime, marketSession, quoteTimeOf, utcOffsetLabel,
} from './quoteTime';
export type { MarketSession } from './quoteTime';
export { envelope, fetchJson } from './skillFetch';
export { computeChange, execForex, execStock } from './market';
export { wmoText } from './weatherForecast';

export interface GeocodedPlace {
  displayName: string;
  countryCode: string;
  latitude: number;
  longitude: number;
}

export interface GeocoderResult {
  name?: string; country?: string; country_code?: string; latitude?: number; longitude?: number;
  feature_code?: string; population?: number;
}

const HAN = /\p{Script=Han}/u;
/** A zh-only match must be a capital, an admin seat, or a city this size to be trusted. */
const ZH_FALLBACK_MIN_POPULATION = 100_000;
const ZH_FALLBACK_SEAT_CODES = new Set(['PPLC', 'PPLA', 'PPLA2']);

async function searchGeocoder(name: string, language: 'en' | 'zh', count: number, timeoutMs: number): Promise<GeocoderResult[]> {
  const geo = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=${count}&language=${language}&format=json`,
    timeoutMs,
  ) as { results?: GeocoderResult[] };
  return (geo.results ?? []).filter((r) => typeof r.latitude === 'number' && typeof r.longitude === 'number');
}

function toPlace(place: GeocoderResult, location: string): GeocodedPlace {
  const countryCode = (place.country_code ?? '').toUpperCase();
  // The zh index names Taiwan in Simplified; the bundled table says 臺灣.
  const country = countryCode === 'TW' && HAN.test(place.country ?? '') ? '臺灣' : place.country;
  return {
    displayName: country ? `${place.name}, ${country}` : String(place.name ?? location),
    countryCode,
    latitude: place.latitude as number,
    longitude: place.longitude as number,
  };
}

/**
 * The zh index is where the wrong places hide: 紐約 is a Kentucky hamlet, 清境 a Guangxi
 * village, 东京 two Chinese ones. A Taiwan match wins; otherwise only a capital, an admin seat
 * or a sizeable city is believed, and anything less is "not found" rather than a wrong forecast.
 */
export function pickZhFallback(results: GeocoderResult[]): GeocoderResult | null {
  return results.find((r) => (r.country_code ?? '').toUpperCase() === 'TW')
    ?? results.find((r) => ZH_FALLBACK_SEAT_CODES.has(r.feature_code ?? '') || (r.population ?? 0) >= ZH_FALLBACK_MIN_POPULATION)
    ?? null;
}

/**
 * Chinese names try the bundled Taiwan table first (the geocoder's en index has no CJK names,
 * and its zh index puts 高雄 in Sichuan); then Open-Meteo in English, then — for CJK input
 * only — its zh index under `pickZhFallback`.
 */
export async function geocodePlace(location: string, timeoutMs: number): Promise<GeocodedPlace | null> {
  const isHan = HAN.test(location);
  if (isHan) {
    const { lookupTaiwanPlace } = await import('./taiwanPlaces');
    const hit = lookupTaiwanPlace(location);
    if (hit) return hit;
  }
  const en = (await searchGeocoder(location, 'en', 1, timeoutMs))[0];
  if (en) return toPlace(en, location);
  if (!isHan) return null;
  const zh = pickZhFallback(await searchGeocoder(location.trim(), 'zh', 10, timeoutMs));
  return zh ? toPlace(zh, location) : null;
}

export async function execWeather(config: Record<string, string>, timeoutMs: number): Promise<string> {
  const location = (config.location ?? '').trim();
  const units = config.units === 'imperial' ? 'imperial' : 'metric';

  const fail = (message: string): string => {
    sendLog(`🌦️ [Flow] Weather: ${message}`);
    return envelope(message, { location, isFailed: '1' });
  };

  if (!location) return fail('weather: a location is required');
  // Outside the try: an unreadable or out-of-range date is the step's config, not the source, and fails the step.
  const forecast = readForecastRequest(config, new Date());

  try {
    const place = await geocodePlace(location, timeoutMs);
    if (!place) return fail(`weather: location not found "${location}"`);
    const { displayName } = place;

    if (forecast) {
      const imperial = units === 'imperial';
      const hourly = await fetchJson(forecastUrl(place.latitude, place.longitude, forecast, imperial), timeoutMs) as HourlyForecast;
      const result = forecastResult(hourly, forecast, { displayName, imperial, nowSec: Math.floor(Date.now() / 1_000) });
      if (!result) return fail(`weather: no hourly data for "${displayName}" from ${forecast.from} to ${forecast.to}`);
      sendLog(`🌦️ [Flow] Weather: ${displayName} ${forecast.from}..${forecast.to} hourly`);
      return envelope(result.output, result.subVars);
    }

    const tempUnit = units === 'imperial' ? 'fahrenheit' : 'celsius';
    const windUnit = units === 'imperial' ? 'mph' : 'kmh';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}`
      + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
      + `&timezone=auto&forecast_days=3&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}`;
    const data = await fetchJson(url, timeoutMs) as {
      current?: Record<string, number>;
      current_units?: Record<string, string>;
      daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: number[] };
    };
    const cur = data.current;
    if (!cur) return fail(`weather: no data for "${displayName}"`);

    const unit = data.current_units?.temperature_2m ?? (units === 'imperial' ? '°F' : '°C');
    const condition = wmoText(Number(cur.weather_code));
    const daily = data.daily;
    const high = daily?.temperature_2m_max?.[0];
    const low = daily?.temperature_2m_min?.[0];
    const rain = daily?.precipitation_probability_max?.[0];

    const subVars: Record<string, string> = {
      location: displayName,
      temp: String(cur.temperature_2m),
      feelsLike: String(cur.apparent_temperature),
      condition,
      humidity: String(cur.relative_humidity_2m),
      windSpeed: String(cur.wind_speed_10m),
      unit,
      isDay: cur.is_day ? '1' : '0',
      high: high == null ? '' : String(high),
      low: low == null ? '' : String(low),
      rainChance: rain == null ? '' : String(rain),
      isFailed: '0',
    };
    const json = JSON.stringify({ ...subVars, isFailed: undefined });
    sendLog(`🌦️ [Flow] Weather: ${displayName} ${cur.temperature_2m}${unit} ${condition}`);
    return envelope(json, subVars);
  } catch (err) {
    return fail(`weather source unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
}
