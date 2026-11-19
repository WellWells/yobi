/**
 * The one tokenisation the knowledge-base index and its queries share.
 *
 * SQLite's `unicode61` tokenizer keeps a run of CJK characters as one token, and `trigram` cannot
 * match a two-character word (逾期, 保固, 預算 — measured: 0 hits). So every CJK run is
 * rewritten as its overlapping two-character pairs (`保固期限` → `保固 固期 期限`) before it is
 * indexed, and a query is rewritten the same way: a two-character word is then one token, and a
 * longer one a phrase of pairs. Latin words and numbers stay as `unicode61` reads them.
 */

/** Han (incl. extension A and compatibility), kana, Hangul syllables. */
const CJK_RUN = /[㐀-鿿豈-﫿぀-ヿ가-힯]+/g;

/** A run as its overlapping pairs; a lone character stays itself. */
function pairs(run: string): string[] {
  const chars = [...run];
  if (chars.length === 1) return chars;
  const out: string[] = [];
  for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1]);
  return out;
}

/** The text as the index stores it. */
export function bigramText(text: string): string {
  return text.replace(CJK_RUN, (run) => ` ${pairs(run).join(' ')} `);
}

/** Latin words, numbers, and code-like tokens unicode61 would also keep (case-folded). */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}_]*/gu;

/** Words a query carries that match almost every chunk, so they only cost ranking. */
const QUERY_STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'what', 'how', 'which', 'who', 'when', 'where', 'why',
  '的', '了', '是', '在', '和', '與', '及', '或', '嗎', '呢', '吧', '我', '你', '他', '她', '它',
]);

/** Pairs that are mostly grammar, not topic: they would match everywhere. */
const PAIR_STOP = new Set([
  '什麼', '甚麼', '怎麼', '如何', '哪些', '哪個', '是否', '有沒', '沒有', '可以', '請問', '一下', '告訴', '幫我', '我們', '你們', '他們',
  '什么', '怎么', '哪个', '请问', '告诉', '帮我', '我们', '你们', '他们', '这个', '那个', '這個', '那個',
]);

/**
 * A question or a keyword list as the distinct terms an OR query is built from: each CJK pair and
 * each other word once, grammar dropped. Order is first appearance.
 */
export function queryTerms(text: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (term: string): void => {
    const key = term.toLowerCase();
    if (seen.has(key) || QUERY_STOP.has(key) || PAIR_STOP.has(key)) return;
    seen.add(key);
    terms.push(key);
  };
  const rest = text.replace(CJK_RUN, (run) => {
    for (const pair of pairs(run)) add(pair);
    return ' ';
  });
  for (const word of rest.match(WORD) ?? []) add(word);
  return terms;
}

/** An FTS5 MATCH expression: every term quoted, OR'ed. Empty when there is nothing to look for. */
export function ftsMatch(terms: readonly string[]): string {
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
}
