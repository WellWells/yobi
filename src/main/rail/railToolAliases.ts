/**
 * The other names models give the rail connector's arguments and options, declared on the schemas
 * (`mcp/schemaAliases.ts`) so a call made from a one-line summary, without the schema in view, still
 * goes through. Each word maps to one option only: a word that could mean two (sort "time") is left
 * out and refused with the real values.
 */
import { ALSO_NAMED, ENUM_ALIASES, lookupAlias } from '../mcp/schemaAliases';

/** `{ option: [words] }` → `{ word: option }`; both 台 and 臺 spellings of each word. A word under two options throws. */
function aliasTable(groups: Readonly<Record<string, readonly string[]>>): Record<string, string> {
  const table: Record<string, string> = {};
  for (const [option, words] of Object.entries(groups)) {
    for (const word of words.flatMap((w) => [w, w.replaceAll('台', '臺')])) {
      const taken = lookupAlias(table, word);
      if (taken !== null && taken !== option) throw new Error(`alias "${word}" means both ${taken} and ${option}`);
      table[word] = option;
    }
  }
  return table;
}

export function alsoNamed(...names: string[]): { [ALSO_NAMED]: string[] } {
  return { [ALSO_NAMED]: names };
}

export function enumAliases(groups: Readonly<Record<string, readonly string[]>>): { [ENUM_ALIASES]: Record<string, string> } {
  return { [ENUM_ALIASES]: aliasTable(groups) };
}

export const FROM_NAMES = alsoNamed('origin', 'source', 'start', 'start_station', 'departure', 'departure_station', 'from_station');
export const TO_NAMES = alsoNamed('destination', 'dest', 'end', 'end_station', 'arrival', 'arrival_station', 'to_station');

export const TIME_IS_ALIASES = enumAliases({
  depart: ['after', 'departure', 'depart_after', 'leave', 'leave_at', 'leave_after', '出發'],
  arrive: ['before', 'arrival', 'arrive_by', 'arrive_before', 'by', '抵達', '到達'],
});

export const SORT_ALIASES = enumAliases({
  earliest_arrival: ['fastest', 'arrival', 'arrival_time', 'earliest_arrive', '最快', '最快到', '最早到'],
  shortest: ['duration', 'travel_time', 'ride_time', 'shortest_duration', 'shortest_time', '車程最短'],
  earliest_departure: ['next', 'departure', 'departure_time', 'earliest_depart', '下一班', '最早出發'],
});

const THSR_WORDS = ['hsr', 'high_speed_rail', 'high_speed', '高鐵'];
const TRA_WORDS = ['tr', 'train', 'trains', 'railway', 'taiwan_railway', '台鐵', '火車'];

export const MODES_ALIASES = enumAliases({
  thsr: THSR_WORDS,
  tra: TRA_WORDS,
  any: ['both', 'all', 'thsr,tra', 'tra,thsr', 'hsr,tra', 'tra,hsr'],
});

export const TRAIN_MODE_ALIASES = enumAliases({ thsr: THSR_WORDS, tra: TRA_WORDS, auto: ['any', 'both', 'all'] });

/** One word of `modes` (a list item too) read as `thsr` / `tra` / `any`, or as itself in lower case. */
export function modeWord(word: string): string {
  return lookupAlias(MODES_ALIASES[ENUM_ALIASES], word) ?? word.trim().toLowerCase();
}

/** Not `line`: a line (BR, 文湖線) is narrower than a system and would be refused as one. */
export const SYSTEM_NAMES = alsoNamed('operator', 'metro', 'network', 'city', 'system_name');

const TAIPEI = ['trtc', 'taipei_metro', 'taipei_mrt', '台北捷運', '北捷'];
const AIRPORT = ['tymc', 'tymetro', 'taoyuan', 'taoyuan_metro', 'taoyuan_mrt', 'taoyuan_airport_mrt', 'airport_mrt', 'airport_metro', '機場捷運', '機捷', '桃園捷運', '桃園機場捷運', '桃捷'];
const TAICHUNG = ['tmrt', 'taichung_metro', 'taichung_mrt', '台中捷運', '中捷'];
const KAOHSIUNG = ['krtc', 'krt', 'kmrt', 'kaohsiung_metro', 'kaohsiung_mrt', 'kaohsiung_lrt', 'krtc_light_rail', '高雄捷運', '高捷', '高雄輕軌', '環狀輕軌'];
const DANHAI = ['danhai_lrt', 'danhai_light_rail', '淡海輕軌'];
const ANKENG = ['ankeng_lrt', 'ankeng_light_rail', '安坑輕軌'];
const SANYING = ['sanying_line', '三鶯線'];
const CIRCULAR = ['circular_line', '環狀線'];

/** metro_status / metro_tickets: New Taipei Metro answers for all four of its lines. */
export const OPERATOR_ALIASES = enumAliases({
  taipei: TAIPEI,
  airport: AIRPORT,
  new_taipei: ['ntmc', 'ntmetro', 'new_taipei_metro', '新北捷運', 'danhai', 'ankeng', 'sanying', 'circular', ...DANHAI, ...ANKENG, ...SANYING, ...CIRCULAR],
  taichung: TAICHUNG,
  kaohsiung: KAOHSIUNG,
});

/** metro_map: one map per line system, so New Taipei's lines stay apart. */
export const MAP_SYSTEM_ALIASES = enumAliases({
  taipei: TAIPEI,
  airport: AIRPORT,
  danhai: DANHAI,
  ankeng: ANKENG,
  sanying: SANYING,
  circular: CIRCULAR,
  taichung: TAICHUNG,
  kaohsiung: KAOHSIUNG,
});
