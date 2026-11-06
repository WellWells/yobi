import { isLoopbackHost } from '../../../shared/calDav';

/**
 * CalDAV through `tsdav` (discovery, calendar list, time-range query, conditional PUT/DELETE).
 * Yobi keeps the transport: every request goes through `davFetch`, which signs it, refuses
 * anything but https (or plain http to this computer), follows redirects itself so the
 * Authorization header goes along, sends `Accept-Language: en` (fetch's default "*" makes iCloud
 * answer 500), and caps time and size. Recurrences are expanded on this side (`icsEvents.ts`);
 * server-side `<expand>` differs from server to server.
 *
 * No error carries a URL, the user name or the password, so an error message is safe for the log.
 */

export type DavErrorKind =
  | 'auth' | 'forbidden' | 'notFound' | 'conflict' | 'unreachable' | 'tls' | 'notCalDav' | 'insecure' | 'tooLarge' | 'http';

export class DavError extends Error {
  constructor(readonly kind: DavErrorKind, readonly status: number, message: string) {
    super(message);
    this.name = 'DavError';
  }
}

export type DavFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface DavClientOptions {
  username: string;
  password: string;
  /** The network itself; `fetch` unless a test stands in. */
  fetch?: DavFetch;
  /** Per request; the caller's signal still aborts sooner. */
  timeoutMs?: number;
}

export interface DiscoveredCalendar {
  url: string;
  name: string;
  writable: boolean;
  color: string;
}

/**
 * Where discovery led (RFC 6764 §6: a client SHOULD cache the service details that worked and
 * discover again only when they stop working). Listing the calendars again is then one PROPFIND.
 */
export interface DavHome {
  rootUrl: string;
  principalUrl: string;
  homeUrl: string;
}

export interface DiscoveredAccount {
  home: DavHome;
  calendars: DiscoveredCalendar[];
}

export interface DavResource {
  url: string;
  etag: string;
  ics: string;
}

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const TLS_CODES = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|SSL/i;
/** Statuses whose Response may not carry a body at all. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function errorCode(err: unknown): string {
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause;
  const code = cause?.code ?? (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

/** Only https, or plain http to this computer; anything else would send the password in the clear. */
export function assertSafeUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DavError('notCalDav', 0, 'The server address is not a valid URL');
  }
  if (parsed.protocol === 'https:') return parsed;
  if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) return parsed;
  throw new DavError('insecure', 0, 'The calendar server is not on https');
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new DavError('tooLarge', response.status, 'The calendar server answered with more than 10 MB');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new DavError('tooLarge', response.status, 'The calendar server answered with more than 10 MB');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}

/**
 * Providers whose CalDAV spans several hosts of their own (iCloud's caldav → pNN-caldav). A
 * suffix rule ("same last two labels") would also join co.uk, com.tw and github.io neighbours.
 */
const PROVIDER_DOMAINS = ['icloud.com', 'fastmail.com', 'yahoo.com'] as const;

/** The same host, or two hosts of one provider in `PROVIDER_DOMAINS`. */
export function sameProvider(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left === right) return true;
  const under = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);
  return PROVIDER_DOMAINS.some((domain) => under(left, domain) && under(right, domain));
}

/**
 * The fetch tsdav is handed. A request that asks for `redirect: 'manual'` (tsdav's own
 * /.well-known lookup reads the Location) gets the redirect as is; every other one is followed
 * here, to safe addresses only, with the same method and body (303: GET); the sign-in goes along
 * only while the redirects stay with the same host or provider.
 */
export function createDavFetch(options: DavClientOptions, signal?: AbortSignal): DavFetch {
  const network: DavFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const authorization = `Basic ${Buffer.from(`${options.username}:${options.password}`, 'utf8').toString('base64')}`;
  return async (url, init) => {
    const manual = init.redirect === 'manual';
    let target = assertSafeUrl(url).toString();
    let signedIn = true;
    let request: RequestInit = init;
    // The sign-in is ours to add: one the caller set never goes past a redirect that drops ours.
    const callerHeaders = headerRecord(init.headers);
    delete callerHeaders.authorization;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await network(target, {
          ...request,
          redirect: 'manual',
          signal: combined,
          headers: { ...callerHeaders, ...(signedIn ? { authorization } : {}), 'accept-language': 'en', 'user-agent': 'Yobi' },
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        const code = errorCode(err);
        if (TLS_CODES.test(code)) throw new DavError('tls', 0, `The calendar server's certificate was not accepted (${code})`);
        throw new DavError('unreachable', 0, `The calendar server did not answer (${code || (err instanceof Error ? err.name : 'error')})`);
      }
      const location = response.headers.get('location');
      if (!manual && response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        const next = assertSafeUrl(new URL(location, target).toString());
        // The password follows a redirect to the same host or provider only (caldav.icloud.com → p12-caldav.icloud.com).
        signedIn = signedIn && sameProvider(new URL(target).hostname, next.hostname);
        if (response.status === 303) request = { ...request, method: 'GET', body: undefined };
        target = next.toString();
        continue;
      }
      const text = await readCapped(response);
      const copy = new Response(NULL_BODY_STATUSES.has(response.status) ? null : text, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
      // tsdav reports a failed request against `response.url`; a constructed Response has none.
      Object.defineProperty(copy, 'url', { value: target });
      return copy;
    }
    throw new DavError('http', 0, 'The calendar server redirected too many times');
  };
}

function statusError(status: number, what: string): DavError {
  if (status === 401) return new DavError('auth', status, `The calendar server refused the user name or password (${what})`);
  if (status === 403) return new DavError('forbidden', status, `The calendar server does not allow this (${what}, HTTP 403)`);
  if (status === 404 || status === 410) return new DavError('notFound', status, `The calendar server has no such item (${what}, HTTP ${status})`);
  if (status === 412) return new DavError('conflict', status, `The event changed on the server since it was read (${what})`);
  return new DavError('http', status, `The calendar server answered HTTP ${status} (${what})`);
}

/** tsdav's own failures are plain Errors; turn the ones discovery meets into kinds the card can name. */
function discoveryError(err: unknown): unknown {
  if (err instanceof DavError || (err instanceof Error && err.name === 'AbortError')) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/Invalid credentials|401/i.test(message)) return new DavError('auth', 401, 'The calendar server refused the user name or password');
  if (/\b403\b/.test(message)) return new DavError('forbidden', 403, 'The calendar server does not allow this account to list calendars');
  return new DavError('notCalDav', 0, `The address is not a CalDAV server (${message.slice(0, 120)})`);
}

/** Every privilege name granted, from tsdav's parsed `current-user-privilege-set`. */
function grantedPrivileges(value: unknown): string[] {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (key === 'privilege') {
        for (const privilege of Array.isArray(child) ? child : [child]) {
          if (privilege && typeof privilege === 'object') names.push(...Object.keys(privilege).map((name) => name.toLowerCase()));
        }
      } else {
        walk(child);
      }
    }
  };
  walk(value);
  return names;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as { _text?: unknown })._text === 'string') return (value as { _text: string })._text;
  return '';
}

/** tsdav's parsed `supported-calendar-component-set`: one `comp` or a list of them. */
function componentNames(compSet: unknown): string[] {
  const items = Array.isArray(compSet) ? compSet : compSet && typeof compSet === 'object' ? [compSet] : [];
  return items
    .map((item) => (item as { _attributes?: { name?: unknown } } | null)?._attributes?.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

interface ListedResponse {
  href?: string;
  ok?: boolean;
  status?: number;
  props?: Record<string, unknown>;
  propStats?: unknown[];
}

/**
 * One listed collection as a calendar, or null for anything else (the home itself, a Reminders
 * list). The href is resolved against the home that listed it: iCloud's home sits on another host
 * (caldav.icloud.com → pNN-caldav.icloud.com), and a bare path belongs on the home's host.
 */
function calendarOf(response: ListedResponse, homeUrl: string): DiscoveredCalendar | null {
  const props = response.props ?? {};
  if (!response.ok || !response.href || !Object.keys((props.resourcetype as object | undefined) ?? {}).includes('calendar')) return null;
  const components = componentNames((props.supportedCalendarComponentSet as { comp?: unknown } | undefined)?.comp);
  // A list with no component set holds anything (RFC 4791 §5.2.3); a Reminders list holds VTODO only.
  if (components.length > 0 && !components.includes('VEVENT')) return null;
  const privileges = props.currentUserPrivilegeSet;
  const granted = grantedPrivileges(privileges);
  const writable = privileges === undefined || granted.some((name) => ['write', 'writecontent', 'write-content', 'all', 'bind'].includes(name));
  const color = /^#[0-9a-f]{6}/i.exec(textOf(props.calendarColor).trim())?.[0].toUpperCase() ?? '';
  const url = assertSafeUrl(new URL(response.href, homeUrl).toString()).toString();
  const segment = decodeURIComponent(new URL(url).pathname.replace(/\/$/, '').split('/').pop() ?? '');
  return { url, name: textOf(props.displayname).trim() || segment, writable, color };
}

/** When a cached home stops answering as one, discovery runs again (RFC 6764 §6); a refused sign-in or a dead network does not. */
export function homeMoved(err: unknown): boolean {
  if (!(err instanceof DavError)) return false;
  return err.kind === 'notFound' || err.kind === 'notCalDav' || (err.kind === 'http' && err.status < 500);
}

function sameCollection(url: string, collection: string): boolean {
  const strip = (value: string): string => {
    try {
      return new URL(value).pathname.replace(/\/+$/, '');
    } catch {
      return value.replace(/\/+$/, '');
    }
  };
  return strip(url) === strip(collection);
}

export interface DavClient {
  /** The whole discovery from the server's address: well-known, principal, home, then the list. */
  discover: (server: string, signal?: AbortSignal) => Promise<DiscoveredAccount>;
  /** The calendars of a home discovery found before: one PROPFIND (Depth: 1). */
  listCalendars: (home: DavHome, signal?: AbortSignal) => Promise<DiscoveredCalendar[]>;
  queryEvents: (collectionUrl: string, start: Date, end: Date, signal?: AbortSignal) => Promise<DavResource[]>;
  getResource: (url: string, signal?: AbortSignal) => Promise<DavResource>;
  /** PUT a new resource; refuses to overwrite one that exists. */
  createResource: (collectionUrl: string, name: string, ics: string, signal?: AbortSignal) => Promise<{ url: string }>;
  /** PUT over the resource only if it is still the version read (`etag`). */
  updateResource: (url: string, ics: string, etag: string, signal?: AbortSignal) => Promise<void>;
  deleteResource: (url: string, etag: string, signal?: AbortSignal) => Promise<void>;
}

const CALENDAR_PROPS = {
  'd:displayname': {},
  'ca:calendar-color': {},
  'd:resourcetype': {},
  'c:supported-calendar-component-set': {},
  'd:current-user-privilege-set': {},
} as const;

export function createDavClient(options: DavClientOptions): DavClient {
  // Loaded on first use: the flow step and the connector reach this module, the boot path does not.
  const tsdav = (): Promise<typeof import('tsdav')> => import('tsdav');

  // tsdav's fetchCalendars also sends one supported-report-set PROPFIND per calendar, which Yobi
  // never reads; the list is this one request.
  async function listCalendars(home: DavHome, signal?: AbortSignal): Promise<DiscoveredCalendar[]> {
    const dav = await tsdav();
    const homeUrl = assertSafeUrl(home.homeUrl).toString();
    let responses: ListedResponse[];
    try {
      responses = await dav.propfind({ url: homeUrl, props: CALENDAR_PROPS, depth: '1', fetch: createDavFetch(options, signal) as typeof fetch });
    } catch (err) {
      throw discoveryError(err);
    }
    // A request that failed as a whole comes back as one entry without propstats.
    const whole = responses.find((response) => !response.propStats);
    if (whole) {
      if ((whole.status ?? 0) >= 200 && (whole.status ?? 0) < 300) throw new DavError('notCalDav', whole.status ?? 0, 'The calendar home did not answer with a calendar list');
      throw statusError(whole.status ?? 0, 'list calendars');
    }
    return responses.map((response) => calendarOf(response, homeUrl)).filter((calendar): calendar is DiscoveredCalendar => calendar !== null);
  }

  async function discover(server: string, signal?: AbortSignal): Promise<DiscoveredAccount> {
    const dav = await tsdav();
    let home: DavHome;
    try {
      const account = await dav.createAccount({
        account: { accountType: 'caldav', serverUrl: assertSafeUrl(server).toString() },
        fetch: createDavFetch(options, signal) as typeof fetch,
      });
      if (!account.rootUrl || !account.principalUrl || !account.homeUrl) throw new Error('cannot find the calendar home');
      home = {
        rootUrl: assertSafeUrl(account.rootUrl).toString(),
        principalUrl: assertSafeUrl(account.principalUrl).toString(),
        homeUrl: assertSafeUrl(account.homeUrl).toString(),
      };
    } catch (err) {
      throw discoveryError(err);
    }
    return { home, calendars: await listCalendars(home, signal) };
  }

  async function queryEvents(collectionUrl: string, start: Date, end: Date, signal?: AbortSignal): Promise<DavResource[]> {
    const dav = await tsdav();
    const objects = await dav.fetchCalendarObjects({
      calendar: { url: collectionUrl },
      timeRange: { start: start.toISOString(), end: end.toISOString() },
      // Every member but the collection: some servers name events without ".ics".
      urlFilter: (url) => !sameCollection(url, collectionUrl),
      fetch: createDavFetch(options, signal) as typeof fetch,
    });
    return objects
      .filter((object) => typeof object.data === 'string' && object.data.trim())
      .map((object) => ({ url: object.url, etag: object.etag ?? '', ics: object.data as string }));
  }

  async function getResource(url: string, signal?: AbortSignal): Promise<DavResource> {
    const response = await createDavFetch(options, signal)(assertSafeUrl(url).toString(), { method: 'GET', headers: { accept: 'text/calendar' } });
    if (response.status !== 200) throw statusError(response.status, 'read event');
    return { url, etag: response.headers.get('etag') ?? '', ics: await response.text() };
  }

  function checkWrite(response: Response, what: string): void {
    if (response.status < 200 || response.status > 299) throw statusError(response.status, what);
  }

  async function createResource(collectionUrl: string, name: string, ics: string, signal?: AbortSignal): Promise<{ url: string }> {
    const dav = await tsdav();
    const base = collectionUrl.endsWith('/') ? collectionUrl : `${collectionUrl}/`;
    const response = await dav.createCalendarObject({
      calendar: { url: base }, filename: encodeURIComponent(name), iCalString: ics, fetch: createDavFetch(options, signal) as typeof fetch,
    });
    checkWrite(response, 'add event');
    return { url: new URL(encodeURIComponent(name), base).toString() };
  }

  async function updateResource(url: string, ics: string, etag: string, signal?: AbortSignal): Promise<void> {
    const dav = await tsdav();
    const response = await dav.updateCalendarObject({
      calendarObject: { url, data: ics, ...(etag ? { etag } : {}) }, fetch: createDavFetch(options, signal) as typeof fetch,
    });
    checkWrite(response, 'change event');
  }

  async function deleteResource(url: string, etag: string, signal?: AbortSignal): Promise<void> {
    const dav = await tsdav();
    const response = await dav.deleteCalendarObject({
      calendarObject: { url, ...(etag ? { etag } : {}) }, fetch: createDavFetch(options, signal) as typeof fetch,
    });
    checkWrite(response, 'delete event');
  }

  return { discover, listCalendars, queryEvents, getResource, createResource, updateResource, deleteResource };
}

