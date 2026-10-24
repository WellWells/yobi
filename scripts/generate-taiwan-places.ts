/**
 * Generates src/main/flow/skills/taiwanPlacesData.ts: every Taiwan township-level division
 * (鄉／鎮／市／區, 368 of them) with its county and one representative coordinate.
 *
 * Sources (both downloaded by hand; this script never touches the network):
 *  - Names, codes and boundaries: 內政部國土測繪中心「鄉(鎮、市、區)界線(TWD97經緯度)」
 *    (data.gov.tw dataset 7441, SHP, UTF-8). License: 政府資料開放授權條款－第1版
 *    (Open Government Data License, version 1.0), https://data.gov.tw/license
 *  - Coordinates: GeoNames Taiwan dump (download.geonames.org/export/dump/TW.zip), ADM3
 *    features. License: CC BY 4.0, https://www.geonames.org/
 *    GeoNames places a township at its town centre, which is what a weather lookup wants;
 *    a polygon centroid lands mid-mountain for districts like 高雄市桃源區.
 *
 * A township takes the GeoNames ADM3 point that lies inside its own polygon (by romanised name
 * when several do; romanisations differ, e.g. Tamsui/Danshui, so a lone point is taken as is);
 * with none it falls back to the polygon's area centroid (reported).
 *
 * Usage:
 *   npx tsx scripts/generate-taiwan-places.ts <TOWN_MOI_xxx.shp> <TOWN_MOI_xxx.dbf> <GeoNames TW.txt>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import OpenCC from 'opencc-js/t2cn';

type Ring = Array<[number, number]>;

interface TownRecord {
  townCode: string;
  county: string;
  town: string;
  townEng: string;
}

function readDbf(file: string): TownRecord[] {
  const buf = fs.readFileSync(file);
  const count = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);
  const fields: Array<{ name: string; len: number }> = [];
  for (let o = 32; buf[o] !== 0x0d; o += 32) {
    fields.push({ name: buf.toString('latin1', o, o + 11).replace(/\0.*$/s, ''), len: buf[o + 16] });
  }
  const rows: TownRecord[] = [];
  for (let i = 0; i < count; i++) {
    const start = headerLen + i * recordLen;
    let p = start + 1;
    const row: Record<string, string> = {};
    for (const f of fields) {
      row[f.name] = buf.toString('utf8', p, p + f.len).trim();
      p += f.len;
    }
    rows.push({ townCode: row.TOWNCODE, county: row.COUNTYNAME, town: row.TOWNNAME, townEng: row.TOWNENG });
  }
  return rows;
}

function readShpPolygons(file: string): Ring[][] {
  const buf = fs.readFileSync(file);
  const out: Ring[][] = [];
  let o = 100;
  while (o < buf.length) {
    const contentLen = buf.readInt32BE(o + 4) * 2;
    const rec = o + 8;
    const type = buf.readInt32LE(rec);
    if (type !== 5) throw new Error(`unexpected shape type ${type}`);
    const numParts = buf.readInt32LE(rec + 36);
    const numPoints = buf.readInt32LE(rec + 40);
    const parts: number[] = [];
    for (let i = 0; i < numParts; i++) parts.push(buf.readInt32LE(rec + 44 + i * 4));
    const pts = rec + 44 + numParts * 4;
    const rings: Ring[] = [];
    for (let i = 0; i < numParts; i++) {
      const end = i + 1 < numParts ? parts[i + 1] : numPoints;
      const ring: Ring = [];
      for (let j = parts[i]; j < end; j++) {
        ring.push([buf.readDoubleLE(pts + j * 16), buf.readDoubleLE(pts + j * 16 + 8)]);
      }
      rings.push(ring);
    }
    out.push(rings);
    o = rec + contentLen;
  }
  return out;
}

function insidePolygon(lon: number, lat: number, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function largestRingCentroid(rings: Ring[]): [number, number] {
  let best: { area: number; cx: number; cy: number } | null = null;
  for (const ring of rings) {
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += cross;
      cx += (ring[j][0] + ring[i][0]) * cross;
      cy += (ring[j][1] + ring[i][1]) * cross;
    }
    if (a === 0) continue;
    const area = Math.abs(a / 2);
    if (!best || area > best.area) best = { area, cx: cx / (3 * a), cy: cy / (3 * a) };
  }
  if (!best) throw new Error('degenerate polygon');
  return [best.cx, best.cy];
}

interface GeoPoint { name: string; lon: number; lat: number }

function readGeoNamesAdm3(file: string): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const cols = line.split('\t');
    if (cols[7] !== 'ADM3') continue;
    out.push({ name: cols[1], lon: Number(cols[5]), lat: Number(cols[4]) });
  }
  return out;
}

/** "Yongkang District" / "Yong'an Dist." → "yongkang"; romanisations differ only in punctuation and suffix. */
function romanStem(name: string): string {
  return name.toLowerCase().split(/\s+/)[0].replace(/[^a-z]/g, '');
}

/**
 * GeoNames' admin3 codes predate the 2010 municipality mergers (臺南 townships still carry R..
 * codes, the MOI file D..), so the join is spatial: the ADM3 point inside the township polygon
 * whose romanised name matches.
 */
function pickGeoPoint(town: TownRecord, rings: Ring[], points: GeoPoint[]): GeoPoint | null {
  const inside = points.filter((p) => insidePolygon(p.lon, p.lat, rings));
  if (inside.length === 1) return inside[0];
  const stem = romanStem(town.townEng);
  return inside.find((p) => romanStem(p.name) === stem) ?? null;
}

function main(): void {
  const [shpFile, dbfFile, geoFile] = process.argv.slice(2);
  if (!shpFile || !dbfFile || !geoFile) {
    console.error('usage: tsx scripts/generate-taiwan-places.ts <shp> <dbf> <GeoNames TW.txt>');
    process.exit(1);
  }
  const towns = readDbf(dbfFile);
  const polygons = readShpPolygons(shpFile);
  if (towns.length !== polygons.length) throw new Error('shp/dbf record count mismatch');
  const geo = readGeoNamesAdm3(geoFile);

  const rows: Array<{ code: string; county: string; town: string; lat: number; lon: number }> = [];
  towns.forEach((t, i) => {
    const point = pickGeoPoint(t, polygons[i], geo);
    let lonLat: [number, number];
    if (point) {
      lonLat = [point.lon, point.lat];
    } else {
      lonLat = largestRingCentroid(polygons[i]);
      const inside = geo.filter((p) => insidePolygon(p.lon, p.lat, polygons[i])).map((p) => p.name);
      console.warn(`fallback to centroid: ${t.county}${t.town} (${t.townEng}); ADM3 points inside: ${inside.join(' / ') || 'none'}`);
    }
    rows.push({ code: t.townCode, county: t.county, town: t.town, lat: lonLat[1], lon: lonLat[0] });
  });
  rows.sort((a, b) => a.code.localeCompare(b.code));

  const counties = new Set(rows.map((r) => r.county));
  if (rows.length !== 368 || counties.size !== 22) {
    throw new Error(`expected 368 towns in 22 counties, got ${rows.length} in ${counties.size}`);
  }

  // Every Traditional character in the table paired with its Simplified form, so 板桥 finds 板橋
  // (and 台 finds 臺) without shipping a converter.
  const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
  const chars = [...new Set(rows.flatMap((r) => [...`${r.county}${r.town}`]))].sort();
  const fold = chars.map((c) => [c, toSimplified(c)]).filter(([c, s]) => s !== c && [...s].length === 1);

  const lines = rows.map((r) => `  ['${r.county}', '${r.town}', ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}],`);
  const body = [
    '// Generated by scripts/generate-taiwan-places.ts. Do not edit by hand.',
    '// Names: 內政部國土測繪中心 鄉(鎮、市、區)界線, 政府資料開放授權條款－第1版 (https://data.gov.tw/license).',
    '// Coordinates: GeoNames (https://www.geonames.org/), CC BY 4.0.',
    '// [county, township, latitude, longitude], in official township-code order.',
    'export const TAIWAN_TOWNS: ReadonlyArray<readonly [string, string, number, number]> = [',
    ...lines,
    '];',
    '',
    '// Traditional/Simplified pairs for every character above that has a Simplified form.',
    `export const TAIWAN_CHAR_FOLD = '${fold.map(([c, s]) => `${c}${s}`).join('')}';`,
    '',
  ].join('\n');
  const outFile = path.resolve(__dirname, '..', 'src/main/flow/skills/taiwanPlacesData.ts');
  fs.writeFileSync(outFile, body, 'utf8');
  console.log(`wrote ${rows.length} towns in ${counties.size} counties to ${outFile}`);
}

main();
