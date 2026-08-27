import { useCallback } from 'react';
import { useI18nStore } from '../store/i18nStore';
import { formatTimeLabel } from '../utils/timeLabel';
import type { TimeGroupKey } from '../utils/timeGroups';

export function useFormatTime(): (ts: string, group?: TimeGroupKey) => string {
  const { t, locale, isReady } = useI18nStore();

  return useCallback(
    (ts: string, group?: TimeGroupKey) => formatTimeLabel(ts, { now: new Date(), locale, t, group }),
    [t, locale, isReady],
  );
}
