/**
 * A count of messages the bot may send unasked per local calendar day — on LINE every push costs
 * the owner's monthly quota, so a burst of strangers or groups must not spend it. In memory: a
 * restart starts the day's count again, which at worst sends one day's allowance twice.
 */
export interface DailyAllowance {
  /** Takes one from today's allowance; false when it is used up. */
  take: (now?: Date) => boolean;
  reset: () => void;
}

function localDay(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

export function dailyAllowance(limit: number): DailyAllowance {
  let used: { day: string; count: number } | null = null;
  return {
    take: (now = new Date()) => {
      const day = localDay(now);
      const count = used?.day === day ? used.count : 0;
      if (count >= limit) return false;
      used = { day, count: count + 1 };
      return true;
    },
    reset: () => { used = null; },
  };
}
