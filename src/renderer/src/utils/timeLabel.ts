import { resolveTimeGroup, type TimeGroupKey } from './timeGroups';

export interface TimeLabelOptions {
  now: Date;
  locale: string;
  t: (key: string) => string;
  group?: TimeGroupKey;
}

function clock(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function weekdayClock(date: Date, locale: string): string {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
  return `${weekday} ${clock(date, locale)}`;
}

function calendarDate(date: Date, now: Date, locale: string): string {
  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(date);
  }
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date)
    .replace(/\//g, '-');
}

export function formatTimeLabel(timestamp: string, options: TimeLabelOptions): string {
  const { now, locale, t, group } = options;
  if (!timestamp) return '';

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (diffMinutes < 1) return t('sidebar.time.justNow');
  if (diffMinutes < 60) return t('sidebar.time.minutesAgo').replace('{{count}}', String(diffMinutes));

  const resolved = group ?? resolveTimeGroup(timestamp, now);
  switch (resolved) {
    case 'undated':
      return '';
    case 'today':
      return group ? clock(date, locale) : t('sidebar.time.today').replace('{{time}}', clock(date, locale));
    case 'yesterday':
      return group ? clock(date, locale) : t('sidebar.time.yesterday').replace('{{time}}', clock(date, locale));
    case 'past7':
      return weekdayClock(date, locale);
    default:
      return calendarDate(date, now, locale);
  }
}
