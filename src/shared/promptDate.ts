import { toIsoDate } from './localTime';

export { toIsoDate as formatPromptDate } from './localTime';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function formatPromptDateWithWeekday(now: Date): string {
  return `${toIsoDate(now)} (${WEEKDAYS[now.getDay()]})`;
}

export function relativeYearSentence(now: Date): string {
  const year = now.getFullYear();
  return `It is currently ${year}, so ${year - 1} was last year and ${year + 1} is next year.`;
}
