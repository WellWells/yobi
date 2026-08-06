import { queriesFor } from './queryNormalize';
import type { QueryPlan, TemporalFilter } from './types';

/**
 * Recency hints, narrowest window first. Two things this table learned the hard way:
 *
 * - The "latest" class ("最新", "latest", "current") is by far the most common way to ask
 *   for fresh information and used to fall through to no filter at all, which returns the
 *   evergreen pages that rank best. It maps to `month` rather than `day` because the point
 *   is to exclude stale pages, not to demand same-day coverage.
 * - The locale coverage matches `DDG_REGION` in serp.ts. Detecting only Chinese and English
 *   while offering seven search regions meant most non-English users never got a filter.
 *
 * Latin-script terms that collide across languages are left out on purpose: Spanish
 * "actual" means "current", but the identical English word does not, and a false positive
 * costs a whole search. `collectHits` retries without the filter when one returns nothing,
 * which is what makes an aggressive table safe.
 */
const TEMPORAL_HINTS: readonly { filter: TemporalFilter; patterns: readonly RegExp[] }[] = [
  {
    filter: 'day',
    patterns: [
      /今天|今日|本日|24 ?小時|即時|快訊|現在|剛剛|速報/,
      /오늘|속보/,
      /\b(?:today|breaking|last 24 hours|right now|just now)\b/i,
      /\b(?:heute|hoy|aujourd'hui|hoje)\b/i,
    ],
  },
  {
    filter: 'week',
    patterns: [
      /這週|這周|本週|本周|這一週|過去一週|上週|上周|今週|先週/,
      /이번 ?주|지난 ?주/,
      /\b(?:this week|past week|last week)\b/i,
      /\b(?:diese Woche|esta semana|cette semaine|nesta semana)\b/i,
    ],
  },
  {
    filter: 'month',
    patterns: [
      /這個月|本月|過去一個月|上個月|今月|先月/,
      /이번 ?달|지난 ?달/,
      /\b(?:this month|past month|last month)\b/i,
      /\b(?:diesen Monat|este mes|ce mois|neste mês)\b/i,
      // The "latest" class — asks for freshness without naming a window.
      /最新|最近|近期|目前|現況|现况|如今|直近/,
      /최신|최근/,
      /\b(?:latest|current|currently|most recent|up[- ]to[- ]date|nowadays|newest)\b/i,
      /\b(?:neueste|neuesten|aktuell|aktuelle|último|últimos|última|últimas|dernières|dernière|derniers|dernier|atual|atuais)\b/i,
    ],
  },
];

function detectTemporal(query: string): TemporalFilter {
  for (const { filter, patterns } of TEMPORAL_HINTS) {
    if (patterns.some((re) => re.test(query))) return filter;
  }
  return 'none';
}

export function planQuery(query: string): QueryPlan {
  return {
    temporal: detectTemporal(query),
    queries: queriesFor(query),
  };
}
