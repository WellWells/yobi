/**
 * The operators' own route maps. No map file is kept in the app and no map URL is fixed: five of
 * the eight systems put a version in the file name (Taipei `routemap2026-…`, New Taipei a
 * base64 name plus an upload number, KRTC a hex id on its PDFs), so every map is found again on
 * the operator's page that shows it, then fetched from the operator's own host. Measured
 * 2026-10-22; `npm run test:rail` re-reads every page before a release.
 */
import { load } from 'cheerio';
import { railFetch, browserHeaders, RailHttpError } from '../rail/railHttp';
import type { MetroDeps } from './metroTypes';

export const METRO_MAP_SYSTEMS = ['taipei', 'airport', 'danhai', 'ankeng', 'circular', 'sanying', 'taichung', 'kaohsiung'] as const;
export type MetroMapSystem = (typeof METRO_MAP_SYSTEMS)[number];

interface MapSpec {
  /** The system as its operator names it, and in English. */
  zh: string;
  en: string;
  operator: string;
  /** The page a rider opens to see the map. */
  page: string;
  /** The page the image is found on (Taipei's map lives in an iframe, the airport line's on its intro page). */
  discover: string;
  image: string;
  /** A downloadable full map (PDF) next to the image, when the page has one. */
  pdf?: string;
  /** The hosts the image may come from: the operator's own. */
  host: RegExp;
}

const NTMETRO = /^www\.ntmetro\.com\.tw$/u;

const MAPS: Readonly<Record<MetroMapSystem, MapSpec>> = {
  // The iframe's download link is the full bilingual map (5867×8000, 2026-08-30); the image shown
  // inside the iframe is a 1280-wide WebP that Electron cannot decode, served as text/html.
  taipei: {
    zh: '台北捷運', en: 'Taipei Metro', operator: '臺北大眾捷運股份有限公司',
    page: 'https://www.metro.taipei/cp.aspx?n=73B51F32ED23C5E1',
    discover: 'https://web.metro.taipei/pages2026/WebRouteMap',
    image: 'a.routemap__download-link',
    host: /^web\.metro\.taipei$/u,
  },
  // The route page draws its map as inline SVG (with fares and express stops); the image is the
  // line's own intro map (2024-10). The older static PNG on the English page lists only five
  // express stops — A18 and A21 are missing — so it is not used.
  airport: {
    zh: '桃園機場捷運', en: 'Taoyuan Airport MRT', operator: '桃園大眾捷運股份有限公司',
    page: 'https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide/road.html',
    discover: 'https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide/road03.php',
    image: 'img[src*="road_intro"]',
    host: /^www\.tymetro\.com\.tw$/u,
  },
  danhai: {
    zh: '淡海輕軌', en: 'Danhai LRT', operator: '新北大眾捷運股份有限公司',
    page: 'https://www.ntmetro.com.tw/basic/?node=10070', discover: 'https://www.ntmetro.com.tw/basic/?node=10070',
    image: '#is-content img', pdf: '#is-content a[href*=".pdf"]', host: NTMETRO,
  },
  ankeng: {
    zh: '安坑輕軌', en: 'Ankeng LRT', operator: '新北大眾捷運股份有限公司',
    page: 'https://www.ntmetro.com.tw/basic/?node=10071', discover: 'https://www.ntmetro.com.tw/basic/?node=10071',
    image: '#is-content img', pdf: '#is-content a[href*=".pdf"]', host: NTMETRO,
  },
  circular: {
    zh: '環狀線', en: 'Circular Line', operator: '新北大眾捷運股份有限公司',
    page: 'https://www.ntmetro.com.tw/basic/?node=10069', discover: 'https://www.ntmetro.com.tw/basic/?node=10069',
    image: '#is-content img', pdf: '#is-content a[href*=".pdf"]', host: NTMETRO,
  },
  // Only a JPG (7016×9934); no PDF.
  sanying: {
    zh: '三鶯線', en: 'Sanying Line', operator: '新北大眾捷運股份有限公司',
    page: 'https://www.ntmetro.com.tw/basic/?node=10154', discover: 'https://www.ntmetro.com.tw/basic/?node=10154',
    image: '#is-content img', host: NTMETRO,
  },
  // 13161×13754, 4 MB; the same image serves the Chinese and English pages.
  taichung: {
    zh: '台中捷運', en: 'Taichung MRT', operator: '臺中捷運股份有限公司',
    page: 'https://www.tmrt.com.tw/metro-life/map', discover: 'https://www.tmrt.com.tw/metro-life/map',
    image: '#train-info img', host: /^www\.tmrt\.com\.tw$/u,
  },
  // One map for the MRT and the light rail. The JPG is small (1110×1530); the PDF is the full map.
  kaohsiung: {
    zh: '高雄捷運（含環狀輕軌）', en: 'Kaohsiung MRT and Circular LRT', operator: '高雄捷運股份有限公司',
    page: 'https://www.krtc.com.tw/Guide/guide_map', discover: 'https://www.krtc.com.tw/Guide/guide_map',
    image: 'img[usemap="#guideMap"]', pdf: 'a[href*="GuideMap"]', host: /^www\.krtc\.com\.tw$/u,
  },
};

export function mapSpec(system: MetroMapSystem): Readonly<MapSpec> {
  return MAPS[system];
}

export function isMapSystem(value: string): value is MetroMapSystem {
  return (METRO_MAP_SYSTEMS as readonly string[]).includes(value);
}

/** The links a map page shows, resolved against the page; undefined when the page no longer has them. */
export function findMapLinks(system: MetroMapSystem, html: string): { image?: string; pdf?: string } {
  const spec = MAPS[system];
  const $ = load(html);
  const pick = (selector: string): string | undefined => {
    const node = $(selector).first();
    const raw = (node.is('a') ? node.attr('href') : node.attr('src'))?.trim();
    if (!raw) return undefined;
    try {
      return new URL(raw, spec.discover).href;
    } catch {
      return undefined;
    }
  };
  const image = pick(spec.image);
  const pdf = spec.pdf ? pick(spec.pdf) : undefined;
  return { ...(image ? { image } : {}), ...(pdf ? { pdf } : {}) };
}

/** What the bytes are by their first bytes: the operators' servers mislabel types and answer a missing file with a 200 HTML page. */
export function sniffImage(bytes: Uint8Array): 'jpeg' | 'png' | undefined {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  return undefined;
}

/** The largest map measured is 7.9 MB (Taipei); anything far past that is not the map. */
const MAX_MAP_BYTES = 30_000_000;
const PAGE_TTL_MS = 6 * 60 * 60_000;

export interface FoundMap {
  system: MetroMapSystem;
  page: string;
  image: string;
  pdf?: string;
  bytes: Uint8Array;
  kind: 'jpeg' | 'png';
  /** The image's Last-Modified as the server sent it. */
  updated?: string;
}

async function fetchMapPage(system: MetroMapSystem, deps: MetroDeps): Promise<{ image?: string; pdf?: string }> {
  const spec = MAPS[system];
  return deps.memo(`map-page-${system}`, PAGE_TTL_MS, async () => {
    const res = await railFetch(deps.fetchFn, spec.discover, { headers: browserHeaders(spec.discover) }, deps.signal);
    if (!res.ok) throw new RailHttpError(res.status, spec.discover);
    return findMapLinks(system, await res.text());
  });
}

/** Finds the map on its page and downloads it. Throws when the page or the image is not what it was. */
export async function fetchMetroMap(system: MetroMapSystem, deps: MetroDeps): Promise<FoundMap> {
  const spec = MAPS[system];
  const links = await fetchMapPage(system, deps);
  if (!links.image) throw new Error(`The ${spec.en} map page no longer shows its map image (${spec.discover})`);
  const imageUrl = new URL(links.image);
  if (imageUrl.protocol !== 'https:' || !spec.host.test(imageUrl.hostname)) {
    throw new Error(`The ${spec.en} map image is on an unexpected host: ${imageUrl.host}`);
  }
  const res = await railFetch(deps.fetchFn, imageUrl.href, { headers: browserHeaders(imageUrl.href, { Referer: spec.discover }) }, deps.signal);
  if (!res.ok) throw new RailHttpError(res.status, imageUrl.href);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_MAP_BYTES) throw new Error(`The ${spec.en} map image is ${bytes.length} bytes, too large to be the map`);
  const kind = sniffImage(bytes);
  if (!kind) throw new Error(`The ${spec.en} map link did not return a JPEG or PNG (${imageUrl.href})`);
  const updated = res.headers.get('last-modified') ?? undefined;
  return {
    system, page: spec.page, image: imageUrl.href, bytes, kind,
    ...(links.pdf ? { pdf: links.pdf } : {}),
    ...(updated ? { updated } : {}),
  };
}
