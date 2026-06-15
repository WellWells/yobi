import { sendLog } from '../../helpers';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function envelope(output: string, subVars: Record<string, string>): string {
  return JSON.stringify({ output, ...subVars });
}

async function fetchJson(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`request timed out after ${Math.ceil(timeoutMs / 1_000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number((raw ?? '').trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

interface ForexResult { base: string; target: string; rate: number; amount: number; converted: number; asOf: string }

function buildForexEnvelope(r: ForexResult, precision: number): string {
  const rate = Number(r.rate.toFixed(precision));
  const converted = Number(r.converted.toFixed(precision));
  const json = JSON.stringify({ base: r.base, target: r.target, rate, amount: r.amount, converted, asOf: r.asOf });
  return envelope(json, {
    rate: String(rate),
    converted: String(converted),
    amount: String(r.amount),
    base: r.base,
    target: r.target,
    asOf: r.asOf,
    isFailed: '0',
  });
}

export async function execForex(config: Record<string, string>, timeoutMs: number): Promise<string> {
  const base = (config.base ?? 'USD').trim().toUpperCase();
  const target = (config.target ?? '').trim().toUpperCase();
  const amountRaw = (config.amount ?? '').trim();
  const precision = clampInt(config.precision, 4, 0, 12);

  const fail = (message: string): string => {
    sendLog(`💱 [AgentFlow] Forex: ${message}`);
    return envelope(message, { rate: '0', converted: '0', amount: amountRaw || '1', base, target, asOf: '', isFailed: '1' });
  };

  if (!base || !target) return fail('forex: base and target are required');
  const amount = amountRaw === '' ? 1 : Number(amountRaw);
  if (!Number.isFinite(amount)) return fail(`forex: invalid amount "${amountRaw}"`);
  if (base === target) return buildForexEnvelope({ base, target, rate: 1, amount, converted: amount, asOf: '' }, precision);

  try {
    const data = await fetchJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, timeoutMs) as {
      result?: string; 'error-type'?: string; rates?: Record<string, number>; time_last_update_utc?: string;
    };
    if (data.result === 'error') return fail(`forex: unknown currency ${base} (${data['error-type'] ?? 'error'})`);
    const rate = data.rates?.[target];
    if (typeof rate !== 'number') return fail(`forex: unknown currency ${target}`);
    sendLog(`💱 [AgentFlow] Forex: 1 ${base} = ${rate} ${target}`);
    return buildForexEnvelope({ base, target, rate, amount, converted: amount * rate, asOf: data.time_last_update_utc ?? '' }, precision);
  } catch (err) {
    return fail(`forex source unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

interface Quote {
  symbol: string; name: string; currency: string;
  price: number; previousClose: number;
  open: number | null; high: number | null; low: number | null; volume: number | null;
  marketTime: string;
}

// Exported for tests.
export function computeChange(price: number, previousClose: number): { change: number; changePct: string } {
  const change = price - previousClose;
  const changePct = previousClose ? String(Number((change / previousClose * 100).toFixed(4))) : '';
  return { change: Number(change.toFixed(6)), changePct };
}

function lastNum(arr: unknown): number | null {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

async function fetchQuote(symbol: string, timeoutMs: number): Promise<Quote | null> {
  if (!symbol) return null;
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
      const data = await fetchJson(url, timeoutMs, { 'User-Agent': BROWSER_UA }) as {
        chart?: { error?: unknown; result?: Array<{ meta?: Record<string, unknown>; indicators?: { quote?: Array<Record<string, unknown>> } }> };
      };
      const result = data.chart?.result?.[0];
      if (data.chart?.error || !result?.meta) return null;
      const meta = result.meta;
      const q = result.indicators?.quote?.[0] ?? {};
      const price = Number(meta.regularMarketPrice);
      if (!Number.isFinite(price)) return null;
      const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? NaN);
      const t = Number(meta.regularMarketTime);
      return {
        symbol: String(meta.symbol ?? symbol),
        name: String(meta.longName ?? meta.shortName ?? symbol),
        currency: String(meta.currency ?? ''),
        price,
        previousClose: Number.isFinite(prevClose) ? prevClose : 0,
        open: lastNum(q.open),
        high: Number(meta.regularMarketDayHigh) || lastNum(q.high),
        low: Number(meta.regularMarketDayLow) || lastNum(q.low),
        volume: Number(meta.regularMarketVolume) || lastNum(q.volume),
        marketTime: Number.isFinite(t) ? new Date(t * 1_000).toISOString() : '',
      };
    } catch {
    }
  }
  return null;
}

function stockJson(q: Quote): Record<string, unknown> {
  const { change, changePct } = computeChange(q.price, q.previousClose);
  return {
    symbol: q.symbol, name: q.name, currency: q.currency,
    price: q.price, open: q.open, high: q.high, low: q.low, volume: q.volume,
    previousClose: q.previousClose, change, changePct, marketTime: q.marketTime,
  };
}

function buildStockEnvelope(q: Quote): string {
  const { change, changePct } = computeChange(q.price, q.previousClose);
  return envelope(JSON.stringify(stockJson(q)), {
    symbol: q.symbol, name: q.name, currency: q.currency,
    price: String(q.price),
    open: q.open == null ? '' : String(q.open),
    high: q.high == null ? '' : String(q.high),
    low: q.low == null ? '' : String(q.low),
    volume: q.volume == null ? '' : String(q.volume),
    previousClose: String(q.previousClose),
    change: String(change),
    changePct,
    marketTime: q.marketTime,
    isFailed: '0',
  });
}

export async function execStock(config: Record<string, string>, timeoutMs: number): Promise<string> {
  const symbols = (config.symbol ?? '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);

  if (symbols.length === 0) {
    sendLog('📈 [AgentFlow] Stock: no symbol');
    return envelope('(no symbol)', { isFailed: '1' });
  }

  if (symbols.length === 1) {
    const q = await fetchQuote(symbols[0], timeoutMs);
    if (!q) {
      sendLog(`📈 [AgentFlow] Stock: quote unavailable for ${symbols[0]}`);
      return envelope(`(quote unavailable: ${symbols[0]})`, { symbol: symbols[0], isFailed: '1' });
    }
    sendLog(`📈 [AgentFlow] Stock: ${q.symbol} ${q.price} ${q.currency}`);
    return buildStockEnvelope(q);
  }

  const quotes = await Promise.all(symbols.map((s) => fetchQuote(s, timeoutMs).then((q) => ({ s, q }))));
  sendLog(`📈 [AgentFlow] Stock: ${quotes.filter((x) => x.q).length}/${symbols.length} quotes`);
  return JSON.stringify(quotes.map(({ s, q }) => (q ? stockJson(q) : { symbol: s, isFailed: 1 })));
}

const WMO_CODE_TEXT: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
};

// Exported for tests.
export function wmoText(code: number): string {
  return WMO_CODE_TEXT[code] ?? `code ${code}`;
}

export async function execWeather(config: Record<string, string>, timeoutMs: number): Promise<string> {
  const location = (config.location ?? '').trim();
  const units = config.units === 'imperial' ? 'imperial' : 'metric';

  const fail = (message: string): string => {
    sendLog(`🌦️ [AgentFlow] Weather: ${message}`);
    return envelope(message, { location, isFailed: '1' });
  };

  if (!location) return fail('weather: a location is required');

  try {
    const geo = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`,
      timeoutMs,
    ) as { results?: Array<{ name?: string; country?: string; latitude?: number; longitude?: number }> };
    const place = geo.results?.[0];
    if (!place || typeof place.latitude !== 'number' || typeof place.longitude !== 'number') {
      return fail(`weather: location not found "${location}"`);
    }
    const displayName = place.country ? `${place.name}, ${place.country}` : String(place.name ?? location);

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
    sendLog(`🌦️ [AgentFlow] Weather: ${displayName} ${cur.temperature_2m}${unit} ${condition}`);
    return envelope(json, subVars);
  } catch (err) {
    return fail(`weather source unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
}
