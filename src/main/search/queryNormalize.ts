const LEAD_PATTERNS: readonly RegExp[] = [
  /^(?:請問|請你|請|麻煩你|麻煩|幫我(?:查詢|查|搜尋|找|看|問)一下|幫我(?:查詢|查|搜尋|找|看|問)|我想(?:知道|問|查|了解|瞭解)|我想|告訴我|查一下|搜尋一下|給我|想請教|想問)\s*/,
  /^(?:please|can you|could you|would you|tell me about|tell me|i want to know|i'd like to know|i wanna know|search for|look up|find me|find|show me|give me)\s+/i,
  /^(?:what is|what are|what's|whats|who is|who are|who's)\s+/i,
];

const TRAIL_PATTERNS: readonly RegExp[] = [
  /[嗎吗呢吧啊阿喔哦耶欸捏麼么\s]+$/,
  /[?？!！。．，,、;；:：]+$/,
  /\s+(?:please|thanks|thank you|thx)$/i,
];

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

export function queriesFor(query: string): string[] {
  return [normalizeQuery(query)];
}
