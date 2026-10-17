/**
 * TDX's daily allowance, as TDX itself reports it. A visitor without a key gets 20 calls a day per
 * IP, one counter across every endpoint (`X-RateLimit-Remaining-Day`); a key's allowance depends on
 * its plan, so nothing here hard-codes a number — it only reads the header.
 *
 * Timetables are the calls an answer cannot do without, so `TIMETABLE_RESERVE` calls are kept for
 * them; live data (delays, seats, notices) refreshes no more often than the rest of the day's
 * allowance can sustain until Taipei midnight.
 */
import { minutesToTaipeiMidnight, taipeiClock } from './railTime';

export const TIMETABLE_RESERVE = 2;

export class TdxQuota {
  private remaining: number | null = null;
  private observedOn = '';
  private exhaustedUntil = 0;

  constructor(private readonly now: () => Date) {}

  /** Records what a TDX response says about the allowance; 429 means none is left today. */
  observe(headers: Headers, status: number): void {
    const now = this.now();
    if (status === 429) {
      this.remaining = 0;
      this.observedOn = taipeiClock(now).date;
      this.exhaustedUntil = now.getTime() + minutesToTaipeiMidnight(now) * 60_000;
      return;
    }
    const raw = headers.get('x-ratelimit-remaining-day');
    const value = raw === null ? Number.NaN : Number(raw);
    if (!Number.isFinite(value)) return;
    this.remaining = value;
    this.observedOn = taipeiClock(now).date;
  }

  /** What is left today, or null when no response has said (or the count is from an earlier day). */
  private current(): number | null {
    if (this.remaining === null) return null;
    return this.observedOn === taipeiClock(this.now()).date ? this.remaining : null;
  }

  exhausted(): boolean {
    return this.now().getTime() < this.exhaustedUntil;
  }

  canSpendTimetable(): boolean {
    const left = this.current();
    return !this.exhausted() && (left === null || left > 0);
  }

  canSpendLive(): boolean {
    const left = this.current();
    return !this.exhausted() && (left === null || left > TIMETABLE_RESERVE);
  }

  /**
   * The shortest time live data may be reused before it is fetched again: the source's own
   * refresh (`floorMs`) while the allowance is unknown or plentiful, longer as it runs low.
   */
  liveInterval(floorMs: number): number {
    const left = this.current();
    if (left === null) return floorMs;
    const spare = left - TIMETABLE_RESERVE;
    if (spare <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(floorMs, (minutesToTaipeiMidnight(this.now()) * 60_000) / spare);
  }

  snapshot(): { remaining: number | null; exhausted: boolean } {
    return { remaining: this.current(), exhausted: this.exhausted() };
  }
}
