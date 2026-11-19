import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * What became of one link a list step handed on in this run:
 * - `ack`: the item went through (or was deliberately skipped) — it is seen.
 * - `failed`: a step on it failed — it is retried next run, up to a limit.
 * - `unreached`: the run never got to it (a loop's iteration limit, Stop) — retried, no attempt spent.
 */
export type SeenOutcome = 'ack' | 'failed' | 'unreached';

export type SettleSeen = (outcomes: Map<string, SeenOutcome>) => Promise<void>;

interface HandedBatch {
  links: Set<string>;
  settle: SettleSeen;
  settled: Set<string>;
  /** A loop went over this batch: what it did not settle was never reached. */
  looped: boolean;
}

/**
 * One run's record of the links its seen-cache list steps (rss, scraper, youtube_subs, ptt_board,
 * x_posts) handed on. Those links stay pending in the checkpoint until the run says what became of
 * them, so an article whose llm or bot step failed comes back next run instead of being lost.
 */
export class SeenLedger {
  private readonly batches: HandedBatch[] = [];

  register(links: string[], settle: SettleSeen): void {
    if (links.length === 0) return;
    this.batches.push({ links: new Set(links), settle, settled: new Set(), looped: false });
  }

  /** One loop iteration over `link` finished; written at once so a later crash keeps it. */
  async settleItem(link: string, outcome: Exclude<SeenOutcome, 'unreached'>): Promise<void> {
    const key = link.trim();
    for (const batch of this.batches) {
      if (!batch.links.has(key)) continue;
      batch.looped = true;
      if (batch.settled.has(key)) continue;
      batch.settled.add(key);
      await batch.settle(new Map([[key, outcome]]));
    }
  }

  /**
   * The run ended. A batch a loop went over: whatever it did not settle was not reached. A batch
   * used whole (rss → llm → bot) shares the run's fate.
   */
  async settleRun(whole: SeenOutcome): Promise<void> {
    for (const batch of this.batches) {
      const outcomes = new Map<string, SeenOutcome>();
      for (const link of batch.links) {
        if (!batch.settled.has(link)) outcomes.set(link, batch.looped ? 'unreached' : whole);
      }
      if (outcomes.size === 0) continue;
      for (const link of outcomes.keys()) batch.settled.add(link);
      await batch.settle(outcomes);
    }
  }
}

const runLedger = new AsyncLocalStorage<SeenLedger>();

export function runWithSeenLedger<T>(ledger: SeenLedger, fn: () => Promise<T>): Promise<T> {
  return runLedger.run(ledger, fn);
}

/** The running flow's ledger; none for `/agent` tools and pasted-link shortcuts (seen at once). */
export function currentSeenLedger(): SeenLedger | undefined {
  return runLedger.getStore();
}

/** The loop item's link, the key a list step registered it under. */
export function loopItemLink(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const link = (item as { link?: unknown }).link;
  return typeof link === 'string' ? link.trim() : '';
}
