/**
 * TRA's own open-data timetables (ODS): one JSON file per service day, about 2 MB, listed on a page
 * that links each `YYYYMMDD.json` to an opaque download id. No key and no quota — this is why the
 * TRA timetable never spends TDX calls.
 */
import { browserHeaders, railJson, railText } from './railHttp';
import type { FetchFn } from './railHttp';
import { clockMinutes, rollStops } from './railTime';
import { railNode } from './railTypes';
import type { RailTrain } from './railTypes';
import { traTypeName } from './traTrainTypes';

const ODS_ORIGIN = 'https://ods.railway.gov.tw';
export const ODS_LIST_URL = `${ODS_ORIGIN}/tra-ods-web/ods/download/dataResource/railway_schedule/JSON/list`;

interface OdsTimeInfo {
  Station?: unknown;
  Order?: unknown;
  ARRTime?: unknown;
  DEPTime?: unknown;
}

interface OdsTrainInfo {
  Train?: unknown;
  CarClass?: unknown;
  Note?: unknown;
  TimeInfos?: unknown;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseTrain(info: OdsTrainInfo): RailTrain | null {
  const no = str(info.Train);
  if (!no || !Array.isArray(info.TimeInfos)) return null;
  const raw = (info.TimeInfos as OdsTimeInfo[])
    .map((t) => ({ order: Number(t.Order), station: str(t.Station), arr: clockMinutes(str(t.ARRTime)), dep: clockMinutes(str(t.DEPTime)) }))
    .filter((t) => t.station && Number.isFinite(t.order))
    .sort((a, b) => a.order - b.order)
    .map((t) => ({ node: railNode('tra', t.station), arr: t.arr, dep: t.dep }));
  const stops = rollStops(raw);
  if (stops.length < 2) return null;
  const type = traTypeName(str(info.CarClass));
  const note = str(info.Note);
  return { mode: 'tra', no, type: type.zh, typeEn: type.en, stops, ...(note ? { note } : {}) };
}

export function parseOdsTimetable(json: unknown): RailTrain[] {
  const infos = (json as { TrainInfos?: unknown } | null)?.TrainInfos;
  if (!Array.isArray(infos)) throw new Error('TRA open-data timetable has no TrainInfos');
  return (infos as OdsTrainInfo[]).map(parseTrain).filter((train): train is RailTrain => train !== null);
}

/** The download link the list page gives `YYYYMMDD.json` for this date, or null when it is not out yet. */
export function findOdsFileLink(listHtml: string, date: string): string | null {
  const file = `${date.replaceAll('-', '')}.json`;
  const match = new RegExp(`<a[^>]+href="([^"]+)"[^>]*>\\s*${file}\\s*</a>`, 'u').exec(listHtml);
  if (!match) return null;
  return new URL(match[1].replaceAll('&amp;', '&'), ODS_ORIGIN).toString();
}

/** The dates the list page offers, as `YYYY-MM-DD`. */
export function listOdsDates(listHtml: string): string[] {
  return [...listHtml.matchAll(/>\s*(\d{4})(\d{2})(\d{2})\.json\s*</gu)].map((m) => `${m[1]}-${m[2]}-${m[3]}`);
}

export async function fetchOdsList(fetchFn: FetchFn, signal?: AbortSignal): Promise<string> {
  return railText(fetchFn, ODS_LIST_URL, { headers: browserHeaders(ODS_LIST_URL) }, signal);
}

export async function fetchOdsFile(fetchFn: FetchFn, url: string, signal?: AbortSignal): Promise<RailTrain[]> {
  return parseOdsTimetable(await railJson(fetchFn, url, { headers: browserHeaders(url) }, signal));
}
