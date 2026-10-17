/**
 * TRA's fine-grained train classes (the ODS `CarClass`, TDX `TrainTypeID`) folded into the categories
 * a rider uses. The class → code pairs follow TDX's `v3/Rail/TRA/TrainType` list; the ODS
 * timetable carries only the class, so the fold has to live here.
 */
const CATEGORY_BY_CODE: Readonly<Record<string, readonly [zh: string, en: string]>> = {
  '1': ['太魯閣', 'Taroko Express'],
  '2': ['普悠瑪', 'Puyuma Express'],
  '3': ['自強', 'Tze-Chiang Express'],
  '4': ['莒光', 'Chu-Kuang Express'],
  '5': ['復興', 'Fu-Hsing Semi Express'],
  '6': ['區間', 'Local Train'],
  '7': ['普快', 'Ordinary Train'],
  '10': ['區間快', 'Fast Local Train'],
  '11': ['自強3000', 'Tze-Chiang 3000 Express'],
};

export const TRA_CLASS_CODES: Readonly<Record<string, string>> = {
  '1100': '3', '1101': '1', '1102': '3', '1103': '3', '1104': '3', '1105': '3', '1106': '3', '1107': '2',
  '1108': '3', '1109': '3', '110A': '3', '110B': '3', '110C': '3', '110D': '3', '110E': '3', '110F': '3',
  '110G': '11', '110H': '11', '110K': '11', '110M': '11',
  '1110': '4', '1111': '4', '1112': '4', '1113': '4', '1114': '4', '1115': '4',
  '1120': '5', '1121': '5', '1122': '5',
  '1130': '6', '1131': '6', '1132': '10', '1133': '6', '1134': '6', '1135': '6',
  '113A': '6', '113B': '6', '113C': '6', '113D': '6',
  '1140': '7', '1141': '6', '1150': '7', '1151': '7', '1152': '5', '1154': '6', '1155': '5',
  '1270': '7', '1280': '7', '1281': '7', '1282': '7', '12A0': '7', '12A1': '7', '12B0': '7',
  '4200': '7', '5230': '7',
};

/** The category of a TRA class; an unknown class is shown as its code rather than guessed. */
export function traTypeName(carClass: string): { zh: string; en: string } {
  const code = TRA_CLASS_CODES[carClass];
  const category = code ? CATEGORY_BY_CODE[code] : undefined;
  if (!category) return { zh: carClass, en: carClass };
  return { zh: category[0], en: category[1] };
}

/** The category from TRA's own page, which prints it fused to the train number. */
export function traTypeFromLabel(label: string): string {
  const names = Object.values(CATEGORY_BY_CODE).map(([zh]) => zh).sort((a, b) => b.length - a.length);
  return names.find((name) => label.startsWith(name)) ?? label.replace(/\d+$/, '');
}
