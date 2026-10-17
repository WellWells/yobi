import { load } from 'cheerio';
import { ProtectedStreamError, StreamFormatError } from './streamTypes';
import type { ByteRange, SegmentPlan, SegmentRef } from './streamTypes';
import { expandTemplate, templateSegments } from './dashTemplate';

/*
 * A DASH manifest (MPD), parsed without fetching anything: each representation of the first
 * period with its segments as a `SegmentPlan` — a single file (BaseURL, SegmentBase), a
 * SegmentList, or a SegmentTemplate with $Number$ or $Time$ and a SegmentTimeline. Any
 * `ContentProtection` means DRM: `ProtectedStreamError`. A dynamic (live) manifest is refused.
 */

export interface DashRepresentation {
  id: string;
  contentType: 'video' | 'audio' | 'text' | 'other';
  mimeType: string;
  /** `avc1.64001f`, `mp4a.40.2`. */
  codecs: string;
  /** Bits per second. */
  bandwidth: number;
  width?: number;
  height?: number;
  frameRate?: number;
  language?: string;
  plan: SegmentPlan;
}

export interface DashManifest {
  durationS: number;
  representations: DashRepresentation[];
}

/** An element as the parser reads it: its local name (`mpd:Period` → `Period`), attributes, child elements and text. */
interface XmlNode {
  name: string;
  attrs: Readonly<Record<string, string>>;
  children: XmlNode[];
  text: string;
}

/** The parts of htmlparser2's nodes read here. */
interface DomLike {
  type: string;
  name?: string;
  attribs?: Record<string, string>;
  children?: DomLike[];
  data?: string;
}

function toNode(dom: DomLike): XmlNode {
  const children: XmlNode[] = [];
  let text = '';
  for (const kid of dom.children ?? []) {
    if (kid.type === 'tag') children.push(toNode(kid));
    else if (kid.type === 'text') text += kid.data ?? '';
    else if (kid.type === 'cdata') text += (kid.children ?? []).map((c) => c.data ?? '').join('');
  }
  const name = dom.name ?? '';
  return { name: name.slice(name.indexOf(':') + 1), attrs: dom.attribs ?? {}, children, text: text.trim() };
}

/** The document's root element, entities decoded (a BaseURL's `&amp;` included). */
function parseXml(xml: string): XmlNode | undefined {
  const $ = load(xml, { xml: true });
  const root = $.root().toArray()[0] as unknown as DomLike | undefined;
  return root ? toNode(root).children[0] : undefined;
}

function all(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name);
}

function first(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name);
}

function find(node: XmlNode, name: string): XmlNode | undefined {
  if (node.name === name) return node;
  for (const kid of node.children) {
    const hit = find(kid, name);
    if (hit) return hit;
  }
  return undefined;
}

function num(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** `30000/1001` or `25`. */
function frameRate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [a, b] = value.split('/').map(Number);
  const rate = b ? a / b : a;
  return Number.isFinite(rate) && rate > 0 ? Math.round(rate * 100) / 100 : undefined;
}

/** ISO 8601 durations as MPDs write them: `PT1H2M3.5S`, `P1DT0S`. */
export function parseIsoDuration(text: string | undefined): number {
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec((text ?? '').trim());
  if (!match) return 0;
  const [d, h, m, s] = match.slice(1).map((part) => Number(part ?? 0));
  return d * 86_400 + h * 3_600 + m * 60 + s;
}

/** `100-199` → bytes 100–199. */
function parseRange(text: string | undefined): ByteRange | undefined {
  const match = /^(\d+)-(\d+)$/.exec((text ?? '').trim());
  if (!match) return undefined;
  const offset = Number(match[1]);
  const length = Number(match[2]) - offset + 1;
  if (length <= 0) throw new StreamFormatError(`Bad byte range in the manifest: ${text}`);
  return { offset, length };
}

function resolve(uri: string, base: string): string {
  try {
    return new URL(uri, base).toString();
  } catch {
    throw new StreamFormatError(`Bad URL in the manifest: ${uri.slice(0, 80)}`);
  }
}

/** The element's own BaseURL resolved against its parent's. */
function baseOf(node: XmlNode, parentBase: string): string {
  const text = first(node, 'BaseURL')?.text ?? '';
  return text ? resolve(text, parentBase) : parentBase;
}

/** The same-named element on the representation, its adaptation set and period, attributes inherited downwards. */
function inherited(name: string, levels: readonly XmlNode[]): { attrs: Record<string, string>; node?: XmlNode; timeline?: XmlNode } {
  const attrs: Record<string, string> = {};
  let node: XmlNode | undefined;
  let timeline: XmlNode | undefined;
  for (const level of levels) {
    const el = first(level, name);
    if (!el) continue;
    node ??= el;
    timeline ??= first(el, 'SegmentTimeline');
    for (const [key, value] of Object.entries(el.attrs)) attrs[key] ??= value;
  }
  return { attrs, ...(node ? { node } : {}), ...(timeline ? { timeline } : {}) };
}

function contentTypeOf(mimeType: string, declared: string): DashRepresentation['contentType'] {
  const kind = declared || mimeType.split('/')[0];
  return kind === 'video' || kind === 'audio' || kind === 'text' ? kind : 'other';
}

interface RepContext {
  /** Representation, adaptation set, period: the most specific first. */
  levels: readonly XmlNode[];
  base: string;
  /** Where the manifest came from: a base still equal to it means no BaseURL was given. */
  manifestUrl: string;
  durationS: number;
  id: string;
  bandwidth: number;
}

function segmentListRefs(list: XmlNode, base: string): SegmentRef[] {
  const segments: SegmentRef[] = [];
  const init = first(list, 'Initialization');
  if (init) {
    const range = parseRange(init.attrs.range);
    segments.push({ url: resolve(init.attrs.sourceURL ?? '', base), ...(range ? { range } : {}) });
  }
  for (const entry of all(list, 'SegmentURL')) {
    const range = parseRange(entry.attrs.mediaRange);
    segments.push({ url: resolve(entry.attrs.media ?? '', base), ...(range ? { range } : {}) });
  }
  return segments;
}

function representationPlan(ctx: RepContext): SegmentPlan {
  const template = inherited('SegmentTemplate', ctx.levels);
  if (template.node) {
    const vars = { RepresentationID: ctx.id, Bandwidth: ctx.bandwidth };
    const segments: SegmentRef[] = [];
    const init = template.attrs.initialization;
    if (init) segments.push({ url: resolve(expandTemplate(init, vars), ctx.base) });
    const timeline = template.timeline ? all(template.timeline, 'S').map((s) => s.attrs) : undefined;
    for (const media of templateSegments(template.attrs, timeline, ctx.durationS)) {
      segments.push({ url: resolve(expandTemplate(template.attrs.media ?? '', { ...vars, ...media }), ctx.base) });
    }
    return { segments, durationS: ctx.durationS };
  }
  const list = inherited('SegmentList', ctx.levels).node;
  if (list) return { segments: segmentListRefs(list, ctx.base), durationS: ctx.durationS };
  // BaseURL alone (with or without SegmentBase): the whole file, which holds its own index.
  // Without any BaseURL the "file" would be the manifest itself.
  if (ctx.base === ctx.manifestUrl) throw new StreamFormatError(`Representation ${ctx.id} has no media URL`);
  return { segments: [{ url: ctx.base }], durationS: ctx.durationS };
}

/** The representations of the manifest's first period; URLs resolved against `baseUrl` (where it was fetched from). */
export function parseDashManifest(xml: string, baseUrl: string): DashManifest {
  const mpd = parseXml(xml);
  if (mpd?.name !== 'MPD') throw new StreamFormatError('Not a DASH manifest (no MPD)');
  // Anywhere in the manifest: a protected adaptation set is never picked, so none is downloaded.
  const protection = find(mpd, 'ContentProtection');
  if (protection) throw new ProtectedStreamError(`DASH ${protection.attrs.schemeIdUri ?? 'ContentProtection'}`);
  if ((mpd.attrs.type ?? 'static') === 'dynamic') throw new StreamFormatError('The manifest is live', true);
  const period = first(mpd, 'Period');
  if (!period) throw new StreamFormatError('The manifest has no period');
  const durationS = parseIsoDuration(period.attrs.duration) || parseIsoDuration(mpd.attrs.mediaPresentationDuration);
  const periodBase = baseOf(period, baseOf(mpd, baseUrl));
  const representations: DashRepresentation[] = [];
  for (const set of all(period, 'AdaptationSet')) {
    const setBase = baseOf(set, periodBase);
    for (const rep of all(set, 'Representation')) {
      const attr = (name: string): string | undefined => rep.attrs[name] ?? set.attrs[name];
      const mimeType = attr('mimeType') ?? '';
      const id = rep.attrs.id ?? '';
      const bandwidth = num(rep.attrs.bandwidth) ?? 0;
      const width = num(attr('width'));
      const height = num(attr('height'));
      const rate = frameRate(attr('frameRate'));
      const lang = set.attrs.lang ?? rep.attrs.lang;
      representations.push({
        id,
        contentType: contentTypeOf(mimeType, set.attrs.contentType ?? ''),
        mimeType,
        codecs: attr('codecs') ?? '',
        bandwidth,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        ...(rate ? { frameRate: rate } : {}),
        ...(lang ? { language: lang } : {}),
        plan: representationPlan({ levels: [rep, set, period], base: baseOf(rep, setBase), manifestUrl: baseUrl, durationS, id, bandwidth }),
      });
    }
  }
  if (representations.length === 0) throw new StreamFormatError('The manifest lists no representations');
  return { durationS, representations };
}
