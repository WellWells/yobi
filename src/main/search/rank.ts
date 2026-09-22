import type { SerpHit, SourceDoc } from './types';

const K1 = 1.5;
const B = 0.75;
const SCORING_SAMPLE_CHARS = 20_000;

const WORD_RE = /[a-z0-9_]+/g;
const CJK_RE = /[぀-ヿ一-鿿가-힯]/g;

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = lower.match(WORD_RE) ?? [];
  const cjkChars = lower.match(CJK_RE) ?? [];
  for (let i = 0; i < cjkChars.length; i++) {
    tokens.push(cjkChars[i]);
    if (i + 1 < cjkChars.length) tokens.push(cjkChars[i] + cjkChars[i + 1]);
  }
  return tokens;
}

export function bm25Scores(texts: string[], query: string): number[] {
  if (texts.length === 0) return [];
  const queryTokens = Array.from(new Set(tokenize(query)));
  if (queryTokens.length === 0) return texts.map(() => 0);

  const termFrequencies = texts.map((text) => {
    const tf = new Map<string, number>();
    for (const token of tokenize(text)) tf.set(token, (tf.get(token) ?? 0) + 1);
    return tf;
  });
  const docLengths = termFrequencies.map((tf) => {
    let length = 0;
    for (const count of tf.values()) length += count;
    return length;
  });
  const avgLength = docLengths.reduce((sum, len) => sum + len, 0) / texts.length || 1;

  const documentFrequencies = new Map<string, number>();
  for (const token of queryTokens) {
    documentFrequencies.set(token, termFrequencies.filter((tf) => tf.has(token)).length);
  }

  return texts.map((_, index) => {
    let score = 0;
    for (const token of queryTokens) {
      const df = documentFrequencies.get(token) ?? 0;
      if (df === 0) continue;
      const idf = Math.log(1 + (texts.length - df + 0.5) / (df + 0.5));
      const tf = termFrequencies[index].get(token) ?? 0;
      const norm = 1 - B + B * (docLengths[index] / avgLength);
      score += idf * ((tf * (K1 + 1)) / (tf + K1 * norm));
    }
    return score;
  });
}

export function rankHits(hits: SerpHit[], query: string, freshnessOrdered: boolean): SerpHit[] {
  if (hits.length <= 1) return hits;
  const scores = bm25Scores(hits.map((hit) => `${hit.title}\n${hit.snippet ?? ''}`), query);
  const indexed = hits.map((hit, index) => ({ hit, score: scores[index], index }));
  if (freshnessOrdered) {
    return [...indexed.filter((e) => e.score > 0), ...indexed.filter((e) => e.score <= 0)]
      .map((e) => e.hit);
  }
  return indexed
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((e) => e.hit);
}

export interface ScoredSource {
  doc: SourceDoc;
  score: number;
}

export function rankSourcesScored(docs: SourceDoc[], query: string): ScoredSource[] {
  if (docs.length === 0) return [];
  if (docs.length === 1) return [{ doc: docs[0], score: 1 }];
  const scores = bm25Scores(
    docs.map((doc) => `${doc.title}\n${doc.text.slice(0, SCORING_SAMPLE_CHARS)}`),
    query,
  );
  return docs
    .map((doc, index) => ({ doc, score: scores[index] }))
    .sort((a, b) => b.score - a.score);
}
