import type * as Tyme from 'tyme4ts';
import { toHant } from './almanacHant';

/**
 * One day of the farmer's almanac (農民曆), field for field what tw.piliapp.com/lunar shows.
 * The computation is tyme4ts (6tail): astronomical new moons and solar terms in China time for the
 * date, and the 協紀辨方書 tables for activities and spirits. The one decision made here is
 * presentation — Traditional characters, 冬月/臘月, 正-prefixed god directions, the year by the
 * lunar new year — each pinned against piliapp captures.
 */
export interface AlmanacDay {
  date: string;
  weekday: string;
  lunar: string;
  lunarYear: string;
  zodiac: string;
  monthPillar: string;
  dayPillar: string;
  dayType: string;
  dutyGod: string;
  yi: string[];
  ji: string[];
  goodHours: string[];
  clash: string;
  evilDirection: string;
  officer: string;
  mansion: string;
  joyGod: string;
  wealthGod: string;
  nayin: string;
  luckyGods: string[];
  unluckyGods: string[];
  pengzu: string[];
  fetusGod: string;
  solarTerm: string;
  solarTermDay: number;
  festival: string;
}

export type AlmanacScript = 'hant' | 'hans';

export interface YmdDate {
  year: number;
  month: number;
  day: number;
}

type TymeModule = typeof Tyme;

let tymeModule: Promise<TymeModule> | null = null;

/** tyme4ts carries ~290 KB of tables; only an almanac lookup pays for parsing them. */
function loadTyme(): Promise<TymeModule> {
  tymeModule ??= import('tyme4ts');
  return tymeModule;
}

const HOUR_RANGES = ['23-1', '1-3', '3-5', '5-7', '7-9', '9-11', '11-13', '13-15', '15-17', '17-19', '19-21', '21-23'] as const;

const HOUR_BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;

// 青龍 takes the hour of this branch on a day of the indexed branch: 子午 → 申, 丑未 → 戌, 寅申 → 子,
// 卯酉 → 寅, 辰戌 → 辰, 巳亥 → 午; then 明堂, 天刑, 朱雀, 金匱, 天德, 白虎, 玉堂, 天牢, 玄武, 司命, 勾陳.
const DRAGON_HOUR = [8, 10, 0, 2, 4, 6, 8, 10, 0, 2, 4, 6] as const;
const GOOD_OFFSETS = new Set([0, 1, 4, 5, 7, 10]); // 青龍 明堂 金匱 天德 玉堂 司命

/**
 * The 黃道 hours of a day, by its branch — the same as tyme4ts's per-hour twelve stars, which cost
 * ~1.7 ms a day (95% of a day's almanac) and made a year of good-day search take seconds. A day's
 * 子 is its own early 子 at 00:00, as piliapp shows it, not the late one belonging to the next day.
 */
export function goodHourBranches(dayBranch: number): number[] {
  return HOUR_BRANCHES.map((_, i) => i).filter((i) => GOOD_OFFSETS.has((i - DRAGON_HOUR[dayBranch] + 12) % 12));
}

function lunarMonthName(name: string): string {
  return name.replace(/十一月$/, '冬月').replace(/十二月$/, '腊月');
}

/** A god's bearing on one of the four sides reads 正北, the way almanacs print it. */
function godDirection(name: string): string {
  return name.length === 1 ? `正${name}` : name;
}

function buildDay(solar: Tyme.SolarDay, script: AlmanacScript): AlmanacDay {
  const conv = script === 'hant' ? toHant : (s: string): string => s;
  const list = (items: { getName(): string }[]): string[] => items.map((x) => conv(x.getName()));
  const lunarDay = solar.getLunarDay();
  const lunarMonth = lunarDay.getLunarMonth();
  const lunarYear = lunarMonth.getLunarYear().getSixtyCycle();
  const cycleDay = solar.getSixtyCycleDay();
  const day = cycleDay.getSixtyCycle();
  const stem = day.getHeavenStem();
  const branch = day.getEarthBranch();
  const opposite = branch.getOpposite();
  const star = cycleDay.getTwelveStar();
  const gods = cycleDay.getGods();
  const termDay = solar.getTermDay();
  const isLuck = (g: Tyme.God, luck: string): boolean => g.getLuck().getName() === luck;
  const goodHours = goodHourBranches(branch.getIndex()).map((i) => `${HOUR_BRANCHES[i]} (${HOUR_RANGES[i]})`);
  const festival = lunarDay.getFestival();
  const p = (n: number): string => String(n).padStart(2, '0');
  return {
    date: `${solar.getYear()}-${p(solar.getMonth())}-${p(solar.getDay())}`,
    weekday: conv(`星期${solar.getWeek().getName()}`),
    lunar: conv(`${lunarMonthName(lunarMonth.getName())}${lunarDay.getName()}`),
    lunarYear: lunarYear.getName(),
    zodiac: conv(lunarYear.getEarthBranch().getZodiac().getName()),
    monthPillar: cycleDay.getMonth().getName(),
    dayPillar: day.getName(),
    dayType: conv(star.getEcliptic().getName()),
    dutyGod: conv(star.getName()),
    yi: list(cycleDay.getRecommends()),
    ji: list(cycleDay.getAvoids()),
    goodHours,
    clash: conv(`${opposite.getName()}（${opposite.getZodiac().getName()}）`),
    evilDirection: conv(branch.getOminous().getName()),
    officer: conv(cycleDay.getDuty().getName()),
    mansion: conv(cycleDay.getTwentyEightStar().getName()),
    joyGod: conv(godDirection(stem.getJoyDirection().getName())),
    wealthGod: conv(godDirection(stem.getWealthDirection().getName())),
    nayin: conv(day.getSound().getName()),
    luckyGods: gods.filter((g) => isLuck(g, '吉')).map((g) => conv(g.getName())),
    unluckyGods: gods.filter((g) => isLuck(g, '凶')).map((g) => conv(g.getName())),
    pengzu: conv(day.getPengZu().toString()).split(' ').filter(Boolean),
    fetusGod: conv(cycleDay.getFetusDay().toString()),
    solarTerm: conv(termDay.getSolarTerm().getName()),
    solarTermDay: termDay.getDayIndex() + 1,
    festival: festival ? conv(festival.getName()) : '',
  };
}

/** The almanac for `days` consecutive days from a Gregorian date. Throws RangeError on a bad date. */
export async function almanacDays(start: YmdDate, days: number, script: AlmanacScript): Promise<AlmanacDay[]> {
  const T = await loadTyme();
  let solar = solarDayOrThrow(T, start);
  const out: AlmanacDay[] = [];
  for (let i = 0; i < days; i++) {
    out.push(buildDay(solar, script));
    solar = solar.next(1);
  }
  return out;
}

/** The Gregorian date of a lunar date (`leap` = the intercalary month). Throws RangeError when it does not exist. */
export async function solarFromLunar(lunar: YmdDate, leap: boolean): Promise<YmdDate> {
  const T = await loadTyme();
  let solar: Tyme.SolarDay;
  try {
    solar = T.LunarDay.fromYmd(lunar.year, leap ? -lunar.month : lunar.month, lunar.day).getSolarDay();
  } catch (err) {
    throw new RangeError(err instanceof Error ? err.message : String(err));
  }
  return { year: solar.getYear(), month: solar.getMonth(), day: solar.getDay() };
}

/** A lunar month (the leap month when `leap`), or a whole lunar year, as Gregorian start + length. */
export async function solarSpanOfLunar(year: number, month: number | null, leap: boolean): Promise<{ start: YmdDate; days: number }> {
  const T = await loadTyme();
  try {
    const span = month === null ? T.LunarYear.fromYear(year) : T.LunarMonth.fromYm(year, leap ? -month : month);
    const first = (month === null ? T.LunarMonth.fromYm(year, 1) : (span as Tyme.LunarMonth)).getFirstDay().getSolarDay();
    return { start: { year: first.getYear(), month: first.getMonth(), day: first.getDay() }, days: span.getDayCount() };
  } catch (err) {
    throw new RangeError(err instanceof Error ? err.message : String(err));
  }
}

function solarDayOrThrow(T: TymeModule, d: YmdDate): Tyme.SolarDay {
  try {
    return T.SolarDay.fromYmd(d.year, d.month, d.day);
  } catch (err) {
    throw new RangeError(err instanceof Error ? err.message : String(err));
  }
}

/** One 時辰 of a day, and the eight characters (八字) of that moment. */
export interface AlmanacHour {
  time: string;
  name: string;
  pillar: string;
  luck: string;
  dutyGod: string;
  yi: string[];
  ji: string[];
  eightChar: string;
}

/**
 * The 時辰 holding `hour:minute` on a Gregorian day. 23:00 onwards is the late 子 hour, whose
 * eight characters already take the next day's pillar (子時換日), as 八字 is read.
 */
export async function almanacHour(d: YmdDate, hour: number, minute: number, script: AlmanacScript): Promise<AlmanacHour> {
  const T = await loadTyme();
  const conv = script === 'hant' ? toHant : (s: string): string => s;
  let lunarHour: Tyme.LunarHour;
  try {
    lunarHour = T.SolarTime.fromYmdHms(d.year, d.month, d.day, hour, minute, 0).getLunarHour();
  } catch (err) {
    throw new RangeError(err instanceof Error ? err.message : String(err));
  }
  const star = lunarHour.getTwelveStar();
  const pillar = lunarHour.getSixtyCycle();
  const p = (n: number): string => String(n).padStart(2, '0');
  return {
    time: `${p(hour)}:${p(minute)}`,
    name: conv(`${pillar.getEarthBranch().getName()}时`),
    pillar: pillar.getName(),
    luck: conv(star.getEcliptic().getLuck().getName()),
    dutyGod: conv(star.getName()),
    yi: lunarHour.getRecommends().map((x) => conv(x.getName())),
    ji: lunarHour.getAvoids().map((x) => conv(x.getName())),
    eightChar: lunarHour.getEightChar().toString(),
  };
}

/** Every activity name the almanac can list under 宜 or 忌, in the given script. */
export async function almanacActivityNames(script: AlmanacScript): Promise<string[]> {
  const T = await loadTyme();
  const names = (T.Taboo as unknown as { NAMES: string[] }).NAMES;
  return script === 'hant' ? names.map(toHant) : [...names];
}
