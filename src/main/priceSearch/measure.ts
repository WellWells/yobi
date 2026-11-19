/*
 * The size a listing's title states, so offers of different sizes can be compared by unit price
 * ("UCC 咖啡豆 100g" against a 454 g bag, an AirTag against the pack of four). Read from the title
 * only, by fixed rules: a title that states two different sizes (a listing with options) gives
 * none rather than a guess.
 */

export type MeasureUnit = '100g' | '100ml' | '1 pc';

export interface Measure {
  unit: MeasureUnit;
  /** Grams, millilitres or pieces in the whole listing. */
  amount: number;
}

/** The unit may be followed by the "x" of "450gx2", but not by another letter ("5gb", "2led"). */
const WEIGHT_VOLUME = /(?<![a-z\d.])(\d+(?:\.\d+)?)\s*(kg|g|ml|cc|l)(?![a-wyz]|x[a-z])/g;
/** Counters a pack is sold by; 抽 and 張 count sheets inside one pack, so they are not here. */
const COUNTER = '入|包|罐|瓶|盒|袋|組|件|支|顆|條|片|捲|卷|枚|粒|錠|個|杯|串|箱|提';
const TIMES = '[x×*]';
const COUNT_CHAIN = new RegExp(`(\\d{1,3})\\s*(?:${COUNTER})(?:\\s*${TIMES}\\s*(\\d{1,3})\\s*(?:${COUNTER}))*`, 'g');
const CHAIN_NUMBER = new RegExp(`(\\d{1,3})\\s*(?:${COUNTER})`, 'g');
/** "x 12", "×2盒" right after a size; not "x 30cm". */
const TIMES_AFTER = new RegExp(`^\\s*(?:/\\s*(?:${COUNTER}))?\\s*${TIMES}\\s*(\\d{1,3})(?!\\d|\\.\\d|\\s*(?:kg|g|ml|cc|l|cm|mm|m|w|v)(?![a-z]))\\s*(?:${COUNTER})?`);

/** Above this, the first number of a chain is sheets or capsules in a pack, not packs. */
const INNER_COUNT_FROM = 60;

const PER_UNIT: Record<string, { kind: 'g' | 'ml'; scale: number }> = {
  kg: { kind: 'g', scale: 1_000 },
  g: { kind: 'g', scale: 1 },
  l: { kind: 'ml', scale: 1_000 },
  ml: { kind: 'ml', scale: 1 },
  cc: { kind: 'ml', scale: 1 },
};

/** One spelling for comparing: full-width folded, lower case, Chinese unit names as their symbols. */
export function foldText(text: string): string {
  return text.normalize('NFKC').toLowerCase()
    .replace(/(\d)\s*公斤/g, '$1kg')
    .replace(/(\d)\s*公克/g, '$1g')
    .replace(/(\d)\s*克(?!力)/g, '$1g')
    .replace(/(\d)\s*毫升/g, '$1ml')
    .replace(/(\d)\s*公升/g, '$1l')
    .replace(/c\.c\./g, 'cc');
}

function productOf(numbers: readonly number[]): number {
  return numbers.reduce((total, n) => total * n, 1);
}

/**
 * Every "24包x3袋" or "4入" in the text, each as its total count. A chain that opens with a big
 * number counts what is inside one pack ("270組x6粒" is six rolls of 270 sheets), so that number
 * is left out.
 */
function packCounts(text: string): number[] {
  return [...text.matchAll(COUNT_CHAIN)].map((chain) => {
    const numbers = [...chain[0].matchAll(CHAIN_NUMBER)].map((part) => Number(part[1]));
    return productOf(numbers.length > 1 && numbers[0] > INNER_COUNT_FROM ? numbers.slice(1) : numbers);
  });
}

/** How many of the stated size the listing holds: the "x N" chain right after it, else the one pack count in the title. */
function multiplierAfter(text: string, sizeEnd: number): number {
  let rest = text.slice(sizeEnd);
  const factors: number[] = [];
  for (let hit = TIMES_AFTER.exec(rest); hit; hit = TIMES_AFTER.exec(rest)) {
    factors.push(Number(hit[1]));
    rest = rest.slice(hit[0].length);
  }
  if (factors.length) return productOf(factors);
  const counts = new Set(packCounts(text));
  return counts.size === 1 ? [...counts][0] : 1;
}

/** The size the title states, or null when it states none or more than one. */
export function measureOf(title: string): Measure | null {
  const text = foldText(title);
  const sizes = [...text.matchAll(WEIGHT_VOLUME)].map((hit) => {
    const per = PER_UNIT[hit[2]];
    return { kind: per.kind, amount: Number(hit[1]) * per.scale, end: hit.index + hit[0].length };
  }).filter((size) => size.amount > 0);
  if (sizes.length) {
    const distinct = new Set(sizes.map((size) => `${size.kind}:${size.amount}`));
    if (distinct.size !== 1) return null;
    const { kind, amount, end } = sizes[0];
    const total = amount * multiplierAfter(text, end);
    return { unit: kind === 'g' ? '100g' : '100ml', amount: total };
  }
  const counts = new Set(packCounts(text));
  if (counts.size !== 1) return null;
  const [pieces] = [...counts];
  return pieces > 0 ? { unit: '1 pc', amount: pieces } : null;
}

/** The price of one unit (100 g, 100 ml, one piece), to two decimals. */
export function unitPriceOf(price: number, measure: Measure): number {
  const per = measure.unit === '1 pc' ? 1 : 100;
  return Math.round((price / measure.amount) * per * 100) / 100;
}
