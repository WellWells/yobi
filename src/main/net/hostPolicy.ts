/**
 * What Yobi has learned about each site's patience with its page reads: a site whose bot wall
 * refused a markdown-first request is asked for plain HTML, a site that walls off plain requests
 * is read in a window, and a site that refused is read more slowly until it has answered calmly
 * for a while. Nothing is known about a site until it refuses once.
 */

export type BlockKind = 'rate' | 'wall';

/** One answer, as `record` hears it. */
export type ReadOutcome =
  | { kind: 'ok' }
  | {
      kind: 'blocked';
      block: BlockKind;
      /** Only the markdown-first request was refused: the plain retry got through. */
      markdownOnly: boolean;
      retryAfterMs?: number;
    };

export interface HostState {
  markdownOffUntil?: number;
  rawOffUntil?: number;
  pauseUntil?: number;
  gapMs?: number;
  calmReads?: number;
  updatedAt: number;
}

const DAY_MS = 86_400_000;

/** Long enough to stop asking a site that refuses markdown; short enough to notice it changed. */
export const MARKDOWN_OFF_MS = 30 * DAY_MS;
/** A bot wall that refused a plain request is read in a window for a day, then tried again. */
export const RAW_OFF_MS = DAY_MS;
export const FIRST_GAP_MS = 2_000;
/** Under harvest's 35 s per-page ceiling even with two reads of a host queued. */
export const MAX_GAP_MS = 10_000;
/** A gap halved below this is gone. */
const MIN_GAP_MS = 1_000;
export const CALM_READS_TO_RELAX = 5;
/** A 429 without Retry-After. */
export const RATE_PAUSE_MS = 60_000;
export const MAX_PAUSE_MS = 15 * 60_000;
/** A site not heard from in this long starts over as unknown. */
export const FORGET_AFTER_MS = 30 * DAY_MS;
export const MAX_HOSTS = 500;

/** 503 counts only with Cloudflare's own mark: an origin that is down answers 503 through it too. */
export function blockSignal(status: number, headers: Readonly<Record<string, string>> = {}): BlockKind | null {
  if (status === 429) return 'rate';
  if (headers['cf-mitigated']) return 'wall';
  if (status !== 403) return null;
  const server = (headers.server ?? '').toLowerCase();
  if (headers['cf-ray'] || server === 'cloudflare') return 'wall';
  if (headers['x-datadome'] || server.includes('akamaighost')) return 'wall';
  return null;
}

/** Retry-After in seconds or as an HTTP date; undefined when absent or unreadable. */
export function retryAfterMs(headers: Readonly<Record<string, string>> = {}, now: number = Date.now()): number | undefined {
  const raw = headers['retry-after']?.trim();
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw) * 1_000;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

const NUMERIC_FIELDS = ['markdownOffUntil', 'rawOffUntil', 'pauseUntil', 'gapMs', 'calmReads'] as const;

function cleanState(value: unknown): HostState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)) return null;
  const state: HostState = { updatedAt: record.updatedAt };
  for (const field of NUMERIC_FIELDS) {
    const n = record[field];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) state[field] = n;
  }
  if (state.gapMs !== undefined) state.gapMs = Math.min(state.gapMs, MAX_GAP_MS);
  return state;
}

function abortableSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface HostPolicyDeps {
  now?: () => number;
  /** Called after every change worth keeping. */
  onChange?: () => void;
  log?: (line: string) => void;
}

export class HostPolicy {
  private readonly hosts = new Map<string, HostState>();
  /** When the next read of a paced host may start; memory only. */
  private readonly nextStart = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly deps: HostPolicyDeps = {}) {
    this.now = deps.now ?? Date.now;
  }

  /** Takes a saved snapshot, which is untrusted: bad entries and long-silent sites are dropped. */
  load(saved: unknown): void {
    this.hosts.clear();
    if (!saved || typeof saved !== 'object') return;
    const now = this.now();
    const entries = Object.entries(saved as Record<string, unknown>)
      .map(([host, value]) => [host.toLowerCase(), cleanState(value)] as const)
      .filter((entry): entry is readonly [string, HostState] => entry[1] !== null && now - entry[1].updatedAt < FORGET_AFTER_MS)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX_HOSTS);
    for (const [host, state] of entries) this.hosts.set(host, state);
  }

  snapshot(): Record<string, HostState> {
    return Object.fromEntries(this.hosts);
  }

  clear(): void {
    this.hosts.clear();
    this.nextStart.clear();
  }

  sendsMarkdown(host: string): boolean {
    return !this.active(this.hosts.get(host)?.markdownOffUntil);
  }

  readsRaw(host: string): boolean {
    return !this.active(this.hosts.get(host)?.rawOffUntil);
  }

  /** How long the site asked to be left alone; 0 when it did not. */
  pausedFor(host: string): number {
    const until = this.hosts.get(host)?.pauseUntil ?? 0;
    return Math.max(0, until - this.now());
  }

  /** Waits for this host's turn when it is paced; reads of other hosts never wait. */
  async waitTurn(host: string, signal?: AbortSignal): Promise<void> {
    const gap = this.hosts.get(host)?.gapMs ?? 0;
    if (gap <= 0) return;
    const now = this.now();
    const at = Math.max(now, this.nextStart.get(host) ?? 0);
    this.nextStart.set(host, at + gap);
    if (at > now) await abortableSleep(at - now, signal);
  }

  record(host: string, outcome: ReadOutcome): void {
    if (outcome.kind === 'ok') {
      this.recordCalm(host);
      return;
    }
    const now = this.now();
    const state: HostState = { ...this.hosts.get(host), updatedAt: now };
    state.gapMs = Math.min(MAX_GAP_MS, Math.max(FIRST_GAP_MS, (state.gapMs ?? 0) * 2));
    state.calmReads = 0;
    const learned: string[] = [];
    if (outcome.markdownOnly) {
      state.markdownOffUntil = now + MARKDOWN_OFF_MS;
      learned.push('plain HTML only');
    } else if (outcome.block === 'wall') {
      state.rawOffUntil = now + RAW_OFF_MS;
      learned.push('read in a window');
    } else {
      const pause = Math.min(MAX_PAUSE_MS, Math.max(1_000, outcome.retryAfterMs ?? RATE_PAUSE_MS));
      state.pauseUntil = now + pause;
      learned.push(`paused ${Math.round(pause / 1_000)} s`);
    }
    learned.push(`${state.gapMs / 1_000} s between reads`);
    this.hosts.set(host, state);
    this.deps.log?.(`🔎 [Search] ${host} refused a read (${outcome.block}) — ${learned.join(', ')}`);
    this.deps.onChange?.();
  }

  private recordCalm(host: string): void {
    const current = this.hosts.get(host);
    if (!current) return;
    const state: HostState = { ...current, calmReads: (current.calmReads ?? 0) + 1 };
    if (state.gapMs && state.calmReads! >= CALM_READS_TO_RELAX) {
      const halved = state.gapMs / 2;
      state.gapMs = halved < MIN_GAP_MS ? undefined : halved;
      state.calmReads = 0;
      this.deps.log?.(`🔎 [Search] ${host} answered calmly — ${state.gapMs ? `${state.gapMs / 1_000} s` : 'no wait'} between reads`);
    }
    if (!this.active(state.pauseUntil)) delete state.pauseUntil;
    if (!state.gapMs) delete state.gapMs;
    // A site with nothing left to remember is unknown again; only a change is saved, not each calm read.
    const remembers = state.gapMs || this.active(state.markdownOffUntil) || this.active(state.rawOffUntil) || state.pauseUntil;
    if (!remembers) {
      this.hosts.delete(host);
      this.nextStart.delete(host);
      this.deps.onChange?.();
      return;
    }
    this.hosts.set(host, state);
    if (state.gapMs !== current.gapMs) this.deps.onChange?.();
  }

  private active(until: number | undefined): boolean {
    return until !== undefined && until > this.now();
  }
}
