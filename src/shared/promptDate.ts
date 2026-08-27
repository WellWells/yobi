const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function formatPromptDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function formatPromptDateWithWeekday(now: Date): string {
  return `${formatPromptDate(now)} (${WEEKDAYS[now.getDay()]})`;
}

export function relativeYearSentence(now: Date): string {
  const year = now.getFullYear();
  return `It is currently ${year}, so ${year - 1} was last year and ${year + 1} is next year.`;
}
