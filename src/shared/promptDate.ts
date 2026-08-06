const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/**
 * The local calendar date as a prompt states it. Local, never UTC: a prompt built at 01:00
 * in Taipei that says "yesterday" has grounded the model in the wrong day.
 */
export function formatPromptDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function formatPromptDateWithWeekday(now: Date): string {
  return `${formatPromptDate(now)} (${WEEKDAYS[now.getDay()]})`;
}

/**
 * Spelled out rather than left as arithmetic. Models routinely resolve "last year" against
 * their training cutoff instead of the date they were just given, and stating the three
 * years explicitly is the cheapest known fix.
 */
export function relativeYearSentence(now: Date): string {
  const year = now.getFullYear();
  return `It is currently ${year}, so ${year - 1} was last year and ${year + 1} is next year.`;
}
