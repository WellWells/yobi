/**
 * The Internet Archive's copy of a page its site no longer has. It is asked only once the site says
 * the page is gone (404, 410) or its name no longer resolves: never for a page that is refused,
 * walled or slow, where an archived copy would get past the site instead of standing in for a page
 * that is no longer there. Asking sends the link to archive.org, so a name only a local network
 * knows is never asked about.
 */
import * as net from 'node:net';
import { dropTrackingParams } from '../../shared/trackingParams';

export interface ArchivedCopy {
  /** When it was taken, as the archive writes it: yyyymmddhhmmss. */
  timestamp: string;
  /** The address the archive holds it under. */
  original: string;
}

const LOOKUP = 'https://archive.org/wayback/available?url=';
/** Before the archive's first copy of anything: asking for the copy closest to it gives the first one. */
const BEFORE_ANY_COPY = '19960101';

/**
 * Which copy to ask for. The newest holds the most of a page (a thread's later replies), but a site
 * that closed often left a notice at its pages' addresses at the end: Engadget 中文版's last copies
 * of its articles are its farewell banner. The first copy was taken while the page was new.
 */
export type ArchivedCopyChoice = 'newest' | 'first';
const SNAPSHOT = /^https?:\/\/web\.archive\.org\/web\/(\d{14})\/(https?:\/\/.+)$/;
/** Names that only a local network or a test setup knows (RFC 6761, RFC 8375 and the usual private ones). */
const LOCAL_SUFFIX = /\.(?:local|localhost|lan|home|internal|intranet|corp|private|test|invalid|example|home\.arpa)\.?$/i;

/** Where to ask for a copy of `url`; null for a link that is not to be sent to the archive. */
export function archiveLookupAddress(url: string, choice: ArchivedCopyChoice = 'newest'): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host.includes('.') || net.isIP(host) || LOCAL_SUFFIX.test(host)) return null;
  u.hash = '';
  // The archive holds a page under the address it was found at, which a share's fbclid is not.
  dropTrackingParams(u);
  const when = choice === 'first' ? `&timestamp=${BEFORE_ANY_COPY}` : '';
  return `${LOOKUP}${encodeURIComponent(u.href)}${when}`;
}

/** The copy the lookup answered with: one the archive took of a page that answered 200. */
export function archivedCopyOf(answer: string): ArchivedCopy | null {
  let closest: unknown;
  try {
    closest = (JSON.parse(answer) as { archived_snapshots?: { closest?: unknown } } | null)?.archived_snapshots?.closest;
  } catch {
    return null;
  }
  if (!closest || typeof closest !== 'object') return null;
  const { available, status, url } = closest as Record<string, unknown>;
  if (available !== true || status !== '200' || typeof url !== 'string') return null;
  const match = SNAPSHOT.exec(url);
  return match?.[1] && match[2] ? { timestamp: match[1], original: match[2] } : null;
}

/** The page as the site sent it, without the archive's toolbar or its rewritten links. */
export function rawSnapshotAddress(copy: ArchivedCopy): string {
  return `https://web.archive.org/web/${copy.timestamp}id_/${copy.original}`;
}

/** The copy for a person to open. */
export function snapshotAddress(copy: ArchivedCopy): string {
  return `https://web.archive.org/web/${copy.timestamp}/${copy.original}`;
}

/** The day it was taken, yyyy-mm-dd. */
export function snapshotDay(copy: ArchivedCopy): string {
  const { timestamp } = copy;
  return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
}
