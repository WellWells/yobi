/**
 * Every rail source behind the shared cache and the TDX allowance:
 *
 * | data                | from        | kept                          | TDX calls          |
 * |---------------------|-------------|-------------------------------|--------------------|
 * | TRA timetable       | TRA ODS     | disk, per date, 6 h           | none               |
 * | THSR timetable      | TDX         | disk, per date, 2 h then 304  | one per date       |
 * | THSR fares, offers  | THSR site   | memory, per OD + date, 6 h    | none               |
 * | TRA fares           | TRA site    | memory, per OD + date, 6 h    | none               |
 * | TRA train offers    | TRA site    | memory, per OD + date, 30 min | none               |
 * | TRA delays          | TDX         | memory, ≥ 2 min, longer as the allowance runs low | per refresh |
 * | THSR seats          | TDX         | memory, per station, ≥ 5 min  | per refresh        |
 * | notices             | TDX         | memory, 30 min                | two per refresh    |
 * | one TRA train live  | TRA site    | memory, per train, 1 min      | none               |
 */
import { errorText } from '../../shared/errorText';
import { RailCache } from './railCache';
import type { Cached } from './railCache';
import type { FetchFn } from './railHttp';
import { fetchOdsFile, fetchOdsList, findOdsFileLink } from './odsSource';
import { TdxQuota } from './quota';
import { TdxClient, TdxQuotaError } from './tdxClient';
import type { TdxCredentials } from './tdxClient';
import { TDX_PATHS, parseAlerts, parseThsrDaily, parseThsrSeats, parseTraDelays } from './tdxSources';
import type { SeatInfo, TraDelay } from './tdxSources';
import { searchThsrWeb } from './thsrWebSource';
import type { ThsrSearchResult } from './thsrWebSource';
import { fetchTraFares } from './traFareSource';
import type { TraFares } from './traFareSource';
import { fetchTraTrainOffers } from './traTrainOfferSource';
import type { TraTrainOffers } from './traTrainOfferSource';
import { fetchTraTrainLive } from './traWebSource';
import type { TraTrainLive } from './traWebSource';
import { nodeId } from './railTypes';
import type { RailNode, RailTrain } from './railTypes';
import { stationName, thsrWebCode } from './stations';

const HOUR = 3_600_000;
const MINUTE = 60_000;
export const LIVE_FLOOR = { traDelay: 2 * MINUTE, thsrSeats: 5 * MINUTE, alerts: 30 * MINUTE } as const;

export interface RailDataDeps {
  fetchFn: FetchFn;
  /** Where timetables persist between launches; null keeps them in memory only. */
  cacheDir: string | null;
  credentials: () => TdxCredentials | null;
  now: () => Date;
}

/** Live data, or why there is none; `at` is when it was fetched. */
export interface Live<T> {
  value?: T;
  at?: number;
  /** Why the value is missing or old. */
  unavailable?: string;
}

export class RailData {
  readonly quota: TdxQuota;
  readonly cache: RailCache;
  private readonly tdx: TdxClient;

  constructor(private readonly deps: RailDataDeps) {
    this.quota = new TdxQuota(deps.now);
    this.cache = new RailCache(deps.cacheDir, () => deps.now().getTime());
    this.tdx = new TdxClient({ fetchFn: deps.fetchFn, credentials: deps.credentials, quota: this.quota, now: () => deps.now().getTime() });
  }

  traTimetable(date: string, signal?: AbortSignal): Promise<Cached<RailTrain[]>> {
    return this.cache.stored<RailTrain[]>(`ods-${date}`, 6 * HOUR, async () => {
      const list = await this.cache.memo('ods-list', 6 * HOUR, () => fetchOdsList(this.deps.fetchFn, signal));
      const link = findOdsFileLink(list.value, date);
      if (!link) throw new Error(`TRA has not published a timetable for ${date}`);
      return { value: await fetchOdsFile(this.deps.fetchFn, link, signal) };
    });
  }

  thsrTimetable(date: string, signal?: AbortSignal): Promise<Cached<RailTrain[]>> {
    return this.cache.stored<RailTrain[]>(`thsr-${date}`, 2 * HOUR, async (previous) => {
      if (!this.quota.canSpendTimetable()) throw new TdxQuotaError();
      const result = await this.tdx.get(TDX_PATHS.thsrDaily(date), { ifModifiedSince: previous?.meta, signal });
      if (result.status === 304) return 'unchanged';
      const trains = parseThsrDaily(result.body);
      if (trains.length === 0) throw new Error(`THSR has not published a timetable for ${date}`);
      return { value: trains, ...(result.lastModified ? { meta: result.lastModified } : {}) };
    });
  }

  /** THSR's own search for one pair of THSR stations: fares, offers, and the day's trains. */
  thsrWeb(from: RailNode, to: RailNode, date: string, signal?: AbortSignal): Promise<Cached<ThsrSearchResult>> {
    const fromWeb = thsrWebCode(from);
    const toWeb = thsrWebCode(to);
    if (!fromWeb || !toWeb) return Promise.reject(new Error(`Not a THSR station pair: ${from} → ${to}`));
    // The search lists the whole day whatever time is sent; the time only scrolls THSR's own page.
    return this.cache.memo(`thsrweb-${nodeId(from)}-${nodeId(to)}-${date}`, 6 * HOUR, () =>
      searchThsrWeb(this.deps.fetchFn, { fromWeb, toWeb, to, date, time: '06:00' }, signal));
  }

  /** TRA's fare page for one pair of TRA stations: every train type, adult and half fare. */
  traFares(from: RailNode, to: RailNode, date: string, signal?: AbortSignal): Promise<Cached<TraFares>> {
    return this.cache.memo(`trafare-${nodeId(from)}-${nodeId(to)}-${date}`, 6 * HOUR, () =>
      fetchTraFares(this.deps.fetchFn, nodeId(from), nodeId(to), date, signal));
  }

  /**
   * TRA's timetable page for one pair: each direct train's own fare and discounts, and its
   * non-reserved seat fare when asked. Discounts follow seat sales, so it is kept for half an hour, not six.
   */
  traTrainOffers(from: RailNode, to: RailNode, date: string, unreserved: boolean, signal?: AbortSignal): Promise<Cached<TraTrainOffers>> {
    const station = (node: RailNode) => `${nodeId(node)}-${stationName(node)}`;
    return this.cache.memo(`traoffers-${nodeId(from)}-${nodeId(to)}-${date}-${unreserved ? 'free' : 'normal'}`, 30 * MINUTE, () =>
      fetchTraTrainOffers(this.deps.fetchFn, station(from), station(to), date, { unreserved }, signal));
  }

  traTrainLive(trainNo: string, date: string, signal?: AbortSignal): Promise<Cached<TraTrainLive | null>> {
    return this.cache.memo(`traweb-${trainNo}-${date}`, MINUTE, () => fetchTraTrainLive(this.deps.fetchFn, trainNo, date, signal));
  }

  private unavailableReason(): string {
    return this.quota.exhausted()
      ? 'TDX daily allowance is used up until midnight'
      : "the rest of today's TDX allowance is kept for timetables";
  }

  private async live<T>(key: string, floorMs: number, load: () => Promise<T>): Promise<Live<T>> {
    if (!this.quota.canSpendLive()) {
      const held = this.cache.peek<T>(key);
      return held ? { value: held.value, at: held.at, unavailable: this.unavailableReason() } : { unavailable: this.unavailableReason() };
    }
    try {
      const result = await this.cache.memo(key, this.quota.liveInterval(floorMs), load);
      return { value: result.value, at: result.at, ...(result.stale ? { unavailable: result.stale.error } : {}) };
    } catch (err) {
      return { unavailable: err instanceof TdxQuotaError ? this.unavailableReason() : errorText(err) };
    }
  }

  traDelays(signal?: AbortSignal): Promise<Live<Map<string, TraDelay>>> {
    return this.live('tra-delay', LIVE_FLOOR.traDelay, async () => {
      const result = await this.tdx.get(TDX_PATHS.traDelay, { signal });
      if (result.status === 304) throw new Error('TDX answered 304 to a plain request');
      return parseTraDelays(result.body);
    });
  }

  thsrSeats(station: RailNode, signal?: AbortSignal): Promise<Live<Map<string, SeatInfo>>> {
    return this.live(`thsr-seats-${nodeId(station)}`, LIVE_FLOOR.thsrSeats, async () => {
      const result = await this.tdx.get(TDX_PATHS.thsrSeats(nodeId(station)), { signal });
      if (result.status === 304) throw new Error('TDX answered 304 to a plain request');
      return parseThsrSeats(result.body);
    });
  }

  alerts(signal?: AbortSignal): Promise<Live<{ thsr: string[]; tra: string[] }>> {
    return this.live('alerts', LIVE_FLOOR.alerts, async () => {
      const [thsr, tra] = await Promise.all([
        this.tdx.get(TDX_PATHS.thsrAlert, { signal }),
        this.tdx.get(TDX_PATHS.traAlert, { signal }),
      ]);
      return {
        thsr: thsr.status === 200 ? parseAlerts(thsr.body, 'thsr') : [],
        tra: tra.status === 200 ? parseAlerts(tra.body, 'tra') : [],
      };
    });
  }

  sweep(today: string): Promise<void> {
    return this.cache.sweep(today);
  }
}
