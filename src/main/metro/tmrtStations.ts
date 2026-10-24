/**
 * Taichung MRT's Green line (綠線), the only line, as its own site lists it (`api/public/Site/AllSite`,
 * 2026-10-22): 18 stations from 北屯總站 (103a) to 高鐵臺中站 (119), each keyed by the code on its
 * signs and carrying the GUID the site's own requests take. Names are `SiteName` / `SiteNameEn`
 * with the API's stray tabs and doubled spaces ("Wenxin   Chongde") collapsed. The open data on
 * data.taichung.gov.tw is a 2023 copy with older names; it is not used. The self-test compares this
 * table with the live list.
 */
import type { MetroStation } from './metroTypes';

/** GUID, sign code, zh, en — in line order, 北屯總站 first. */
type Row = readonly [id: string, code: string, zh: string, en: string];

const ROWS: readonly Row[] = [
  ['0afa3027-e0cd-43a2-902b-c3081efd3b27', '103a', '北屯總站', 'Beitun Main Station'],
  ['9396045b-31bb-4135-96ad-0b5040bd4aeb', '103', '舊社', 'Jiushe'],
  ['8cbc2661-c30e-417e-bfe5-69c7fd559f77', '104', '松竹', 'Songzhu'],
  ['95ea9819-79c6-4069-bee9-80e09f9ceb75', '105', '四維國小', 'Sihwei Elementary School'],
  ['080ccba5-84e9-4b23-9800-84a68fa614f7', '106', '文心崇德', 'Wenxin Chongde'],
  ['f911489b-497e-45ef-bafa-2876083b8458', '107', '文心中清', 'Wenxin Zhongqing'],
  ['4f85d84b-06d9-40de-a2d3-c9c54f58119a', '108', '文華高中', 'Wenhua Senior High School'],
  ['17e62fc0-7e3f-42a8-80ce-c597136e6f99', '109', '文心櫻花', 'Wenxin Yinghua'],
  ['82361949-b015-4435-aab6-75166d4b5681', '110', '市政府', 'Taichung City Hall'],
  ['6f55e961-4add-4b24-82ba-d477d47c771a', '111', '水安宮', 'Shui-an Temple'],
  ['52c7f0f6-47b2-4341-bcb8-6485aeab0279', '112', '文心森林公園', 'Wenxin Forest Park'],
  ['04daa9f4-d7d2-4099-8b90-a9f77ca7c201', '113', '南屯', 'Nantun'],
  ['c089d378-8398-4d04-9efa-3aeaa73ed5f2', '114', '豐樂公園', 'Feng-le Park'],
  ['a4c466b9-9cca-4b27-8be1-5734134aa4c8', '115', '大慶', 'Daqing'],
  ['0f61a447-86c5-4bdd-9282-aab066e1acfc', '116', '九張犁', 'Jiuzhangli'],
  ['34b7d9a2-228f-4c84-a969-72a7cfda0a82', '117', '九德', 'Jiude'],
  ['d2da6396-1db1-484e-8c4e-9eae063dcf88', '118', '烏日', 'Wuri'],
  ['6b0c61b9-4b22-4332-8483-db4a0828cedc', '119', '高鐵臺中站', 'HSR Taichung Station'],
];

/** The site's two direction names: the ends of the line. */
export const TMRT_TERMINALS = { south: '高鐵臺中站', north: '北屯總站' } as const;

export const TMRT_LINE_NAME = '綠線';

export const TMRT_STATIONS: readonly MetroStation[] = ROWS.map(([id, code, zh, en]) => ({
  network: 'tmrt', codes: [code], zh, en, lines: ['G'], ref: id,
}));

/** The API's names carry tabs and runs of spaces; the signs do not. */
export function tidyTmrtName(name: string): string {
  return name.replace(/\s+/gu, ' ').trim();
}

/** A station's place along the line, 0 = 北屯總站; -1 when it is not Taichung MRT's. */
export function tmrtIndex(station: MetroStation): number {
  return station.network === 'tmrt' ? ROWS.findIndex((row) => row[0] === station.ref) : -1;
}

export function tmrtStationByCode(code: string): MetroStation | undefined {
  return TMRT_STATIONS.find((station) => station.codes[0] === code.toLowerCase());
}
