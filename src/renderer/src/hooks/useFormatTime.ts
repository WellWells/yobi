import { useCallback } from 'react';
import { useI18nStore } from '../store/i18nStore';

export function useFormatTime(): (ts: string) => string {
  const { t, locale, isReady } = useI18nStore();

  return useCallback((ts: string) => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMins = Math.floor(diffMs / 60_000);
      const diffHours = Math.floor(diffMs / 3_600_000);
      const diffDays = Math.floor(diffMs / 86_400_000);

      if (diffMins < 1) return t('sidebar.time.justNow');

      if (diffMins < 60) return t('sidebar.time.minutesAgo').replace('{{count}}', String(diffMins));

      if (diffHours < 24) {
        const timeStr = new Intl.DateTimeFormat(locale, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(d);
        return t('sidebar.time.today').replace('{{time}}', timeStr);
      }

      if (diffDays === 1) {
        const timeStr = new Intl.DateTimeFormat(locale, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(d);
        return t('sidebar.time.yesterday').replace('{{time}}', timeStr);
      }

      if (diffDays < 7) {
        const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d);
        const timeStr = new Intl.DateTimeFormat(locale, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(d);
        return `${weekday} ${timeStr}`;
      }

      if (diffDays < 30 || d.getFullYear() === now.getFullYear()) {
        return new Intl.DateTimeFormat(locale, {
          month: 'numeric',
          day: 'numeric',
        }).format(d);
      }

      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d).replace(/\//g, '-');
    } catch {
      return ts;
    }
  }, [t, locale, isReady]);
}
