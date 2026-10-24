/**
 * Taoyuan Airport MRT (機場捷運) stations in revenue service, as TYMC's timetable search lists them
 * (2026-10-22): A1…A13, A14a, A15…A22. A14 (機場第三航廈) is not open — the search does not offer
 * it, although its internal id 14 still returns rows. `ref` is the search form's station id;
 * A14a takes 15, so from A15 on the id is the number plus one.
 *
 * The form prints names with 站 ("A2 三重站", "A1 台北車站"); `zh` drops that suffix except where
 * it is part of the name (台北車站), and `en` drops " Station" except in "Taipei Main Station" —
 * the English site's own labels otherwise.
 */
import type { MetroStation } from './metroTypes';

function station(code: string, ref: number, zh: string, en: string): MetroStation {
  return { network: 'tymc', codes: [code], zh, en, lines: ['A'], ref: String(ref) };
}

export const TYMC_STATIONS: readonly MetroStation[] = [
  station('A1', 1, '台北車站', 'Taipei Main Station'),
  station('A2', 2, '三重', 'Sanchong'),
  station('A3', 3, '新北產業園區', 'New Taipei Industrial Park'),
  station('A4', 4, '新莊副都心', 'Xinzhuang Fuduxin'),
  station('A5', 5, '泰山', 'Taishan'),
  station('A6', 6, '泰山貴和', 'Taishan Guihe'),
  station('A7', 7, '體育大學', 'National Taiwan Sport University'),
  station('A8', 8, '長庚醫院', 'Chang Gung Memorial Hospital'),
  station('A9', 9, '林口', 'Linkou'),
  station('A10', 10, '山鼻', 'Shanbi'),
  station('A11', 11, '坑口', 'Kengkou'),
  station('A12', 12, '機場第一航廈', 'Airport Terminal 1'),
  station('A13', 13, '機場第二航廈', 'Airport Terminal 2'),
  station('A14a', 15, '機場旅館', 'Airport Hotel'),
  station('A15', 16, '大園', 'Dayuan'),
  station('A16', 17, '橫山', 'Hengshan'),
  station('A17', 18, '領航', 'Linghang'),
  station('A18', 19, '高鐵桃園', 'Taoyuan HSR'),
  station('A19', 20, '桃園體育園區', 'Taoyuan Sports Park'),
  station('A20', 21, '興南', 'Xingnan'),
  station('A21', 22, '環北', 'Huanbei'),
  station('A22', 23, '老街溪', 'Laojie River'),
];

/** The search form's option label for a station ("A2 三重站", "A1 台北車站"). */
export function tymcOptionLabel(s: MetroStation): string {
  return `${s.codes[0]} ${s.zh.endsWith('站') ? s.zh : `${s.zh}站`}`;
}
