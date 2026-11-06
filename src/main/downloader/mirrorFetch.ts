import { assertStreamUrl } from './streamFetch';
import type { FetchLike, HostAllowlist } from './streamFetch';

/*
 * A fetch for files a site gives at more than one address: bilibili's player gets each stream's
 * `base_url` with `backup_url`s on other CDNs and moves on to the next one when a host refuses.
 * A request that an address answers with an error status, or not at all, goes to the file's next
 * address; the one that answered is asked first from then on (a resumed file goes straight to it),
 * and a host that refused once is asked last for the download's other files. Every address is
 * held to what the first one is (https, the site's hosts, no port of its own).
 */

function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

export interface MirrorLinksOptions {
  isAllowedHost: HostAllowlist;
  /** The site's name, for the log. */
  label: string;
  /** One line each time an address is given up on: hosts only, never a signed query. */
  onLog?: (line: string) => void;
}

/** One download's files and their addresses. */
export class MirrorLinks {
  /** A file's other addresses, by the one its plan names. */
  private readonly others = new Map<string, readonly string[]>();
  /** The address that last answered, by the one the plan names. */
  private readonly answered = new Map<string, string>();
  /** Hosts that refused or never answered during this download. */
  private readonly refused = new Set<string>();

  constructor(private readonly options: MirrorLinksOptions) {}

  /**
   * One file's addresses in the site's order. Returns the first that may be asked (the plan's URL)
   * and keeps the rest behind it; null when none may.
   */
  add(urls: readonly string[]): string | null {
    const usable = [...new Set(urls)].filter((url) => this.usable(url));
    if (usable.length === 0) return null;
    this.others.set(usable[0], usable.slice(1));
    return usable[0];
  }

  private usable(url: string): boolean {
    try {
      assertStreamUrl(url, this.options.isAllowedHost);
      return true;
    } catch {
      return false;
    }
  }

  /** The addresses to ask for `url`, the one that answered first and hosts that refused last. */
  private order(url: string): string[] {
    const all = [url, ...(this.others.get(url) ?? [])];
    const answered = this.answered.get(url);
    const ranked = answered ? [answered, ...all.filter((u) => u !== answered)] : all;
    return [...ranked.filter((u) => !this.refused.has(hostOf(u))), ...ranked.filter((u) => this.refused.has(hostOf(u)))];
  }

  private giveUp(address: string, why: string, next: string | undefined): void {
    this.refused.add(hostOf(address));
    const then = next ? `trying ${hostOf(next)}` : 'no other address left';
    this.options.onLog?.(`[${this.options.label}] ${hostOf(address)} ${why} — ${then}`);
  }

  /**
   * `base` sending each request to the file's addresses in turn. Resolves with the first answer
   * under 400, else the last error answer; rejects with the last failure when none answered, and
   * at once on Stop (or the caller's own timeout), with the address's host marked for the retry.
   */
  fetch(base: FetchLike): FetchLike {
    return async (url, init) => {
      const addresses = this.order(url);
      let failed: Response | undefined;
      let error: unknown;
      for (const [index, address] of addresses.entries()) {
        const next = addresses[index + 1];
        try {
          const response = await base(address, init);
          if (response.status < 400) {
            await failed?.body?.cancel().catch(() => {});
            if (address !== url) this.answered.set(url, address);
            return response;
          }
          this.giveUp(address, `answered ${response.status}`, next);
          await failed?.body?.cancel().catch(() => {});
          failed = response;
        } catch (err) {
          if (init.signal?.aborted) {
            this.refused.add(hostOf(address));
            await failed?.body?.cancel().catch(() => {});
            throw err;
          }
          this.giveUp(address, `did not answer (${err instanceof Error ? err.message : String(err)})`, next);
          error = err;
        }
      }
      if (failed) return failed;
      throw error;
    };
  }
}
