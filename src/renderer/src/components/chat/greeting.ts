export type GreetingSlot = 'morning' | 'noon' | 'teatime' | 'dusk' | 'evening' | 'night';

const SLOT_STARTS: ReadonlyArray<readonly [GreetingSlot, number]> = [
  ['night', 23],
  ['evening', 19],
  ['dusk', 17],
  ['teatime', 14],
  ['noon', 12],
  ['morning', 5],
];

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

export interface GreetingSources {
  t: (key: string) => string;
  has: (key: string) => boolean;
  hasFallback: (key: string) => boolean;
}

function countLines(slot: GreetingSlot, has: (key: string) => boolean): number {
  let count = 0;
  while (has(`welcome.greeting.${slot}.${count + 1}`)) count += 1;
  return count;
}

function lineIndex(now: Date, slot: GreetingSlot, count: number): number {
  const day = now.getFullYear() * 372 + now.getMonth() * 31 + now.getDate();
  const slotOffset = SLOT_STARTS.findIndex(([name]) => name === slot);
  return ((day + slotOffset) % count) + 1;
}

export function resolveGreeting(now: Date, name: string, sources: GreetingSources): string {
  const { t, has, hasFallback } = sources;
  const slot = greetingSlotFor(now.getHours());
  const count = countLines(slot, has) || countLines(slot, hasFallback);
  if (count === 0) return '';
  return applyNickname(t(`welcome.greeting.${slot}.${lineIndex(now, slot, count)}`), name);
}
