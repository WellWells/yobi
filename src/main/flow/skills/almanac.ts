import { sendLog } from '../../helpers';
import { getLangCache, t } from '../../i18n';
import { config as appConfig } from '../../config';
import { FlowUserError } from '../userError';
import { clampIntField } from './numberField';
import { envelope } from './dataSources';
import { almanacActivityNames, almanacDays, almanacHour, solarFromLunar, solarSpanOfLunar } from '../../almanac/almanac';
import type { AlmanacDay, AlmanacHour, AlmanacScript, YmdDate } from '../../almanac/almanac';
import { toHant } from '../../almanac/almanacHant';
import { MAX_ALMANAC_DAYS, MAX_ALMANAC_FILTER_DAYS } from '../../../shared/almanac';

export interface AlmanacStepDeps {
  now: () => Date;
  script: AlmanacScript;
  strings: Record<string, string>;
  log: (line: string) => void;
}

/** Simplified for a Simplified-Chinese UI; everyone else — Taiwan, Hong Kong, English — reads Traditional. */
export function almanacScriptFor(locale: string): AlmanacScript {
  return /^zh-(CN|SG|Hans)/i.test(locale.trim()) ? 'hans' : 'hant';
}

function localYmd(d: Date): YmdDate {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function parseYmd(raw: string): YmdDate | null {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function badDate(value: string): FlowUserError {
  return new FlowUserError('flow.error.almanacDate', { value }, `Not a date the almanac can read: "${value}"`);
}

const DAY_MS = 86_400_000;

interface Span {
  start: YmdDate;
  days: number;
}

/** How a lunar request reads its dates; null = Gregorian. */
type LunarReading = { leap: boolean } | null;

const dayNumber = (d: YmdDate): number => Date.UTC(d.year, d.month - 1, d.day) / DAY_MS;

/** A day count in "days" — "30", "30天", "30 days", capped later. A bare year is a span instead. */
const DAY_COUNT = /^(\d+)(?:\.\d+)?\s*(?:天|日|days?)?$/i;
const BARE_YEAR = /^(19\d\d|20\d\d|2100)$/;

/**
 * A lunar range's ends as Gregorian days. With `leap`, an end in that year's leap month reads as
 * the leap month and one in any other month as the regular one; a range with no end in a leap
 * month throws, so the flag is never dropped without a word.
 */
async function solarRangeFromLunar(from: YmdDate, to: YmdDate, leap: boolean): Promise<[YmdDate, YmdDate]> {
  const regular = (d: YmdDate) => solarFromLunar(d, false);
  if (!leap) return [await regular(from), await regular(to)];
  const asLeap = (d: YmdDate) => solarFromLunar(d, true).catch(() => null);
  const [leapFrom, leapTo] = [await asLeap(from), await asLeap(to)];
  if (!leapFrom && !leapTo) throw new RangeError('Neither end of the range is in a leap month');
  return [leapFrom ?? await regular(from), leapTo ?? await regular(to)];
}

/**
 * A month ("2026-11"), a year ("2027") or a range ("2027-01-01 to 2027-06-30") as start + length;
 * with `lunar` the same spellings name the lunar month (閏 when leap), lunar year or lunar dates.
 */
async function parseSpan(raw: string, lunar: LunarReading): Promise<Span | null> {
  const month = /^(\d{4})[-/.](\d{1,2})$/.exec(raw);
  if (month) {
    const [year, m] = [Number(month[1]), Number(month[2])];
    if (m < 1 || m > 12) return null;
    if (!lunar) return { start: { year, month: m, day: 1 }, days: new Date(year, m, 0).getDate() };
    return solarSpanOfLunar(year, m, lunar.leap).catch(() => { throw badDate(raw); });
  }
  const year = BARE_YEAR.exec(raw);
  if (year) {
    const y = Number(year[1]);
    if (lunar) return solarSpanOfLunar(y, null, false).catch(() => { throw badDate(raw); });
    return { start: { year: y, month: 1, day: 1 }, days: dayNumber({ year: y + 1, month: 1, day: 1 }) - dayNumber({ year: y, month: 1, day: 1 }) };
  }
  const range = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*(?:to|~|～|\.\.|至|到|–|—|\s-\s)\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})$/i.exec(raw);
  let from = range ? parseYmd(range[1]) : null;
  let to = range ? parseYmd(range[2]) : null;
  if (!from || !to) return null;
  if (lunar) {
    try {
      [from, to] = await solarRangeFromLunar(from, to, lunar.leap);
    } catch {
      throw badDate(raw);
    }
  }
  const days = dayNumber(to) - dayNumber(from) + 1;
  return days >= 1 ? { start: from, days } : null;
}

/**
 * Where the lookup starts and, when the request names a span, how long it is. Models write the
 * span wherever it fits their sentence — "date": "2026-11", or "days": "2027" / "2027-01-01 to
 * 2027-06-30" (2026-10-22 live eval) — so a span is read from either field rather than refused.
 * With a day in "date" as well, the span holds: a day before it is where the model stood, a day
 * inside it starts the span there, a day after it contradicts it. "lunar" reads every form.
 */
async function resolveSpan(config: Record<string, string>, now: Date): Promise<{ start: YmdDate; days: number | null }> {
  const lunar: LunarReading = config.lunar === 'true' ? { leap: config.leap === 'true' } : null;
  const raw = (config.date ?? '').trim();
  const lower = raw.toLowerCase();
  const daysRaw = (config.days ?? '').trim();
  const count = BARE_YEAR.test(daysRaw) ? null : DAY_COUNT.exec(daysRaw);
  const daysSpan = daysRaw && !count ? await parseSpan(daysRaw, lunar) : null;
  if (daysRaw && !count && !daysSpan) throw badDate(daysRaw);
  const countDays = count ? Number(count[1]) : null;
  if (!raw || lower === 'today') return daysSpan ?? { start: localYmd(now), days: countDays };

  let day: YmdDate;
  if (lower === 'tomorrow') {
    day = localYmd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  } else {
    const ymd = parseYmd(raw);
    if (!ymd) {
      const span = await parseSpan(raw, lunar);
      if (!span) throw badDate(raw);
      return span;
    }
    try {
      day = lunar ? await solarFromLunar(ymd, lunar.leap) : ymd;
    } catch {
      throw badDate(raw);
    }
  }
  if (!daysSpan) return { start: day, days: countDays };
  const offset = dayNumber(day) - dayNumber(daysSpan.start);
  if (offset <= 0) return daysSpan;
  if (offset >= daysSpan.days) throw badDate(`${raw} + ${daysRaw}`);
  return { start: day, days: daysSpan.days - offset };
}

function join(items: string[], strings: Record<string, string>): string {
  return items.length ? items.join('、') : t(strings, 'almanac.none');
}

function dayTypeLabel(day: AlmanacDay, strings: Record<string, string>): string {
  const good = day.dayType === '黃道' || day.dayType === '黄道';
  return t(strings, good ? 'almanac.dayType.good' : 'almanac.dayType.bad', { god: day.dutyGod });
}

/** The piliapp day card as text lines, for a bot message or an llm prompt. */
export function formatAlmanacDay(day: AlmanacDay, strings: Record<string, string>): string {
  const L = (key: string, value: string): string => `${t(strings, `almanac.label.${key}`)}：${value}`;
  const term = t(strings, 'almanac.termDay', { term: day.solarTerm, n: String(day.solarTermDay) });
  return [
    t(strings, 'almanac.heading', {
      date: day.date, weekday: day.weekday, lunar: day.lunar, year: day.lunarYear, zodiac: day.zodiac,
    }),
    [dayTypeLabel(day, strings), day.festival].filter(Boolean).join(' · '),
    L('yi', join(day.yi, strings)),
    L('ji', join(day.ji, strings)),
    L('goodHours', join(day.goodHours, strings)),
    `${L('clash', day.clash)}　${L('evilDirection', day.evilDirection)}`,
    L('officerMansion', `${day.officer} · ${day.mansion}`),
    `${L('joyGod', day.joyGod)}　${L('wealthGod', day.wealthGod)}`,
    L('nayin', day.nayin),
    L('luckyGods', join(day.luckyGods, strings)),
    L('unluckyGods', join(day.unluckyGods, strings)),
    L('pengzu', day.pengzu.join('；')),
    L('fetusGod', day.fetusGod),
    L('pillars', `${day.lunarYear} · ${day.monthPillar} · ${day.dayPillar}`),
    L('solarTerm', term),
  ].join('\n');
}

function compact(day: AlmanacDay): Record<string, unknown> {
  const { date, weekday, lunar, dayType, dutyGod, yi, ji, clash, solarTerm, solarTermDay, festival } = day;
  return { date, weekday, lunar, dayType, dutyGod, yi, ji, clash, solarTerm, solarTermDay, festival };
}

function compactLine(day: AlmanacDay, strings: Record<string, string>): string {
  const extra = [day.festival, day.solarTermDay === 1 ? day.solarTerm : ''].filter(Boolean).join(' ');
  return [
    `${day.date}（${day.weekday}）${day.lunar}${extra ? ` ${extra}` : ''}`,
    dayTypeLabel(day, strings),
    `${t(strings, 'almanac.label.yi')}：${join(day.yi, strings)}`,
    `${t(strings, 'almanac.label.ji')}：${join(day.ji, strings)}`,
    `${t(strings, 'almanac.label.clash')}：${day.clash}`,
  ].join(' | ');
}

export async function resolveActivity(raw: string, script: AlmanacScript): Promise<string> {
  const wanted = raw.trim();
  if (!wanted) return '';
  const names = await almanacActivityNames(script);
  const key = toHant(wanted.replace(/[「」『』"'\s]/g, ''));
  // Traditional input against a Simplified list (or the reverse) still finds its name.
  const byName = (name: string): string | undefined => names.find((n) => toHant(n) === name);
  const everyday = ACTIVITY_WORDS[key] ?? ACTIVITY_WORDS[everydayHant(key)];
  const hit = byName(key) ?? (everyday ? byName(everyday) : undefined) ?? oneSlipFrom(key, names);
  if (!hit) {
    const near = names.filter((n) => [...toHant(n)].some((ch) => key.includes(ch))).slice(0, 6);
    throw new FlowUserError(
      'flow.error.almanacActivity',
      { name: wanted },
      `"${wanted}" is not an almanac activity; ${near.length ? `close names: ${near.join(', ')}; ` : ''}common ones: 嫁娶 (wedding), 納采, 入宅, 移徙 (moving), 開市 (opening), 出行 (travel), 動土, 修造, 理髮`,
    );
  }
  return hit;
}

/**
 * What people call an activity, mapped to the almanac's name for it. Models pass the user's own
 * word (結婚, 搬家, 開店) about half the time — 2026-10-22 live eval — and each miss cost a call.
 */
export const ACTIVITY_WORDS: Readonly<Record<string, string>> = {
  結婚: '嫁娶', 婚禮: '嫁娶', 成婚: '嫁娶', 娶親: '嫁娶', 出嫁: '嫁娶', 辦婚禮: '嫁娶', 婚嫁: '嫁娶',
  訂婚: '納采', 提親: '納采', 文定: '納采', 下聘: '納采',
  搬家: '移徙', 搬遷: '移徙', 遷居: '移徙', 搬新家: '入宅', 入厝: '入宅', 進新家: '入宅', 新居: '入宅',
  開店: '開市', 開業: '開市', 開幕: '開市', 開張: '開市', 開工: '開市',
  裝潢: '修造', 裝修: '修造', 整修: '修造', 翻修: '修造', 蓋房: '動土', 建房: '動土', 動工: '動土',
  旅行: '出行', 旅遊: '出行', 出遠門: '出行', 出國: '出行', 出差: '出行', 遠行: '出行',
  剪頭髮: '理髮', 剪髮: '理髮', 理頭髮: '理髮', 剃頭: '理髮',
  簽約: '立券', 買房: '置產', 下葬: '安葬', 出殯: '安葬', 祭拜: '祭祀', 拜拜: '祭祀', 求子: '求嗣',
  看病: '求醫', 就醫: '求醫', 動手術: '求醫',
};

/*
 * The Simplified characters of the words above that the almanac table (`toHant`, limited to what
 * tyme4ts prints) leaves alone, and 发 where it is hair: 头發 / 剪發 after that table.
 */
const EVERYDAY_SIMPLIFIED = '礼办迁业装签约殡术';
const EVERYDAY_TRADITIONAL = '禮辦遷業裝簽約殯術';
const EVERYDAY_CHARS: ReadonlyMap<string, string> = new Map(
  [...EVERYDAY_SIMPLIFIED].map((ch, i) => [ch, [...EVERYDAY_TRADITIONAL][i]] as const),
);

/** An everyday word after `toHant`, in the Traditional spelling ACTIVITY_WORDS is keyed by. */
function everydayHant(key: string): string {
  return [...key.replace(/頭發/g, '頭髮').replace(/剪發/g, '剪髮')].map((ch) => EVERYDAY_CHARS.get(ch) ?? ch).join('');
}

/** A name one character off from the input (嫁婶 → 嫁娶), when exactly one name is that close. */
function oneSlipFrom(key: string, names: string[]): string | undefined {
  const chars = [...key];
  const close = names.filter((n) => {
    const other = [...toHant(n)];
    return other.length === chars.length && chars.length >= 2 && other.filter((ch, i) => ch !== chars[i]).length === 1;
  });
  return close.length === 1 ? close[0] : undefined;
}

const ZODIAC_SIGNS: Readonly<Record<string, string>> = {
  鼠: '鼠', 牛: '牛', 虎: '虎', 兔: '兔', 龍: '龍', 龙: '龍', 蛇: '蛇', 馬: '馬', 马: '馬',
  羊: '羊', 猴: '猴', 雞: '雞', 鸡: '雞', 狗: '狗', 豬: '豬', 猪: '豬',
};

/** The signs named in a free-form field — 「屬虎」「龍、狗」「虎,狗」 — in Traditional form. */
function resolveZodiac(raw: string): string[] {
  const wanted = raw.trim();
  if (!wanted) return [];
  const signs = [...new Set([...wanted].map((ch) => ZODIAC_SIGNS[ch]).filter(Boolean))];
  if (signs.length === 0) {
    throw new FlowUserError('flow.error.almanacZodiac', { value: wanted }, `No zodiac sign in "${wanted}"; use 鼠 牛 虎 兔 龍 蛇 馬 羊 猴 雞 狗 豬`);
  }
  return signs;
}

function resolveTime(raw: string): { hour: number; minute: number } | null {
  const wanted = raw.trim();
  if (!wanted) return null;
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(wanted);
  const hour = m ? Number(m[1]) : NaN;
  const minute = m?.[2] ? Number(m[2]) : 0;
  if (!(hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)) {
    throw new FlowUserError('flow.error.almanacTime', { value: wanted }, `Not a time of day: "${wanted}"; use HH:MM`);
  }
  return { hour, minute };
}

/** A filtered day: enough to name it and say why it was kept, so a year of matches stays short. */
function brief(day: AlmanacDay): Record<string, unknown> {
  const { date, weekday, lunar, dayType, clash, festival } = day;
  return { date, weekday, lunar, dayType, clash, festival };
}

function briefLine(day: AlmanacDay, strings: Record<string, string>): string {
  return [`${day.date}（${day.weekday}）${day.lunar}${day.festival ? ` ${day.festival}` : ''}`, dayTypeLabel(day, strings), `${t(strings, 'almanac.label.clash')}：${day.clash}`].join(' | ');
}

function hourLines(hour: AlmanacHour, strings: Record<string, string>): string {
  return [
    `${t(strings, 'almanac.label.hour')}：${hour.time} ${hour.name}（${hour.pillar}）${hour.luck} · ${hour.dutyGod}`,
    `${t(strings, 'almanac.label.hourYiJi')}：${join(hour.yi, strings)} / ${join(hour.ji, strings)}`,
    `${t(strings, 'almanac.label.eightChar')}：${hour.eightChar}`,
  ].join('\n');
}

const isWeekend = (day: AlmanacDay): boolean => /[六日]$/.test(day.weekday);

/**
 * What a filtered list already accounts for, in English for the model. 2026-10-22 eval: given
 * days kept for 屬虎, the model read a day's 「沖猴（申）」 as bad for the tiger and warned against
 * days the filter had already judged — `clash` is the sign the day is bad FOR, not the day's own.
 */
function describeFilters(from: string, to: string, activity: string, zodiac: string[], weekends: boolean): string {
  return [
    `${from} to ${to}`,
    activity ? `${activity} listed under 宜 and not under 忌` : '',
    zodiac.length ? `days clashing ${zodiac.join('/')} already left out (a day's "clash" is the sign that day is bad for)` : '',
    weekends ? 'Saturdays and Sundays only' : '',
  ].filter(Boolean).join('; ');
}

/**
 * The almanac step. One day (the default): {{key}} = the whole day as JSON, .text = the day card;
 * a `time` adds that 時辰 and the eight characters. Several days: a JSON array of shorter days.
 * Any filter — an activity (宜 and not 忌), signs whose clash rules a day out, weekends only —
 * allows a span of a year and returns only the matching days, each as a short entry.
 */
export async function runAlmanacStep(config: Record<string, string>, deps: AlmanacStepDeps): Promise<string> {
  const span = await resolveSpan(config, deps.now());
  const start = span.start;
  const activity = await resolveActivity(config.activity ?? '', deps.script);
  const zodiac = resolveZodiac(config.zodiac ?? '');
  const weekends = config.weekends === 'true';
  const time = resolveTime(config.time ?? '');
  const filtered = Boolean(activity) || zodiac.length > 0 || weekends;
  const days = clampIntField(span.days, 1, 1, filtered ? MAX_ALMANAC_FILTER_DAYS : MAX_ALMANAC_DAYS);
  let list: AlmanacDay[];
  try {
    list = await almanacDays(start, days, deps.script);
  } catch {
    throw badDate((config.date ?? '').trim());
  }

  if (days === 1 && !filtered) {
    const [day] = list;
    const hour = time ? await almanacHour(start, time.hour, time.minute, deps.script) : null;
    deps.log(`📅 [Flow] Almanac: ${day.date}${hour ? ` ${hour.time}` : ''} = ${day.lunar}`);
    const text = formatAlmanacDay(day, deps.strings);
    return envelope(JSON.stringify(hour ? { ...day, hour } : day), {
      text: hour ? `${text}\n${hourLines(hour, deps.strings)}` : text,
      date: day.date,
      lunar: day.lunar,
      dayType: day.dayType,
      yi: day.yi.join('、'),
      ji: day.ji.join('、'),
      ...(hour ? { eightChar: hour.eightChar } : {}),
      count: '1',
    });
  }

  if (!filtered) {
    deps.log(`📅 [Flow] Almanac: ${list[0].date} +${days}d`);
    return envelope(JSON.stringify(list.map(compact)), {
      text: list.map((d) => compactLine(d, deps.strings)).join('\n'),
      date: list[0].date,
      lunar: list[0].lunar,
      count: String(list.length),
    });
  }

  // A clash is told by the zodiac in "亥（豬）"; signs were normalised to the Traditional form.
  const clashes = (d: AlmanacDay): boolean => zodiac.some((sign) => toHant(d.clash).includes(sign));
  const picked = list.filter((d) => (!activity || (d.yi.includes(activity) && !d.ji.includes(activity)))
    && !clashes(d) && (!weekends || isWeekend(d)));
  deps.log(`📅 [Flow] Almanac: ${list[0].date} +${days}d${activity ? ` "${activity}"` : ''}${zodiac.length ? ` not clashing ${zodiac.join('')}` : ''}${weekends ? ' weekends' : ''} → ${picked.length} day(s)`);
  return envelope(JSON.stringify(picked.map(brief)), {
    text: picked.map((d) => briefLine(d, deps.strings)).join('\n'),
    date: picked[0]?.date ?? '',
    lunar: picked[0]?.lunar ?? '',
    count: String(picked.length),
    filters: describeFilters(list[0].date, list[list.length - 1].date, activity, zodiac, weekends),
  });
}

export function execAlmanac(config: Record<string, string>): Promise<string> {
  return runAlmanacStep(config, {
    now: () => new Date(),
    script: almanacScriptFor(appConfig.locale ?? ''),
    strings: getLangCache(),
    log: sendLog,
  });
}
