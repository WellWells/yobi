import { queriesFor } from './queryNormalize';
import type { QueryPlan, TemporalFilter } from './types';

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
