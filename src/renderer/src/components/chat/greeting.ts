export type GreetingSlot = 'morning' | 'noon' | 'teatime' | 'dusk' | 'evening' | 'night';

const SLOT_STARTS: ReadonlyArray<readonly [GreetingSlot, number]> = [
  ['night', 23],
  ['evening', 19],
  ['dusk', 17],
  ['teatime', 14],
  ['noon', 12],
  ['morning', 5],
];

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** A week without a conversation turns the greeting into "welcome back". */
export const RETURNING_AFTER_MS = 7 * 24 * 60 * 60_000;

const NAME_SEGMENT = /\[([^\]]*)\]/g;
const NAME_PLACEHOLDER = /\{\{name\}\}/g;

export function greetingSlotFor(hour: number): GreetingSlot {
  for (const [slot, start] of SLOT_STARTS) {
    if (hour >= start) return slot;
  }
  return 'night';
}

export function applyNickname(line: string, name: string): string {
  const resolved = line.replace(NAME_SEGMENT, (_match, inner: string) => (name ? inner : ''));
  return resolved.replace(NAME_PLACEHOLDER, () => name);
}

export function isReturning(now: Date, lastActiveAt: number | null): boolean {
  return lastActiveAt !== null && now.getTime() - lastActiveAt >= RETURNING_AFTER_MS;
}

export interface GreetingSources {
  t: (key: string) => string;
  has: (key: string) => boolean;
  hasFallback: (key: string) => boolean;
}

function countLines(pool: string, has: (key: string) => boolean): number {
  let count = 0;
  while (has(`welcome.greeting.${pool}.${count + 1}`)) count += 1;
  return count;
}

function lineIndex(now: Date, slot: GreetingSlot, count: number): number {
  const day = now.getFullYear() * 372 + now.getMonth() * 31 + now.getDate();
  const slotOffset = SLOT_STARTS.findIndex(([name]) => name === slot);
  return ((day + slotOffset) % count) + 1;
}

/**
 * Welcome back beats the weekday line, which beats the slot pool. The first two read the current
 * locale only: an English "Happy Monday" must never surface in another language's UI.
 */
export function resolveGreeting(
  now: Date,
  name: string,
  sources: GreetingSources,
  lastActiveAt: number | null = null,
): string {
  const { t, has, hasFallback } = sources;
  const slot = greetingSlotFor(now.getHours());
  const special = [
    ...(isReturning(now, lastActiveAt) ? ['back'] : []),
    `${slot}.${WEEKDAYS[now.getDay()]}`,
  ];
  for (const pool of special) {
    const count = countLines(pool, has);
    if (count > 0) return applyNickname(t(`welcome.greeting.${pool}.${lineIndex(now, slot, count)}`), name);
  }
  const count = countLines(slot, has) || countLines(slot, hasFallback);
  if (count === 0) return '';
  return applyNickname(t(`welcome.greeting.${slot}.${lineIndex(now, slot, count)}`), name);
}
