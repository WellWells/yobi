/**
 * A local, zero-latency rewrite of a natural-language question into something a keyword
 * search engine ranks well.
 *
 * It exists because query planning was otherwise BYOK-only: `planQueryLlm` talks to an HTTP
 * endpoint, so every browser provider — including the default one — sent DuckDuckGo the
 * user's raw sentence, question particles and all. An LLM round-trip is not an option there
 * (the worker window is exclusive and a browser turn costs about a minute), so the rewrite
 * has to be free.
 *
 * Deliberately conservative: it strips politeness, meta-request wrappers and trailing
 * question particles, and NOTHING else. Words like 如何 / "how to" narrow a query to
 * tutorial content and are worth their tokens, so they stay. Whatever it produces is only
 * used when it still resembles the original — see `MIN_RETAINED_RATIO`.
 */

/** Meta-request wrappers: the user addressing the assistant, not the search engine. */
const LEAD_PATTERNS: readonly RegExp[] = [
  /^(?:請問|請你|請|麻煩你|麻煩|幫我(?:查詢|查|搜尋|找|看|問)一下|幫我(?:查詢|查|搜尋|找|看|問)|我想(?:知道|問|查|了解|瞭解)|我想|告訴我|查一下|搜尋一下|給我|想請教|想問)\s*/,
  /^(?:please|can you|could you|would you|tell me about|tell me|i want to know|i'd like to know|i wanna know|search for|look up|find me|find|show me|give me)\s+/i,
  /^(?:what is|what are|what's|whats|who is|who are|who's)\s+/i,
];

/** Sentence-final particles and punctuation that carry no retrieval signal. */
const TRAIL_PATTERNS: readonly RegExp[] = [
  /[嗎吗呢吧啊阿喔哦耶欸捏麼么\s]+$/,
  /[?？!！。．，,、;；:：]+$/,
  /\s+(?:please|thanks|thank you|thx)$/i,
];

/**
 * Below this share of the original length the rewrite is thrown away — a query stripped to a
 * fragment ("what is it?" → "it") retrieves worse than the sentence it came from.
 *
 * Kept low on purpose. The obvious 0.4 punishes exactly the requests the rewrite helps most:
 * "Can you tell me about the Voyager probes, please" is 47 characters of which only 18 are
 * the query, and rejecting that rewrite would leave the padding in.
 */
const MIN_RETAINED_RATIO = 0.25;

function stripRepeatedly(text: string, patterns: readonly RegExp[]): string {
  let current = text;
  for (let pass = 0; pass < patterns.length; pass++) {
    let changed = false;
    for (const pattern of patterns) {
      const next = current.replace(pattern, '');
      if (next !== current) {
        current = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return current;
}

/**
 * Returns the rewritten query, or the trimmed original when the rewrite would go too far.
 * Never returns an empty string for a non-empty input.
 */
export function normalizeQuery(query: string): string {
  const original = query.replace(/\s+/g, ' ').trim();
  if (!original) return '';

  let text = stripRepeatedly(original, LEAD_PATTERNS);
  text = stripRepeatedly(text, TRAIL_PATTERNS);
  text = text.replace(/\s+/g, ' ').trim();

  if (!text) return original;
  if (text.length < original.length * MIN_RETAINED_RATIO) return original;
  return text;
}

/**
 * The queries one user request should be sent to the engine as — exactly one.
 *
 * Sending the original alongside the rewrite looks like free recall insurance and is not.
 * The rewrite only removes politeness and particles, so the two queries carry the same
 * content words and DuckDuckGo answers them almost identically; `dedupeHits` then collapses
 * the overlap. What it actually buys is a second SERP fetch per search against an engine
 * that serves a verification page when asked too often. A genuinely different angle is worth
 * the extra fetch, but nothing local can produce one — that is what `planQueryLlm` is for.
 */
export function queriesFor(query: string): string[] {
  return [normalizeQuery(query)];
}
