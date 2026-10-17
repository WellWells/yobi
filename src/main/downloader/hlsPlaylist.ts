import { ProtectedStreamError, StreamFormatError } from './streamTypes';
import type { ByteRange, SegmentPlan, SegmentRef } from './streamTypes';

/*
 * HLS playlists (RFC 8216), parsed without fetching anything: a master playlist's variants and
 * renditions, a media playlist's segments as a `SegmentPlan` (TS or fMP4 with EXT-X-MAP,
 * EXT-X-BYTERANGE included). Only the standard tags are read; vendor tags are ignored. Any key
 * other than METHOD=NONE means the stream is encrypted or DRM'd: `ProtectedStreamError`.
 */

/** One `#EXT-X-STREAM-INF` entry: a rendition of the whole video at one bitrate. */
export interface HlsVariant {
  url: string;
  /** Peak bits per second (`BANDWIDTH`). */
  bandwidth: number;
  /** `AVERAGE-BANDWIDTH`, when given: the better size estimate. */
  averageBandwidth?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  /** `CODECS`, split: `['avc1.64001f', 'mp4a.40.2']`. */
  codecs: string[];
  /** The `AUDIO` group whose renditions carry this variant's sound, when it is separate. */
  audioGroup?: string;
}

/** One `#EXT-X-MEDIA` entry: an alternative audio, subtitles or video rendition. */
export interface HlsRendition {
  type: 'AUDIO' | 'VIDEO' | 'SUBTITLES' | 'CLOSED-CAPTIONS';
  groupId: string;
  name: string;
  language?: string;
  default: boolean;
  /** The rendition's media playlist; absent when its media is muxed into the variant. */
  url?: string;
  /** `CHANNELS` (`2`, `6`), when given. */
  channels?: number;
}

export interface HlsMaster {
  variants: HlsVariant[];
  renditions: HlsRendition[];
}

export interface HlsMediaPlaylist extends SegmentPlan {
  /** No `#EXT-X-ENDLIST`: a live or event playlist still growing. */
  live: boolean;
  /** How many of `segments` are media; the rest are fMP4 initialization sections. */
  mediaSegments: number;
}

/** The media playlist of each AUDIO group's sound: its DEFAULT rendition, else its first. */
export function audioByGroup(renditions: readonly HlsRendition[]): Map<string, string> {
  const groups = new Map<string, string>();
  const audio = renditions.filter((r) => r.type === 'AUDIO' && r.url);
  for (const r of [...audio.filter((a) => a.default), ...audio]) {
    if (!groups.has(r.groupId)) groups.set(r.groupId, r.url as string);
  }
  return groups;
}

/** `KEY="quoted, value",OTHER=plain` → a map; quoted values keep their commas. */
export function parseAttributes(text: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[2];
    attributes.set(match[1], raw.startsWith('"') ? raw.slice(1, -1) : raw.trim());
  }
  return attributes;
}

function tagValue(line: string): string {
  const colon = line.indexOf(':');
  return colon < 0 ? '' : line.slice(colon + 1);
}

function lines(text: string): string[] {
  return text.replace(/^﻿/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function requireHeader(all: readonly string[]): void {
  if (all[0] !== '#EXTM3U') throw new StreamFormatError('Not an HLS playlist (no #EXTM3U)');
}

function absolute(uri: string, base: string): string {
  try {
    return new URL(uri, base).toString();
  } catch {
    throw new StreamFormatError(`Bad URI in the playlist: ${uri.slice(0, 80)}`);
  }
}

function positive(value: string | undefined): number | undefined {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A master playlist lists variants; a media playlist lists segments. */
export function isHlsMaster(text: string): boolean {
  return /^#EXT-X-STREAM-INF:/m.test(text);
}

/** Throws `ProtectedStreamError` for a key that is not METHOD=NONE (session keys included). */
function checkKey(attributes: string): void {
  const key = parseAttributes(attributes);
  const method = (key.get('METHOD') ?? 'NONE').toUpperCase();
  if (method !== 'NONE') throw new ProtectedStreamError(`HLS ${method}${key.get('KEYFORMAT') ? ` ${key.get('KEYFORMAT')}` : ''}`);
}

/** The variants and renditions of a master playlist; URIs resolved against `baseUrl` (where it was fetched from). */
export function parseHlsMaster(text: string, baseUrl: string): HlsMaster {
  const all = lines(text);
  requireHeader(all);
  const variants: HlsVariant[] = [];
  const renditions: HlsRendition[] = [];
  let pending: Map<string, string> | null = null;
  for (const line of all) {
    if (line.startsWith('#EXT-X-SESSION-KEY:')) {
      checkKey(tagValue(line));
    } else if (line.startsWith('#EXT-X-MEDIA:')) {
      const a = parseAttributes(tagValue(line));
      const type = a.get('TYPE') as HlsRendition['type'] | undefined;
      if (!type || !['AUDIO', 'VIDEO', 'SUBTITLES', 'CLOSED-CAPTIONS'].includes(type)) continue;
      const uri = a.get('URI');
      const channels = positive(a.get('CHANNELS')?.split('/')[0]);
      renditions.push({
        type,
        groupId: a.get('GROUP-ID') ?? '',
        name: a.get('NAME') ?? '',
        ...(a.get('LANGUAGE') ? { language: a.get('LANGUAGE') } : {}),
        default: a.get('DEFAULT') === 'YES',
        ...(uri ? { url: absolute(uri, baseUrl) } : {}),
        ...(channels ? { channels } : {}),
      });
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pending = parseAttributes(tagValue(line));
    } else if (!line.startsWith('#') && pending) {
      const a = pending;
      pending = null;
      const [width, height] = (a.get('RESOLUTION') ?? '').split('x').map((n) => positive(n));
      const averageBandwidth = positive(a.get('AVERAGE-BANDWIDTH'));
      const frameRate = positive(a.get('FRAME-RATE'));
      variants.push({
        url: absolute(line, baseUrl),
        bandwidth: positive(a.get('BANDWIDTH')) ?? averageBandwidth ?? 0,
        ...(averageBandwidth ? { averageBandwidth } : {}),
        ...(width && height ? { width, height } : {}),
        ...(frameRate ? { frameRate } : {}),
        codecs: (a.get('CODECS') ?? '').split(',').map((c) => c.trim()).filter(Boolean),
        ...(a.get('AUDIO') ? { audioGroup: a.get('AUDIO') } : {}),
      });
    }
  }
  if (variants.length === 0) throw new StreamFormatError('The master playlist lists no variants');
  return { variants, renditions };
}

/** `1000@2000` → bytes 2000–2999; without `@`, the range starts where the last one of the same URI ended. */
function parseByteRange(text: string, next: number | undefined): ByteRange {
  const [lengthText, offsetText] = text.split('@');
  const length = Number(lengthText);
  const offset = offsetText !== undefined ? Number(offsetText) : next;
  if (!Number.isInteger(length) || length <= 0 || offset === undefined || !Number.isInteger(offset) || offset < 0) {
    throw new StreamFormatError(`Bad byte range in the playlist: ${text}`);
  }
  return { offset, length };
}

function sameRef(a: SegmentRef | null, b: SegmentRef): boolean {
  return a !== null && a.url === b.url && a.range?.offset === b.range?.offset && a.range?.length === b.range?.length;
}

/** A media playlist's segments as a plan; URIs resolved against `baseUrl`. Throws for a protected stream. */
export function parseHlsMedia(text: string, baseUrl: string): HlsMediaPlaylist {
  const all = lines(text);
  requireHeader(all);
  if (isHlsMaster(text)) throw new StreamFormatError('Expected a media playlist, got a master playlist');
  const segments: SegmentRef[] = [];
  let durationS = 0;
  let live = true;
  let extinf: number | null = null;
  let range: string | null = null;
  // Where the last byte range of each URI ended, for a BYTERANGE without an offset.
  const ends = new Map<string, number>();
  let map: SegmentRef | null = null;
  let mapPlaced: SegmentRef | null = null;
  let mediaCount = 0;
  for (const line of all) {
    if (line.startsWith('#EXT-X-KEY:')) {
      checkKey(tagValue(line));
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const a = parseAttributes(tagValue(line));
      const uri = a.get('URI');
      if (!uri) throw new StreamFormatError('EXT-X-MAP without a URI');
      const url = absolute(uri, baseUrl);
      const mapRange = a.get('BYTERANGE');
      map = { url, ...(mapRange ? { range: parseByteRange(mapRange, 0) } : {}) };
    } else if (line.startsWith('#EXTINF:')) {
      const seconds = Number(tagValue(line).split(',')[0]);
      extinf = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      range = tagValue(line);
    } else if (line === '#EXT-X-ENDLIST') {
      live = false;
    } else if (!line.startsWith('#')) {
      if (extinf === null) continue;
      const url = absolute(line, baseUrl);
      const segment: SegmentRef = { url };
      if (range !== null) {
        segment.range = parseByteRange(range, ends.get(url));
        ends.set(url, segment.range.offset + segment.range.length);
      }
      // The init section goes in front of the first segment, and again only where it changes.
      if (map && !sameRef(mapPlaced, map)) {
        segments.push(map);
        mapPlaced = map;
      }
      segments.push(segment);
      mediaCount += 1;
      durationS += extinf;
      extinf = null;
      range = null;
    }
  }
  if (mediaCount === 0) throw new StreamFormatError('The media playlist lists no segments');
  return { segments, durationS: Math.round(durationS * 1000) / 1000, live, mediaSegments: mediaCount };
}
